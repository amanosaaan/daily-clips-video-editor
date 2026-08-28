import { useEffect, useRef, useState } from 'react';
import type { AspectRatio } from '../domain/types';
import { createProject, deleteProject, listProjects, loadProject, saveProject } from '../storage/projectRepository';
import { importProjectFile } from '../storage/projectPortability';
import { useProjectStore } from '../state/projectStore';

interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
}

export function ProjectListView() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [newName, setNewName] = useState('新しいプロジェクト');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const loadIntoStore = useProjectStore((s) => s.loadProject);

  async function refresh() {
    setProjects(await listProjects());
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleCreate() {
    const project = createProject(newName.trim() || '無題のプロジェクト', aspectRatio);
    await saveProject(project);
    loadIntoStore(project);
  }

  async function handleOpen(id: string) {
    const project = await loadProject(id);
    if (project) loadIntoStore(project);
  }

  async function handleDelete(id: string) {
    if (!window.confirm('このプロジェクトを削除しますか？（元に戻せません）')) return;
    await deleteProject(id);
    await refresh();
  }

  async function handleImportFile(file: File | undefined) {
    if (!file) return;
    setImporting(true);
    setImportError(null);
    try {
      const project = await importProjectFile(file);
      await saveProject(project);
      await refresh();
    } catch (err) {
      console.error(err);
      setImportError('プロジェクトファイルの読み込みに失敗しました。ファイルが壊れているか、対応していない形式です。');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="project-list">
      <h1>
        <div className="editor__logo" />
        デイリークリップス
      </h1>
      <p className="project-list__tagline">日付順に動画をつないで、思い出をまとめて残すバックアップアプリ</p>
      <section className="project-list__new">
        <h2>新規プロジェクト</h2>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="プロジェクト名" />
        <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}>
          <option value="16:9">16:9（横）</option>
          <option value="9:16">9:16（縦）</option>
          <option value="1:1">1:1（正方形）</option>
        </select>
        <button className="btn-pill btn-pill--primary" onClick={() => void handleCreate()}>
          作成
        </button>
        <input
          ref={importInputRef}
          type="file"
          accept=".veproj,application/zip"
          style={{ display: 'none' }}
          onChange={(e) => void handleImportFile(e.target.files?.[0])}
        />
        <button onClick={() => importInputRef.current?.click()} disabled={importing}>
          {importing ? '読み込み中…' : 'プロジェクトを読み込む'}
        </button>
      </section>
      {importError && <p className="project-list__empty">{importError}</p>}
      <section className="project-list__existing">
        <h2>プロジェクト一覧</h2>
        {projects.length === 0 && <p className="project-list__empty">まだプロジェクトがありません。</p>}
        <ul>
          {projects.map((p) => (
            <li key={p.id} className="project-list__row">
              <button className="project-list__open" onClick={() => void handleOpen(p.id)}>
                <span>{p.name}</span>
                <span className="project-list__date">{new Date(p.updatedAt).toLocaleString('ja-JP')}</span>
              </button>
              <button className="project-list__delete" onClick={() => void handleDelete(p.id)}>
                削除
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
