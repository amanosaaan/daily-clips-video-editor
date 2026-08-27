import { getLayerVisibleRange } from './layerTiming';
import { getSceneStartMs } from './timeline';
import type { Layer, Project } from './types';

export type OverlayTrackKind = 'text' | 'shape' | 'mosaic';

export interface OverlayTrackEntry {
  sceneId: string;
  sceneIndex: number;
  layerId: string;
  layer: Layer;
  /** シーンをまたいだプロジェクト全体での表示開始/終了時刻(ms) */
  globalStartMs: number;
  globalEndMs: number;
  /** packOverlayRows()適用後にのみ意味を持つ、重なり回避用の段番号(0始まり) */
  row: number;
}

function overlayKindOf(layer: Layer): OverlayTrackKind | null {
  return layer.type === 'text' || layer.type === 'shape' || layer.type === 'mosaic' ? layer.type : null;
}

/**
 * 指定した種類(text/shape/mosaic)のレイヤーを全シーン横断で集め、
 * プロジェクト全体でのグローバル時刻(ms)での表示区間を求める。
 * 全クリップ横断の統合タイムライン帯(OverlayTrackPanel)の元データ。
 */
export function collectOverlayEntries(project: Project, kind: OverlayTrackKind): OverlayTrackEntry[] {
  const entries: OverlayTrackEntry[] = [];
  project.scenes.forEach((scene, sceneIndex) => {
    const sceneStartMs = getSceneStartMs(project, scene.id);
    scene.layers.forEach((layer) => {
      if (overlayKindOf(layer) !== kind) return;
      const { start, end } = getLayerVisibleRange(layer, scene.duration);
      entries.push({
        sceneId: scene.id,
        sceneIndex,
        layerId: layer.id,
        layer,
        globalStartMs: sceneStartMs + start,
        globalEndMs: sceneStartMs + end,
        row: 0,
      });
    });
  });
  return entries;
}

const MAX_TRACK_ROWS = 3;

/**
 * 同じトラック内で時間が重なるエントリを、最大MAX_TRACK_ROWS段まで縦に振り分ける
 * (重なったまま1段に表示すると見分けがつかないため)。空いている段が無ければ、
 * 一番早く空く段に重ねて表示する。Python版のpackTrackRowsと同じ方針。
 */
export function packOverlayRows(entries: OverlayTrackEntry[]): OverlayTrackEntry[] {
  const sorted = [...entries].sort((a, b) => a.globalStartMs - b.globalStartMs);
  const rowEnds = new Array(MAX_TRACK_ROWS).fill(-Infinity);
  return sorted.map((entry) => {
    let row = 0;
    for (let r = 0; r < MAX_TRACK_ROWS; r++) {
      if (rowEnds[r] <= entry.globalStartMs) {
        row = r;
        break;
      }
      if (rowEnds[r] < rowEnds[row]) row = r;
    }
    rowEnds[row] = entry.globalEndMs;
    return { ...entry, row };
  });
}
