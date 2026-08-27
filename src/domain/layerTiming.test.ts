import { describe, expect, it } from 'vitest';
import { getLayerVisibleRange, isLayerVisibleAt } from './layerTiming';
import type { ShapeLayer } from './types';

function makeLayer(overrides: Partial<ShapeLayer> = {}): ShapeLayer {
  return {
    id: 'l1',
    type: 'shape',
    shape: 'rect',
    fill: '#000',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    zIndex: 1,
    ...overrides,
  };
}

describe('getLayerVisibleRange', () => {
  it('defaults to the full scene duration when startMs/endMs are not set', () => {
    expect(getLayerVisibleRange(makeLayer(), 5000)).toEqual({ start: 0, end: 5000 });
  });

  it('uses the explicit startMs/endMs when set', () => {
    expect(getLayerVisibleRange(makeLayer({ startMs: 1000, endMs: 3000 }), 5000)).toEqual({ start: 1000, end: 3000 });
  });

  it('clamps start and end to the scene duration', () => {
    expect(getLayerVisibleRange(makeLayer({ startMs: -500, endMs: 9000 }), 5000)).toEqual({ start: 0, end: 5000 });
  });

  it('never lets end fall below start (a degenerate/inverted range collapses to a point)', () => {
    expect(getLayerVisibleRange(makeLayer({ startMs: 4000, endMs: 1000 }), 5000)).toEqual({ start: 4000, end: 4000 });
  });
});

describe('isLayerVisibleAt', () => {
  it('is visible for the whole scene by default', () => {
    const layer = makeLayer();
    expect(isLayerVisibleAt(layer, 0, 5000)).toBe(true);
    expect(isLayerVisibleAt(layer, 2500, 5000)).toBe(true);
    expect(isLayerVisibleAt(layer, 5000, 5000)).toBe(true);
  });

  it('is invisible before its start and after its end', () => {
    const layer = makeLayer({ startMs: 1000, endMs: 3000 });
    expect(isLayerVisibleAt(layer, 500, 5000)).toBe(false);
    expect(isLayerVisibleAt(layer, 1000, 5000)).toBe(true);
    expect(isLayerVisibleAt(layer, 2000, 5000)).toBe(true);
    expect(isLayerVisibleAt(layer, 3000, 5000)).toBe(true);
    expect(isLayerVisibleAt(layer, 3001, 5000)).toBe(false);
  });
});
