import { isLayerVisibleAt } from '../domain/layerTiming';
import type { AnimationConfig, Layer, Scene, TransitionConfig } from '../domain/types';

export type ResolvedAssetMap = Map<string, HTMLVideoElement | HTMLImageElement>;
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface DateBurnInOptions {
  enabled: boolean;
  position: 'left' | 'right';
}

export function drawSceneFrame(
  ctx: Ctx2D,
  scene: Scene,
  canvasWidth: number,
  canvasHeight: number,
  resolvedAssets: ResolvedAssetMap,
  sceneTimeMs = 0,
  hiddenLayerId?: string | null,
  dateBurnIn?: DateBurnInOptions,
): void {
  ctx.save();
  ctx.fillStyle = scene.backgroundColor ?? '#000000';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  const sortedLayers = [...scene.layers].sort((a, b) => a.zIndex - b.zIndex);
  for (const layer of sortedLayers) {
    if (layer.id === hiddenLayerId) continue;
    if (!isLayerVisibleAt(layer, sceneTimeMs, scene.duration)) continue;
    drawLayer(ctx, layer, resolvedAssets, sceneTimeMs);
  }

  // 撮影日の焼き込みは実レイヤーではなく、常に最前面・指定した角に固定表示する
  // 別枠の描画として扱う(ズーム/パン/クロップなど他のレイヤー操作の影響を受けない)。
  if (dateBurnIn?.enabled && scene.shotDate) {
    drawDateBadge(ctx, scene.shotDate, dateBurnIn.position, canvasWidth, canvasHeight);
  }
  ctx.restore();
}

function formatShotDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function drawDateBadge(ctx: Ctx2D, shotDateIso: string, position: 'left' | 'right', canvasWidth: number, canvasHeight: number): void {
  const text = formatShotDate(shotDateIso);
  const fontSize = Math.round(canvasHeight * 0.035);
  const margin = Math.round(canvasHeight * 0.02);
  ctx.save();
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textBaseline = 'bottom';
  ctx.textAlign = position === 'right' ? 'right' : 'left';
  const x = position === 'right' ? canvasWidth - margin : margin;
  const y = canvasHeight - margin;
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, fontSize * 0.12);
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, x, y);
  ctx.restore();
}

/**
 * 2つのシーンをまたぐトランジションのフレームを描画する。
 * fromScene → toScene の切り替え中、progress は 0（fromのみ）→ 1（toのみ）で進む。
 * 次シーンの動画/音声はまだ再生開始しない前提（呼び出し側で先頭フレームを渡す）。
 */
export function drawTransitionFrame(
  ctx: Ctx2D,
  fromScene: Scene,
  toScene: Scene,
  progress: number,
  transition: TransitionConfig,
  canvasWidth: number,
  canvasHeight: number,
  resolvedAssets: ResolvedAssetMap,
  fromSceneTimeMs: number,
  dateBurnIn?: DateBurnInOptions,
): void {
  const p = Math.min(1, Math.max(0, progress));

  switch (transition.type) {
    case 'crossfade': {
      drawSceneFrame(ctx, fromScene, canvasWidth, canvasHeight, resolvedAssets, fromSceneTimeMs, undefined, dateBurnIn);
      ctx.save();
      ctx.globalAlpha = p;
      drawSceneFrame(ctx, toScene, canvasWidth, canvasHeight, resolvedAssets, 0, undefined, dateBurnIn);
      ctx.restore();
      break;
    }
    case 'slide': {
      ctx.save();
      ctx.translate(-p * canvasWidth, 0);
      drawSceneFrame(ctx, fromScene, canvasWidth, canvasHeight, resolvedAssets, fromSceneTimeMs, undefined, dateBurnIn);
      ctx.restore();
      ctx.save();
      ctx.translate(canvasWidth - p * canvasWidth, 0);
      drawSceneFrame(ctx, toScene, canvasWidth, canvasHeight, resolvedAssets, 0, undefined, dateBurnIn);
      ctx.restore();
      break;
    }
    case 'wipe': {
      drawSceneFrame(ctx, fromScene, canvasWidth, canvasHeight, resolvedAssets, fromSceneTimeMs, undefined, dateBurnIn);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, p * canvasWidth, canvasHeight);
      ctx.clip();
      drawSceneFrame(ctx, toScene, canvasWidth, canvasHeight, resolvedAssets, 0, undefined, dateBurnIn);
      ctx.restore();
      break;
    }
  }
}

