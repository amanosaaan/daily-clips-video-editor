import type { Layer, Project } from './types';

export type AlignAxis = 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom';

export function bringToFrontPatch(layers: Layer[]): Partial<Layer> {
  const maxZ = Math.max(...layers.map((l) => l.zIndex));
  return { zIndex: maxZ + 1 };
}

export function sendToBackPatch(layers: Layer[]): Partial<Layer> {
  const minZ = Math.min(...layers.map((l) => l.zIndex));
  return { zIndex: minZ - 1 };
}

export function alignPatch(project: Project, layer: Layer, axis: AlignAxis): Partial<Layer> {
  switch (axis) {
    case 'left':
      return { x: 0 };
    case 'centerH':
      return { x: (project.resolution.width - layer.width) / 2 };
    case 'right':
      return { x: project.resolution.width - layer.width };
    case 'top':
      return { y: 0 };
    case 'centerV':
      return { y: (project.resolution.height - layer.height) / 2 };
    case 'bottom':
      return { y: project.resolution.height - layer.height };
  }
}

export function rotatePatch(layer: Layer, deltaDeg: number): Partial<Layer> {
  return { rotation: (((layer.rotation + deltaDeg) % 360) + 360) % 360 };
}

export interface LayerPatch {
  id: string;
  patch: Partial<Layer>;
}

/** 選択中の複数レイヤーをまとめて最前面へ。相対的な重なり順は保持する */
export function bringToFrontPatches(allLayers: Layer[], targets: Layer[]): LayerPatch[] {
  let z = Math.max(...allLayers.map((l) => l.zIndex));
  return targets.map((l) => ({ id: l.id, patch: { zIndex: ++z } }));
}

/** 選択中の複数レイヤーをまとめて最背面へ。相対的な重なり順は保持する */
export function sendToBackPatches(allLayers: Layer[], targets: Layer[]): LayerPatch[] {
  let z = Math.min(...allLayers.map((l) => l.zIndex));
  return [...targets]
    .reverse()
    .map((l) => ({ id: l.id, patch: { zIndex: --z } }))
    .reverse();
}

export function alignPatches(project: Project, targets: Layer[], axis: AlignAxis): LayerPatch[] {
  return targets.map((l) => ({ id: l.id, patch: alignPatch(project, l, axis) }));
}

export function rotatePatches(targets: Layer[], deltaDeg: number): LayerPatch[] {
  return targets.map((l) => ({ id: l.id, patch: rotatePatch(l, deltaDeg) }));
}

export interface StepZIndexResult {
  targetPatch: Partial<Layer>;
  neighborId: string;
  neighborPatch: Partial<Layer>;
}

/** 隣接するレイヤーと zIndex を入れ替えて、重なり順を1段階だけ前後させる */
export function stepZIndexPatches(
  layers: Layer[],
  layer: Layer,
  direction: 'forward' | 'backward',
): StepZIndexResult | null {
  const sorted = [...layers].sort((a, b) => a.zIndex - b.zIndex);
  const index = sorted.findIndex((l) => l.id === layer.id);
  const neighborIndex = direction === 'forward' ? index + 1 : index - 1;
  const neighbor = sorted[neighborIndex];
  if (!neighbor) return null;
  return {
    targetPatch: { zIndex: neighbor.zIndex },
    neighborId: neighbor.id,
    neighborPatch: { zIndex: layer.zIndex },
  };
}
