import { describe, expect, it } from 'vitest';
import type { Project, Scene, TextLayer, VideoLayer } from './types';
import {
  getSceneStartMs,
  getTotalDurationMs,
  resolvePosition,
  sceneChipWidthPx,
  splitSceneAt,
  timelineOffsetPxToGlobalMs,
  timelinePositionToOffsetPx,
} from './timeline';

function scene(id: string, duration: number): Scene {
  return { id, duration, layers: [] };
}

function project(scenes: Scene[]): Project {
  return {
    id: 'p',
    name: 'p',
    createdAt: 0,
    updatedAt: 0,
    aspectRatio: '16:9',
    resolution: { width: 1280, height: 720 },
    fps: 30,
    scenes,
    mediaLibrary: [],
    burnDateEnabled: false,
    burnDatePosition: 'right',
  };
}

describe('getTotalDurationMs', () => {
  it('sums the duration of every scene', () => {
    const p = project([scene('a', 3000), scene('b', 2000)]);
    expect(getTotalDurationMs(p)).toBe(5000);
  });
});

describe('getSceneStartMs', () => {
  it('returns the cumulative start time of a scene', () => {
    const p = project([scene('a', 3000), scene('b', 2000), scene('c', 1000)]);
    expect(getSceneStartMs(p, 'a')).toBe(0);
    expect(getSceneStartMs(p, 'b')).toBe(3000);
    expect(getSceneStartMs(p, 'c')).toBe(5000);
  });
});

describe('resolvePosition', () => {
  const p = project([scene('a', 3000), scene('b', 2000)]);

  it('resolves a time inside the first scene', () => {
    const pos = resolvePosition(p, 1000);
    expect(pos?.scene.id).toBe('a');
    expect(pos?.sceneStartMs).toBe(0);
    expect(pos?.localTimeMs).toBe(1000);
  });

  it('resolves a time exactly on a scene boundary as the start of the next scene', () => {
    const pos = resolvePosition(p, 3000);
    expect(pos?.scene.id).toBe('b');
    expect(pos?.localTimeMs).toBe(0);
  });

  it('resolves a time inside the second scene', () => {
    const pos = resolvePosition(p, 4500);
    expect(pos?.scene.id).toBe('b');
    expect(pos?.localTimeMs).toBe(1500);
  });

  it('clamps a time past the end to the end of the last scene', () => {
    const pos = resolvePosition(p, 999_999);
    expect(pos?.scene.id).toBe('b');
    expect(pos?.localTimeMs).toBe(2000);
  });

  it('clamps a negative time to the start of the first scene', () => {
    const pos = resolvePosition(p, -500);
    expect(pos?.scene.id).toBe('a');
    expect(pos?.localTimeMs).toBe(0);
  });

  it('returns null for a project with no scenes', () => {
    expect(resolvePosition(project([]), 0)).toBeNull();
  });
});

describe('splitSceneAt', () => {
  function videoLayer(overrides: Partial<VideoLayer> = {}): VideoLayer {
    return {
      id: 'v1',
      type: 'video',
      mediaId: 'm1',
      x: 0,
      y: 0,
      width: 1280,
      height: 720,
      rotation: 0,
      opacity: 1,
      zIndex: 1,
      trimStart: 1000,
      volume: 1,
      muted: false,
      ...overrides,
    };
  }

  function textLayer(overrides: Partial<TextLayer> = {}): TextLayer {
    return {
      id: 't1',
      type: 'text',
      content: 'hello',
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      rotation: 0,
      opacity: 1,
      zIndex: 2,
      fontFamily: 'sans-serif',
      fontSize: 20,
      color: '#fff',
      fontWeight: 'bold',
      align: 'left',
      ...overrides,
    };
  }

  it('splits into two scenes whose durations add up to the original', () => {
    const original = { id: 'a', duration: 5000, layers: [] };
    const result = splitSceneAt([original, scene('b', 2000)], 'a', 2000);
    expect(result).not.toBeNull();
    expect(result!.scenes).toHaveLength(3);
    expect(result!.scenes[0].duration).toBe(2000);
    expect(result!.scenes[1].duration).toBe(3000);
    expect(result!.scenes[1].id).toBe(result!.newSceneId);
    // 元のシーン以外(b)はそのまま残る
    expect(result!.scenes[2].id).toBe('b');
  });

  it('advances trimStart on video/audio layers in the second half so playback continues seamlessly', () => {
    const original: Scene = { id: 'a', duration: 5000, layers: [videoLayer({ trimStart: 1000 })] };
    const result = splitSceneAt([original], 'a', 2000);
    expect(result!.scenes[0].layers[0]).toMatchObject({ id: 'v1', trimStart: 1000 });
    expect(result!.scenes[1].layers[0]).toMatchObject({ trimStart: 3000 });
    expect(result!.scenes[1].layers[0].id).not.toBe('v1');
  });

  it('duplicates non time-based layers (text) unchanged into both halves, with a new id', () => {
    const original: Scene = { id: 'a', duration: 5000, layers: [textLayer()] };
    const result = splitSceneAt([original], 'a', 2000);
    expect(result!.scenes[0].layers[0]).toMatchObject({ id: 't1', content: 'hello' });
    expect(result!.scenes[1].layers[0]).toMatchObject({ content: 'hello' });
    expect(result!.scenes[1].layers[0].id).not.toBe('t1');
  });

  it('moves transitionOut to the second half, leaving a hard cut between the two new scenes', () => {
    const original: Scene = { id: 'a', duration: 5000, layers: [], transitionOut: { type: 'crossfade', durationMs: 500 } };
    const result = splitSceneAt([original], 'a', 2000);
    expect(result!.scenes[0].transitionOut).toBeUndefined();
    expect(result!.scenes[1].transitionOut).toEqual({ type: 'crossfade', durationMs: 500 });
  });

  it('returns null when splitting at the very start or end of the scene', () => {
    const original = { id: 'a', duration: 5000, layers: [] };
    expect(splitSceneAt([original], 'a', 0)).toBeNull();
    expect(splitSceneAt([original], 'a', 5000)).toBeNull();
    expect(splitSceneAt([original], 'a', 6000)).toBeNull();
  });

  it('returns null for an unknown scene id', () => {
    const original = { id: 'a', duration: 5000, layers: [] };
    expect(splitSceneAt([original], 'nope', 1000)).toBeNull();
  });
});

