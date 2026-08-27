import { describe, expect, it } from 'vitest';
import type { MosaicLayer, Scene, ShapeLayer, TextLayer, VideoLayer } from '../domain/types';
import { drawSceneFrame, drawTransitionFrame } from './compositor';

function createFakeCtx() {
  const calls: string[] = [];
  const translateLog: [number, number][] = [];
  const rotateLog: number[] = [];
  const scaleLog: [number, number][] = [];
  const fillRectAlphaLog: number[] = [];
  const fillTextAlphaLog: { text: string; alpha: number }[] = [];
  const drawImageArgsLog: unknown[][] = [];

  let globalAlphaValue = 1;
  const alphaStack: number[] = [];

  const ctx = {
    // モザイク描画がctx.canvas.width/heightを参照するため、実際のcanvasに近い最小限の
    // モックを用意する(jsdom環境では実描画コンテキストが取れずモザイク本体は早期returnになるが、
    // クラッシュしないことと呼び出し前後の save/restore は検証できる)。
    canvas: { width: 640, height: 360 },
    fillStyle: '',
    strokeStyle: '',
    font: '',
    filter: 'none',
    lineWidth: 1,
    lineJoin: 'miter' as CanvasLineJoin,
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'top' as CanvasTextBaseline,
    imageSmoothingEnabled: true,
    get globalAlpha() {
      return globalAlphaValue;
    },
    set globalAlpha(v: number) {
      globalAlphaValue = v;
    },
    save: () => {
      calls.push('save');
      alphaStack.push(globalAlphaValue);
    },
    restore: () => {
      calls.push('restore');
      globalAlphaValue = alphaStack.pop() ?? 1;
    },
    translate: (x: number, y: number) => {
      calls.push('translate');
      translateLog.push([x, y]);
    },
    rotate: (angle: number) => {
      calls.push('rotate');
      rotateLog.push(angle);
    },
    scale: (x: number, y: number) => {
      calls.push('scale');
      scaleLog.push([x, y]);
    },
    fillRect: () => {
      calls.push('fillRect');
      fillRectAlphaLog.push(globalAlphaValue);
    },
    strokeRect: () => calls.push('strokeRect'),
    fillText: (text: string) => {
      calls.push(`fillText:${text}`);
      fillTextAlphaLog.push({ text, alpha: globalAlphaValue });
    },
    strokeText: (text: string) => calls.push(`strokeText:${text}`),
    drawImage: (...args: unknown[]) => {
      calls.push('drawImage');
      drawImageArgsLog.push(args);
    },
    beginPath: () => calls.push('beginPath'),
    ellipse: () => calls.push('ellipse'),
    fill: () => calls.push('fill'),
    stroke: () => calls.push('stroke'),
    moveTo: () => calls.push('moveTo'),
    lineTo: () => calls.push('lineTo'),
    clip: () => calls.push('clip'),
    rect: () => calls.push('rect'),
  };
  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    calls,
    translateLog,
    rotateLog,
    scaleLog,
    fillRectAlphaLog,
    fillTextAlphaLog,
    drawImageArgsLog,
  };
}

const baseLayer = {
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  opacity: 1,
};

