import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_LOW,
  QUALITY_MEDIUM,
  QUALITY_VERY_HIGH,
  VideoSampleSink,
  type VideoSample,
  type Quality,
} from 'mediabunny';
import type { Project } from '../domain/types';
import { getMediaBlob, getMediaObjectUrl } from '../storage/mediaRepository';
import { drawSceneFrame, drawTransitionFrame, type ResolvedAssetMap } from '../rendering/compositor';
import { runExclusiveVideoDecode, setExportInProgress } from '../utils/videoDecodeQueue';

function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => resolve('timeout'), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      },
    );
  });
}
const MEDIA_LOAD_TIMEOUT_MS = 30000;

// デバッグログにmediaId(内部の識別子、人間には読めないランダムな文字列)だけ出しても
// ユーザーが「どのファイルのことか」分からず切り分けに困るため、元のファイル名も
// 一緒に出せるようにする。exportProjectToMp4の最初にセットし、終了時にクリアする
// (関数の引数として全箇所に通すより、このファイル内で完結する軽量な方法を優先した)。
let mediaNameLookup: Map<string, string> | null = null;
function describeMedia(mediaId: string): string {
  const name = mediaNameLookup?.get(mediaId);
  return name ? `${name} (${mediaId})` : mediaId;
}

export type ExportQuality = 'low' | 'medium' | 'high' | 'veryHigh';

const QUALITY_PRESETS: Record<ExportQuality, Quality> = {
  low: QUALITY_LOW,
  medium: QUALITY_MEDIUM,
  high: QUALITY_HIGH,
  veryHigh: QUALITY_VERY_HIGH,
};

export interface ExportOptions {
  fps?: number;
  quality?: ExportQuality;
  onProgress?: (ratio: number) => void;
}

/**
 * 書き出しの動画フレーム取得は、以前は<video>要素のcurrentTimeシーク("seeked"/
 * requestVideoFrameCallback待ち)で行っていたが、次のような問題が繰り返し発生した:
 * - iOS/WebKit実機でloadeddata/errorが永久に発火しない(デコーダー同時使用数制限)
 * - 'seeked'は実際のフレーム内容が古いまま発火することが多く、書き出し結果がカクつく
 * - rVFCを優先すると正確にはなるが、キーフレーム間隔の広いiPhone動画で1フレームごとの
 *   シークが重く、書き出しが極端に遅くなる
 * これらは全て「<video>要素のシークで1フレームずつ取り出す」という方式そのものに
 * 起因する不安定さ/低速さと考えられるため、書き出し用に既に導入済みのmediabunny
 * (WebCodecsベースの自前デマルチプレクサ/デコーダー)のVideoSampleSinkで直接
 * フレームを取り出す方式に変更した。<video>要素・DOM挿入・シークイベント待ちを
 * 一切使わないため、上記の問題を構造的に回避できる。
 *
 * ただし、WebCodecsが正式にサポートするコーデックの範囲は<video>要素(ブラウザの
 * メディア再生パイプライン)が再生できる範囲より狭いことがあり、実機で「This video
 * track cannot be decoded by this browser」というmediabunny側のエラーで書き出し
 * 全体が失敗する不具合が確認された。そのため、mediabunnyでデコード不可能と判定された
 * 動画だけは、以前使っていた<video>要素方式にフォールバックする(両対応)。
 */
interface VideoFrameSource {
  /** 直近のフレームを描き込んだcanvas。compositor.tsへはこれを渡す(<video>要素の代わり)。 */
  canvas: HTMLCanvasElement;
  seek(timeSec: number): Promise<void>;
  dispose(): void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// canDecode()は実際にはコーデック自体は対応しているのに、他の処理(プレビューの裏読み込み
// や他の動画のデコード)によるリソース競合で一時的にfalseを返すことがある実機での
// 検証で確認された(同じファイルを他の処理と競合しない単独の状況で試すと確実にtrueを
// 返すのに、実際のアプリ内では稀にfalseと判定され、不要に不安定な<video>要素の
// フォールバックへ回ってしまっていた)。そのため、falseだった場合は少し待ってから
// 数回だけ問い合わせ直す。
async function canDecodeWithRetry(track: { canDecode(): Promise<boolean> }): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await track.canDecode()) return true;
    if (attempt < 2) await sleep(500);
  }
  return false;
}

