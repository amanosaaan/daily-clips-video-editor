import { describe, expect, it } from 'vitest';
import { extractShotDatetime, readMp4CreationTime } from './videoMetadata';

const MAC_EPOCH_OFFSET_SECONDS = 2082844800;

function box(type: string, content: Uint8Array): Uint8Array {
  const size = 8 + content.length;
  const buf = new Uint8Array(size);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, size);
  for (let i = 0; i < 4; i++) buf[4 + i] = type.charCodeAt(i);
  buf.set(content, 8);
  return buf;
}

function mvhdV0(creationTimeSec: number): Uint8Array {
  const content = new Uint8Array(20); // version+flags(4) + creation(4) + modification(4) + timescale(4) + duration(4)
  const dv = new DataView(content.buffer);
  content[0] = 0; // version
  dv.setUint32(4, creationTimeSec);
  dv.setUint32(8, creationTimeSec);
  dv.setUint32(12, 600); // timescale
  dv.setUint32(16, 6000); // duration
  return box('mvhd', content);
}

function mvhdV1(creationTimeSec: bigint): Uint8Array {
  const content = new Uint8Array(32); // version+flags(4) + creation(8) + modification(8) + timescale(4) + duration(8)
  const dv = new DataView(content.buffer);
  content[0] = 1; // version
  dv.setBigUint64(4, creationTimeSec);
  dv.setBigUint64(12, creationTimeSec);
  dv.setUint32(20, 600);
  dv.setBigUint64(24, 6000n);
  return box('mvhd', content);
}

function concatBoxes(...boxes: Uint8Array[]): Blob {
  const total = boxes.reduce((sum, b) => sum + b.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const b of boxes) {
    out.set(b, offset);
    offset += b.length;
  }
  return new Blob([out]);
}

describe('readMp4CreationTime', () => {
  it('reads a version-0 mvhd creation_time, converting from the 1904 epoch to a JS Date', () => {
    // 2025-03-14T06:57:59Z 相当のUnix秒
    const unixSeconds = 1741935479;
    const macSeconds = unixSeconds + MAC_EPOCH_OFFSET_SECONDS;
    const ftyp = box('ftyp', new Uint8Array([0x69, 0x73, 0x6f, 0x6d])); // 'isom'、moov探索が先頭以外もスキップできることの確認用
    const moov = box('moov', mvhdV0(macSeconds));
    const file = concatBoxes(ftyp, moov);

    return readMp4CreationTime(file).then((date) => {
      expect(date).not.toBeNull();
      expect(date!.getTime()).toBe(unixSeconds * 1000);
    });
  });

  it('reads a version-1 (64bit) mvhd creation_time', () => {
    const unixSeconds = 1700000000;
    const macSeconds = BigInt(unixSeconds) + BigInt(MAC_EPOCH_OFFSET_SECONDS);
    const moov = box('moov', mvhdV1(macSeconds));
    const file = concatBoxes(moov);

    return readMp4CreationTime(file).then((date) => {
      expect(date).not.toBeNull();
      expect(date!.getTime()).toBe(unixSeconds * 1000);
    });
  });

  it('skips a large mdat box placed before moov (moov at the end of the file)', () => {
    const unixSeconds = 1650000000;
    const macSeconds = unixSeconds + MAC_EPOCH_OFFSET_SECONDS;
    const mdat = box('mdat', new Uint8Array(2048)); // 動画本体を模した大きめのダミーデータ
    const moov = box('moov', mvhdV0(macSeconds));
    const file = concatBoxes(mdat, moov);

    return readMp4CreationTime(file).then((date) => {
      expect(date).not.toBeNull();
      expect(date!.getTime()).toBe(unixSeconds * 1000);
    });
  });

  it('returns null when there is no moov box at all', async () => {
    const file = concatBoxes(box('ftyp', new Uint8Array([0x69, 0x73, 0x6f, 0x6d])));
    const date = await readMp4CreationTime(file);
    expect(date).toBeNull();
  });

  it('returns null when moov has no mvhd child', async () => {
    const moov = box('moov', box('trak', new Uint8Array(4)));
    const file = concatBoxes(moov);
    const date = await readMp4CreationTime(file);
    expect(date).toBeNull();
  });

  it('returns null when creation_time is unset (0)', async () => {
    const moov = box('moov', mvhdV0(0));
    const file = concatBoxes(moov);
    const date = await readMp4CreationTime(file);
    expect(date).toBeNull();
  });
});

describe('extractShotDatetime', () => {
  it('prefers metadata creation_time when present', async () => {
    const unixSeconds = 1741935479;
    const macSeconds = unixSeconds + MAC_EPOCH_OFFSET_SECONDS;
    const moov = box('moov', mvhdV0(macSeconds));
    const blob = concatBoxes(moov);
    const file = new File([blob], 'clip.mp4', { type: 'video/mp4', lastModified: 0 });

    const result = await extractShotDatetime(file);
    expect(result.source).toBe('metadata');
    expect(result.date.getTime()).toBe(unixSeconds * 1000);
  });

  it('falls back to file.lastModified when there is no usable metadata', async () => {
    const blob = concatBoxes(box('ftyp', new Uint8Array([0x69, 0x73, 0x6f, 0x6d])));
    const lastModified = 1600000000000;
    const file = new File([blob], 'clip.mp4', { type: 'video/mp4', lastModified });

    const result = await extractShotDatetime(file);
    expect(result.source).toBe('mtime');
    expect(result.date.getTime()).toBe(lastModified);
  });
});
