import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { getTotalDurationMs, resolvePosition, type TimelinePosition } from '../domain/timeline';
import type { Project } from '../domain/types';
import { getMediaObjectUrl } from '../storage/mediaRepository';
import { drawSceneFrame, drawTransitionFrame, type ResolvedAssetMap } from './compositor';

export interface ProjectPlaybackEngine {
  isPlaying: boolean;
  currentTimeMs: number;
  totalDurationMs: number;
  position: TimelinePosition | null;
  play: () => void;
  pause: () => void;
  seek: (globalTimeMs: number) => void;
  setHiddenLayerId: (layerId: string | null) => void;
  /**
   * React state（currentTimeMs/position）を経由しない、間引き無しの現在時刻。
   * currentTimeMsはUIの再描画頻度を抑えるため約66ms間隔でしか更新されないので、
   * スクロール位置の追従など毎フレーム滑らかに動かしたい用途はこちらを使う。
   */
  getLiveTimeMs: () => number;
}

// 再生中はズレが大きい時だけ補正する（毎フレーム再シークすると音声にガサガサ
// というノイズが乗るため）。一時停止/スクラブ中は正確に追従させたいので閾値を狭くする。
const SEEK_THRESHOLD_PLAYING_SEC = 0.75;
const SEEK_THRESHOLD_PAUSED_SEC = 0.08;

/**
 * 動画/音声要素をシーン内のローカル時刻に同期させる。
 * ソースの長さより後ろの時刻を狙うと（例: 6秒のシーンに3秒のクリップを配置した場合の
 * 残り3秒）、currentTime をクランプした上で play() を呼び直し続けてしまい、
 * 「じーー」というブザーのような異音でループする。そのため、ソースの長さを超えた
 * 分は再生を試みず一時停止のままにする。
 */
function syncMediaElement(el: HTMLMediaElement, targetSec: number, shouldPlay: boolean): void {
  const hasEnded = Number.isFinite(el.duration) && el.duration > 0 && targetSec >= el.duration - 0.02;
  if (hasEnded) {
    if (!el.paused) el.pause();
    return;
  }

  const threshold = el.paused ? SEEK_THRESHOLD_PAUSED_SEC : SEEK_THRESHOLD_PLAYING_SEC;
  if (Math.abs(el.currentTime - targetSec) > threshold) el.currentTime = targetSec;

  if (shouldPlay) {
    if (el.paused) void el.play().catch(() => {});
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
  const timeRef = useRef(0);
  const isPlayingRef = useRef(false);
  const assetsRef = useRef<ResolvedAssetMap>(new Map());
  const audioAssetsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
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

  // 動画要素を実際にDOMへ配置しておく置き場所（非表示）。
  // detached な <video> のまま drawImage で毎フレーム読むと、ブラウザが
  // オフスクリーン扱いにしてデコードを間引き、再生がカクつくことがあるため。
  useEffect(() => {
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.width = '0';
    container.style.height = '0';
    container.style.overflow = 'hidden';
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

  // 全シーンで参照されている動画/画像を読み込んでおく（シーン境界をまたぐ再生を途切れさせないため）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!project) return;
      for (const scene of project.scenes) {
        for (const layer of scene.layers) {
          if ((layer.type === 'video' || layer.type === 'image') && !assetsRef.current.has(layer.mediaId)) {
            const url = await getMediaObjectUrl(layer.mediaId);
            if (!url || cancelled) continue;
            if (layer.type === 'video') {
              const video = document.createElement('video');
              video.playsInline = true;
              video.preload = 'auto';
              hiddenContainerRef.current?.appendChild(video);
              video.src = url;
              await new Promise<void>((resolve) => {
                video.onloadeddata = () => resolve();
                video.onerror = () => resolve();
              });
              if (!cancelled) assetsRef.current.set(layer.mediaId, video);
              else video.remove();
            } else {
              const img = new Image();
              img.src = url;
              await new Promise<void>((resolve) => {
                img.onload = () => resolve();
                img.onerror = () => resolve();
              });
              if (!cancelled) assetsRef.current.set(layer.mediaId, img);
            }
          } else if (layer.type === 'audio' && !audioAssetsRef.current.has(layer.mediaId)) {
            const url = await getMediaObjectUrl(layer.mediaId);
            if (!url || cancelled) continue;
            const audio = document.createElement('audio');
            audio.preload = 'auto';
            hiddenContainerRef.current?.appendChild(audio);
            audio.src = url;
            await new Promise<void>((resolve) => {
              audio.onloadeddata = () => resolve();
              audio.onerror = () => resolve();
            });
            if (!cancelled) audioAssetsRef.current.set(layer.mediaId, audio);
            else audio.remove();
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project]);

  useEffect(() => {
    function loop(ts: number) {
      if (lastTsRef.current === null) lastTsRef.current = ts;
      const delta = ts - lastTsRef.current;
      lastTsRef.current = ts;

      if (project) {
        const totalDuration = getTotalDurationMs(project);
        if (isPlayingRef.current) {
          timeRef.current = Math.min(timeRef.current + delta, totalDuration);
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
                syncMediaElement(el, targetSec, isPlayingRef.current);
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
                  syncMediaElement(el, targetSec, isPlayingRef.current);
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
              syncMediaElement(el, (layer.trimStart + position.localTimeMs) / 1000, true);
            }
          } else if (layer.type === 'audio') {
            const el = audioAssetsRef.current.get(layer.mediaId);
            if (el) {
              syncMediaElement(el, (layer.trimStart + position.localTimeMs) / 1000, true);
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
    position: project ? resolvePosition(project, currentTimeMsDisplay) : null,
    play,
    pause,
    seek,
    setHiddenLayerId,
    getLiveTimeMs,
  };
}
