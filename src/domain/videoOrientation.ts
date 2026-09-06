import type { MediaAsset, VideoLayer } from './types';

function isSideways(rotationDeg: number): boolean {
  const r = ((rotationDeg % 360) + 360) % 360;
  return r === 90 || r === 270;
}

function approxEqual(a: number, b: number, eps = 1): boolean {
  return Math.abs(a - b) < eps;
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
 *
 * ただし、回転前のレイヤーが「シーン全体を覆うようcontain-fitしていた」
 * (=縦動画を16:9シーンに入れた時の、縦幅いっぱい・横黒帯のような取り込み直後の
 * 標準的な配置)場合、その視覚的な外枠(=黒帯を含む小さい範囲)をそのまま維持して
 * 再フィットすると、回転後の映像が不自然に小さくなってしまう(90度回転すると
 * 縦横比が入れ替わり、多くの場合シーン全体を覆えるはずなのに、回転前の小さい
 * 枠の中に収めようとしてしまうため)。この場合は、シーン全体(canvasSize)を
 * 基準に再フィットする。ワイプ等、手動でサイズ・位置を調整した非メインレイヤーは
 * この条件に当てはまらないため、従来通り自分の枠を維持したまま再フィットされる。
 */
export function reorientVideoPatch(
  layer: VideoLayer,
  asset: MediaAsset | undefined,
  deltaDeg: 90 | -90,
  canvasSize?: { width: number; height: number },
): Partial<VideoLayer> {
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

  // 回転前のレイヤーが、シーン全体に対するcontain-fit(中央揃え)とちょうど
  // 一致しているか判定する(現在のrotationの向きを踏まえた「実効アスペクト比」で
  // 判定する。90/270度時点で既に一度この分岐でシーン全体フィットしたレイヤーを、
  // 続けてもう一度回転させる場合も正しく検出できるようにするため)。
  if (canvasSize) {
    const effW0 = isSideways(layer.rotation) ? cropH : cropW;
    const effH0 = isSideways(layer.rotation) ? cropW : cropH;
    const s0 = Math.min(canvasSize.width / effW0, canvasSize.height / effH0);
    const fitsFullCanvas =
      approxEqual(visualW, effW0 * s0) &&
      approxEqual(visualH, effH0 * s0) &&
      approxEqual(cx, canvasSize.width / 2) &&
      approxEqual(cy, canvasSize.height / 2);

    if (fitsFullCanvas) {
      // 回転後の実効アスペクト比(90/270度なら縦横入れ替え)でシーン全体に
      // 再フィットする。回転前の(黒帯を含む)小さい枠ではなく、シーン全体の
      // 大きさを基準にすることで、多くの場合(回転後にシーンのアスペクト比と
      // 一致する場合)映像がシーン全体を覆えるようになる。
      const effW1 = isSideways(newRotation) ? cropH : cropW;
      const effH1 = isSideways(newRotation) ? cropW : cropH;
      const s1 = Math.min(canvasSize.width / effW1, canvasSize.height / effH1);
      const newVisualW = effW1 * s1;
      const newVisualH = effH1 * s1;
      const boxW = isSideways(newRotation) ? newVisualH : newVisualW;
      const boxH = isSideways(newRotation) ? newVisualW : newVisualH;
      return {
        rotation: newRotation,
        x: canvasSize.width / 2 - boxW / 2,
        y: canvasSize.height / 2 - boxH / 2,
        width: boxW,
        height: boxH,
      };
    }
  }

  // シーン全体を覆っていない(ワイプ等、手動でサイズ・位置を調整した)レイヤーは、
  // 回転前と同じ視覚的な外枠(visualW×visualH)を維持したまま、回転後の見た目を
  // その枠に再フィットする。
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