async function createMediabunnyVideoFrameSource(blob: Blob): Promise<VideoFrameSource | null> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track || !(await canDecodeWithRetry(track))) {
    input.dispose();
    return null;
  }
  // 回転メタデータを反映した「表示上の」幅・高さ(<video>要素のvideoWidth/videoHeightに相当)。
  const displayWidth = await track.getDisplayWidth();
  const displayHeight = await track.getDisplayHeight();
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(displayWidth));
  canvas.height = Math.max(1, Math.round(displayHeight));
  const sink = new VideoSampleSink(track);
  let currentSample: VideoSample | null = null;
  let currentTimestampSec: number | null = null;

  // 書き出しは1シーン内ではフレーム順(昇順)にしかseekしないため、毎回getSample()で
  // 個別に探しに行くより、sink.samples()の連続イテレーターを使い回した方がずっと速い
  // (mediabunny曰く「パケットを1回しかデコードしない最適化されたパイプライン」)。
  // トランジションや別mediaIdへの切り替えで時刻が後退・大きく飛ぶ場合だけ、その時刻から
  // イテレーターを取り直す。getSample()と同じ「指定時刻以下で一番近いサンプル」という
  // 意味を保つため、先読みしたサンプルが指定時刻を超えたところで確定させる。
  let iterator: AsyncGenerator<VideoSample, void, unknown> | null = null;
  let pending: VideoSample | null = null;
  let lastResultTimestampSec: number | null = null;

  async function getSampleAtOrBefore(targetSec: number): Promise<VideoSample | null> {
    const needsRestart =
      !iterator ||
      (lastResultTimestampSec !== null && targetSec < lastResultTimestampSec) ||
      (pending !== null && pending.timestamp > targetSec + 5);
    if (needsRestart) {
      void iterator?.return?.();
      pending?.close();
      pending = null;
      iterator = sink.samples(targetSec);
    }

    let result: VideoSample | null = null;
    for (;;) {
      if (!pending) {
        const next = await iterator!.next();
        if (next.done || !next.value) break;
        pending = next.value;
      }
      if (pending.timestamp > targetSec) break;
      result?.close();
      result = pending;
      pending = null;
    }
    if (result) lastResultTimestampSec = result.timestamp;
    return result;
  }

  return {
    canvas,
    async seek(timeSec) {
      const clamped = Math.max(0, timeSec);
      if (currentTimestampSec !== null && Math.abs(currentTimestampSec - clamped) < 0.0005) return;
      const sample = await getSampleAtOrBefore(clamped);
      if (!sample) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      sample.draw(ctx, 0, 0, canvas.width, canvas.height);
      currentSample?.close();
      currentSample = sample;
      currentTimestampSec = clamped;
    },
    dispose() {
      currentSample?.close();
      pending?.close();
      void iterator?.return?.();
      input.dispose();
    },
  };
}

// mediabunny(WebCodecs)でデコードできない動画専用の、<video>要素ベースのフォールバック。
// 非表示コンテナに実体を置く・play()で明示的に読み込みを促す・rVFC優先でシークする、
// といった対策は、いずれも実機での不具合調査を経て必要だと判明したもの
// (mediaRepository.ts/useProjectPlaybackEngine.tsと同じ理由)。
let hiddenExportFallbackContainer: HTMLDivElement | null = null;
function getHiddenExportFallbackContainer(): HTMLDivElement {
  if (!hiddenExportFallbackContainer) {
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
    hiddenExportFallbackContainer = container;
  }
  return hiddenExportFallbackContainer;
}

