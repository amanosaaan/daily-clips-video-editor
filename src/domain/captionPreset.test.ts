import { describe, expect, it } from 'vitest';
import { computeCaptionPresetLayout } from './captionPreset';

describe('computeCaptionPresetLayout', () => {
  it('centers the caption box horizontally', () => {
    const layout = computeCaptionPresetLayout({ width: 1280, height: 720 });
    const center = layout.x + layout.width / 2;
    expect(Math.abs(center - 1280 / 2)).toBeLessThanOrEqual(1);
  });

  it('keeps the box fully inside the frame near the bottom', () => {
    const layout = computeCaptionPresetLayout({ width: 1280, height: 720 });
    expect(layout.x).toBeGreaterThanOrEqual(0);
    expect(layout.y).toBeGreaterThanOrEqual(0);
    expect(layout.x + layout.width).toBeLessThanOrEqual(1280);
    expect(layout.y + layout.height).toBeLessThanOrEqual(720);
    // 下部寄りに配置されていること
    expect(layout.y).toBeGreaterThan(720 / 2);
  });

  it('scales proportionally for a vertical (9:16) resolution', () => {
    const layout = computeCaptionPresetLayout({ width: 720, height: 1280 });
    expect(layout.width).toBe(Math.round(720 * 0.8));
    expect(layout.fontSize).toBe(Math.round(1280 * 0.045));
  });
});
