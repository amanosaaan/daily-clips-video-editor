import { unzip, zip } from 'fflate';
import { nanoid } from 'nanoid';
import type { Layer, MediaAsset, Project } from '../domain/types';
import { addMediaBlob, getMediaBlob } from './mediaRepository';

export async function exportProjectFile(project: Project): Promise<Blob> {
  const files: Record<string, Uint8Array> = {};
  const mediaMime: Record<string, string> = {};

  for (const asset of project.mediaLibrary) {
    const blob = await getMediaBlob(asset.id);
    if (!blob) continue;
    files[`media/${asset.id}`] = new Uint8Array(await blob.arrayBuffer());
    mediaMime[asset.id] = blob.type;
  }

  files['project.json'] = new TextEncoder().encode(JSON.stringify(project));
  files['media-mime.json'] = new TextEncoder().encode(JSON.stringify(mediaMime));

  const zipped = await new Promise<Uint8Array>((resolve, reject) => {
    zip(files, { level: 6 }, (err, data) => (err ? reject(err) : resolve(data)));
  });

  return new Blob([new Uint8Array(zipped)], { type: 'application/zip' });
}

function remapLayerMediaId(layer: Layer, mediaIdMap: Map<string, string>): Layer | null {
  if (layer.type === 'video' || layer.type === 'image' || layer.type === 'audio') {
    const newMediaId = mediaIdMap.get(layer.mediaId);
    if (!newMediaId) return null;
    return { ...layer, mediaId: newMediaId };
  }
  return layer;
}

export async function importProjectFile(file: File): Promise<Project> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(buffer, (err, data) => (err ? reject(err) : resolve(data)));
  });

  const projectJsonBytes = entries['project.json'];
  if (!projectJsonBytes) throw new Error('プロジェクトファイルの形式が正しくありません');
  const original = JSON.parse(new TextDecoder().decode(projectJsonBytes)) as Project;

  const mediaMimeBytes = entries['media-mime.json'];
  const mediaMime: Record<string, string> = mediaMimeBytes
    ? (JSON.parse(new TextDecoder().decode(mediaMimeBytes)) as Record<string, string>)
    : {};

  const newProjectId = nanoid();
  const mediaIdMap = new Map<string, string>();
  const newMediaLibrary: MediaAsset[] = [];

  for (const asset of original.mediaLibrary) {
    const bytes = entries[`media/${asset.id}`];
    if (!bytes) continue;
    const blob = new Blob([new Uint8Array(bytes)], { type: mediaMime[asset.id] ?? '' });
    const newAsset = await addMediaBlob(newProjectId, blob, asset.name);
    mediaIdMap.set(asset.id, newAsset.id);
    newMediaLibrary.push(newAsset);
  }

  const now = Date.now();
  return {
    ...original,
    id: newProjectId,
    name: `${original.name}（読込）`,
    createdAt: now,
    updatedAt: now,
    mediaLibrary: newMediaLibrary,
    scenes: original.scenes.map((scene) => ({
      ...scene,
      layers: scene.layers
        .map((layer) => remapLayerMediaId(layer, mediaIdMap))
        .filter((layer): layer is Layer => layer !== null),
    })),
  };
}
