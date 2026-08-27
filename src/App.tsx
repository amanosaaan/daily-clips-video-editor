import { useEffect } from 'react';
import { EditorView } from './components/EditorView';
import { MobileEditorView } from './components/MobileEditorView';
import { ProjectListView } from './components/ProjectListView';
import { useIsMobile } from './hooks/useIsMobile';
import { initAutosave } from './state/autosave';
import { useProjectStore } from './state/projectStore';

export default function App() {
  const project = useProjectStore((s) => s.project);
  const isMobile = useIsMobile();

  useEffect(() => {
    const stop = initAutosave();
    return stop;
  }, []);

  if (!project) return <ProjectListView />;
  return isMobile ? <MobileEditorView /> : <EditorView />;
}
