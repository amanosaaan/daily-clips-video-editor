export interface CaptionPresetLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

/** 字幕プリセットのレイアウト（下部中央・画面幅の80%）を解像度から算出する。 */
export function computeCaptionPresetLayout(resolution: { width: number; height: number }): CaptionPresetLayout {
  const width = Math.round(resolution.width * 0.8);
  const height = Math.round(resolution.height * 0.14);
  return {
    x: Math.round((resolution.width - width) / 2),
    y: resolution.height - height - Math.round(resolution.height * 0.06),
    width,
    height,
    fontSize: Math.round(resolution.height * 0.045),
  };
}
