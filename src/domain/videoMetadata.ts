// MP4/MOVコンテナ(ISO Base Media File Format)のトップレベルboxを辿って
// moov > mvhd を見つけ、撮影日時(creation_time)を取り出す。
// mdat(実際の映像データ)本体は読み込まず、boxのヘッダ(8バイト)だけを
// 順番に読みながらoffsetを進めるので、大きなファイルでも軽量に動作する。

// QuickTime/MP4のcreation_timeは1904-01-01 00:00:00 UTC起点の秒数。
// JavaScriptのDateは1970-01-01起点なので、その差分(秒)を引く。
const MAC_EPOCH_OFFSET_SECONDS = 2082844800;

interface TopLevelBox {
  type: string;
  /** ボックス全体(ヘッダ込み)のバイト数 */
  size: number;
  /** ヘッダ自体のバイト数(通常8、64bitサイズ拡張がある場合16) */
  headerSize: number;
  /** ファイル先頭からのボックス開始位置 */
  start: number;
}

async function readTopLevelBoxHeader(file: Blob, offset: number): Promise<TopLevelBox | null> {
  if (offset + 8 > file.size) return null;
  const headBuf = await file.slice(offset, Math.min(offset + 16, file.size)).arrayBuffer();
  if (headBuf.byteLength < 8) return null;
  const dv = new DataView(headBuf);
  let size = dv.getUint32(0);
  const type = String.fromCharCode(dv.getUint8(4), dv.getUint8(5), dv.getUint8(6), dv.getUint8(7));
  let headerSize = 8;
  if (size === 1) {
    if (headBuf.byteLength < 16) return null;
    const high = dv.getUint32(8);
    const low = dv.getUint32(12);
    size = high * 2 ** 32 + low;
    headerSize = 16;
  } else if (size === 0) {
    size = file.size - offset;
  }
  if (size < headerSize) return null;
  return { type, size, headerSize, start: offset };
}

async function findTopLevelBox(file: Blob, targetType: string): Promise<TopLevelBox | null> {
  let offset = 0;
  // 無限ループ防止のための保険(トップレベルboxが極端に大量にあることは通常ない)
  for (let i = 0; i < 10000 && offset < file.size; i++) {
    const header = await readTopLevelBoxHeader(file, offset);
    if (!header) return null;
    if (header.type === targetType) return header;
    offset = header.start + header.size;
  }
  return null;
}

/** すでにメモリ上にある小さめのバッファ(moovの中身)から、直下の子boxを探す */
function findChildBoxOffset(buf: ArrayBuffer, targetType: string): { dv: DataView; contentOffset: number } | null {
  const dv = new DataView(buf);
  let offset = 0;
  while (offset + 8 <= buf.byteLength) {
    let size = dv.getUint32(offset);
    const type = String.fromCharCode(dv.getUint8(offset + 4), dv.getUint8(offset + 5), dv.getUint8(offset + 6), dv.getUint8(offset + 7));
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > buf.byteLength) return null;
      const high = dv.getUint32(offset + 8);
      const low = dv.getUint32(offset + 12);
      size = high * 2 ** 32 + low;
      headerSize = 16;
    } else if (size === 0) {
      size = buf.byteLength - offset;
    }
    if (size < headerSize) return null;
    if (type === targetType) return { dv, contentOffset: offset + headerSize };
    offset += size;
  }
  return null;
}

/**
 * MP4/MOVファイルのmoov > mvhdボックスから撮影日時を読み取る。
 * 見つからない・パースに失敗した場合はnullを返す
 * (呼び出し側でファイルの更新日時にフォールバックすることを想定)。
 */
export async function readMp4CreationTime(file: Blob): Promise<Date | null> {
  try {
    const moov = await findTopLevelBox(file, 'moov');
    if (!moov) return null;
    const moovBuf = await file.slice(moov.start + moov.headerSize, moov.start + moov.size).arrayBuffer();
    const mvhd = findChildBoxOffset(moovBuf, 'mvhd');
    if (!mvhd) return null;
    const { dv, contentOffset } = mvhd;
    if (contentOffset + 4 > moovBuf.byteLength) return null;
    const version = dv.getUint8(contentOffset);
    let creationTimeSec: number;
    if (version === 1) {
      if (contentOffset + 12 > moovBuf.byteLength) return null;
      creationTimeSec = Number(dv.getBigUint64(contentOffset + 4));
    } else {
      if (contentOffset + 8 > moovBuf.byteLength) return null;
      creationTimeSec = dv.getUint32(contentOffset + 4);
    }
    const unixSeconds = creationTimeSec - MAC_EPOCH_OFFSET_SECONDS;
    if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return null;
    return new Date(unixSeconds * 1000);
  } catch {
    return null;
  }
}

/**
 * 動画ファイルの撮影日時を取得する。MP4のメタデータ(moov/mvhdのcreation_time)
 * から取れない場合は、ファイルの更新日時(lastModified)にフォールバックする
 * (ローカル版アプリのffprobe/mtimeフォールバックと同じ方針)。
 */
export async function extractShotDatetime(file: File): Promise<{ date: Date; source: 'metadata' | 'mtime' }> {
  const fromMetadata = await readMp4CreationTime(file);
  if (fromMetadata) return { date: fromMetadata, source: 'metadata' };
  return { date: new Date(file.lastModified), source: 'mtime' };
}
