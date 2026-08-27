import { useState } from 'react';
import type { Project } from '../domain/types';
import { addMediaFile } from '../storage/mediaRepository';
import { useProjectStore } from '../state/projectStore';

export interface ClipImportProgress {
  done: number;
  total: number;
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
    for (let i = 0; i < videoFiles.length; i++) {
      try {
        const asset = await addMediaFile(project.id, videoFiles[i]);
        addMediaAsset(asset);
        addSceneWithVideo(asset);
      } catch (err) {
        console.error(err);
      }
      setProgress({ done: i + 1, total: videoFiles.length });
    }
    sortScenesByDate();
    setProgress(null);
    setImporting(false);
  }

  return { importVideoFiles, importing, progress };
}