async function createVideoElementFrameSource(url: string): Promise<VideoFrameSource> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  getHiddenExportFallbackContainer().appendChild(video);
  video.src = url;
  await runExclusiveVideoDecode(
    () =>
      new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('動画の読み込みがタイムアウトしました')), MEDIA_LOAD_TIMEOUT_MS);
        video.onloadeddata = () => {
          window.clearTimeout(timer);
          video.pause();
          resolve();
        };
        video.onerror = () => {
          window.clearTimeout(timer);
          reject(new Error('動画の読み込みに失敗しました'));
        };
        video.play().catch(() => {});
      }),
  );

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, video.videoWidth);
  canvas.height = Math.max(1, video.videoHeight);
  const useFrameCallback = typeof video.requestVideoFrameCallback === 'function';

  return {
    canvas,
    async seek(timeSec) {
      const clamped = Math.max(0, Math.min(timeSec, video.duration || timeSec));
      if (Math.abs(video.currentTime - clamped) >= 0.001) {
        await raceTimeout(
          new Promise<void>((resolve) => {
            const onSeeked = () => resolve();
            if (useFrameCallback) {
              video.requestVideoFrameCallback(() => resolve());
            } else {
              video.addEventListener('seeked', onSeeked, { once: true });
            }
            video.currentTime = clamped;
          }),
          useFrameCallback ? 2000 : 1000,
        );
      }
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    },
    dispose() {
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.remove();
    },
  };
}

async function createVideoFrameSource(mediaId: string): Promise<VideoFrameSource> {
  const blob = await getMediaBlob(mediaId);
  if (!blob) throw new Error('動画データが見つかりませんでした');

  // mediabunnyのトラック確認(getPrimaryVideoTrack/canDecode)自体にはタイムアウトが
  // 無いため、通常は一瞬で終わるはずのこの処理に短めの保険を掛けておく。ここを
  // <video>要素フォールバック側の30秒タイムアウトと二重に(入れ子で)くくると、
  // 外側のタイムアウトが内側の正当な待ち時間の途中で先に発火してしまいかねないため、
  // 別々に、短い時間(この確認処理用)と長い時間(実際の読み込み用)で分けている。
  const mediabunnyOutcome = await raceTimeout(
    createMediabunnyVideoFrameSource(blob).catch((err) => {
      console.warn('mediabunnyでの動画デコードに失敗したため、<video>要素にフォールバックします:', describeMedia(mediaId), err);
      return null;
    }),
    10000,
  );
  const viaMediabunny = mediabunnyOutcome === 'timeout' ? null : mediabunnyOutcome;
  if (mediabunnyOutcome === 'timeout') {
    console.warn('mediabunnyでのトラック確認がタイムアウトしたため、<video>要素にフォールバックします:', describeMedia(mediaId));
  }
  if (viaMediabunny) return viaMediabunny;

  console.warn(
    'この動画はWebCodecsでデコードできない形式のため、<video>要素方式にフォールバックします(書き出し結果のカクつき/低速化が起きやすい可能性があります):',
    describeMedia(mediaId),
  );
  const url = await getMediaObjectUrl(mediaId);
  if (!url) throw new Error('動画URLが取得できませんでした');
  return createVideoElementFrameSource(url);
}

async function loadImageElement(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
  });
  return img;
}

function scheduleDecodedBuffer(
  offlineCtx: OfflineAudioContext,
  decoded: AudioBuffer,
  trimStartMs: number,
  volume: number,
  sceneStartMs: number,
  sceneDurationMs: number,
): boolean {
  const offsetSec = trimStartMs / 1000;
  const durationSec = Math.min(sceneDurationMs / 1000, Math.max(0, decoded.duration - offsetSec));
  if (durationSec <= 0) return false;
  const source = offlineCtx.createBufferSource();
  source.buffer = decoded;
  const gain = offlineCtx.createGain();
  gain.gain.value = volume;
  source.connect(gain).connect(offlineCtx.destination);
  source.start(sceneStartMs / 1000, offsetSec, durationSec);
  return true;
}

