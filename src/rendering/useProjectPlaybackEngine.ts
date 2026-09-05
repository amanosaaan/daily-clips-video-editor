import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { getTotalDurationMs, resolvePosition, type TimelinePosition } from '../domain/timeline';
import type { Project } from '../domain/types';
import { getMediaObjectUrl } from '../storage/mediaRepository';
import { drawSceneFrame, drawTransitionFrame, type ResolvedAssetMap } from './compositor';
import { runExclusiveVideoDecode } from '../utils/videoDecodeQueue';

export interface ProjectPlaybackEngine {
  isPlaying: boolean;
  currentTimeMs: number;
  totalDurationMs: number;
  position: TimelinePosition | null;
  play: () => void;
  pause: () => void;
  seek: (globalTimeMs: number) => void;
  setHiddenLayerId: (layerId: string | null) => void;
  /** プレビューの再生速度(1=等倍)。書き出し結果には影響しない(プレビュー確認専用、Python版のspeed-btnと同じ)。 */
  playbackRate: number;
  setPlaybackRate: (rate: number) => void;
  /**
   * React state（currentTimeMs/position）を経由しない、間引き無しの現在時刻。
   * currentTimeMsはUIの再描画頻度を抑えるため約66ms間隔でしか更新されないので、
   * スクロール位置の追従など毎フレーム滑らかに動かしたい用途はこちらを使う。
   */
  getLiveTimeMs: () => number;
  /**
   * 読み込み(デコード)に失敗した素材のmediaId集合。プレビューが真っ黒/無音になる原因を
   * 画面上で分かるようにするためのもの(端末が対応していない動画コーデック等で起こりうる)。
   * 実際の失敗理由はブラウザのコンソールにも詳細を出力している。
   */
  mediaLoadErrors: Set<string>;
}

// 再生中はズレが大きい時だけ補正する（毎フレーム再シークすると音声にガサガサ
// というノイズが乗るため）。一時停止/スクラブ中は正確に追従させたいので閾値を狭くする。
const SEEK_THRESHOLD_PLAYING_SEC = 0.75;
const SEEK_THRESHOLD_PAUSED_SEC = 0.08;

// 端末やファイル形式によってはloadeddata/onerrorのどちらも一切発火しないことがあり、
// その場合Promiseが永久に解決しない(=このシーンより後の素材が一切読み込まれなくなる)。
// 一定時間で必ず諦めて次に進むための安全弁。大きな動画ファイルではモバイル回線/端末次第で
// loadeddataまでにこの程度掛かることもあるため、誤って「失敗」と判定しすぎないよう
// ある程度余裕を持たせている(タイムアウト後に実際は成功した場合はclearMediaLoadErrorで
// 後から取り消す)。
const MEDIA_LOAD_TIMEOUT_MS = 30000;
function raceTimeout(promise: Promise<void>, ms: number): Promise<'ok' | 'timeout'> {
  return Promise.race([
    promise.then((): 'ok' => 'ok'),
    new Promise<'timeout'>((resolve) => window.setTimeout(() => resolve('timeout'), ms)),
  ]);
}

/**
 * 動画/音声要素をシーン内のローカル時刻に同期させる。
 * ソースの長さより後ろの時刻を狙うと（例: 6秒のシーンに3秒のクリップを配置した場合の
 * 残り3秒）、currentTime をクランプした上で play() を呼び直し続けてしまい、
 * 「じーー」というブザーのような異音でループする。そのため、ソースの長さを超えた
 * 分は再生を試みず一時停止のままにする。
 */
// play()が失敗した場合、毎フレーム(el.pausedがtrueのまま)再試行して同じエラーを
// コンソールに出し続けないよう、要素ごとに一度だけ記録する。
const loggedPlayErrors = new WeakSet<HTMLMediaElement>();

