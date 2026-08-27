import { nanoid } from 'nanoid';
import { db } from './db';
import type { MediaAsset } from '../domain/types';

const mediaUrlCache = new Map<string, string>();
const thumbnailUrlCache = new Map<string, string>();

function detectKind(mime: string): MediaAsset['kind'] {
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'image';
}

async function readVideoMetadata(url: string): Promise<{ durationMs: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.src = url;
    video.onloadedmetadata = () => {
      resolve({ durationMs: video.duration * 1000, width: video.videoWidth, height: video.videoHeight });
    };
    video.onerror = () => reject(new Error('動画メタデータの読み込みに失敗しました'));
  });
}

async function readAudioMetadata(url: string): Promise<{ durationMs: number }> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.src = url;
    audio.onloadedmetadata = () => resolve({ durationMs: audio.duration * 1000 });
    audio.onerror = () => reject(new Error('音声メタデータの読み込みに失敗しました'));
  });
}

async function readImageMetadata(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('画像メタデータの読み込みに失敗しました'));
    img.src = url;
  });
}

async function generateVideoThumbnail(mediaId: string, url: string, width: number, height: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.src = url;
    video.currentTime = 0;
    video.onloadeddata = () => {
      video.currentTime = Math.min(0.5, (video.duration || 1) / 2);
    };
    video.onseeked = async () => {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 320 / width);
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('canvas context を取得できませんでした'));
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(async (blob) => {
        if (!blob) return reject(new Error('サムネイル生成に失敗しました'));
        const id = nanoid();
        await db.thumbnails.put({ id, mediaId, blob });
        resolve(id);
      }, 'image/jpeg', 0.8);
    };
    video.onerror = () => reject(new Error('サムネイル用の動画読み込みに失敗しました'));
  });
}

async function generateImageThumbnail(mediaId: string, url: string, width: number, height: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 320 / width);
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('canvas context を取得できませんでした'));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(async (blob) => {
        if (!blob) return reject(new Error('サムネイル生成に失敗しました'));
        const id = nanoid();
        await db.thumbnails.put({ id, mediaId, blob });
        resolve(id);
      }, 'image/jpeg', 0.8);
    };
    img.onerror = () => reject(new Error('サムネイル用の画像読み込みに失敗しました'));
    img.src = url;
  });
}

export async function addMediaBlob(
  projectId: string,
  blob: Blob,
  name: string,
): Promise<MediaAsset> {
  const kind = detectKind(blob.type);
  const id = nanoid();
  await db.mediaBlobs.put({ id, projectId, blob, mime: blob.type, sizeBytes: blob.size });

  const url = getMediaObjectUrlFromBlob(id, blob);

  let durationMs: number | undefined;
  let width: number | undefined;
  let height: number | undefined;
  let thumbnailBlobId: string | undefined;

  if (kind === 'video') {
    const meta = await readVideoMetadata(url);
    durationMs = meta.durationMs;
    width = meta.width;
    height = meta.height;
    thumbnailBlobId = await generateVideoThumbnail(id, url, width, height);
  } else if (kind === 'image') {
    const meta = await readImageMetadata(url);
    width = meta.width;
    height = meta.height;
    thumbnailBlobId = await generateImageThumbnail(id, url, width, height);
  } else {
    const meta = await readAudioMetadata(url);
    durationMs = meta.durationMs;
  }

  return {
    id,
    kind,
    name,
    durationMs,
    width,
    height,
    createdAt: Date.now(),
    sizeBytes: blob.size,
    thumbnailBlobId,
  };
}

export async function addMediaFile(projectId: string, file: File): Promise<MediaAsset> {
  return addMediaBlob(projectId, file, file.name);
}

function getMediaObjectUrlFromBlob(mediaId: string, blob: Blob): string {
  const existing = mediaUrlCache.get(mediaId);
  if (existing) return existing;
  const url = URL.createObjectURL(blob);
  mediaUrlCache.set(mediaId, url);
  return url;
}

export async function getMediaObjectUrl(mediaId: string): Promise<string | undefined> {
  const cached = mediaUrlCache.get(mediaId);
  if (cached) return cached;
  const record = await db.mediaBlobs.get(mediaId);
  if (!record) return undefined;
  return getMediaObjectUrlFromBlob(mediaId, record.blob);
}

export async function getMediaBlob(mediaId: string): Promise<Blob | undefined> {
  const record = await db.mediaBlobs.get(mediaId);
  return record?.blob;
}

export async function getThumbnailUrl(thumbnailBlobId: string): Promise<string | undefined> {
  const cached = thumbnailUrlCache.get(thumbnailBlobId);
  if (cached) return cached;
  const record = await db.thumbnails.get(thumbnailBlobId);
  if (!record) return undefined;
  const url = URL.createObjectURL(record.blob);
  thumbnailUrlCache.set(thumbnailBlobId, url);
  return url;
}

export async function deleteMedia(mediaId: string): Promise<void> {
  const url = mediaUrlCache.get(mediaId);
  if (url) {
    URL.revokeObjectURL(url);
    mediaUrlCache.delete(mediaId);
  }
  await db.mediaBlobs.delete(mediaId);
  const thumbs = await db.thumbnails.where('mediaId').equals(mediaId).toArray();
  for (const thumb of thumbs) {
    const thumbUrl = thumbnailUrlCache.get(thumb.id);
    if (thumbUrl) {
      URL.revokeObjectURL(thumbUrl);
      thumbnailUrlCache.delete(thumb.id);
    }
  }
  await db.thumbnails.where('mediaId').equals(mediaId).delete();
}

export function revokeAllMediaObjectUrls(): void {
  for (const url of mediaUrlCache.values()) URL.revokeObjectURL(url);
  mediaUrlCache.clear();
  for (const url of thumbnailUrlCache.values()) URL.revokeObjectURL(url);
  thumbnailUrlCache.clear();
}