/**
 * iPhoneのカメラで撮影した.movは、通常のAAC音声トラックに加えてApple独自の空間音声
 * (apacコーデック、ブラウザ未対応)や複数のメタデータトラック(mebx)を同梱していることが
 * あり、この構成のファイルではブラウザ標準のdecodeAudioDataがEncodingErrorで失敗する
 * ことが実機で確認された(LINE等で再エンコードされた通常のAAC単体ファイルでは問題なし)。
 * mediabunny(WebCodecsベースの自前デマルチプレクサ/デコーダー、書き出し用に既に導入
 * 済み)であれば、主音声トラック(AAC)だけを明示的に選んでデコードできるため、
 * decodeAudioDataが失敗した場合のフォールバックとして使う。
 */
async function scheduleAudioSourceViaMediabunny(
  offlineCtx: OfflineAudioContext,
  blob: Blob,
  trimStartMs: number,
  volume: number,
  sceneStartMs: number,
  sceneDurationMs: number,
): Promise<boolean> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    // iPhoneのSpatial Audio対応動画は、通常のAAC音声トラックとは別にApple独自の
    // apacトラックも同梱していることがある。getPrimaryAudioTrack()は無条件だと
    // このapacトラック(ブラウザ/WebCodecsとも未対応)を「主音声トラック」として
    // 選んでしまうことがあったため、実際にデコード可能なトラックだけに絞り込む。
    const track = await input.getPrimaryAudioTrack({ filter: (t) => t.canDecode() });
    if (!track) return false;

    const offsetSec = trimStartMs / 1000;
    const endSec = offsetSec + sceneDurationMs / 1000;
    const gain = offlineCtx.createGain();
    gain.gain.value = volume;
    gain.connect(offlineCtx.destination);

    const sink = new AudioBufferSink(track);
    let scheduledAny = false;
    for await (const chunk of sink.buffers(offsetSec, endSec)) {
      const chunkStartInClip = Math.max(chunk.timestamp, offsetSec);
      const chunkEndInClip = Math.min(chunk.timestamp + chunk.duration, endSec);
      const playDurationSec = chunkEndInClip - chunkStartInClip;
      if (playDurationSec <= 0) continue;
      const withinBufferOffsetSec = chunkStartInClip - chunk.timestamp;
      const atTime = sceneStartMs / 1000 + (chunkStartInClip - offsetSec);
      if (atTime < 0) continue;
      const source = offlineCtx.createBufferSource();
      source.buffer = chunk.buffer;
      source.connect(gain);
      source.start(atTime, withinBufferOffsetSec, playDurationSec);
      scheduledAny = true;
    }
    return scheduledAny;
  } finally {
    // Inputを使い終わったら明示的に解放する。放置すると内部のデコーダーリソースが
    // 残り続け、後続の<video>要素の読み込み(iOS/WebKitはデコーダー同時使用数が
    // 少ない)を巻き込んでタイムアウトさせる恐れがある。
    input.dispose();
  }
}

async function scheduleAudioSource(
  offlineCtx: OfflineAudioContext,
  mediaId: string,
  trimStartMs: number,
  volume: number,
  sceneStartMs: number,
  sceneDurationMs: number,
): Promise<boolean> {
  const blob = await getMediaBlob(mediaId);
  if (!blob) return false;

  try {
    const arrayBuffer = await blob.arrayBuffer();
    // decodeAudioDataは失敗時にすぐ例外を投げてくれる分には問題ないが、特定のファイルで
    // 例外も発生も無いまま永久に解決しないことがあり、その場合ここでbuildProjectAudioBuffer
    // 全体が止まり、書き出しが0%から一切進まなくなる不具合が実機で確認された
    // (大量ファイル一括取り込みの用途では、1本でもこれに当たる確率が上がる)。
    // 他の読み込み処理と同様にタイムアウトの保険を掛けておく。
    const outcome = await raceTimeout(offlineCtx.decodeAudioData(arrayBuffer), MEDIA_LOAD_TIMEOUT_MS);
    if (outcome === 'timeout') throw new Error('decodeAudioDataがタイムアウトしました');
    return scheduleDecodedBuffer(offlineCtx, outcome, trimStartMs, volume, sceneStartMs, sceneDurationMs);
  } catch (err) {
    console.warn(
      '標準のdecodeAudioDataに失敗したため、mediabunny経由でのデコードにフォールバックします(iPhoneカメラ動画のApple空間音声トラック等が原因の可能性):',
      describeMedia(mediaId),
      err,
    );
  }

  try {
    const outcome = await raceTimeout(
      runExclusiveVideoDecode(() =>
        scheduleAudioSourceViaMediabunny(offlineCtx, blob, trimStartMs, volume, sceneStartMs, sceneDurationMs),
      ),
      MEDIA_LOAD_TIMEOUT_MS,
    );
    if (outcome === 'timeout') throw new Error('mediabunny経由の音声デコードがタイムアウトしました');
    return outcome;
  } catch (err) {
    // 音声デコードに失敗した場合はそのレイヤーを無音として扱う(書き出し自体は止めない)。
    // 原因(コーデック非対応等)を追えるよう詳細はコンソールに残しておく。
    console.error('音声のデコードに失敗しました(このレイヤーは無音になります):', describeMedia(mediaId), err);
    return false;
  }
}

