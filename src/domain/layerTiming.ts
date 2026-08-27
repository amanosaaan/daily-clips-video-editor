import type { Layer } from './types';

/**
 * レイヤーがシーン内で表示される時間範囲(ms、シーン先頭からの相対時刻)を求める。
 * startMs/endMs未指定時はシーン全体（0〜シーンの長さ）がデフォルト。
 * シーンの長さでクランプし、endがstartを下回らないようにする。
 */
export function getLayerVisibleRange(layer: Layer, sceneDurationMs: number): { start: number; end: number } {
  const rawStart = layer.startMs ?? 0;
  const rawEnd = layer.endMs ?? sceneDurationMs;
  const start = Math.max(0, Math.min(rawStart, sceneDurationMs));
  const end = Math.max(start, Math.min(rawEnd, sceneDurationMs));
  return { start, end };
}

/** 指定したシーン内時刻において、このレイヤーが表示されているかどうか。 */
export function isLayerVisibleAt(layer: Layer, sceneTimeMs: number, sceneDurationMs: number): boolean {
  const { start, end } = getLayerVisibleRange(layer, sceneDurationMs);
  return sceneTimeMs >= start && sceneTimeMs <= end;
}
