import { useEffect } from 'react';
import { DebugLogPanel } from './components/DebugLogPanel';
import { EditorView } from './components/EditorView';
import { MobileEditorView } from './components/MobileEditorView';
import { ProjectListView } from './components/ProjectListView';
import { useIsMobile } from './hooks/useIsMobile';
import { initAutosave } from './state/autosave';
import { installDebugLogCapture } from './state/debugLog';
import { useProjectStore } from './state/projectStore';

// なるべく早いタイミングでconsole.error/warnの横取りを開始しておく
// (モジュール読み込み時点で一度だけ実行される。DebugLogPanel参照)。
installDebugLogCapture();

export default function App() {
  const project = useProjectStore((s) => s.project);
  const isMobile = useIsMobile();

  useEffect(() => {
    const stop = initAutosave();
    return stop;
  }, []);

  return (
    <>
      {!project ? <ProjectListView /> : isMobile ? <MobileEditorView /> : <EditorView />}
      <DebugLogPanel />
    </>
  );
}
