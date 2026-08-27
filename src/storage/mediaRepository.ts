import { nanoid } from 'nanoid';
import { db } from './db';
import type { MediaAsset } from '../domain/types';
import { readMp4CreationTime } from '../domain/videoMetadata';

const mediaUrlCache = new Map<string, string>();
const thumbnailUrlCache = new Map<string, string>();

function detectKind(mime: string): MediaAsset['kind'] {
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'image';
}

// iOS Safari等では、DOM上に接続されていない<video>/<audio>要素はloadedmetadata/loadeddata/
// seekedといったイベントが発火しない(または非常に不安定になる)ことがある。読み込み中の
// プログレスが0/Nのまま永久に固まって見える不具合の主因だったため、useProjectPlaybackEngine.ts
// で既に使っている「非表示コンテナに実体を置いておく」パターンをここでも踏襲する。
// 幅・高さを0にすると(特にiOS/WebKitで)実質非表示扱いとなりデコード自体が行われないことが
// あるため面積0にはしていないが、それだけでは不十分だったことが実機のデバッグログ
// (30秒待ってもloadeddataが一切発火しない=デコードが始まっていない)で判明した。
// left:-9999pxのようにビューポートの外へ大きくずらす配置自体が、iOS(WebKit)側で
// 「画面に交差していない要素」としてデコードを止める判定基準になっている可能性が高いため、
// ビューポート内(0,0)に置いたまま、ごく薄い不透明度と背面へのz-indexで見えなくする方式にした。
let hiddenMediaContainer: HTMLDivElement | null = null;
function getHiddenMediaContainer(): HTMLDivElement {
  if (!hiddenMediaContainer) {
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
    hiddenMediaContainer = container;
  }
  return hiddenMediaContainer;
}

/**
 * 端末やファイル形式によってはメタデータ/サムネイル取得用のイベントが一切発火しないことがあり、
 * その場合Promiseが永久に解決しない(=読み込み中0/Nのまま固まる)。一定時間で必ず諦めて
 * 呼び出し元にフォールバックさせるための安全弁。
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
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

// 大きな動画ファイルではモバイル回線/端末次第でloadeddata等までにこの程度掛かることも
// あるため、誤って「失敗」と判定しすぎないよう余裕を持たせている(useProjectPlaybackEngine.ts
// のMEDIA_LOAD_TIMEOUT_MSと同じ値に揃えている)。
const METADATA_TIMEOUT_MS = 30000;

async function readVideoMetadata(url: string): Promise<{ durationMs: number; width: number; height: number }> {
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  getHiddenMediaContainer().appendChild(video);
  try {
    return await withTimeout(
      new Promise((resolve, reject) => {
        video.onloadedmetadata = () => {
          resolve({ durationMs: video.duration * 1000, width: video.videoWidth, height: video.videoHeight });
        };
        video.onerror = () => reject(new Error('動画メタデータの読み込みに失敗しました'));
        video.src = url;
      }),
      METADATA_TIMEOUT_MS,
      '動画メタデータの読み込みがタイムアウトしました',
    );
  } finally {
    video.remove();
  }
}

async function readAudioMetadata(url: string): Promise<{ durationMs: number }> {
  const audio = document.createElement('audio');
  audio.preload = 'metadata';
  getHiddenMediaContainer().appendChild(audio);
  try {
    return await withTimeout(
      new Promise((resolve, reject) => {
        audio.onloadedmetadata = () => resolve({ durationMs: audio.duration * 1000 });
        audio.onerror = () => reject(new Error('音声メタデータの読み込みに失敗しました'));
        audio.src = url;
      }),
      METADATA_TIMEOUT_MS,
      '音声メタデータの読み込みがタイムアウトしました',
    );
  } finally {
    audio.remove();
  }
}

async function readImageMetadata(url: string): Promise<{ width: number; height: number }> {
  return withTimeout(
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error('画像メタデータの読み込みに失敗しました'));
      img.src = url;
    }),
    METADATA_TIMEOUT_MS,
    '画像メタデータの読み込みがタイムアウトしました',
  );
}

async function generateVideoThumbnail(mediaId: string, url: string, width: number, height: number): Promise<string> {
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  getHiddenMediaContainer().appendChild(video);
  try {
    return await withTimeout(
      new Promise((resolve, reject) => {
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
        video.src = url;
      }),
      METADATA_TIMEOUT_MS,
      'サムネイル生成がタイムアウトしました',
    );
  } finally {
    video.remove();
  }
}

async function generateImageThumbnail(mediaId: string, url: string, width: number, height: number): Promise<string> {
  return withTimeout(
    new Promise((resolve, reject) => {
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
    }),
    METADATA_TIMEOUT_MS,
    'サムネイル生成がタイムアウトしました',
  );
}

export async function addMediaBlob(
  projectId: string,
  blob: Blob,
  name: string,
): Promise<MediaAsset> {
  const kind = detectKind(blob.type);
  const id = nanoid();
  // IndexedDBへの書き込みも、他タブが同じDBへの接続を握ったまま止まっている等の理由で
  // 稀に応答が返ってこないことがある。ここが詰まると一括取り込みが「次のファイルへ全く
  // 進まない(ボタンも反応しない)」ように見えてしまうため、他の読み込み処理と同様に
  // タイムアウトの保険を掛けておく。
  await withTimeout(
    db.mediaBlobs.put({ id, projectId, blob, mime: blob.type, sizeBytes: blob.size }),
    METADATA_TIMEOUT_MS,
    'IndexedDBへの保存がタイムアウトしました(他のタブでこのアプリを開いたままにしていないか確認してください)',
  );

  const url = getMediaObjectUrlFromBlob(id, blob);

  let durationMs: number | undefined;
  let width: number | undefined;
  let height: number | undefined;
  let thumbnailBlobId: string | undefined;
  let shotDatetime: string | undefined;
  let shotDateSource: 'metadata' | 'mtime' | undefined;

  if (kind === 'video') {
    // メタデータ取得・サムネイル生成は端末/形式によって失敗・タイムアウトすることがあるが、
    // それだけでクリップの取り込み自体を止めない(失敗した項目だけ諦めて、動画自体は
    // 取り込む)。以前はここで例外を投げるとaddMediaBlob全体が失敗し、呼び出し元の
    // 一括取り込みが「そのファイルだけ丸ごとスキップ」になっていた。
    try {
      const meta = await readVideoMetadata(url);
      durationMs = meta.durationMs;
      width = meta.width;
      height = meta.height;
    } catch (err) {
      console.error('動画メタデータの取得に失敗しました(動画自体は取り込みを続けます):', err);
    }

    if (width && height) {
      try {
        thumbnailBlobId = await generateVideoThumbnail(id, url, width, height);
      } catch (err) {
        console.error('サムネイル生成に失敗しました(動画自体は取り込みを続けます):', err);
      }
    }

    // 撮影日時: MP4のメタデータ(moov/mvhdのcreation_time)から取得できなければ、
    // ファイルの更新日時にフォールバックする(取得できない場合は現在時刻)。
    const fromMetadata = await readMp4CreationTime(blob);
    if (fromMetadata) {
      shotDatetime = fromMetadata.toISOString();
      shotDateSource = 'metadata';
    } else {
      const mtimeMs = blob instanceof File ? blob.lastModified : Date.now();
      shotDatetime = new Date(mtimeMs).toISOString();
      shotDateSource = 'mtime';
    }
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
    shotDatetime,
    shotDateSource,
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
