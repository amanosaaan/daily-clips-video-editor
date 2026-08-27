import Dexie, { type EntityTable } from 'dexie';

export interface ProjectRecord {
  id: string;
  name: string;
  updatedAt: number;
  json: string;
}

export interface MediaBlobRecord {
  id: string;
  projectId: string;
  blob: Blob;
  mime: string;
  sizeBytes: number;
}

export interface ThumbnailRecord {
  id: string;
  mediaId: string;
  blob: Blob;
}

export const db = new Dexie('video-editor-db') as Dexie & {
  projects: EntityTable<ProjectRecord, 'id'>;
  mediaBlobs: EntityTable<MediaBlobRecord, 'id'>;
  thumbnails: EntityTable<ThumbnailRecord, 'id'>;
};

db.version(1).stores({
  projects: 'id, updatedAt',
  mediaBlobs: 'id, projectId',
  thumbnails: 'id, mediaId',
});