describe('drawSceneFrame', () => {
  it('draws layers in ascending zIndex order regardless of array order', () => {
    const shape: ShapeLayer = { ...baseLayer, id: 'shape', type: 'shape', shape: 'rect', fill: '#f00', zIndex: 2 };
    const text: TextLayer = {
      ...baseLayer,
      id: 'text',
      type: 'text',
      content: 'hello',
      fontFamily: 'sans-serif',
      fontSize: 20,
      color: '#fff',
      fontWeight: 'normal',
      align: 'left',
      zIndex: 1,
    };
    const scene: Scene = { id: 'scene', duration: 1000, layers: [shape, text] };
    const { ctx, calls } = createFakeCtx();

    drawSceneFrame(ctx, scene, 640, 360, new Map());

    const textIndex = calls.indexOf('fillText:hello');
    // fillRect is also used for the scene background, so take the later (shape's own) call.
    const shapeIndex = calls.lastIndexOf('fillRect');
    expect(textIndex).toBeGreaterThan(-1);
    expect(shapeIndex).toBeGreaterThan(-1);
    expect(textIndex).toBeLessThan(shapeIndex);
  });

  it('draws each newline-separated line of a text layer separately', () => {
    const text: TextLayer = {
      ...baseLayer,
      id: 'text',
      type: 'text',
      content: '1行目\n2行目',
      fontFamily: 'sans-serif',
      fontSize: 20,
      color: '#fff',
      fontWeight: 'normal',
      align: 'left',
      zIndex: 0,
    };
    const scene: Scene = { id: 'scene', duration: 1000, layers: [text] };
    const { ctx, calls } = createFakeCtx();

    drawSceneFrame(ctx, scene, 640, 360, new Map());

    expect(calls).toContain('fillText:1行目');
    expect(calls).toContain('fillText:2行目');
  });

  it('draws a background box before the text when backgroundColor is set', () => {
    const withBackground: TextLayer = {
      ...baseLayer,
      id: 'text',
      type: 'text',
      content: '字幕',
      fontFamily: 'sans-serif',
      fontSize: 20,
      color: '#fff',
      fontWeight: 'normal',
      align: 'center',
      backgroundColor: 'rgba(0,0,0,0.6)',
      zIndex: 0,
    };
    const scene: Scene = { id: 'scene', duration: 1000, layers: [withBackground] };
    const { ctx, calls } = createFakeCtx();

    drawSceneFrame(ctx, scene, 640, 360, new Map());

    // シーン背景 + 字幕の背景ボックスで fillRect が2回呼ばれ、どちらも fillText より前にある。
    const fillRectCalls = calls.filter((c) => c === 'fillRect').length;
    const lastFillRectIndex = calls.lastIndexOf('fillRect');
    const textIndex = calls.indexOf('fillText:字幕');
    expect(fillRectCalls).toBe(2);
    expect(lastFillRectIndex).toBeLessThan(textIndex);
  });

  it('does not draw an extra background box when backgroundColor is unset', () => {
    const withoutBackground: TextLayer = {
      ...baseLayer,
      id: 'text',
      type: 'text',
      content: '通常テキスト',
      fontFamily: 'sans-serif',
      fontSize: 20,
      color: '#fff',
      fontWeight: 'normal',
      align: 'left',
      zIndex: 0,
    };
    const scene: Scene = { id: 'scene', duration: 1000, layers: [withoutBackground] };
    const { ctx, calls } = createFakeCtx();

    drawSceneFrame(ctx, scene, 640, 360, new Map());

    expect(calls.filter((c) => c === 'fillRect').length).toBe(1);
  });
});

describe('drawLayer animations', () => {
  it('applies an extra rotation for a spin animation based on sceneTimeMs', () => {
    const shape: ShapeLayer = {
      ...baseLayer,
      id: 'shape',
      type: 'shape',
      shape: 'rect',
      fill: '#f00',
      zIndex: 0,
      animation: { type: 'spin', durationMs: 1000 },
    };
    const scene: Scene = { id: 'scene', duration: 1000, layers: [shape] };
    const { ctx, rotateLog } = createFakeCtx();

    // 1000msが1周期なので250ms = 1/4周 = 90度 = π/2ラジアン
    drawSceneFrame(ctx, scene, 640, 360, new Map(), 250);

    expect(rotateLog.some((angle) => Math.abs(angle - Math.PI / 2) < 1e-6)).toBe(true);
  });

  it('applies no extra rotation when there is no animation', () => {
    const shape: ShapeLayer = { ...baseLayer, id: 'shape', type: 'shape', shape: 'rect', fill: '#f00', zIndex: 0 };
    const scene: Scene = { id: 'scene', duration: 1000, layers: [shape] };
    const { ctx, rotateLog } = createFakeCtx();

    drawSceneFrame(ctx, scene, 640, 360, new Map(), 250);

    // baseLayer.rotation = 0 分の rotate(0) のみで、追加の回転はない
    expect(rotateLog.every((angle) => angle === 0)).toBe(true);
  });

  it('applies a scale factor for a pulse animation at its peak', () => {
    const shape: ShapeLayer = {
      ...baseLayer,
      id: 'shape',
      type: 'shape',
      shape: 'rect',
      fill: '#f00',
      zIndex: 0,
      animation: { type: 'pulse', durationMs: 1000 },
    };
    const scene: Scene = { id: 'scene', duration: 1000, layers: [shape] };
    const { ctx, scaleLog } = createFakeCtx();

    // sin(2π*t) は t=0.25 (250ms) でピーク(1.0)になる
    drawSceneFrame(ctx, scene, 640, 360, new Map(), 250);

    expect(scaleLog).toHaveLength(1);
    expect(scaleLog[0][0]).toBeCloseTo(1.08, 5);
    expect(scaleLog[0][1]).toBeCloseTo(1.08, 5);
  });
});

describe('drawLayer photo filter', () => {
  it('sets and resets ctx.filter around a video/image draw when a filter is set', () => {
    const video: VideoLayer = {
      ...baseLayer,
      id: 'video',
      type: 'video',
      mediaId: 'media-1',
      trimStart: 0,
      volume: 1,
      muted: false,
      zIndex: 0,
      filter: { brightness: 120, contrast: 80 },
    };
    const scene: Scene = { id: 'scene', duration: 1000, layers: [video] };
    const { ctx } = createFakeCtx();
    const assets = new Map([['media-1', document.createElement('video')]]);

    drawSceneFrame(ctx, scene, 640, 360, assets);

    expect((ctx as unknown as { filter: string }).filter).toBe('none');
  });
});

