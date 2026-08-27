import { useState } from 'react';
import type { Project } from '../domain/types';
import { addMediaFile } from '../storage/mediaRepository';
import { useProjectStore } from '../state/projectStore';

export interface ClipImportProgress {
  done: number;
  total: number;
}

// addMediaFile内部では、IndexedDB書き込み・動画メタデータ取得・サムネイル生成の
// それぞれに個別のタイムアウト(mediaRepository.tsのMETADATA_TIMEOUT_MS、現在30秒)が
// 順番に掛かりうるため、ここはその合計より確実に大きい値にしておく(そうしないと、
// 内側がまだ粘っている途中でここが先に諦めてしまい、本来成功したはずのファイルを
// 失敗扱いにしてしまう)。あくまで「内側の対策が万一すり抜けた場合」の最終防衛ラインで、
// 通常はここまで待たされることは無い想定。これが無いと、1ファイルでも詰まると
// 「次のファイルへ進まない(ボタンも反応しない)」まま importing が true に張り付いてしまう
// (既存のimportingで全ボタンを無効化するUIの副作用)。
const IMPORT_FILE_TIMEOUT_MS = 100000;
function withImportTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('ファイルの取り込みがタイムアウトしました')), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * 動画ファイルを1つずつ、フレーム全体を使ったクリップ(シーン)として結合していく
 * 用途向けの一括取り込み。個別ファイル選択・フォルダ選択どちらからも使える
 * 共通ロジック(EditorView/MobileEditorView両方から使う)。
 * 全件取り込み終わったら、撮影日時順に自動で並び替える(Python版の挙動と同じ)。
 */
export function useClipImport(project: Project | null) {
  const addMediaAsset = useProjectStore((s) => s.addMediaAsset);
  const addSceneWithVideo = useProjectStore((s) => s.addSceneWithVideo);
  const sortScenesByDate = useProjectStore((s) => s.sortScenesByDate);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<ClipImportProgress | null>(null);

  async function importVideoFiles(files: FileList | File[] | null): Promise<void> {
    if (!files || !project) return;
    const videoFiles = Array.from(files).filter((f) => f.type.startsWith('video/'));
    if (videoFiles.length === 0) return;
    setImporting(true);
    setProgress({ done: 0, total: videoFiles.length });
    // importingがtrueのままだと「追加」ボタン等が無効化されっぱなしになり、次のファイルを
    // 選ぶことすらできなくなる(disabledなボタンはクリックしても無反応に見える)。
    // ループ内の想定外のエラーだけでなく、ループの外(並び替え処理等)で何か起きた場合でも
    // 必ずfinallyでimporting/progressを解除する。
    try {
      for (let i = 0; i < videoFiles.length; i++) {
        try {
          const asset = await withImportTimeout(addMediaFile(project.id, videoFiles[i]), IMPORT_FILE_TIMEOUT_MS);
          addMediaAsset(asset);
          addSceneWithVideo(asset);
        } catch (err) {
          console.error('動画の取り込みに失敗しました(このファイルはスキップします):', videoFiles[i].name, err);
        }
        setProgress({ done: i + 1, total: videoFiles.length });
      }
      sortScenesByDate();
    } finally {
      setProgress(null);
      setImporting(false);
    }
  }

  return { importVideoFiles, importing, progress };
}
