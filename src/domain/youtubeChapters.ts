import type { Project } from './types';

function formatYoutubeTimestamp(totalSeconds: number): string {
  const total = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatChapterDate(iso: string | undefined): string {
  if (!iso) return '不明';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '不明';
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 撮影日が変わるタイミングごとにYouTubeのチャプター行を作る(例: "0:00 2026/08/01")。
 * Python版のgenerate_chapters_textと同じ方針: 各シーンの長さ(ms)を積算してタイムスタンプを求め、
 * 直前のシーンと撮影日(表示用に日付だけへ丸めたもの)が変わったときだけ新しい行を追加する。
 * 先頭シーンは必ず0:00の行になる(YouTubeがチャプターとして認識する条件の一つ)。
 * シーンが1つも無ければ空文字列を返す。
 */
export function generateYoutubeChapters(project: Project): string {
  const lines: string[] = [];
  let elapsedMs = 0;
  let lastDate: string | null = null;
  for (const scene of project.scenes) {
    const date = formatChapterDate(scene.shotDate);
    if (date !== lastDate) {
      lines.push(`${formatYoutubeTimestamp(elapsedMs / 1000)} ${date}`);
      lastDate = date;
    }
    elapsedMs += scene.duration;
  }
  return lines.join('\n');
}
