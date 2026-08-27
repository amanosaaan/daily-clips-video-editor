import { nanoid } from 'nanoid';
import { computeCaptionPresetLayout } from './captionPreset';
import type { ImageLayer, MediaAsset, MosaicLayer, Project, Scene, ShapeLayer, TextLayer, VideoLayer } from './types';

export function createTextLayer(scene: Scene): TextLayer {
  return {
    id: nanoid(),
    type: 'text',
    content: 'テキスト',
    x: 40,
    y: 40,
    width: 400,
    height: 80,
    rotation: 0,
    opacity: 1,
    zIndex: scene.layers.length + 1,
    fontFamily: 'sans-serif',
    fontSize: 40,
    color: '#ffffff',
    fontWeight: 'bold',
    align: 'left',
  };
}

export function createCaptionLayer(project: Project, scene: Scene): TextLayer {
  const { x, y, width, height, fontSize } = computeCaptionPresetLayout(project.resolution);
  return {
    id: nanoid(),
    type: 'text',
    content: '字幕テキスト',
    x,
    y,
    width,
    height,
    rotation: 0,
    opacity: 1,
    zIndex: scene.layers.length + 1,
    fontFamily: 'sans-serif',
    fontSize,
    color: '#ffffff',
    fontWeight: 'bold',
    align: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
  };
}

/** 指定した範囲(bounds)の中に、元の縦横比を保ったまま収まる最大サイズを計算する */
export function containFit(
  naturalWidth: number,
  naturalHeight: number,
  bounds: { x: number; y: number; width: number; height: number },
) {
  if (!naturalWidth || !naturalHeight) return bounds;
  const scale = Math.min(bounds.width / naturalWidth, bounds.height / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  return {
    x: bounds.x + (bounds.width - width) / 2,
    y: bounds.y + (bounds.height - height) / 2,
    width,
    height,
  };
}

/**
 * シーンに動画/画像レイヤーを配置する際の位置・サイズ・zIndexを決める。
 * まだ動画/画像が1つも無いシーンでは画面全体を使える範囲とし、
 * 既に動画/画像がある場合は重ねて隠してしまわないよう中央の半分の範囲を使う。
 * 素材の実サイズ（asset.width/height）が分かる場合は、その範囲の中で
 * 元の縦横比を保ったまま最大になるようフィットさせる（比率を変えて引き伸ばさない）。
 */
function visualLayerBounds(project: Project, scene: Scene, asset: MediaAsset) {
  const hasVisual = scene.layers.some((l) => l.type === 'video' || l.type === 'image');
  const zIndex = scene.layers.length > 0 ? Math.max(...scene.layers.map((l) => l.zIndex)) + 1 : 1;
  const outerBounds = hasVisual
    ? {
        x: project.resolution.width * 0.25,
        y: project.resolution.height * 0.25,
        width: project.resolution.width * 0.5,
        height: project.resolution.height * 0.5,
      }
    : { x: 0, y: 0, width: project.resolution.width, height: project.resolution.height };
  const fitted =
    asset.width && asset.height ? containFit(asset.width, asset.height, outerBounds) : outerBounds;
  return { ...fitted, zIndex, isMain: !hasVisual };
}

export function createImageLayerForScene(project: Project, scene: Scene, asset: MediaAsset): ImageLayer {
  const { x, y, width, height, zIndex } = visualLayerBounds(project, scene, asset);
  return { id: nanoid(), type: 'image', mediaId: asset.id, x, y, width, height, rotation: 0, opacity: 1, zIndex };
}

/**
 * トリミング確定時のレイヤー更新パッチを計算する。
 * crop（元画像に対する割合）が元の縦横比と異なる場合、crop だけを更新して
 * width/height を据え置くと、描画時にその比率に引き伸ばされてしまう。
 * そのため、トリミング後の実ピクセル縦横比を求め、元のレイヤー枠内に収まる
 * よう中心を保ったままレイヤーサイズも合わせて更新する。
 */
export function cropPatch(
  layer: ImageLayer | VideoLayer,
  crop: { x: number; y: number; width: number; height: number },
  asset: MediaAsset | undefined,
): Partial<ImageLayer | VideoLayer> {
  if (!asset?.width || !asset?.height) return { crop };
  const cx = layer.x + layer.width / 2;
  const cy = layer.y + layer.height / 2;
  const croppedWidth = crop.width * asset.width;
  const croppedHeight = crop.height * asset.height;
  const fitted = containFit(croppedWidth, croppedHeight, {
    x: layer.x,
    y: layer.y,
    width: layer.width,
    height: layer.height,
  });
  return {
    crop,
    x: cx - fitted.width / 2,
    y: cy - fitted.height / 2,
    width: fitted.width,
    height: fitted.height,
  };
}

export function createVideoLayerForScene(
  project: Project,
  scene: Scene,
  asset: MediaAsset,
): { layer: VideoLayer; isMain: boolean } {
  const { x, y, width, height, zIndex, isMain } = visualLayerBounds(project, scene, asset);
  const layer: VideoLayer = {
    id: nanoid(),
    type: 'video',
    mediaId: asset.id,
    x,
    y,
    width,
    height,
    rotation: 0,
    opacity: 1,
    zIndex,
    trimStart: 0,
    volume: 1,
    muted: false,
  };
  return { layer, isMain };
}

export function createShapeLayer(scene: Scene): ShapeLayer {
  return {
    id: nanoid(),
    type: 'shape',
    shape: 'rect',
    fill: '#1a73e8',
    x: 60,
    y: 60,
    width: 200,
    height: 120,
    rotation: 0,
    opacity: 1,
    zIndex: scene.layers.length + 1,
  };
}

export function createMosaicLayer(scene: Scene): MosaicLayer {
  return {
    id: nanoid(),
    type: 'mosaic',
    blockSize: 16,
    x: 60,
    y: 60,
    width: 240,
    height: 180,
    rotation: 0,
    opacity: 1,
    zIndex: scene.layers.length + 1,
  };
}