async function buildProjectAudioBuffer(project: Project): Promise<AudioBuffer | null> {
  const totalDurationMs = project.scenes.reduce((sum, s) => sum + s.duration, 0);
  if (totalDurationMs <= 0) return null;

  const sampleRate = 44100;
  const offlineCtx = new OfflineAudioContext(2, Math.ceil((totalDurationMs / 1000) * sampleRate), sampleRate);

  let sceneStartMs = 0;
  let hasAnyAudio = false;
  let attemptedAnyAudio = false;

  for (const scene of project.scenes) {
    for (const layer of scene.layers) {
      if (layer.type === 'video' && !layer.muted && layer.volume > 0) {
        attemptedAnyAudio = true;
        const scheduled = await scheduleAudioSource(offlineCtx, layer.mediaId, layer.trimStart, layer.volume, sceneStartMs, scene.duration);
        hasAnyAudio ||= scheduled;
      } else if (layer.type === 'audio' && layer.volume > 0) {
        attemptedAnyAudio = true;
        const scheduled = await scheduleAudioSource(offlineCtx, layer.mediaId, layer.trimStart, layer.volume, sceneStartMs, scene.duration);
        hasAnyAudio ||= scheduled;
      }
    }
    sceneStartMs += scene.duration;
  }

  if (!hasAnyAudio) {
    if (attemptedAnyAudio) {
      console.error('音声を1件もデコードできなかったため、書き出し結果は無音になります(上に個別のエラーが出力されているはずです)。');
    }
    return null;
  }
  return offlineCtx.startRendering();
}

export async function exportProjectToMp4(project: Project, options: ExportOptions = {}): Promise<Blob> {
  mediaNameLookup = new Map(project.mediaLibrary.map((m) => [m.id, m.name]));
  // 書き出し中はプレビュー側の裏読み込みが同じ直列デコードキューを取り合わないよう、
  // 新規の先読み開始を止める(videoDecodeQueue.tsのコメント参照)。
  setExportInProgress(true);
  try {
    return await exportProjectToMp4Inner(project, options);
  } finally {
    setExportInProgress(false);
    mediaNameLookup = null;
  }
}

