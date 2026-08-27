import { describe, expect, it } from 'vitest';
import { reorientVideoPatch } from './videoOrientation';
import type { MediaAsset, VideoLayer } from './types';

function makeAsset(width: number, height: number): MediaAsset {
  return { id: 'a1', kind: 'video', name: 'a.mp4', width, height, createdAt: 0, sizeBytes: 0 };
}

function makeLayer(overrides: Partial<VideoLayer> = {}): VideoLayer {
  return {
    id: 'l1',
    type: 'video',
    mediaId: 'a1',
    x: 220,
    y: 270,
    width: 960,
    height: 540,
    rotation: 0,
    opacity: 1,
    zIndex: 1,
    trimStart: 0,
    volume: 1,
    muted: false,
    ...overrides,
  };
}

describe('reorientVideoPatch', () => {
  it('swaps width/height and keeps the same visual footprint when rotating a landscape source by 90deg', () => {
    // 1920x1080の素材が、画面上960x540の枠にちょうど収まっている状態(scale=0.5)
    const asset = makeAsset(1920, 1080);
    const layer = makeLayer({ x: 220, y: 270, width: 960, height: 540, rotation: 0 });

    const patch = reorientVideoPatch(layer, asset, 90);

    expect(patch.rotation).toBe(90);
    // 回転後は見た目がw960×h540のままになるよう、レイヤー枠自体はw540×h540... (swap)
    expect(patch.width).toBeCloseTo(540, 5);
    expect(patch.height).toBeCloseTo(960, 5);
    // 中心は保たれる
    const cx = layer.x + layer.width / 2;
    const cy = layer.y + layer.height / 2;
    expect(patch.x! + patch.width! / 2).toBeCloseTo(cx, 5);
    expect(patch.y! + patch.height! / 2).toBeCloseTo(cy, 5);
  });

  it('going 90 -> 180 keeps the portrait-fitted look (swaps back)', () => {
    const asset = makeAsset(1920, 1080);
    // 前のテストの結果を引き継いだ状態(90度、540x960の枠)
    const layer = makeLayer({ x: 250, y: 40, width: 540, height: 960, rotation: 90 });

    const patch = reorientVideoPatch(layer, asset, 90);

    expect(patch.rotation).toBe(180);
    // 90度時点の見た目の外枠は960(横)×540(縦)。180度は非sidewaysなので
    // その見た目の外枠がそのままレイヤー枠(w960×h540)になる。
    expect(patch.width).toBeCloseTo(960, 5);
    expect(patch.height).toBeCloseTo(540, 5);
  });

  it('wraps 270 + 90 back to 0', () => {
    const layer = makeLayer({ rotation: 270 });
    const patch = reorientVideoPatch(layer, undefined, 90);
    expect(patch.rotation).toBe(0);
  });

  it('falls back to rotation-only when the asset has no known dimensions', () => {
    const layer = makeLayer({ rotation: 0 });
    const patch = reorientVideoPatch(layer, undefined, -90);
    expect(patch).toEqual({ rotation: 270 });
  });

  it('accounts for an existing crop when computing the natural aspect ratio', () => {
    const asset = makeAsset(1920, 1080);
    // 中央の正方形部分(1080x1080相当)だけをcropしている場合
    const layer = makeLayer({
      x: 0,
      y: 0,
      width: 500,
      height: 500,
      rotation: 0,
      crop: { x: 0.219, y: 0, width: 0.5625, height: 1 },
    });

    const patch = reorientVideoPatch(layer, asset, 90);

    // crop後の実ピクセルはほぼ1080x1080の正方形なので、90度回転しても
    // 見た目の縦横比は変わらないはず(swapされてもほぼ正方形のまま)
    expect(patch.width).toBeCloseTo(patch.height!, 0);
  });
});
