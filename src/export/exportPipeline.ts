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

async function seekVideo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  const clamped = Math.max(0, Math.min(timeSec, video.duration || timeSec));
  if (Math.abs(video.currentTime - clamped) < 0.001) return;
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = clamped;
  });
}

async function loadVideoElement(url: string): Promise<HTMLVideoElement> {
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error('動画の読み込みに失敗しました'));
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
  } catch {
    // 音声デコードに失敗した場合はそのレイヤーを無音として扱う
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

  for (const scene of project.scenes) {
    for (const layer of scene.layers) {
      if (layer.type === 'video' && !layer.muted && layer.volume > 0) {
        const scheduled = await scheduleAudioSource(offlineCtx, layer.mediaId, layer.trimStart, layer.volume, sceneStartMs, scene.duration);
        hasAnyAudio ||= scheduled;
      } else if (layer.type === 'audio' && layer.volume > 0) {
        const scheduled = await scheduleAudioSource(offlineCtx, layer.mediaId, layer.trimStart, layer.volume, sceneStartMs, scene.duration);
        hasAnyAudio ||= scheduled;
      }
    }
    sceneStartMs += scene.duration;
  }

  if (!hasAnyAudio) return null;
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
  if (!target.buffer) throw new Error('書き出しに失敗しました');
  return new Blob([target.buffer], { type: 'video/mp4' });
}
