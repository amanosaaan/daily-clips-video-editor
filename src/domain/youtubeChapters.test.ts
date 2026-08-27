import { describe, expect, it } from 'vitest';
import { generateYoutubeChapters } from './youtubeChapters';
import type { Project, Scene } from './types';

function makeProject(scenes: Scene[]): Project {
  return {
    id: 'p',
    name: 'p',
    createdAt: 0,
    updatedAt: 0,
    aspectRatio: '16:9',
    resolution: { width: 1920, height: 1080 },
    fps: 30,
    scenes,
    mediaLibrary: [],
    burnDateEnabled: false,
    burnDatePosition: 'left',
  };
}

describe('generateYoutubeChapters', () => {
  it('returns an empty string when there are no scenes', () => {
    expect(generateYoutubeChapters(makeProject([]))).toBe('');
  });

  it('emits one line per distinct shot date, always starting at 0:00', () => {
    const scenes: Scene[] = [
      { id: 'a', duration: 5000, layers: [], shotDate: '2026-08-01T09:00:00.000Z' },
      { id: 'b', duration: 3000, layers: [], shotDate: '2026-08-01T10:00:00.000Z' },
      { id: 'c', duration: 4000, layers: [], shotDate: '2026-08-02T09:00:00.000Z' },
    ];

    const text = generateYoutubeChapters(makeProject(scenes));

    // scene a/b は同じ日付(2026/08/01)なのでまとまり、scene cで新しい行になる。
    // b開始時点は0+5=5秒、c開始時点は5+3=8秒。
    expect(text).toBe('0:00 2026/08/01\n0:08 2026/08/02');
  });

  it('treats scenes without a shotDate as a distinct "不明" group', () => {
    const scenes: Scene[] = [
      { id: 'a', duration: 2000, layers: [] },
      { id: 'b', duration: 2000, layers: [], shotDate: '2026-08-01T00:00:00.000Z' },
    ];

    const text = generateYoutubeChapters(makeProject(scenes));

    expect(text).toBe('0:00 不明\n0:02 2026/08/01');
  });

  it('formats timestamps past one hour as h:mm:ss', () => {
    const scenes: Scene[] = [
      { id: 'a', duration: 3600_500, layers: [], shotDate: '2026-08-01T00:00:00.000Z' },
      { id: 'b', duration: 1000, layers: [], shotDate: '2026-08-02T00:00:00.000Z' },
    ];

    const text = generateYoutubeChapters(makeProject(scenes));

    expect(text).toBe('0:00 2026/08/01\n1:00:00 2026/08/02');
  });

  it('does not add a new line when consecutive scenes share the same date', () => {
    // ローカルタイムゾーンでの日付比較なので、日付をまたがない同日内の時刻同士で確認する
    const scenes: Scene[] = [
      { id: 'a', duration: 1000, layers: [], shotDate: '2026-08-01T09:00:00.000Z' },
      { id: 'b', duration: 1000, layers: [], shotDate: '2026-08-01T10:00:00.000Z' },
    ];

    const text = generateYoutubeChapters(makeProject(scenes));

    expect(text).toBe('0:00 2026/08/01');
  });
});