/** 0→1で「少し行き過ぎてから戻る」ようなイージング。ポップの弾む感じに使う。 */
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = t - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function applyAnimationTransform(
  ctx: Ctx2D,
  animation: AnimationConfig | undefined,
  sceneTimeMs: number,
  layerStartMs: number,
  width: number,
  height: number,
): void {
  if (!animation || animation.durationMs <= 0) return;
  // 詳細調整(intensity)。0〜100、未指定は50（標準＝1倍）。
  const strength = (animation.intensity ?? 50) / 50;

  switch (animation.type) {
    // ループ系: シーン内の経過時間に関わらず、周期(durationMs)でずっと繰り返す。
    case 'pulse':
    case 'spin':
    case 'hover':
    case 'shake':
    case 'bounce': {
      const t = (sceneTimeMs % animation.durationMs) / animation.durationMs;
      const angle = 2 * Math.PI * t;
      switch (animation.type) {
        case 'pulse': {
          const s = 1 + 0.08 * strength * Math.sin(angle);
          ctx.scale(s, s);
          break;
        }
        case 'spin':
          ctx.rotate(angle);
          break;
        case 'hover':
          ctx.translate(0, Math.sin(angle) * height * 0.06 * strength);
          break;
        case 'shake':
          ctx.translate(Math.sin(angle * 6) * width * 0.02 * strength, 0);
          break;
        case 'bounce':
          ctx.translate(0, -Math.abs(Math.sin(Math.PI * t)) * height * 0.15 * strength);
          break;
      }
      break;
    }
    // 登場系: レイヤーが表示され始めた瞬間(layerStartMs)を起点に、一度だけ再生する。
    case 'pop': {
      const t = Math.min(1, Math.max(0, (sceneTimeMs - layerStartMs) / animation.durationMs));
      const s = Math.max(0, easeOutBack(t));
      ctx.scale(s, s);
      break;
    }
    case 'rise': {
      const t = Math.min(1, Math.max(0, (sceneTimeMs - layerStartMs) / animation.durationMs));
      const eased = easeOutCubic(t);
      const riseDistance = height * 0.5 * strength;
      ctx.translate(0, (1 - eased) * riseDistance);
      break;
    }
    case 'typewriter':
      // 文字を1文字ずつ出す効果は描画する文字列自体を変えて表現するため、
      // ここでは幾何変換は不要（drawLayerのtextケースで個別に処理する）。
      break;
  }
}