async function exportProjectToMp4Inner(project: Project, options: ExportOptions): Promise<Blob> {
  const fps = options.fps ?? project.fps ?? 30;
  const quality = QUALITY_PRESETS[options.quality ?? 'high'];
  const { width, height } = project.resolution;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas context を取得できませんでした');

  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const videoSource = new CanvasSource(canvas, { codec: 'avc', quality });
  output.addVideoTrack(videoSource, { frameRate: fps });

  const audioBuffer = await buildProjectAudioBuffer(project);
  let audioSource: AudioBufferSource | null = null;
  if (audioBuffer) {
    audioSource = new AudioBufferSource({ codec: 'aac', quality });
    output.addAudioTrack(audioSource);
  }

  await output.start();

  const totalDurationMs = project.scenes.reduce((sum, s) => sum + s.duration, 0);
  const frameDurationSec = 1 / fps;
  const assets: ResolvedAssetMap = new Map();
  const videoFrameSources = new Map<string, VideoFrameSource>();

  // 動画1本ごとにmediabunnyのInput/VideoSampleSink(WebCodecsデコーダー)を開くため、
  // 大量ファイルの一括取り込みで作った(数十本規模の)プロジェクトを全シーン分まとめて
  // 先読みすると、同時に開くデコーダーの数が端末の実際の同時デコード可能数を超え、
  // canDecode()が(コーデック非対応ではなく単なるリソース不足で)falseを返したり、
  // 読み込み自体がタイムアウトしたりする不具合が実機で確認された(iOS固有ではなく、
  // PCの大量ファイル一括取り込みでも発生)。そのため動画だけは全件先読みをやめ、
  // 「今処理中のシーン」+「トランジションで必要な次のシーン」の分だけをその都度
  // 開き、不要になった時点ですぐ解放する方式に変更した(画像は軽いため従来通り
  // 全件先読みのままで問題ない)。
  async function ensureVideoFrameSource(mediaId: string): Promise<void> {
    if (videoFrameSources.has(mediaId)) return;
    try {
      // createVideoFrameSource内部では、mediabunnyのトラック確認(最大10秒)→
      // 失敗時は<video>要素フォールバック(最大30秒、こちらは独自にタイムアウト済み)
      // という流れになりうるため、この外側の安全弁は両方を合わせても収まるよう、
      // MEDIA_LOAD_TIMEOUT_MSより長めに取っている(内側のタイムアウトが正当に
      // 動作している途中で外側が先に発火してしまわないようにするため)。
      const outcome = await raceTimeout(createVideoFrameSource(mediaId), MEDIA_LOAD_TIMEOUT_MS + 15000);
      if (outcome === 'timeout') throw new Error('動画フレームの読み込みがタイムアウトしました');
      videoFrameSources.set(mediaId, outcome);
      assets.set(mediaId, outcome.canvas);
    } catch (err) {
      // mediabunny/<video>要素のどちらでも読み込めなかった場合、この動画レイヤーは
      // 書き出し結果に映らなくなるが、書き出し自体は続ける(1本のせいで全体が
      // 失敗するのを避けるため。デコード不可の原因を追えるようログは残す)。
      console.error('この動画は書き出し用にデコードできませんでした(このレイヤーは書き出し結果に含まれません):', describeMedia(mediaId), err);
    }
  }

  function releaseUnneededVideoFrameSources(neededMediaIds: Set<string>): void {
    for (const [mediaId, source] of videoFrameSources) {
      if (neededMediaIds.has(mediaId)) continue;
      source.dispose();
      videoFrameSources.delete(mediaId);
      assets.delete(mediaId);
    }
  }

  // 読み込み(ensureVideoFrameSource)自体は成功しても、その後の毎フレームのseek()が
  // 特定のファイルで想定外に長時間かかる/解決しないケースが実機で確認された
  // (書き出しの進捗が特定のパーセントから一切進まなくなる)。原因を完全には特定
  // できていないため、個々のseek()呼び出しにも安全弁を掛けておく。タイムアウトした
  // 場合はそのフレームでは前回描画した内容のまま(canvas上は更新されない)進める
  // (書き出し全体を止めないことを優先する)。一度タイムアウトした動画は、以降ずっと
  // 同じ調子で毎フレーム5秒ずつ無駄に待つと書き出し全体が極端に遅くなるため、
  // その動画へのseek自体を以降スキップするようにする(残りのフレームは前回の内容の
  // まま=静止画のようになるが、書き出しは現実的な時間で完了する)。
  const seekTimeoutMediaIds = new Set<string>();
  async function safeSeek(source: VideoFrameSource, mediaId: string, timeSec: number): Promise<void> {
    if (seekTimeoutMediaIds.has(mediaId)) return;
    const outcome = await raceTimeout(source.seek(timeSec), 5000);
    if (outcome === 'timeout') {
      seekTimeoutMediaIds.add(mediaId);
      console.error(
        'この動画のシーク処理がタイムアウトしました(以降このクリップは前回の内容のまま進めます。書き出し自体は継続します):',
        describeMedia(mediaId),
      );
    }
  }

  try {
    // 画像は動画と違ってデコーダーのリソース制約が無いため、従来通り全件先読みする。
    for (const scene of project.scenes) {
      for (const layer of scene.layers) {
        if (layer.type === 'image' && !assets.has(layer.mediaId)) {
          const url = await getMediaObjectUrl(layer.mediaId);
          if (!url) continue;
          assets.set(layer.mediaId, await loadImageElement(url));
        }
      }
    }

    let elapsedMs = 0;
    let framesWritten = 0;
    const totalFrames = Math.max(1, Math.round((totalDurationMs / 1000) * fps));

    for (let sceneIndex = 0; sceneIndex < project.scenes.length; sceneIndex++) {
      const scene = project.scenes[sceneIndex];
      const nextScene = project.scenes[sceneIndex + 1];
      const transition = scene.transitionOut;

      // このシーンの再生に必要な動画(このシーン自身+トランジションがあれば次シーン分)
      // だけを用意し、それ以外(前のシーンで使っていたもの等)は解放する。
      const neededMediaIds = new Set<string>();
      for (const layer of scene.layers) if (layer.type === 'video') neededMediaIds.add(layer.mediaId);
      if (transition && nextScene) {
        for (const layer of nextScene.layers) if (layer.type === 'video') neededMediaIds.add(layer.mediaId);
      }
      releaseUnneededVideoFrameSources(neededMediaIds);
      for (const mediaId of neededMediaIds) {
        await ensureVideoFrameSource(mediaId);
      }

      const sceneFrameCount = Math.max(1, Math.round((scene.duration / 1000) * fps));
      for (let f = 0; f < sceneFrameCount; f++) {
        const localTimeMs = (f / fps) * 1000;
        for (const layer of scene.layers) {
          if (layer.type === 'video') {
            const source = videoFrameSources.get(layer.mediaId);
            if (source) await safeSeek(source, layer.mediaId, (layer.trimStart + localTimeMs) / 1000);
          }
        }

        const remainingInSceneMs = scene.duration - localTimeMs;
        if (transition && nextScene && remainingInSceneMs <= transition.durationMs) {
          for (const layer of nextScene.layers) {
            if (layer.type === 'video') {
              const source = videoFrameSources.get(layer.mediaId);
              if (source) await safeSeek(source, layer.mediaId, layer.trimStart / 1000);
            }
          }
          const progress = 1 - remainingInSceneMs / transition.durationMs;
          drawTransitionFrame(ctx, scene, nextScene, progress, transition, width, height, assets, localTimeMs, {
            enabled: project.burnDateEnabled,
            position: project.burnDatePosition,
          });
        } else {
          drawSceneFrame(ctx, scene, width, height, assets, localTimeMs, undefined, {
            enabled: project.burnDateEnabled,
            position: project.burnDatePosition,
          });
        }

        const timestampSec = elapsedMs / 1000 + localTimeMs / 1000;
        await videoSource.add(timestampSec, frameDurationSec);
        framesWritten++;
        options.onProgress?.(Math.min(1, framesWritten / totalFrames));
      }
      elapsedMs += scene.duration;
    }

    if (audioSource && audioBuffer) {
      await audioSource.add(audioBuffer);
    }

    await output.finalize();
  } finally {
    // 書き出し用に開いたmediabunnyのInput/VideoFrame等のリソースは使い捨てなので、
    // 成功/失敗に関わらず必ず解放する(放置するとデコーダーリソースが残り続け、
    // 次回以降の書き出しに影響する恐れがある)。
    for (const source of videoFrameSources.values()) {
      source.dispose();
    }
  }

  if (!target.buffer) throw new Error('書き出しに失敗しました');
  return new Blob([target.buffer], { type: 'video/mp4' });
}
