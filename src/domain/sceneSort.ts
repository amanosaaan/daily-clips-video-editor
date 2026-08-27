import type { Scene } from './types';

/**
 * 全シーンを撮影日時(Scene.shotDate、ISO文字列)順に並び替える。
 * 日付が分からないシーンは末尾側に寄せる(Python版のsortClipsByDate/
 * sortKeyForDateと同じ方針)。安定ソートなので、同日内・日付不明同士の
 * 相対順序は保たれる。
 */
export function sortScenesByShotDate(scenes: Scene[]): Scene[] {
  return [...scenes].sort((a, b) => {
    const da = a.shotDate || '';
    const db = b.shotDate || '';
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return da < db ? -1 : da > db ? 1 : 0;
  });
}