describe('drawLayer video crop', () => {
  function makeVideoEl(videoWidth: number, videoHeight: number): HTMLVideoElement {
    const el = document.createElement('video');
    Object.defineProperty(el, 'videoWidth', { value: videoWidth, configurable: true });
    Object.defineProperty(el, 'videoHeight', { value: videoHeight, configurable: true });
    return el;
  }

  it('draws with a source rect derived from crop (fractions of videoWidth/videoHeight)', () => {
    const video: VideoLayer = {
      ...baseLayer,
      id: 'video',
      type: 'video',
      mediaId: 'media-1',
      trimStart: 0,
      volume: 1,
      muted: false,
      zIndex: 0,
      x: 10,
      y: 20,
      width: 300,
      height: 150,
      crop: { x: 0.25, y: 0.1, width: 0.5, height: 0.8 },
    };
    const scene: Scene = { id: 'scene', duration: 1000, layers: [video] };
    const { ctx, drawImageArgsLog } = createFakeCtx();
    const el = makeVideoEl(1920, 1080);
    const assets = new Map([['media-1', el]]);

    drawSceneFrame(ctx, scene, 640, 360, assets);

    expect(drawImageArgsLog).toHaveLength(1);
    const [elArg, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight] = drawImageArgsLog[0];
    expect(elArg).toBe(el);
    expect(sx).toBeCloseTo(0.25 * 1920, 5);
    expect(sy).toBeCloseTo(0.1 * 1080, 5);
    expect(sWidth).toBeCloseTo(0.5 * 1920, 5);
    expect(sHeight).toBeCloseTo(0.8 * 1080, 5);
    expect(dx).toBe(10);
    expect(dy).toBe(20);
    expect(dWidth).toBe(300);
    expect(dHeight).toBe(150);
  });

  it('draws the full frame (4-arg drawImage) when no crop is set', () => {
    const video: VideoLayer = {
      ...baseLayer,
      id: 'video',
      type: 'video',
      mediaId: 'media-1',
      trimStart: 0,
      volume: 1,
      muted: false,
      zIndex: 0,
    };
    const scene: Scene = { id: 'scene', duration: 1000, layers: [video] };
    const { ctx, drawImageArgsLog } = createFakeCtx();
    const assets = new Map([['media-1', makeVideoEl(1920, 1080)]]);

    drawSceneFrame(ctx, scene, 640, 360, assets);

    expect(drawImageArgsLog).toHaveLength(1);
    expect(drawImageArgsLog[0]).toHaveLength(5); // el, x, y, width, height
  });
});

describe('date burn-in', () => {
  it('draws the shot date near the bottom-right when enabled and shotDate is set', () => {
    const scene: Scene = { id: 'scene', duration: 1000, layers: [], shotDate: '2025-03-14T06:57:59.000Z' };
    const { ctx, calls } = createFakeCtx();

    drawSceneFrame(ctx, scene, 640, 360, new Map(), 0, undefined, { enabled: true, position: 'right' });

    expect(calls).toContain('fillText:2025/03/14');
    expect(calls).toContain('strokeText:2025/03/14');
  });

  it('does not draw anything when disabled', () => {
    const scene: Scene = { id: 'scene', duration: 1000, layers: [], shotDate: '2025-03-14T06:57:59.000Z' };
    const { ctx, calls } = createFakeCtx();

    drawSceneFrame(ctx, scene, 640, 360, new Map(), 0, undefined, { enabled: false, position: 'right' });

    expect(calls.some((c) => c.startsWith('fillText:2025'))).toBe(false);
  });

  it('does not draw anything when the scene has no shotDate', () => {
    const scene: Scene = { id: 'scene', duration: 1000, layers: [] };
    const { ctx, calls } = createFakeCtx();

    drawSceneFrame(ctx, scene, 640, 360, new Map(), 0, undefined, { enabled: true, position: 'right' });

    expect(calls.some((c) => c.startsWith('fillText:') || c.startsWith('strokeText:'))).toBe(false);
  });

  it('is unaffected by an omitted dateBurnIn option (defaults to off)', () => {
    const scene: Scene = { id: 'scene', duration: 1000, layers: [], shotDate: '2025-03-14T06:57:59.000Z' };
    const { ctx, calls } = createFakeCtx();

    drawSceneFrame(ctx, scene, 640, 360, new Map());

    expect(calls.some((c) => c.startsWith('fillText:') || c.startsWith('strokeText:'))).toBe(false);
  });
});

