import { describe, expect, it } from 'vitest';
import { collectOverlayEntries, packOverlayRows } from './overlayTrack';
import type { MosaicLayer, Project, Scene, ShapeLayer, TextLayer } from './types';

const baseLayer = { x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1 };

function makeText(id: string, overrides: Partial<TextLayer> = {}): TextLayer {
  return {
    ...baseLayer,
    id,
    type: 'text',
    content: id,
    fontFamily: 'sans-serif',
    fontSize: 20,
    color: '#fff',
    fontWeight: 'normal',
    align: 'left',
    zIndex: 1,
    ...overrides,
  };
}

function makeShape(id: string, overrides: Partial<ShapeLayer> = {}): ShapeLayer {
  return { ...baseLayer, id, type: 'shape', shape: 'rect', fill: '#f00', zIndex: 1, ...overrides };
}

function makeMosaic(id: string, overrides: Partial<MosaicLayer> = {}): MosaicLayer {
  return { ...baseLayer, id, type: 'mosaic', blockSize: 16, zIndex: 1, ...overrides };
}

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

describe('collectOverlayEntries', () => {
  it('converts each scene-local layer into a project-global time range', () => {
    const sceneA: Scene = { id: 'a', duration: 1000, layers: [makeText('t1', { startMs: 200, endMs: 800 })] };
    const sceneB: Scene = { id: 'b', duration: 2000, layers: [makeText('t2')] };
    const project = makeProject([sceneA, sceneB]);

    const entries = collectOverlayEntries(project, 'text');

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ sceneId: 'a', layerId: 't1', globalStartMs: 200, globalEndMs: 800 });
    // sceneBはsceneA(duration 1000)の後に続くので、startMs/endMs未指定=シーン全体(1000〜3000)
    expect(entries[1]).toMatchObject({ sceneId: 'b', layerId: 't2', globalStartMs: 1000, globalEndMs: 3000 });
  });

  it('only returns entries of the requested kind', () => {
    const scene: Scene = { id: 'a', duration: 1000, layers: [makeText('t1'), makeShape('s1'), makeMosaic('m1')] };
    const project = makeProject([scene]);

    expect(collectOverlayEntries(project, 'text').map((e) => e.layerId)).toEqual(['t1']);
    expect(collectOverlayEntries(project, 'shape').map((e) => e.layerId)).toEqual(['s1']);
    expect(collectOverlayEntries(project, 'mosaic').map((e) => e.layerId)).toEqual(['m1']);
  });

  it('ignores non-overlay layers such as video/audio', () => {
    const scene: Scene = {
      id: 'a',
      duration: 1000,
      layers: [{ ...baseLayer, id: 'v1', type: 'video', mediaId: 'm', trimStart: 0, volume: 1, muted: false, zIndex: 0 }],
    };
    const project = makeProject([scene]);

    expect(collectOverlayEntries(project, 'text')).toEqual([]);
  });
});

describe('packOverlayRows', () => {
  it('keeps non-overlapping entries on row 0', () => {
    const scene: Scene = {
      id: 'a',
      duration: 3000,
      layers: [makeText('t1', { startMs: 0, endMs: 500 }), makeText('t2', { startMs: 600, endMs: 900 })],
    };
    const entries = collectOverlayEntries(makeProject([scene]), 'text');

    const packed = packOverlayRows(entries);

    expect(packed.every((e) => e.row === 0)).toBe(true);
  });

  it('bumps overlapping entries to separate rows', () => {
    const scene: Scene = {
      id: 'a',
      duration: 3000,
      layers: [makeText('t1', { startMs: 0, endMs: 1000 }), makeText('t2', { startMs: 500, endMs: 1500 })],
    };
    const entries = collectOverlayEntries(makeProject([scene]), 'text');

    const packed = packOverlayRows(entries);
    const rows = new Map(packed.map((e) => [e.layerId, e.row]));

    expect(rows.get('t1')).not.toBe(rows.get('t2'));
  });

  it('reuses a row once its previous entry has ended', () => {
    const scene: Scene = {
      id: 'a',
      duration: 3000,
      layers: [makeText('t1', { startMs: 0, endMs: 500 }), makeText('t2', { startMs: 500, endMs: 1000 })],
    };
    const entries = collectOverlayEntries(makeProject([scene]), 'text');

    const packed = packOverlayRows(entries);

    expect(packed.every((e) => e.row === 0)).toBe(true);
  });
});
