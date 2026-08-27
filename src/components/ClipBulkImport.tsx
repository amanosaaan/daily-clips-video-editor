import { useRef } from 'react';
import type { Project } from '../domain/types';
import { useClipImport } from '../hooks/useClipImport';
import { useProjectStore } from '../state/projectStore';
import { CalendarIcon, FolderOpenIcon, UploadIcon } from './icons';

interface Props {
  project: Project;
}

/**
 * 動画をクリップとしてまとめて追加するボタン群(個別ファイル選択/フォルダ選択)と、
 * 撮影日時順への並び替えボタン。EditorView(PC)・MobileEditorView両方から使う。
 */
export function ClipBulkImport({ project }: Props) {
  const sortScenesByDate = useProjectStore((s) => s.sortScenesByDate);
  const { importVideoFiles, importing, progress } = useClipImport(project);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="clip-bulk-import">
      <button
        className="btn-pill"
        onClick={() => filesInputRef.current?.click()}
        disabled={importing}
        title="動画をクリップとしてまとめて追加"
      >
        <UploadIcon size={16} /> 動画を追加
      </button>
      <button
        className="btn-pill"
        onClick={() => folderInputRef.current?.click()}
        disabled={importing}
        title="フォルダ内の動画をまとめてクリップとして追加"
      >
        <FolderOpenIcon size={16} /> フォルダから追加
      </button>
      <button
        className="btn-pill"
        onClick={() => sortScenesByDate()}
        disabled={importing || project.scenes.length < 2}
        title="全クリップを撮影日時順に並び替える"
      >
        <CalendarIcon size={16} /> 日付順に並び替え
      </button>
      {importing && progress && (
        <span className="clip-bulk-import__progress">
          読み込み中: {progress.done} / {progress.total} 件
        </span>
      )}
      <input
        ref={filesInputRef}
        type="file"
        accept="video/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          void importVideoFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        accept="video/*"
        multiple
        // @ts-expect-error webkitdirectoryは非標準だが主要ブラウザで広くサポートされている
        webkitdirectory=""
        style={{ display: 'none' }}
        onChange={(e) => {
          void importVideoFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