function syncMediaElement(el: HTMLMediaElement, targetSec: number, shouldPlay: boolean, rate = 1): void {
  const hasEnded = Number.isFinite(el.duration) && el.duration > 0 && targetSec >= el.duration - 0.02;
  if (hasEnded) {
    if (!el.paused) el.pause();
    return;
  }

  if (el.playbackRate !== rate) el.playbackRate = rate;

  const threshold = el.paused ? SEEK_THRESHOLD_PAUSED_SEC : SEEK_THRESHOLD_PLAYING_SEC;
  if (Math.abs(el.currentTime - targetSec) > threshold) el.currentTime = targetSec;

  if (shouldPlay) {
    if (el.paused) {
      void el.play().catch((err) => {
        if (!loggedPlayErrors.has(el)) {
          loggedPlayErrors.add(el);
          console.error('動画/音声の再生に失敗しました(自動再生がブロックされたか、この端末で対応していない形式の可能性があります):', el.src, err);
        }
      });
    }
  } else if (!el.paused) {
    el.pause();
  }
}

export function useProjectPlaybackEngine(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  project: Project | null,
): ProjectPlaybackEngine {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeMsDisplay, setCurrentTimeMsDisplay] = useState(0);
  const [mediaLoadErrors, setMediaLoadErrors] = useState<Set<string>>(() => new Set());
  const mediaLoadErrorsRef = useRef<Set<string>>(new Set());
  const reportMediaLoadError = useCallback((mediaId: string, url: string, detail: unknown) => {
    console.error('素材の読み込み(デコード)に失敗しました。この端末/ブラウザが対応していない形式の可能性があります:', url, detail);
    if (mediaLoadErrorsRef.current.has(mediaId)) return;
    mediaLoadErrorsRef.current = new Set(mediaLoadErrorsRef.current).add(mediaId);
    setMediaLoadErrors(mediaLoadErrorsRef.current);
  }, []);
  // タイムアウト(MEDIA_LOAD_TIMEOUT_MS)で一旦「失敗」扱いにした後、実際にはそれより遅れて
  // loadeddata/onloadが発火して読み込めていた、というケースの誤検知を取り消す
  // (video.onloadeddata等のハンドラはPromise解決後も外していないため、遅れて呼ばれうる)。
  const clearMediaLoadError = useCallback((mediaId: string) => {
    if (!mediaLoadErrorsRef.current.has(mediaId)) return;
    const next = new Set(mediaLoadErrorsRef.current);
    next.delete(mediaId);
    mediaLoadErrorsRef.current = next;
    setMediaLoadErrors(next);
  }, []);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const playbackRateRef = useRef(1);
  const setPlaybackRate = useCallback((rate: number) => {
    playbackRateRef.current = rate;
    setPlaybackRateState(rate);
  }, []);
  const timeRef = useRef(0);
  const isPlayingRef = useRef(false);
  const assetsRef = useRef<ResolvedAssetMap>(new Map());
  const audioAssetsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  // 一括取り込み中はファイルが追加されるたびにprojectが変わり、下の先読みeffectが
  // 再実行される。以前はeffectの再実行のたびに進行中の読み込みを「古い実行」として
  // 中断・破棄し、次のeffect実行でまた同じmediaIdを最初からやり直していたため、
  // 大量ファイルの一括取り込み中は1本の動画すら読み込みが完了しないまま
  // 中断→再試行を延々と繰り返し、共有の直列デコードキュー(videoDecodeQueue.ts)を
  // 占有し続けて取り込み自体まで巻き込んでタイムアウトさせる不具合があった。
  // このrefで「現在読み込み中のmediaId」を管理し、effectが再実行されても
  // 進行中の読み込みは中断せず最後まで完了させ、新しいeffect実行はまだ着手して
  // いないmediaIdだけを拾うようにする。
  const loadingMediaIdsRef = useRef<Set<string>>(new Set());
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const lastUiSyncRef = useRef(0);
  const projectIdRef = useRef<string | null>(null);
  const hiddenContainerRef = useRef<HTMLDivElement | null>(null);
  const hiddenLayerIdRef = useRef<string | null>(null);
  const setHiddenLayerId = useCallback((layerId: string | null) => {
    hiddenLayerIdRef.current = layerId;
  }, []);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // UI表示用のcurrentTimeMsDisplay(rAFループとは別に、~66ms間隔で確実に更新される
  // 既存の仕組み)から導出する現在シーン番号。下の先読み/解放effectのトリガーに使う。
  // rAFループの実行タイミングに依存せず、React effectの通常の再レンダーの仕組みで
  // 確実に発火する(以前のウィンドウ方式がrAFの発火状況に挙動が左右されて不安定
  // だった反省を踏まえた設計)。
  const currentPosition = project ? resolvePosition(project, currentTimeMsDisplay) : null;
  const currentSceneIndex = currentPosition?.sceneIndex ?? 0;

  // 動画要素を実際にDOMへ配置しておく置き場所（非表示）。
  // detached な <video> のまま drawImage で毎フレーム読むと、ブラウザが
  // オフスクリーン扱いにしてデコードを間引き、再生がカクつくことがあるため。
  // 幅・高さ0の要素はiOS(WebKit)では「実質非表示」とみなされ、再生や音声は
  // 進んでいるように見えても実際のフレームがデコード・合成されず、
  // canvasへのdrawImageが真っ黒になることがある(面積0の場合の既知の挙動)。
  // 幅・高さを2pxに広げただけでは不十分で、実機のデバッグログでloadeddataが
  // 30秒たっても一切発火しない(=デコード自体が始まっていない)ケースが確認された。
  // left:-9999pxのようにビューポートの外へ大きくずらす配置自体が、iOS(WebKit)側で
  // 「画面に交差していない要素」としてデコードを完全に止める判定基準になっている
  // 可能性が高いため、ビューポート内(0,0)に置いたまま、ごく薄い不透明度と
  // 背面へのz-indexで視覚的に見えなくする方式に変更した。
  useEffect(() => {
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.left = '0';
    container.style.top = '0';
    container.style.width = '2px';
    container.style.height = '2px';
    container.style.overflow = 'hidden';
    container.style.opacity = '0.01';
    container.style.zIndex = '-1';
    container.style.pointerEvents = 'none';
    container.setAttribute('aria-hidden', 'true');
    document.body.appendChild(container);
    hiddenContainerRef.current = container;
    return () => {
      container.remove();
      hiddenContainerRef.current = null;
    };
  }, []);

  // プロジェクトが切り替わったら再生位置をリセットする
  useEffect(() => {
    if (project && projectIdRef.current !== project.id) {
      projectIdRef.current = project.id;
      timeRef.current = 0;
      setCurrentTimeMsDisplay(0);
      lastTsRef.current = null;
      for (const el of assetsRef.current.values()) {
        if (el instanceof HTMLVideoElement) {
          el.pause();
          el.removeAttribute('src');
          el.load();
          el.remove();
        }
      }
      assetsRef.current = new Map();
      for (const el of audioAssetsRef.current.values()) {
        el.pause();
        el.removeAttribute('src');
        el.load();
        el.remove();
      }
      audioAssetsRef.current = new Map();
      loadingMediaIdsRef.current = new Set();
      mediaLoadErrorsRef.current = new Set();
      setMediaLoadErrors(mediaLoadErrorsRef.current);
    }
  }, [project]);

  // レイヤーやシーンの削除でどこからも参照されなくなった動画/画像/音声を破棄する。
  // 参照が切れた <video>/<audio> を放置すると、再生中だった場合に誰も pause() を呼ばず
  // 音声だけ鳴り続けたままになってしまうため。
  useEffect(() => {
    if (!project) return;
    const referencedIds = new Set<string>();
    const referencedAudioIds = new Set<string>();
    for (const scene of project.scenes) {
      for (const layer of scene.layers) {
        if (layer.type === 'video' || layer.type === 'image') referencedIds.add(layer.mediaId);
        if (layer.type === 'audio') referencedAudioIds.add(layer.mediaId);
      }
    }
    for (const [mediaId, el] of assetsRef.current) {
      if (referencedIds.has(mediaId)) continue;
      if (el instanceof HTMLVideoElement) {
        el.pause();
        el.removeAttribute('src');
        el.load();
        el.remove();
      }
      assetsRef.current.delete(mediaId);
    }
    for (const [mediaId, el] of audioAssetsRef.current) {
      if (referencedAudioIds.has(mediaId)) continue;
      el.pause();
      el.removeAttribute('src');
      el.load();
      el.remove();
      audioAssetsRef.current.delete(mediaId);
    }
  }, [project]);

  // 現在のシーンの前後1シーン分(計3シーン)で使われている動画/画像/音声だけを読み込み、
  // ウィンドウの外に出たものは解放する。
  //
  // 以前は「動画編集アプリ２と同じ、シンプルな全件先読み方式」(全シーン分を常に
  // 一括で読み込む)を採用していたが、これは動画3本程度の小規模プロジェクトを前提と
  // した設計であり、数十本規模の一括取り込みプロジェクトでは同時に開く<video>/<audio>
  // 要素の数が端末の実際の同時デコード可能数を超え、ほぼ全てが読み込みタイムアウトに
  // なる不具合が実機で確認された(書き出し側で同じ理由の不具合が起き、シーン単位の
  // ウィンドウ方式で解決できた実績があり、同じ考え方をここにも適用した)。
  //
  // 以前一度ウィンドウ方式を試みて「シークすると再生できない」不具合を起こし全件方式に
  // 戻した経緯があるが、その際の原因は「ウィンドウの再計算をrAFループの実行タイミングに
  // 依存させていた」ことだったと考えられる(rAFは非表示タブ等で発火が遅延・停止する
  // ことがある)。今回はrAFループとは独立した、currentTimeMsDisplay(UIの現在時刻表示にも
  // 使っている、通常のReact effectの仕組みで確実に更新される値)から導出したシーン番号を
  // 依存配列に使うことで、この問題を避けている。
  useEffect(() => {
    if (!project) return;

    async function loadVideoAsset(mediaId: string, url: string): Promise<void> {
      const video = document.createElement('video');
      video.playsInline = true;
      video.preload = 'auto';
      // iOS/WebKitはpreload="auto"を額面通り尊重せず、実際のデータ取得/デコードを
      // 開始しないことがある。ミュート状態でのplay()呼び出しはユーザー操作無しでも
      // 許可されるため、これを「本当に読み込め」という明示的な合図として使う
      // (実際の音量/ミュート状態は再生開始時にel.mutedへ改めて設定し直される)。
      video.muted = true;
      hiddenContainerRef.current?.appendChild(video);
      video.src = url;
      // 複数の<video>要素が同時に実際のデコードを試みると、iOS/WebKitでは
      // どちらもloadeddata/errorが永久に発火しなくなることが実機で繰り返し
      // 確認されたため、実データの取得(play()呼び出し)はアプリ全体で1本ずつ
      // 直列に行う(videoDecodeQueue.ts参照)。
      const outcome = await runExclusiveVideoDecode(() =>
        raceTimeout(
          new Promise<void>((resolve) => {
            video.onloadeddata = () => {
              video.pause();
              clearMediaLoadError(mediaId);
              resolve();
            };
            // video.error.codeでコーデック非対応(MEDIA_ERR_SRC_NOT_SUPPORTED=4)か
            // デコード失敗(MEDIA_ERR_DECODE=3)かなどが分かる。
            video.onerror = () => {
              reportMediaLoadError(mediaId, url, video.error);
              resolve();
            };
            video.play().catch(() => {});
          }),
          MEDIA_LOAD_TIMEOUT_MS,
        ),
      );
      if (outcome === 'timeout') reportMediaLoadError(mediaId, url, 'timeout');
      assetsRef.current.set(mediaId, video);
    }

    async function loadImageAsset(mediaId: string, url: string): Promise<void> {
      const img = new Image();
      img.src = url;
      const outcome = await raceTimeout(
        new Promise<void>((resolve) => {
          img.onload = () => {
            clearMediaLoadError(mediaId);
            resolve();
          };
          img.onerror = (err) => {
            reportMediaLoadError(mediaId, url, err);
            resolve();
          };
        }),
        MEDIA_LOAD_TIMEOUT_MS,
      );
      if (outcome === 'timeout') reportMediaLoadError(mediaId, url, 'timeout');
      assetsRef.current.set(mediaId, img);
    }

    async function loadAudioAsset(mediaId: string, url: string): Promise<void> {
      const audio = document.createElement('audio');
      audio.preload = 'auto';
      // 動画と同じ理由(iOS/WebKitがpreload="auto"を尊重しないことがある)で、
      // ミュートしたplay()で実際の読み込みを明示的に促す。
      audio.muted = true;
      hiddenContainerRef.current?.appendChild(audio);
      audio.src = url;
      const outcome = await runExclusiveVideoDecode(() =>
        raceTimeout(
          new Promise<void>((resolve) => {
            audio.onloadeddata = () => {
              audio.pause();
              clearMediaLoadError(mediaId);
              resolve();
            };
            audio.onerror = () => {
              reportMediaLoadError(mediaId, url, audio.error);
              resolve();
            };
            audio.play().catch(() => {});
          }),
          MEDIA_LOAD_TIMEOUT_MS,
        ),
      );
      if (outcome === 'timeout') reportMediaLoadError(mediaId, url, 'timeout');
      audioAssetsRef.current.set(mediaId, audio);
    }

    const windowSceneIndices = [currentSceneIndex - 1, currentSceneIndex, currentSceneIndex + 1].filter(
      (i) => i >= 0 && i < project.scenes.length,
    );
    const neededMediaIds = new Set<string>();
    const neededAudioIds = new Set<string>();
    for (const idx of windowSceneIndices) {
      for (const layer of project.scenes[idx].layers) {
        if (layer.type === 'video' || layer.type === 'image') neededMediaIds.add(layer.mediaId);
        if (layer.type === 'audio') neededAudioIds.add(layer.mediaId);
      }
    }

    // ウィンドウの外に出た(前後1シーンより遠くなった)素材は解放する。まだ読み込み中
    // (loadingMediaIdsRef)のものは、完了時にassetsRefへ入った時点で次回のeffect実行時に
    // 改めて解放されるので、ここで特別扱いする必要はない。
    for (const [mediaId, el] of assetsRef.current) {
      if (neededMediaIds.has(mediaId)) continue;
      if (el instanceof HTMLVideoElement) {
        el.pause();
        el.removeAttribute('src');
        el.load();
        el.remove();
      }
      assetsRef.current.delete(mediaId);
    }
    for (const [mediaId, el] of audioAssetsRef.current) {
      if (neededAudioIds.has(mediaId)) continue;
      el.pause();
      el.removeAttribute('src');
      el.load();
      el.remove();
      audioAssetsRef.current.delete(mediaId);
    }

    // ウィンドウ内でまだ読み込んでいない素材を読み込む。一括取り込み中はファイルが
    // 追加されるたびにこのeffectが再実行されるが、既に読み込み中(loadingMediaIdsRef)の
    // mediaIdは再度着手しない。これにより、前回のeffect実行で開始した読み込みが
    // 「古い実行」として中断されることなく最後まで完了できる
    // (loadingMediaIdsRefの説明コメント参照)。
    for (const idx of windowSceneIndices) {
      for (const layer of project.scenes[idx].layers) {
        if (layer.type !== 'video' && layer.type !== 'image' && layer.type !== 'audio') continue;
        const mediaId = layer.mediaId;
        if (loadingMediaIdsRef.current.has(mediaId)) continue;
        if ((layer.type === 'video' || layer.type === 'image') && !assetsRef.current.has(mediaId)) {
          loadingMediaIdsRef.current.add(mediaId);
          void (async () => {
            try {
              const url = await getMediaObjectUrl(mediaId);
              if (!url) return;
              if (layer.type === 'video') await loadVideoAsset(mediaId, url);
              else await loadImageAsset(mediaId, url);
            } finally {
              loadingMediaIdsRef.current.delete(mediaId);
            }
          })();
        } else if (layer.type === 'audio' && !audioAssetsRef.current.has(mediaId)) {
          loadingMediaIdsRef.current.add(mediaId);
          void (async () => {
            try {
              const url = await getMediaObjectUrl(mediaId);
              if (!url) return;
              await loadAudioAsset(mediaId, url);
            } finally {
              loadingMediaIdsRef.current.delete(mediaId);
            }
          })();
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, currentSceneIndex]);

  useEffect(() => {
    function loop(ts: number) {
      if (lastTsRef.current === null) lastTsRef.current = ts;
      const delta = ts - lastTsRef.current;
      lastTsRef.current = ts;

      if (project) {
        const totalDuration = getTotalDurationMs(project);
        if (isPlayingRef.current) {
          timeRef.current = Math.min(timeRef.current + delta * playbackRateRef.current, totalDuration);
        }

        let position = resolvePosition(project, timeRef.current);

        // 現在のシーンを駆動している動画がすでに再生中なら、その動画自身の
        // 再生位置を正としてタイムラインを合わせる（独自クロックとのズレによる
        // 頻繁な re-seek＝カクつきを防ぐ）。
        if (position && isPlayingRef.current) {
          const anchorLayer = position.scene.layers.find((l) => l.type === 'video');
          const anchorEl = anchorLayer ? (assetsRef.current.get(anchorLayer.mediaId) as HTMLVideoElement | undefined) : undefined;
          if (anchorLayer && anchorEl && !anchorEl.paused && anchorEl.readyState >= 2) {
            const realLocalMs = anchorEl.currentTime * 1000 - anchorLayer.trimStart;
            if (Number.isFinite(realLocalMs) && realLocalMs >= 0) {
              timeRef.current = Math.min(position.sceneStartMs + realLocalMs, totalDuration);
              position = resolvePosition(project, timeRef.current);
            }
          }
        }

        if (isPlayingRef.current && timeRef.current >= totalDuration) {
          isPlayingRef.current = false;
          setIsPlaying(false);
        }

        if (position) {
          // シーン分割で作られた前後のシーンは同じ素材(mediaId)を共有していることがある。
          // 「現在のシーンでなければ一時停止」という単純なルールだと、同じ<audio>要素を
          // 参照する「現在は使っていない方のシーン」を処理したタイミングで一時停止してしまい、
          // 直後に現在のシーン側の処理で再生を再開する…を毎フレーム繰り返して
          // 再生が全く進まなくなる（フリーズしたように見える）。
          // そのため、現在のシーンでも使われている素材は他シーン側の処理で止めないようにする。
          const currentSceneAudioMediaIds = new Set(
            position.scene.layers.filter((l) => l.type === 'audio').map((l) => l.mediaId),
          );
          for (const scene of project.scenes) {
            const isCurrentScene = scene.id === position.scene.id;
            for (const layer of scene.layers) {
              if (layer.type !== 'audio') continue;
              const el = audioAssetsRef.current.get(layer.mediaId);
              if (!el) continue;
              if (isCurrentScene) {
                const targetSec = (layer.trimStart + position.localTimeMs) / 1000;
                el.volume = layer.volume;
                syncMediaElement(el, targetSec, isPlayingRef.current, playbackRateRef.current);
              } else if (!currentSceneAudioMediaIds.has(layer.mediaId) && !el.paused) {
                el.pause();
              }
            }
          }
        }

        const canvas = canvasRef.current;
        if (canvas && position) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            // 音声と同じ理由（シーン分割による素材の共有）で、現在のシーンでも
            // 使われているvideoは他シーン側の処理で一時停止しないようにする。
            const currentSceneVideoMediaIds = new Set(
              position.scene.layers.filter((l) => l.type === 'video').map((l) => l.mediaId),
            );
            for (const scene of project.scenes) {
              const isCurrentScene = scene.id === position.scene.id;
              for (const layer of scene.layers) {
                if (layer.type !== 'video') continue;
                const el = assetsRef.current.get(layer.mediaId) as HTMLVideoElement | undefined;
                if (!el) continue;
                if (isCurrentScene) {
                  const targetSec = (layer.trimStart + position.localTimeMs) / 1000;
                  el.muted = layer.muted;
                  el.volume = layer.muted ? 0 : layer.volume;
                  syncMediaElement(el, targetSec, isPlayingRef.current, playbackRateRef.current);
                } else if (!currentSceneVideoMediaIds.has(layer.mediaId) && !el.paused) {
                  el.pause();
                }
              }
            }
            const transition = position.scene.transitionOut;
            const remainingInSceneMs = position.scene.duration - position.localTimeMs;
            const nextScene = project.scenes[position.sceneIndex + 1];
            if (transition && nextScene && remainingInSceneMs <= transition.durationMs) {
              // 次シーンの動画は再生開始せず、トリム開始位置の静止フレームを重ねる
              for (const layer of nextScene.layers) {
                if (layer.type !== 'video') continue;
                const el = assetsRef.current.get(layer.mediaId) as HTMLVideoElement | undefined;
                if (!el || !el.paused) continue;
                const startSec = layer.trimStart / 1000;
                if (Math.abs(el.currentTime - startSec) > 0.05) el.currentTime = startSec;
              }
              const progress = 1 - remainingInSceneMs / transition.durationMs;
              drawTransitionFrame(
                ctx,
                position.scene,
                nextScene,
                progress,
                transition,
                project.resolution.width,
                project.resolution.height,
                assetsRef.current,
                position.localTimeMs,
                { enabled: project.burnDateEnabled, position: project.burnDatePosition },
              );
            } else {
              drawSceneFrame(
                ctx,
                position.scene,
                project.resolution.width,
                project.resolution.height,
                assetsRef.current,
                position.localTimeMs,
                hiddenLayerIdRef.current,
                { enabled: project.burnDateEnabled, position: project.burnDatePosition },
              );
            }
          }
        }
      }

      if (ts - lastUiSyncRef.current > 66) {
        lastUiSyncRef.current = ts;
        setCurrentTimeMsDisplay(timeRef.current);
      }

      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastTsRef.current = null;
    };
  }, [project, canvasRef]);

  const play = useCallback(() => {
    if (project && timeRef.current >= getTotalDurationMs(project)) {
      timeRef.current = 0;
      setCurrentTimeMsDisplay(0);
    }
    // ブラウザの自動再生ポリシー対策: video/audioのplay()は、ユーザー操作（タップ/クリック）
    // ハンドラの同期呼び出しの中で行わないとブロックされることがある（特にiOS Safari）。
    // rAFループ側で非同期にplay()を呼んでいるだけだと、再生ボタンを押しても実際には
    // ブロックされて再生されない（音も出ない）ことがあるため、ボタン押下と同じ
    // 呼び出しスタック内で現在シーンの動画・音声を、正しい再生位置にシークした上で
    // 先に再生開始しておく（rAFループと同じsyncMediaElementを使うことで、
    // 「まず0秒から再生されてから数フレーム後に正しい位置へ飛ぶ」ような
    // 一瞬のノイズ/コマ飛びが起きないようにする）。
    if (project) {
      const position = resolvePosition(project, timeRef.current);
      if (position) {
        for (const layer of position.scene.layers) {
          if (layer.type === 'video') {
            const el = assetsRef.current.get(layer.mediaId);
            if (el instanceof HTMLVideoElement) {
              // muted/volumeもこのユーザー操作の呼び出しスタック内で確定させておく。
              // rAFループ側(ユーザー操作ではない)で後からmuted=falseに変えると、
              // 一部のブラウザでは自動再生ポリシー的に再生が止められてしまうことがあるため。
              el.muted = layer.muted;
              el.volume = layer.muted ? 0 : layer.volume;
              syncMediaElement(el, (layer.trimStart + position.localTimeMs) / 1000, true, playbackRateRef.current);
            }
          } else if (layer.type === 'audio') {
            const el = audioAssetsRef.current.get(layer.mediaId);
            if (el) {
              el.volume = layer.volume;
              syncMediaElement(el, (layer.trimStart + position.localTimeMs) / 1000, true, playbackRateRef.current);
            }
          }
        }
      }
    }
    setIsPlaying(true);
  }, [project]);

  const pause = useCallback(() => setIsPlaying(false), []);

  const seek = useCallback(
    (globalTimeMs: number) => {
      const total = project ? getTotalDurationMs(project) : 0;
      timeRef.current = Math.max(0, Math.min(globalTimeMs, total));
      setCurrentTimeMsDisplay(timeRef.current);
    },
    [project],
  );

  const getLiveTimeMs = useCallback(() => timeRef.current, []);

  return {
    isPlaying,
    currentTimeMs: currentTimeMsDisplay,
    totalDurationMs: project ? getTotalDurationMs(project) : 0,
    position: currentPosition,
    play,
    pause,
    seek,
    setHiddenLayerId,
    getLiveTimeMs,
    playbackRate,
    setPlaybackRate,
    mediaLoadErrors,
  };
}