describe('drawLayer mosaic', () => {
  // 実際のブロック化ピクセルの正しさ(縮小->最近傍拡大)は、jsdomにcanvas実描画が無いため
  // ここでは検証できない(getContext('2d')がnullを返し、compositor側は静かに早期returnする)。
  // 実際の見た目は書き出しパイプライン経由でのライブ確認(export→ffmpegでフレーム抽出)で
  // 検証済み。ここではクラッシュしないこと・他レイヤーと同様にsave/restoreで囲まれることのみ確認する。
  it('does not throw and wraps rendering in save/restore', () => {
    const mosaic: MosaicLayer = { ...baseLayer, id: 'mosaic', type: 'mosaic', blockSize: 16, zIndex: 1 };
    const scene: Scene = { id: 'scene', duration: 1000, layers: [mosaic] };
    const { ctx, calls } = createFakeCtx();

    expect(() => drawSceneFrame(ctx, scene, 640, 360, new Map())).not.toThrow();
    expect(calls.filter((c) => c === 'save').length).toBe(calls.filter((c) => c === 'restore').length);
  });

  it('is skipped like any other layer when hiddenLayerId matches', () => {
    const mosaic: MosaicLayer = { ...baseLayer, id: 'mosaic', type: 'mosaic', blockSize: 16, zIndex: 1 };
    const scene: Scene = { id: 'scene', duration: 1000, layers: [mosaic] };
    const { ctx, calls } = createFakeCtx();
    const before = calls.length;

    drawSceneFrame(ctx, scene, 640, 360, new Map(), 0, 'mosaic');

    // drawSceneFrame自体のsave/fillRect(背景)/restoreの3件だけになる
    // (モザイク自体の描画=drawLayer呼び出しは完全にスキップされる)
    expect(calls.slice(before)).toEqual(['save', 'fillRect', 'restore']);
  });
});

describe('drawTransitionFrame', () => {
  function makeScene(id: string, fillColor: string): Scene {
    const shape: ShapeLayer = { ...baseLayer, id: `${id}-shape`, type: 'shape', shape: 'rect', fill: fillColor, zIndex: 0 };
    return { id, duration: 1000, layers: [shape] };
  }

  it('crossfade: draws the "to" scene at globalAlpha=progress while keeping the "from" scene at full alpha', () => {
    const from = makeScene('from', '#f00');
    const to = makeScene('to', '#0f0');
    const { ctx, fillRectAlphaLog } = createFakeCtx();

    drawTransitionFrame(ctx, from, to, 0.5, { type: 'crossfade', durationMs: 500 }, 640, 360, new Map(), 0);

    // fillRect呼び出し順: [背景from, shape-from, 背景to, shape-to]
    expect(fillRectAlphaLog).toHaveLength(4);
    expect(fillRectAlphaLog[0]).toBe(1); // fromの背景は等倍
    expect(fillRectAlphaLog[1]).toBe(1); // fromのシェイプも等倍
    expect(fillRectAlphaLog[2]).toBe(0.5); // toの背景はprogress分だけ
    expect(fillRectAlphaLog[3]).toBe(0.5); // toのシェイプもprogress分だけ（レイヤー自体のopacityは1なので0.5*1）
  });

  it('wipe: clips before drawing the "to" scene', () => {
    const from = makeScene('from', '#f00');
    const to = makeScene('to', '#0f0');
    const { ctx, calls } = createFakeCtx();

    drawTransitionFrame(ctx, from, to, 0.3, { type: 'wipe', durationMs: 500 }, 640, 360, new Map(), 0);

    const clipIndex = calls.indexOf('clip');
    const toShapeFillIndex = calls.lastIndexOf('fillRect');
    expect(clipIndex).toBeGreaterThan(-1);
    expect(clipIndex).toBeLessThan(toShapeFillIndex);
  });

  it('slide: translates the "from" scene left and the "to" scene in from the right', () => {
    // レイヤーを持たない空シーンにして、drawLayer由来の余計なtranslate呼び出しを排除する
    const from: Scene = { id: 'from', duration: 1000, layers: [] };
    const to: Scene = { id: 'to', duration: 1000, layers: [] };
    const { ctx, translateLog } = createFakeCtx();

    drawTransitionFrame(ctx, from, to, 0.4, { type: 'slide', durationMs: 500 }, 640, 360, new Map(), 0);

    // 最初のtranslateがfromシーン用（-0.4*640）、2番目がtoシーン用（640-0.4*640）
    expect(translateLog[0]).toEqual([-0.4 * 640, 0]);
    expect(translateLog[1]).toEqual([640 - 0.4 * 640, 0]);
  });
});