describe('sceneChipWidthPx / timelinePositionToOffsetPx / timelineOffsetPxToGlobalMs', () => {
  it('is proportional to duration above the floor, and clamps to a minimum below it', () => {
    expect(sceneChipWidthPx(5000)).toBe(100); // 20px/秒
    expect(sceneChipWidthPx(3000)).toBe(60);
    expect(sceneChipWidthPx(200)).toBe(32); // 200ms*0.02=4px -> フロアの32pxにクランプ
  });

  it('places the second scene start right after the first scene width + gap', () => {
    const scenes = [scene('a', 5000), scene('b', 3000)];
    const startOfA = timelinePositionToOffsetPx(scenes, 0, 0, 5000);
    const startOfB = timelinePositionToOffsetPx(scenes, 1, 0, 3000);
    expect(startOfA).toBe(0);
    expect(startOfB).toBe(sceneChipWidthPx(5000) + 8); // 100 + gap(8) = 108
  });

  it('round-trips time -> px -> time exactly at an arbitrary mid-scene point', () => {
    const scenes = [scene('a', 5000), scene('b', 3000), scene('c', 2000)];
    const px = timelinePositionToOffsetPx(scenes, 1, 1500, 3000); // シーンbの1.5秒地点
    const globalMs = timelineOffsetPxToGlobalMs(scenes, px);
    expect(globalMs).toBeCloseTo(5000 + 1500); // シーンaの5秒 + シーンb内1.5秒
  });

  it('round-trips correctly right at a scene boundary crossing (regression: dragging across scenes must land in the new scene, not get stuck)', () => {
    const scenes = [scene('a', 5000), scene('b', 3000), scene('c', 2000)];
    const endOfAContentPx = sceneChipWidthPx(5000); // シーンa自体の幅（gapを含まない）の終端
    const boundaryPx = endOfAContentPx + 8; // シーンbの開始位置ちょうど（gapの分だけ後ろ）
    const justBeforeA = timelineOffsetPxToGlobalMs(scenes, endOfAContentPx - 1); // シーンaの中身の最後あたり
    const justAfterB = timelineOffsetPxToGlobalMs(scenes, boundaryPx + 1); // シーンbに入った直後
    // 境界をまたぐドラッグで、前後のpxがそれぞれ別のシーンの適切な時刻に解決されること
    // （両方とも同じ値に固まったままにならないこと）
    expect(justBeforeA).toBeLessThan(5000);
    expect(justAfterB).toBeGreaterThan(5000);
  });

  it('clamps offsets before the start and past the end of the whole timeline', () => {
    const scenes = [scene('a', 5000), scene('b', 3000)];
    expect(timelineOffsetPxToGlobalMs(scenes, -100)).toBe(0);
    const totalPx = sceneChipWidthPx(5000) + 8 + sceneChipWidthPx(3000);
    expect(timelineOffsetPxToGlobalMs(scenes, totalPx + 500)).toBeCloseTo(8000);
  });

  it('falls into the gap between chips resolves to the start of the following scene', () => {
    const scenes = [scene('a', 5000), scene('b', 3000)];
    const midGapPx = sceneChipWidthPx(5000) + 4; // シーンaの終わりとシーンbの間（gap内）
    expect(timelineOffsetPxToGlobalMs(scenes, midGapPx)).toBe(5000);
  });
});
