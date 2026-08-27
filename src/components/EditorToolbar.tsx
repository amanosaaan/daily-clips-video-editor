import { useEffect } from 'react';
import { useProjectStore } from '../state/projectStore';
import { CursorIcon, FrameIcon, PaletteIcon, PenIcon, PlusIcon, RedoIcon, SearchIcon, UndoIcon } from './icons';

export function EditorToolbar() {
  const canUndo = useProjectStore((s) => s.past.length > 0);
  const canRedo = useProjectStore((s) => s.future.length > 0);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  return (
    <div className="editor__tools" role="toolbar" aria-label="ツール">
      <button className="editor__tools-btn" disabled title="検索（未対応）">
        <SearchIcon />
      </button>
      <button className="editor__tools-btn" disabled title="要素を追加（右側の挿入メニューをご利用ください）">
        <PlusIcon />
      </button>
      <span className="editor__tools-divider" />
      <button className="editor__tools-btn is-active" disabled title="選択ツール">
        <CursorIcon />
      </button>
      <button className="editor__tools-btn" disabled title="図形描画（未対応）">
        <FrameIcon />
      </button>
      <button className="editor__tools-btn" disabled title="塗りつぶし（未対応）">
        <PaletteIcon />
      </button>
      <button className="editor__tools-btn" disabled title="ペン（未対応）">
        <PenIcon />
      </button>
      <span className="editor__tools-divider" />
      <button className="editor__tools-btn" onClick={undo} disabled={!canUndo} title="元に戻す (Ctrl+Z)">
        <UndoIcon />
      </button>
      <button className="editor__tools-btn" onClick={redo} disabled={!canRedo} title="やり直す (Ctrl+Shift+Z)">
        <RedoIcon />
      </button>
    </div>
  );
}
