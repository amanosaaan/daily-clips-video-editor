import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../storage/projectRepository';
import type { MediaAsset } from '../domain/types';
import { useProjectStore } from './projectStore';

function makeVideoAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: 'asset-1',
    kind: 'video',
    name: 'clip.mp4',
    durationMs: 4000,
    width: 1920,
    height: 1080,
    createdAt: 0,
    sizeBytes: 1000,
    shotDatetime: '2025-03-02T00:00:00.000Z',
    shotDateSource: 'metadata',
    ...overrides,
  };
}

beforeEach(() => {
  useProjectStore.setState({ project: createProject('テスト'), selectedLayerIds: [], past: [], future: [] });
});

describe('addSceneWithVideo', () => {
  it('adds a new scene with one full-frame video layer, matching duration, and copies shotDate', () => {
    const asset = makeVideoAsset();
    const sceneId = useProjectStore.getState().addSceneWithVideo(asset);
    const project = useProjectStore.getState().project!;

    expect(sceneId).not.toBeNull();
    const scene = project.scenes.find((s) => s.id === sceneId)!;
    expect(scene.duration).toBe(4000);
    expect(scene.shotDate).toBe('2025-03-02T00:00:00.000Z');
    expect(scene.layers).toHaveLength(1);
    expect(scene.layers[0].type).toBe('video');
    expect((scene.layers[0] as { mediaId: string }).mediaId).toBe('asset-1');
  });

  it('appends to the existing scenes rather than replacing them', () => {
    useProjectStore.getState().addSceneWithVideo(makeVideoAsset({ id: 'a' }));
    useProjectStore.getState().addSceneWithVideo(makeVideoAsset({ id: 'b' }));
    const project = useProjectStore.getState().project!;
    // createProject()の初期シーン1つ + 追加した2つ
    expect(project.scenes).toHaveLength(3);
  });

  it('falls back to a default duration when the asset has no known duration', () => {
    const sceneId = useProjectStore.getState().addSceneWithVideo(makeVideoAsset({ durationMs: undefined }));
    const project = useProjectStore.getState().project!;
    const scene = project.scenes.find((s) => s.id === sceneId)!;
    expect(scene.duration).toBeGreaterThan(0);
  });
});

describe('sortScenesByDate', () => {
  it('reorders scenes chronologically by shotDate', () => {
    useProjectStore.getState().addSceneWithVideo(makeVideoAsset({ id: 'c', shotDatetime: '2025-03-03T00:00:00.000Z' }));
    useProjectStore.getState().addSceneWithVideo(makeVideoAsset({ id: 'a', shotDatetime: '2025-03-01T00:00:00.000Z' }));
    useProjectStore.getState().addSceneWithVideo(makeVideoAsset({ id: 'b', shotDatetime: '2025-03-02T00:00:00.000Z' }));

    useProjectStore.getState().sortScenesByDate();

    const project = useProjectStore.getState().project!;
    const mediaIds = project.scenes
      .map((s) => s.layers.find((l) => l.type === 'video'))
      .map((l) => (l as { mediaId?: string } | undefined)?.mediaId);
    // 最初のシーン(createProjectの空シーン、日付不明)は末尾に寄る
    expect(mediaIds).toEqual(['a', 'b', 'c', undefined]);
  });
});

describe('reorderScenes', () => {
  it('moves a scene from one index to another', () => {
    useProjectStore.getState().addSceneWithVideo(makeVideoAsset({ id: 'a' }));
    useProjectStore.getState().addSceneWithVideo(makeVideoAsset({ id: 'b' }));
    const before = useProjectStore.getState().project!.scenes.map((s) => s.id);

    useProjectStore.getState().reorderScenes(before.length - 1, 0);

    const after = useProjectStore.getState().project!.scenes.map((s) => s.id);
    expect(after[0]).toBe(before[before.length - 1]);
  });
});

describe('loadProject', () => {
  it('sorts scenes by shotDate as soon as the project is loaded', () => {
    const base = createProject('読み込みテスト');
    const project = {
      ...base,
      scenes: [
        { id: 'c', duration: 1000, layers: [], shotDate: '2025-03-03T00:00:00.000Z' },
        { id: 'a', duration: 1000, layers: [], shotDate: '2025-03-01T00:00:00.000Z' },
        { id: 'b', duration: 1000, layers: [], shotDate: '2025-03-02T00:00:00.000Z' },
      ],
    };

    useProjectStore.getState().loadProject(project);

    const loaded = useProjectStore.getState().project!;
    expect(loaded.scenes.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
});
