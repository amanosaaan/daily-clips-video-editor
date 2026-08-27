import { describe, expect, it } from 'vitest';
import { sortScenesByShotDate } from './sceneSort';
import type { Scene } from './types';

function scene(id: string, shotDate?: string): Scene {
  return { id, duration: 1000, layers: [], shotDate };
}

describe('sortScenesByShotDate', () => {
  it('sorts scenes chronologically by shotDate', () => {
    const scenes = [scene('c', '2025-03-03T00:00:00.000Z'), scene('a', '2025-03-01T00:00:00.000Z'), scene('b', '2025-03-02T00:00:00.000Z')];
    const sorted = sortScenesByShotDate(scenes);
    expect(sorted.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input array', () => {
    const scenes = [scene('b', '2025-03-02T00:00:00.000Z'), scene('a', '2025-03-01T00:00:00.000Z')];
    const original = [...scenes];
    sortScenesByShotDate(scenes);
    expect(scenes).toEqual(original);
  });

  it('pushes scenes with no shotDate to the end, preserving their relative order', () => {
    const scenes = [scene('unknown1'), scene('b', '2025-03-02T00:00:00.000Z'), scene('unknown2'), scene('a', '2025-03-01T00:00:00.000Z')];
    const sorted = sortScenesByShotDate(scenes);
    expect(sorted.map((s) => s.id)).toEqual(['a', 'b', 'unknown1', 'unknown2']);
  });

  it('keeps same-day scenes in their original relative order (stable sort)', () => {
    const scenes = [scene('first', '2025-03-01T09:00:00.000Z'), scene('second', '2025-03-01T09:00:00.000Z')];
    const sorted = sortScenesByShotDate(scenes);
    expect(sorted.map((s) => s.id)).toEqual(['first', 'second']);
  });
});
