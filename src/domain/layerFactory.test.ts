import { describe, expect, it } from 'vitest';
import { createImageLayerForScene, createVideoLayerForScene, cropPatch } from './layerFactory';
import type { ImageLayer, MediaAsset, Project, Scene } from './types';

function makeProject(): Project {
  return {
    id: 'p1',
    name: 'test',
    createdAt: 0,
    updatedAt: 0,
    aspectRatio: '16:9',
    resolution: { width: 1280, height: 720 },
    fps: 30,
    scenes: [],
    mediaLibrary: [],
  };
}

function makeScene(layers: Scene['layers'] = []): Scene {
  return { id: 's1', duration: 5000, layers };
}

function makeAsset(width?: number, height?: number): MediaAsset {
  return { id: 'a1', kind: 'image', name: 'x.png', width, height, createdAt: 0, sizeBytes: 0 };
}

describe('createImageLayerForScene', () => {
  it('does not stretch a wide image: fills full width, letterboxes top/bottom, in an empty scene', () => {
    const project = makeProject();
    const scene = makeScene();
    const asset = makeAsset(400, 200); // 2:1, wider than the 16:9 canvas
    const layer = createImageLayerForScene(project, scene, asset);

    expect(layer.width).toBeCloseTo(1280);
    expect(layer.height).toBeLessThan(720);
    expect(layer.height / layer.width).toBeCloseTo(200 / 400);
    // 縦方向に中央寄せされていること
    expect(layer.y).toBeCloseTo((720 - layer.height) / 2);
    expect(layer.x).toBeCloseTo(0);
  });

  it('does not stretch a tall image: fills full height, pillarboxes left/right', () => {
    const project = makeProject();
    const scene = makeScene();
    const asset = makeAsset(100, 400); // 1:4, taller than the 16:9 canvas
    const layer = createImageLayerForScene(project, scene, asset);

    expect(layer.height).toBeCloseTo(720);
    expect(layer.width).toBeLessThan(1280);
    expect(layer.width / layer.height).toBeCloseTo(100 / 400);
    expect(layer.x).toBeCloseTo((1280 - layer.width) / 2);
  });

  it('keeps aspect ratio when placed as an overlay on top of an existing visual layer', () => {
    const project = makeProject();
    const scene = makeScene([
      { id: 'existing', type: 'image', mediaId: 'other', x: 0, y: 0, width: 1280, height: 720, rotation: 0, opacity: 1, zIndex: 1 },
    ]);
    const asset = makeAsset(400, 200);
    const layer = createImageLayerForScene(project, scene, asset);

    // 中央半分の範囲(640x360)に収まり、かつ縦横比が保たれていること
    expect(layer.width).toBeLessThanOrEqual(640 + 0.01);
    expect(layer.height).toBeLessThanOrEqual(360 + 0.01);
    expect(layer.height / layer.width).toBeCloseTo(200 / 400);
    expect(layer.zIndex).toBeGreaterThan(1);
  });

  it('falls back to filling the available bounds when the asset has no known dimensions', () => {
    const project = makeProject();
    const scene = makeScene();
    const asset = makeAsset(undefined, undefined);
    const layer = createImageLayerForScene(project, scene, asset);

    expect(layer.width).toBe(1280);
    expect(layer.height).toBe(720);
  });
});

describe('createVideoLayerForScene', () => {
  it('preserves aspect ratio for the main (first) video and reports isMain', () => {
    const project = makeProject();
    const scene = makeScene();
    const asset = makeAsset(400, 200);
    const { layer, isMain } = createVideoLayerForScene(project, scene, asset);

    expect(isMain).toBe(true);
    expect(layer.width).toBeCloseTo(1280);
    expect(layer.height / layer.width).toBeCloseTo(200 / 400);
  });
});

describe('cropPatch', () => {
  function makeImageLayer(overrides: Partial<ImageLayer> = {}): ImageLayer {
    return {
      id: 'l1',
      type: 'image',
      mediaId: 'a1',
      x: 0,
      y: 0,
      width: 1280,
      height: 720,
      rotation: 0,
      opacity: 1,
      zIndex: 1,
      ...overrides,
    };
  }

  it('resizes the layer to match the cropped region aspect ratio instead of stretching it', () => {
    // 元画像 800x400（2:1）から中央の正方形部分(400x400 = 1:1)を切り出す
    const asset = makeAsset(800, 400);
    const layer = makeImageLayer({ width: 1280, height: 720 }); // 16:9の枠
    const crop = { x: 0.25, y: 0, width: 0.5, height: 1 }; // 400x400 部分（1:1）

    const patch = cropPatch(layer, crop, asset);

    expect(patch.crop).toEqual(crop);
    // 1:1 に切り出したのだから、更新後の幅と高さはほぼ同じになるはず（引き伸ばされない）
    expect(patch.width).toBeCloseTo(patch.height!);
    // 元の枠(1280x720)からはみ出さないこと
    expect(patch.width!).toBeLessThanOrEqual(1280 + 0.01);
    expect(patch.height!).toBeLessThanOrEqual(720 + 0.01);
  });

  it('keeps the layer centered on the same point after resizing', () => {
    const asset = makeAsset(800, 400);
    const layer = makeImageLayer({ x: 100, y: 200, width: 1280, height: 720 });
    const crop = { x: 0.25, y: 0, width: 0.5, height: 1 };

    const patch = cropPatch(layer, crop, asset);

    const originalCenterX = layer.x + layer.width / 2;
    const originalCenterY = layer.y + layer.height / 2;
    const newCenterX = patch.x! + patch.width! / 2;
    const newCenterY = patch.y! + patch.height! / 2;
    expect(newCenterX).toBeCloseTo(originalCenterX);
    expect(newCenterY).toBeCloseTo(originalCenterY);
  });

  it('falls back to only updating crop when the asset has no known dimensions', () => {
    const asset = makeAsset(undefined, undefined);
    const layer = makeImageLayer();
    const crop = { x: 0, y: 0, width: 0.5, height: 0.5 };

    const patch = cropPatch(layer, crop, asset);

    expect(patch).toEqual({ crop });
  });
});
