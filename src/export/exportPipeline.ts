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
import { runExclusiveVideoDecode } from '../utils/videoDecodeQueue';

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
 */
type VideoFrameSource = {
  /** 直近のフレームを描き込んだcanvas。compositor.tsへはこれを渡す(<video>要素の代わり)。 */
  canvas: HTMLCanvasElement;
  sink: VideoSampleSink;
  input: Input;
  currentSample: VideoSample | null;
  currentTimestampSec: number | null;
};

async function createVideoFrameSource(blob: Blob): Promise<VideoFrameSource> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) {
    input.dispose();
    throw new Error('動画トラックが見つかりませんでした');
  }
  // 回転メタデータを反映した「表示上の」幅・高さ(<video>要素のvideoWidth/videoHeightに相当)。
  const displayWidth = await track.getDisplayWidth();
  const displayHeight = await track.getDisplayHeight();
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(displayWidth));
  canvas.height = Math.max(1, Math.round(displayHeight));
  const sink = new VideoSampleSink(track);
  return { canvas, sink, input, currentSample: null, currentTimestampSec: null };
}

async function seekVideoFrameSource(source: VideoFrameSource, timeSec: number): Promise<void> {
  const clamped = Math.max(0, timeSec);
  if (source.currentTimestampSec !== null && Math.abs(source.currentTimestampSec - clamped) < 0.0005) return;
  const sample = await source.sink.getSample(clamped);
  if (!sample) return;
  const ctx = source.canvas.getContext('2d');
  if (!ctx) return;
  sample.draw(ctx, 0, 0, source.canvas.width, source.canvas.height);
  source.currentSample?.close();
  source.currentSample = sample;
  source.currentTimestampSec = clamped;
}

function disposeVideoFrameSource(source: VideoFrameSource): void {
  source.currentSample?.close();
  source.input.dispose();
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
    const decoded = await offlineCtx.decodeAudioData(arrayBuffer);
    return scheduleDecodedBuffer(offlineCtx, decoded, trimStartMs, volume, sceneStartMs, sceneDurationMs);
  } catch (err) {
    console.warn(
      '標準のdecodeAudioDataに失敗したため、mediabunny経由でのデコードにフォールバックします(iPhoneカメラ動画のApple空間音声トラック等が原因の可能性):',
      mediaId,
      err,
    );
  }

  try {
    return await runExclusiveVideoDecode(() =>
      scheduleAudioSourceViaMediabunny(offlineCtx, blob, trimStartMs, volume, sceneStartMs, sceneDurationMs),
    );
  } catch (err) {
    // 音声デコードに失敗した場合はそのレイヤーを無音として扱う(書き出し自体は止めない)。
    // 原因(コーデック非対応等)を追えるよう詳細はコンソールに残しておく。
    console.error('音声のデコードに失敗しました(このレイヤーは無音になります):', mediaId, err);
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

  try {
    // トランジションで次シーンの素材も必要になるため、全シーン分を先に読み込んでおく
    for (const scene of project.scenes) {
      for (const layer of scene.layers) {
        if (layer.type === 'video' && !videoFrameSources.has(layer.mediaId)) {
          const blob = await getMediaBlob(layer.mediaId);
          if (!blob) continue;
          const source = await createVideoFrameSource(blob);
          videoFrameSources.set(layer.mediaId, source);
          assets.set(layer.mediaId, source.canvas);
        } else if (layer.type === 'image' && !assets.has(layer.mediaId)) {
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

      const sceneFrameCount = Math.max(1, Math.round((scene.duration / 1000) * fps));
      for (let f = 0; f < sceneFrameCount; f++) {
        const localTimeMs = (f / fps) * 1000;
        for (const layer of scene.layers) {
          if (layer.type === 'video') {
            const source = videoFrameSources.get(layer.mediaId);
            if (source) await seekVideoFrameSource(source, (layer.trimStart + localTimeMs) / 1000);
          }
        }

        const remainingInSceneMs = scene.duration - localTimeMs;
        if (transition && nextScene && remainingInSceneMs <= transition.durationMs) {
          for (const layer of nextScene.layers) {
            if (layer.type === 'video') {
              const source = videoFrameSources.get(layer.mediaId);
              if (source) await seekVideoFrameSource(source, layer.trimStart / 1000);
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
      disposeVideoFrameSource(source);
    }
  }

  if (!target.buffer) throw new Error('書き出しに失敗しました');
  return new Blob([target.buffer], { type: 'video/mp4' });
}
