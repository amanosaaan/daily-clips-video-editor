import { describe, expect, it } from 'vitest';
import { ASPECT_RATIO_RESOLUTIONS } from '../domain/types';
import { createProject } from './projectRepository';

describe('createProject', () => {
  it('creates a project with one default scene and no media', () => {
    const project = createProject('テストプロジェクト');
    expect(project.name).toBe('テストプロジェクト');
    expect(project.scenes).toHaveLength(1);
    expect(project.scenes[0].layers).toHaveLength(0);
    expect(project.mediaLibrary).toHaveLength(0);
  });

  it('maps aspect ratio to the correct resolution', () => {
    const vertical = createProject('縦動画', '9:16');
    expect(vertical.aspectRatio).toBe('9:16');
    expect(vertical.resolution).toEqual(ASPECT_RATIO_RESOLUTIONS['9:16']);
    expect(vertical.resolution.height).toBeGreaterThan(vertical.resolution.width);
  });

  it('defaults to 16:9 when no aspect ratio is given', () => {
    const project = createProject('デフォルト');
    expect(project.aspectRatio).toBe('16:9');
    expect(project.resolution.width).toBeGreaterThan(project.resolution.height);
  });
});
