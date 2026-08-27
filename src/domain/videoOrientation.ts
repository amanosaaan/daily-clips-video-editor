import type { MediaAsset, VideoLayer } from './types';

function isSideways(rotationDeg: number): boolean {
  const r = ((rotationDeg % 360) + 360) % 360;
  return r === 90 || r === 270;
}

/**
 * 動画レイヤーを90度単位で回転させたときの、見た目が歪まないレイヤーパッチを計算する。
 *
 * レイヤーのrotationだけを変えると、レイヤー枠(width/height)は
 * 回転前のまま中身の見た目だけが回転するため、90/270度では映像が
 * 引き伸ばされて(あるいは縮んで)見えてしまう。ここでは「回転後も
 * 画面上で同じ範囲(視覚的な外枠)を埋める」ことを保ったまま、
 * 回転後の縦横比で正しく再フィットする(汎用のArrangeGroupの
 * 自由回転とは別に、動画専用の「向きを直す」操作として使う)。
 */
export function reorientVideoPatch(layer: VideoLayer, asset: MediaAsset | undefined, deltaDeg: 90 | -90): Partial<VideoLayer> {
  const newRotation = (((layer.rotation + deltaDeg) % 360) + 360) % 360;
  const cx = layer.x + layer.width / 2;
  const cy = layer.y + layer.height / 2;

  if (!asset?.width || !asset?.height) {
    return { rotation: newRotation };
  }

  // 回転前の「画面上での見た目の範囲」(視覚的な外枠)を求める。
  // レイヤーのwidth/heightはctx.rotate適用前の(=画面上では回転して見える)
  // 矩形なので、90/270度のときは見た目のw/hが入れ替わっている。
  const visualW = isSideways(layer.rotation) ? layer.height : layer.width;
  const visualH = isSideways(layer.rotation) ? layer.width : layer.height;

  const cropW = layer.crop ? layer.crop.width * asset.width : asset.width;
  const cropH = layer.crop ? layer.crop.height * asset.height : asset.height;
  if (!cropW || !cropH) return { rotation: newRotation };

  const scale = Math.min(visualW / cropW, visualH / cropH);
  const fittedW = cropW * scale;
  const fittedH = cropH * scale;

  // 回転後に見た目がfittedW×fittedHになるよう、レイヤー枠(回転前基準)を組み立てる
  const boxW = isSideways(newRotation) ? fittedH : fittedW;
  const boxH = isSideways(newRotation) ? fittedW : fittedH;

  return {
    rotation: newRotation,
    x: cx - boxW / 2,
    y: cy - boxH / 2,
    width: boxW,
    height: boxH,
  };
}