function drawLayer(ctx: Ctx2D, layer: Layer, assets: ResolvedAssetMap, sceneTimeMs: number): void {
  ctx.save();
  // 上書きではなく乗算にする。クロスフェード等のトランジションは外側の
  // globalAlpha（progress）をセットした状態で drawSceneFrame を呼ぶため、
  // ここで単純に上書きするとレイヤーの内容だけフェードせず即座に出現してしまう。
  ctx.globalAlpha *= layer.opacity;
  const cx = layer.x + layer.width / 2;
  const cy = layer.y + layer.height / 2;
  ctx.translate(cx, cy);
  ctx.rotate((layer.rotation * Math.PI) / 180);
  if (layer.type === 'text' && (layer.skewX || layer.skewY)) {
    // 中心を軸に、水平・垂直それぞれの傾き角度からシアー変換を適用する。
    ctx.transform(1, Math.tan(((layer.skewY ?? 0) * Math.PI) / 180), Math.tan(((layer.skewX ?? 0) * Math.PI) / 180), 1, 0, 0);
  }
  const layerStartMs = layer.startMs ?? 0;
  applyAnimationTransform(ctx, layer.animation, sceneTimeMs, layerStartMs, layer.width, layer.height);
  ctx.translate(-cx, -cy);

  switch (layer.type) {
    case 'video':
    case 'image': {
      const el = assets.get(layer.mediaId);
      if (el) {
        if (layer.filter) {
          ctx.filter = `brightness(${layer.filter.brightness}%) contrast(${layer.filter.contrast}%)`;
        }
        if (layer.type === 'image' && layer.crop && el instanceof HTMLImageElement) {
          const sx = layer.crop.x * el.naturalWidth;
          const sy = layer.crop.y * el.naturalHeight;
          const sWidth = layer.crop.width * el.naturalWidth;
          const sHeight = layer.crop.height * el.naturalHeight;
          ctx.drawImage(el, sx, sy, sWidth, sHeight, layer.x, layer.y, layer.width, layer.height);
        } else if (layer.type === 'video' && layer.crop && el instanceof HTMLVideoElement) {
          const sx = layer.crop.x * el.videoWidth;
          const sy = layer.crop.y * el.videoHeight;
          const sWidth = layer.crop.width * el.videoWidth;
          const sHeight = layer.crop.height * el.videoHeight;
          ctx.drawImage(el, sx, sy, sWidth, sHeight, layer.x, layer.y, layer.width, layer.height);
        } else {
          ctx.drawImage(el, layer.x, layer.y, layer.width, layer.height);
        }
        if (layer.filter) ctx.filter = 'none';
      }
      break;
    }
    case 'text': {
      if (layer.backgroundColor) {
        ctx.fillStyle = layer.backgroundColor;
        ctx.fillRect(layer.x, layer.y, layer.width, layer.height);
      }
      ctx.fillStyle = layer.color;
      ctx.font = `${layer.italic ? 'italic ' : ''}${layer.fontWeight} ${layer.fontSize}px ${layer.fontFamily}`;
      ctx.textAlign = layer.align;
      ctx.textBaseline = 'top';
      if (layer.strokeColor) {
        ctx.strokeStyle = layer.strokeColor;
        ctx.lineWidth = layer.strokeWidth ?? 2;
        ctx.lineJoin = 'round';
      }
      const textX =
        layer.align === 'left'
          ? layer.x
          : layer.align === 'right'
            ? layer.x + layer.width
            : layer.x + layer.width / 2;
      const lineHeight = layer.fontSize * 1.25;
      // 縦位置は元の文章全体の行数を基準に計算し、タイプライター表示中に
      // 文字が増えるたびにテキストの位置がガタガタ動かないようにする。
      const fullLines = layer.content.split('\n');
      const textBlockHeight = fullLines.length * lineHeight;
      const startY = layer.y + Math.max(0, (layer.height - textBlockHeight) / 2);
      let displayContent = layer.content;
      if (layer.animation?.type === 'typewriter') {
        const progress = Math.min(1, Math.max(0, (sceneTimeMs - layerStartMs) / layer.animation.durationMs));
        displayContent = layer.content.slice(0, Math.round(layer.content.length * progress));
      }
      const lines = displayContent.split('\n');
      lines.forEach((line, i) => {
        const lineY = startY + i * lineHeight;
        if (layer.strokeColor) ctx.strokeText(line, textX, lineY, layer.width);
        ctx.fillText(line, textX, lineY, layer.width);
        if (layer.underline) {
          const textWidth = Math.min(ctx.measureText(line).width, layer.width);
          const underlineX =
            layer.align === 'left' ? textX : layer.align === 'right' ? textX - textWidth : textX - textWidth / 2;
          const underlineY = lineY + layer.fontSize * 0.92;
          ctx.save();
          ctx.strokeStyle = layer.color;
          ctx.lineWidth = Math.max(1, layer.fontSize * 0.05);
          ctx.beginPath();
          ctx.moveTo(underlineX, underlineY);
          ctx.lineTo(underlineX + textWidth, underlineY);
          ctx.stroke();
          ctx.restore();
        }
      });
      break;
    }
    case 'shape': {
      ctx.fillStyle = layer.fill;
      if (layer.shape === 'rect') {
        ctx.fillRect(layer.x, layer.y, layer.width, layer.height);
        if (layer.stroke) {
          ctx.strokeStyle = layer.stroke;
          ctx.strokeRect(layer.x, layer.y, layer.width, layer.height);
        }
      } else if (layer.shape === 'circle') {
        ctx.beginPath();
        ctx.ellipse(
          layer.x + layer.width / 2,
          layer.y + layer.height / 2,
          layer.width / 2,
          layer.height / 2,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        if (layer.stroke) {
          ctx.strokeStyle = layer.stroke;
          ctx.stroke();
        }
      } else {
        ctx.beginPath();
        ctx.moveTo(layer.x, layer.y);
        ctx.lineTo(layer.x + layer.width, layer.y + layer.height);
        ctx.strokeStyle = layer.stroke ?? layer.fill;
        ctx.stroke();
      }
      break;
    }
    case 'mosaic': {
      drawMosaic(ctx, layer.x, layer.y, layer.width, layer.height, layer.blockSize);
      break;
    }
    case 'audio':
      break;
  }
  ctx.restore();
}

// モザイクの縮小->拡大に使う作業用キャンバスを使い回す(毎フレーム新規生成しない)。
// このアプリのcompositorは常にメインスレッドの<canvas>(document.createElement製)を
// 対象に呼ばれる(プレビュー・書き出しどちらもWorker/OffscreenCanvasは使っていない)ため、
// document.createElementで問題ない。
let mosaicScratchCanvas: HTMLCanvasElement | null = null;
function getMosaicScratchCanvas(): HTMLCanvasElement {
  if (!mosaicScratchCanvas) mosaicScratchCanvas = document.createElement('canvas');
  return mosaicScratchCanvas;
}

/**
 * 指定範囲を実際にブロック状にモザイク化する(CSSのぼかし近似ではなく本物のピクセル化)。
 * 手順: 1) 対象範囲を縮小してキャンバス上に描く(縮小時の補間で自然に画素が混ざり合う)
 *       2) その縮小画像を、補間を切った(nearest-neighbor)状態で元のサイズへ再度拡大して描き戻す
 * こうすることで、下(既に描画済み)のレイヤーの内容がブロック状に隠れる。
 * このレイヤー自身より前(zIndexが小さい)に描かれた内容だけが対象になる点は、
 * Photoshop等のモザイクフィルタと同じ挙動。
 */
function drawMosaic(ctx: Ctx2D, layerX: number, layerY: number, layerWidth: number, layerHeight: number, blockSize: number): void {
  const canvasWidth = ctx.canvas.width;
  const canvasHeight = ctx.canvas.height;
  const x = Math.max(0, Math.round(layerX));
  const y = Math.max(0, Math.round(layerY));
  const w = Math.min(Math.round(layerWidth), canvasWidth - x);
  const h = Math.min(Math.round(layerHeight), canvasHeight - y);
  if (w <= 0 || h <= 0) return;

  const block = Math.max(2, Math.round(blockSize));
  const smallW = Math.max(1, Math.round(w / block));
  const smallH = Math.max(1, Math.round(h / block));

  const scratch = getMosaicScratchCanvas();
  scratch.width = smallW;
  scratch.height = smallH;
  const sctx = scratch.getContext('2d');
  // テスト環境(jsdom)等、実際の2D描画コンテキストが取得できない場合は
  // 静かに何もしない(呼び出し側でのクラッシュを防ぐ)。
  if (!sctx) return;
  sctx.imageSmoothingEnabled = true;
  sctx.clearRect(0, 0, smallW, smallH);
  sctx.drawImage(ctx.canvas, x, y, w, h, 0, 0, smallW, smallH);

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(scratch, 0, 0, smallW, smallH, x, y, w, h);
  ctx.imageSmoothingEnabled = true;
}
