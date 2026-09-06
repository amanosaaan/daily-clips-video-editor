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

  it('refits to the full scene canvas (not the old pillarboxed box) when rotating the main layer that fills the canvas', () => {
    // 1080x1920の縦動画を1920x1080の16:9シーンにそのまま(トリミング無しで)配置した
    // 直後の標準的な状態: containFitにより縦幅いっぱい(1080)・横は607.5(黒帯あり)。
    const asset = makeAsset(1080, 1920);
    const canvasSize = { width: 1920, height: 1080 };
    const scale = Math.min(canvasSize.width / 1080, canvasSize.height / 1920);
    const fittedW = 1080 * scale;
    const fittedH = 1920 * scale;
    const layer = makeLayer({
      x: (canvasSize.width - fittedW) / 2,
      y: (canvasSize.height - fittedH) / 2,
      width: fittedW,
      height: fittedH,
      rotation: 0,
    });

    const patch = reorientVideoPatch(layer, asset, 90, canvasSize);

    // 回転後は縦横比がほぼ16:9(canvasと一致)になるため、シーン全体を覆えるはず
    // (回転前の小さい枠に押し込められて縮んでしまわないことを確認)
    expect(patch.width).toBeCloseTo(canvasSize.height, 0);
    expect(patch.height).toBeCloseTo(canvasSize.width, 0);
    expect(patch.x! + patch.width! / 2).toBeCloseTo(canvasSize.width / 2, 0);
    expect(patch.y! + patch.height! / 2).toBeCloseTo(canvasSize.height / 2, 0);
  });

  it('refits to the full scene canvas when rotating a landscape source in a portrait (9:16) scene (the reverse case)', () => {
    // 1920x1080の横動画を1080x1920の9:16シーンに配置した直後の標準的な状態:
    // containFitにより横幅いっぱい(1080)・縦は607.5(上下黒帯あり)。
    const asset = makeAsset(1920, 1080);
    const canvasSize = { width: 1080, height: 1920 };
    const scale = Math.min(canvasSize.width / 1920, canvasSize.height / 1080);
    const fittedW = 1920 * scale;
    const fittedH = 1080 * scale;
    const layer = makeLayer({
      x: (canvasSize.width - fittedW) / 2,
      y: (canvasSize.height - fittedH) / 2,
      width: fittedW,
      height: fittedH,
      rotation: 0,
    });

    const patch = reorientVideoPatch(layer, asset, 90, canvasSize);

    // 回転後は縦横比がほぼ9:16(canvasと一致)になるため、シーン全体を覆えるはず
    expect(patch.width).toBeCloseTo(canvasSize.height, 0);
    expect(patch.height).toBeCloseTo(canvasSize.width, 0);
    expect(patch.x! + patch.width! / 2).toBeCloseTo(canvasSize.width / 2, 0);
    expect(patch.y! + patch.height! / 2).toBeCloseTo(canvasSize.height / 2, 0);
  });

  it('keeps refitting to the full canvas across a second consecutive rotation', () => {
    // 1回目の回転で既にシーン全体を覆っている状態から、さらにもう一度回転させても
    // (縦横比が再度合わなくなる可能性はあるが)引き続きシーン全体を基準に判定・
    // 再フィットされ続けるべき(回転前の小さい枠に戻ってしまわないこと)。
    const asset = makeAsset(1080, 1920);
    const canvasSize = { width: 1920, height: 1080 };
    const firstPatch = reorientVideoPatch(
      makeLayer({
        x: (1920 - 607.5) / 2,
        y: 0,
        width: 607.5,
        height: 1080,
        rotation: 0,
      }),
      asset,
      90,
      canvasSize,
    );
    const rotatedLayer = makeLayer({
      x: firstPatch.x!,
      y: firstPatch.y!,
      width: firstPatch.width!,
      height: firstPatch.height!,
      rotation: firstPatch.rotation!,
    });

    const secondPatch = reorientVideoPatch(rotatedLayer, asset, 90, canvasSize);

    expect(secondPatch.rotation).toBe(180);
    // 180度(non-sideways)は元のアスペクト比のまま=元の607.5x1080に戻るはず
    expect(secondPatch.width).toBeCloseTo(607.5, 0);
    expect(secondPatch.height).toBeCloseTo(1080, 0);
    expect(secondPatch.x! + secondPatch.width! / 2).toBeCloseTo(canvasSize.width / 2, 0);
    expect(secondPatch.y! + secondPatch.height! / 2).toBeCloseTo(canvasSize.height / 2, 0);
  });

  it('keeps the manually-sized/positioned layer footprint untouched by canvasSize (non-main overlay)', () => {
    // 中央からずれた位置・シーン全体を覆っていない小さな枠(ワイプ等)は、
    // canvasSizeを渡しても従来通りの「自分の枠を保つ」動作のままであるべき
    const asset = makeAsset(1920, 1080);
    const canvasSize = { width: 1920, height: 1080 };
    const layer = makeLayer({ x: 50, y: 50, width: 400, height: 225, rotation: 0 });

    const patch = reorientVideoPatch(layer, asset, 90, canvasSize);

    expect(patch.width).toBeCloseTo(225, 5);
    expect(patch.height).toBeCloseTo(400, 5);
    const cx = layer.x + layer.width / 2;
    const cy = layer.y + layer.height / 2;
    expect(patch.x! + patch.width! / 2).toBeCloseTo(cx, 5);
    expect(patch.y! + patch.height! / 2).toBeCloseTo(cy, 5);
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
