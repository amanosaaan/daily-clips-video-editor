import { useEffect, useRef } from 'react';
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
  const { importVideoFiles, importing, progress, codecWarnings } = useClipImport(project);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // 取り込みが完了したタイミングで、H.264への自動変換が(それも含めて)失敗した動画が
  // あればまとめて知らせる。プレビュー再生や書き出しで初めて気づくと分かりにくいため。
  useEffect(() => {
    if (codecWarnings.length === 0) return;
    window.alert(
      `次の動画は、この端末/ブラウザで再生できる形式への自動変換に失敗しました。書き出すと、これらの動画は映像が表示されず音声のみになります:\n\n${codecWarnings.join('\n')}`,
    );
  }, [codecWarnings]);

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
          <span>
            読み込み中: {progress.done} / {progress.total} 件
          </span>
          {/* 通常の処理は一瞬で終わるため個別表示すると(フォルダ一括追加等で)大量の行が
              並んで画面を圧迫してしまう。時間の掛かるHEVC等の変換中ファイルだけ個別に
              見せれば十分なので、それ以外は上の件数カウントだけに留める。 */}
          {progress.active
            .filter((file) => file.convertingRatio != null)
            .map((file) => (
              <span key={file.name} className="clip-bulk-import__progress-item">
                {`${file.name} を変換中… ${Math.round(file.convertingRatio! * 100)}%`}
              </span>
            ))}
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
