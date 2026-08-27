import { nanoid } from 'nanoid';
import type { Project, Scene } from './types';

export function getTotalDurationMs(project: Project): number {
  return project.scenes.reduce((sum, scene) => sum + scene.duration, 0);
}

export function getSceneStartMs(project: Project, sceneId: string): number {
  let acc = 0;
  for (const scene of project.scenes) {
    if (scene.id === sceneId) return acc;
    acc += scene.duration;
  }
  return 0;
}

export interface TimelinePosition {
  scene: Scene;
  sceneIndex: number;
  sceneStartMs: number;
  localTimeMs: number;
}

/**
 * 全体タイムライン上のミリ秒からシーンとシーン内ローカル時刻を求める。
 * ちょうど境界上の時刻は次のシーンの先頭として扱う。
 */
export function resolvePosition(project: Project, globalTimeMs: number): TimelinePosition | null {
  if (project.scenes.length === 0) return null;
  const clamped = Math.max(0, globalTimeMs);
  let acc = 0;
  for (let i = 0; i < project.scenes.length; i++) {
    const scene = project.scenes[i];
    const isLast = i === project.scenes.length - 1;
    if (clamped < acc + scene.duration || isLast) {
      const localTimeMs = Math.min(Math.max(clamped - acc, 0), scene.duration);
      return { scene, sceneIndex: i, sceneStartMs: acc, localTimeMs };
    }
    acc += scene.duration;
  }
  return null;
}

/**
 * シーンをローカル時刻(ms)の位置で前半・後半の2シーンに分割する。
 * 動画・音声レイヤーは後半の再生開始位置を分割点の分だけ進め、続きから
 * 再生されるようにする。テキストや図形など時間軸を持たないレイヤーは
 * そのまま両方に複製する。シーン間の切り替え効果(transitionOut)は、
 * 元々「次のシーンへ」のものなので後半側に引き継ぐ（前半と後半の間はカット）。
 * 分割点がシーンの先頭・末尾ちょうどの場合は分割する意味がないため null を返す。
 */
export function splitSceneAt(
  scenes: Scene[],
  sceneId: string,
  localTimeMs: number,
): { scenes: Scene[]; newSceneId: string } | null {
  const index = scenes.findIndex((s) => s.id === sceneId);
  if (index === -1) return null;
  const original = scenes[index];
  const splitAt = Math.round(localTimeMs);
  if (splitAt <= 0 || splitAt >= original.duration) return null;

  const firstScene: Scene = { ...original, duration: splitAt, transitionOut: undefined };
  const secondScene: Scene = {
    ...original,
    id: nanoid(),
    duration: original.duration - splitAt,
    transitionOut: original.transitionOut,
    layers: original.layers.map((l) =>
      l.type === 'video' || l.type === 'audio' ? { ...l, id: nanoid(), trimStart: l.trimStart + splitAt } : { ...l, id: nanoid() },
    ),
  };

  const newScenes = [...scenes];
  newScenes.splice(index, 1, firstScene, secondScene);
  return { scenes: newScenes, newSceneId: secondScene.id };
}

// シーンチップ列（スマホの横スクロールするシーン一覧）の見た目の幅と、
// 実際の再生時刻(ms)を相互変換するための定数・関数。
// forward(time→px)とinverse(px→time)が必ず同じ定数を参照するよう、ここに集約する
// （別々の場所に置くとズレて丸め誤差の温床になる）。
export const SCENE_CHIP_GAP_PX = 8;
// 1msあたりのpx数（20px/秒）
const SCENE_CHIP_PX_PER_MS = 0.02;
// あまりに短いシーンだとタップできない/見えなくなるため最低幅を設ける。
const SCENE_CHIP_MIN_WIDTH_PX = 32;

/** シーンの長さに比例したチップの表示幅(px)を返す（最低幅あり）。zoomは表示倍率(1=100%)。 */
export function sceneChipWidthPx(durationMs: number, zoom = 1): number {
  return Math.max(SCENE_CHIP_MIN_WIDTH_PX, durationMs * SCENE_CHIP_PX_PER_MS * zoom);
}

/** 指定したシーン・シーン内ローカル時刻が、チップ列の先頭から何px進んだ位置に当たるかを計算する */
export function timelinePositionToOffsetPx(
  scenes: Scene[],
  sceneIndex: number,
  localTimeMs: number,
  sceneDurationMs: number,
  zoom = 1,
): number {
  const precedingWidth = scenes.slice(0, sceneIndex).reduce((sum, s) => sum + sceneChipWidthPx(s.duration, zoom) + SCENE_CHIP_GAP_PX, 0);
  const progress = sceneDurationMs > 0 ? Math.min(1, Math.max(0, localTimeMs / sceneDurationMs)) : 0;
  return precedingWidth + progress * sceneChipWidthPx(sceneDurationMs, zoom);
}

/** timelinePositionToOffsetPxの逆変換。チップ列内のpx位置から、対応する全体タイムライン上のミリ秒を求める。 */
export function timelineOffsetPxToGlobalMs(scenes: Scene[], offsetPx: number, zoom = 1): number {
  const clamped = Math.max(0, offsetPx);
  let pxAcc = 0;
  let msAcc = 0;
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const w = sceneChipWidthPx(scene.duration, zoom);
    const isLast = i === scenes.length - 1;
    if (clamped < pxAcc + w || isLast) {
      const localPx = Math.min(Math.max(clamped - pxAcc, 0), w);
      const fraction = w > 0 ? localPx / w : 0;
      return msAcc + fraction * scene.duration;
    }
    pxAcc += w + SCENE_CHIP_GAP_PX;
    msAcc += scene.duration;
  }
  return msAcc;
}
