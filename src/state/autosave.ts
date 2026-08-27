import { saveProject } from '../storage/projectRepository';
import { useProjectStore } from './projectStore';

export function initAutosave(debounceMs = 800): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSavedUpdatedAt = 0;

  const unsubscribe = useProjectStore.subscribe((state) => {
    const project = state.project;
    if (!project || project.updatedAt === lastSavedUpdatedAt) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      lastSavedUpdatedAt = project.updatedAt;
      void saveProject(project);
    }, debounceMs);
  });

  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}
