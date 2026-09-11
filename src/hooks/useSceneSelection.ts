import { useRef, useState } from 'react';
import type { Project } from '../domain/types';

export interface SceneClickModifiers {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/**
 * シーンタイムラインのチップに対する複数選択(Ctrl/Cmd+クリックで追加/除外、
 * Shift+クリックで範囲選択)。ファイルマネージャー等でおなじみの挙動に揃えている。
 * 「今プレビューしている(再生ヘッドがある)シーン」とは独立した、書き出し範囲の
 * 指定等に使うための選択状態。
 */
export function useSceneSelection(project: Project | null) {
  const [selectedSceneIds, setSelectedSceneIds] = useState<string[]>([]);
  // 直前に(修飾キー無しで、またはCtrl/Shiftで)操作した基準のシーン。Shift+クリックの
  // 範囲選択はここからの区間になる。
  const anchorRef = useRef<string | null>(null);

  function selectSingle(sceneId: string) {
    anchorRef.current = sceneId;
    setSelectedSceneIds([sceneId]);
  }

  function toggle(sceneId: string) {
    anchorRef.current = sceneId;
    setSelectedSceneIds((prev) => (prev.includes(sceneId) ? prev.filter((id) => id !== sceneId) : [...prev, sceneId]));
  }

  function selectRange(sceneId: string) {
    if (!project) {
      selectSingle(sceneId);
      return;
    }
    const ids = project.scenes.map((s) => s.id);
    const anchorId = anchorRef.current ?? sceneId;
    const a = ids.indexOf(anchorId);
    const b = ids.indexOf(sceneId);
    if (a === -1 || b === -1) {
      selectSingle(sceneId);
      return;
    }
    const [from, to] = a <= b ? [a, b] : [b, a];
    setSelectedSceneIds(ids.slice(from, to + 1));
  }

  function reset() {
    anchorRef.current = null;
    setSelectedSceneIds([]);
  }

  /** シーンチップのクリックイベントから、修飾キーに応じた選択操作を振り分ける。 */
  function handleChipClick(sceneId: string, modifiers: SceneClickModifiers, onPlainClick?: () => void) {
    if (modifiers.ctrlKey || modifiers.metaKey) {
      toggle(sceneId);
    } else if (modifiers.shiftKey) {
      selectRange(sceneId);
    } else {
      selectSingle(sceneId);
      onPlainClick?.();
    }
  }

  return { selectedSceneIds, selectSingle, toggle, selectRange, reset, handleChipClick };
}
