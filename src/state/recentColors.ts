// 最近使用した色(最大5色)。文字色・図形の塗り色など、複数のカラーピッカーで共有する。
// Python版(video_editor_web.py)のrecentColors/addRecentColorと同じ方針: ブラウザのlocalStorageに
// 保存し、新しく選んだ色を先頭に、重複は除いて最大5件まで保持する。

const STORAGE_KEY = 'daily-clips-recent-colors';
const MAX_RECENT_COLORS = 5;

export function getRecentColors(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === 'string') : [];
  } catch {
    // プライベートブラウジング等でlocalStorageが使えない場合は空扱いにする
    return [];
  }
}

/** 色を最近使った色の先頭に追加し(重複は除く)、保存後の一覧を返す。 */
export function addRecentColor(color: string): string[] {
  const next = [color, ...getRecentColors().filter((c) => c !== color)].slice(0, MAX_RECENT_COLORS);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 保存できなくても致命的ではないため無視する
  }
  return next;
}
