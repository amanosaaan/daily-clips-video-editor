import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_LOW,
  QUALITY_MEDIUM,
  QUALITY_VERY_HIGH,
  type Quality,
} from 'mediabunny';
import type { Project } from '../domain/types';
import { getMediaBlob, getMediaObjectUrl } from '../storage/mediaRepository';
import { drawSceneFrame, drawTransitionFrame, type ResolvedAssetMap } from '../rendering/compositor';

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
 * 動画を指定秒数へシークし、実際にそのフレームが描画に使える状態になるまで待つ。
 * 'seeked'イベントは「シーク操作自体が完了した」タイミングで発火するが、特にモバイル端末や
 * HEVC等キーフレーム間隔の広いコーデックでは、そのタイミングでdrawImageしても実際には
 * 直前のフレームのままのことがあり、書き出し結果がカクつく原因になっていた。
 * requestVideoFrameCallbackは「新しいフレームが実際に提示された」タイミングで呼ばれるため、
 * より正確だが、タブが非アクティブ/非表示の環境ではrAF同様に発火が遅延・停止することがある。
 * そのため'seeked'と両方待ち受け、どちらか早く来た方で確定させる(rVFCが来ればより正確、
 * 来なくても'seeked'だけで従来通り進められる=極端な低速化を避ける)。
 */
async function seekVideo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  const clamped = Math.max(0, Math.min(timeSec, video.duration || timeSec));
  if (Math.abs(video.currentTime - clamped) < 0.001) return;

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };

    const onSeeked = () => finish();
    video.addEventListener('seeked', onSeeked);
    if (typeof video.requestVideoFrameCallback === 'function') {
      video.requestVideoFrameCallback(finish);
    }
    video.currentTime = clamped;

    // 端末やファイル形式によってはイベントが一切発火しないことがあり、その場合
    // 書き出し全体が永久に止まってしまう。一定時間で諦めて次のフレームへ進む安全弁。
    window.setTimeout(finish, 1000);
  });
}

// 書き出し用に読み込む<video>要素の置き場所(非表示)。DOMに繋がっていないと、
// 特にモバイル端末でloadeddata/seeked/requestVideoFrameCallbackが発火しない・
// 極端に遅くなることがある(useProjectPlaybackEngine.ts/mediaRepository.tsと同じ理由)。
// 幅・高さを0にすると実質非表示扱いになりフレームが提示されないことがあるため面積0には
// していないが、それだけでは不十分だったことが実機のデバッグログで判明した。
// left:-9999pxのようにビューポートの外へ大きくずらす配置自体が、iOS(WebKit)側で
// 「画面に交差していない要素」としてデコードを止める判定基準になっている可能性が高いため、
// ビューポート内(0,0)に置いたまま、ごく薄い不透明度と背面へのz-indexで見えなくする。
let hiddenExportContainer: HTMLDivElement | null = null;
function getHiddenExportContainer(): HTMLDivElement {
  if (!hiddenExportContainer) {
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
    hiddenExportContainer = container;
  }
  return hiddenExportContainer;
}

async function loadVideoElement(url: string): Promise<HTMLVideoElement> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  getHiddenExportContainer().appendChild(video);
  video.src = url;
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('動画の読み込みがタイムアウトしました')), 30000);
    video.onloadeddata = () => {
      window.clearTimeout(timer);
      video.pause();
      resolve();
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error('動画の読み込みに失敗しました'));
    };
    // iOS/WebKitはpreload="auto"を額面通り尊重せず、実際のデータ取得/デコードを
    // 開始しないことがある。ミュートしたplay()で明示的に読み込みを促す
    // (mediaRepository.ts/useProjectPlaybackEngine.tsと同じ対策)。
    video.play().catch(() => {});
  });
  return video;
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

async function scheduleAudioSource(
  offlineCtx: OfflineAudioContext,
  mediaId: string,
  trimStartMs: number,
  volume: number,
  sceneStartMs: number,
  sceneDurationMs: number,
): Promise<boolean> {
  try {
    const blob = await getMediaBlob(mediaId);
    if (!blob) return false;
    const arrayBuffer = await blob.arrayBuffer();
    const decoded = await offlineCtx.decodeAudioData(arrayBuffer);
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

  try {
    // トランジションで次シーンの素材も必要になるため、全シーン分を先に読み込んでおく
    for (const scene of project.scenes) {
      for (const layer of scene.layers) {
        if ((layer.type === 'video' || layer.type === 'image') && !assets.has(layer.mediaId)) {
          const url = await getMediaObjectUrl(layer.mediaId);
          if (!url) continue;
          assets.set(layer.mediaId, layer.type === 'video' ? await loadVideoElement(url) : await loadImageElement(url));
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
            const el = assets.get(layer.mediaId) as HTMLVideoElement | undefined;
            if (el) await seekVideo(el, (layer.trimStart + localTimeMs) / 1000);
          }
        }

        const remainingInSceneMs = scene.duration - localTimeMs;
        if (transition && nextScene && remainingInSceneMs <= transition.durationMs) {
          for (const layer of nextScene.layers) {
            if (layer.type === 'video') {
              const el = assets.get(layer.mediaId) as HTMLVideoElement | undefined;
              if (el) await seekVideo(el, layer.trimStart / 1000);
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
    // 書き出し用に読み込んだ<video>要素は使い捨てなので、成功/失敗に関わらず必ず片付ける
    // (放置すると次回以降の書き出しのたびに非表示コンテナ内に要素が増え続けてしまう)。
    for (const el of assets.values()) {
      if (el instanceof HTMLVideoElement) {
        el.pause();
        el.removeAttribute('src');
        el.load();
        el.remove();
      }
    }
  }

  if (!target.buffer) throw new Error('書き出しに失敗しました');
  return new Blob([target.buffer], { type: 'video/mp4' });
}
