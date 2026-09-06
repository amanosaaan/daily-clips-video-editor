import type { FFmpeg } from '@ffmpeg/ffmpeg';

/**
 * HEVC(H.265)等、この端末/ブラウザのWebCodecsや<video>要素では再生・デコードできない
 * 映像コーデックの動画を、H.264へ変換して使えるようにする。
 *
 * ffmpeg.wasm(ブラウザ内で動くffmpeg)を使う。本体(ffmpeg-core.wasm)は約30MBあり
 * 通常のページ読み込みには含めず、この変換が実際に必要になった時だけ動的import+
 * 遅延読み込みする(public/ffmpeg/に配置済み)。SharedArrayBuffer(マルチスレッド版)は
 * GitHub Pagesで必要なCOOP/COEPレスポンスヘッダーを設定できないため使えず、
 * シングルスレッド版を使っている(変換は多少遅いが、追加のサーバー設定が不要)。
 */
let ffmpegPromise: Promise<FFmpeg> | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      const ffmpeg = new FFmpeg();
      // toBlobURL()での変換はCDN等クロスオリジンからの読み込み時にCORSを回避するための
      // ものだが、うちのcoreファイルはアプリ自身と同一オリジン(public/ffmpeg/)から
      // 配信しているため不要。むしろBlob URLをWorker内から動的import()する経路で
      // 「failed to import ffmpeg-core.js」エラーが発生することを確認したため、
      // 素直に通常のURLをそのまま渡す。
      const base = `${import.meta.env.BASE_URL}ffmpeg`;
      await ffmpeg.load({ coreURL: `${base}/ffmpeg-core.js`, wasmURL: `${base}/ffmpeg-core.wasm` });
      return ffmpeg;
    })().catch((err) => {
      // 読み込み自体に失敗した場合、次回また最初から読み込み直せるようにキャッシュを捨てる。
      ffmpegPromise = null;
      throw err;
    });
  }
  return ffmpegPromise;
}

function guessInputExtension(mime: string): string {
  if (mime.includes('quicktime')) return '.mov';
  if (mime.includes('webm')) return '.webm';
  return '.mp4';
}

/**
 * 動画をH.264(+AAC音声)へ変換する。プレビュー/書き出し用に「とにかく再生できる」ことを
 * 優先し、速度重視の設定(preset veryfast)にしている(画質の追い込みは元々の書き出し
 * 機能側の役割であり、ここでの変換はあくまで「取り込めるようにする」ための下処理)。
 */
export async function convertToH264(blob: Blob, onProgress?: (ratio: number) => void): Promise<Blob> {
  const ffmpeg = await getFFmpeg();
  const { fetchFile } = await import('@ffmpeg/util');

  const inputName = `input${guessInputExtension(blob.type)}`;
  const outputName = 'output.mp4';

  const onProgressEvent = onProgress
    ? ({ progress }: { progress: number }) => onProgress(Math.min(1, Math.max(0, progress)))
    : undefined;
  if (onProgressEvent) ffmpeg.on('progress', onProgressEvent);

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(blob));
    const exitCode = await ffmpeg.exec(['-i', inputName, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', outputName]);
    if (exitCode !== 0) throw new Error(`ffmpegの変換が失敗しました(終了コード: ${exitCode})`);
    const data = await ffmpeg.readFile(outputName);
    const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(data);
    // ffmpeg.wasmが返すUint8ArrayはSharedArrayBuffer上のことがあり、そのままでは
    // Blobのコンストラクタの型(BlobPart)と合わないため、通常のArrayBuffer上に
    // コピーし直す。
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    return new Blob([copy], { type: 'video/mp4' });
  } finally {
    if (onProgressEvent) ffmpeg.off('progress', onProgressEvent);
    // 使い捨てのファイルは毎回消しておく(残すとインスタンスを使い回すたびに
    // 仮想ファイルシステムにゴミが溜まる)。存在しなくても実害は無いため
    // エラーは無視する。
    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});
  }
}
