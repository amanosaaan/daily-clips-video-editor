import { nanoid } from 'nanoid';
import { db } from './db';
import type { AspectRatio, Project } from '../domain/types';
import { ASPECT_RATIO_RESOLUTIONS } from '../domain/types';

export function createProject(name: string, aspectRatio: AspectRatio = '16:9'): Project {
  const now = Date.now();
  return {
    id: nanoid(),
    name,
    createdAt: now,
    updatedAt: now,
    aspectRatio,
    resolution: ASPECT_RATIO_RESOLUTIONS[aspectRatio],
    fps: 30,
    scenes: [
      {
        id: nanoid(),
        duration: 5000,
        layers: [],
      },
    ],
    mediaLibrary: [],
  };
}

export async function saveProject(project: Project): Promise<void> {
  await db.projects.put({
    id: project.id,
    name: project.name,
    updatedAt: project.updatedAt,
    json: JSON.stringify(project),
  });
}

export async function loadProject(id: string): Promise<Project | undefined> {
  const record = await db.projects.get(id);
  if (!record) return undefined;
  return JSON.parse(record.json) as Project;
}

export async function listProjects(): Promise<{ id: string; name: string; updatedAt: number }[]> {
  const records = await db.projects.orderBy('updatedAt').reverse().toArray();
  return records.map((r) => ({ id: r.id, name: r.name, updatedAt: r.updatedAt }));
}

export async function deleteProject(id: string): Promise<void> {
  await db.projects.delete(id);
  const blobs = await db.mediaBlobs.where('projectId').equals(id).toArray();
  for (const blob of blobs) {
    await db.thumbnails.where('mediaId').equals(blob.id).delete();
  }
  await db.mediaBlobs.where('projectId').equals(id).delete();
}
