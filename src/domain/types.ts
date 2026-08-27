export type AspectRatio = '16:9' | '9:16' | '1:1';

export const ASPECT_RATIO_RESOLUTIONS: Record<AspectRatio, { width: number; height: number }> = {
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
  '1:1': { width: 900, height: 900 },
};

export interface TransitionConfig {
  type: 'crossfade' | 'slide' | 'wipe';
  durationMs: number;
}

export interface AnimationConfig {
  type: 'pulse' | 'spin' | 'hover' | 'shake' | 'bounce' | 'pop' | 'rise' | 'typewriter';
  /** ループ系(pulse/spin/hover/shake/bounce)は1周期の長さ、
   *  登場系(pop/rise/typewriter)はレイヤーが表示され始めてから効果が終わるまでの長さ。 */
  durationMs: number;
  /** 効果の強さの詳細調整。0〜100、未指定は50（標準）。spin/typewriterでは使わない。 */
  intensity?: number;
}

export interface BaseLayer {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  zIndex: number;
  animation?: AnimationConfig;
  /**
   * シーン内でこのレイヤーが表示され始める時刻(ms、シーン先頭からの相対時刻)。
   * 未指定は0（シーンの先頭から表示）。
   */
  startMs?: number;
  /**
   * シーン内でこのレイヤーが表示され終わる時刻(ms、シーン先頭からの相対時刻)。
   * 未指定はシーンの長さ（シーンの終わりまで表示）。
   */
  endMs?: number;
}

export interface PhotoFilter {
  /** % 単位。100 = 無変換 */
  brightness: number;
  /** % 単位。100 = 無変換 */
  contrast: number;
}

export interface VideoLayer extends BaseLayer {
  type: 'video';
  mediaId: string;
  /** ソース動画内での再生開始位置 (ms)。再生される長さは常にシーンの duration に従う。 */
  trimStart: number;
  volume: number;
  muted: boolean;
  filter?: PhotoFilter;
}

export interface ImageLayer extends BaseLayer {
  type: 'image';
  mediaId: string;
  filter?: PhotoFilter;
  /** 元画像に対するトリミング範囲。0〜1の割合で指定（未指定なら画像全体を表示） */
  crop?: { x: number; y: number; width: number; height: number };
}

export interface TextLayer extends BaseLayer {
  type: 'text';
  content: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  fontWeight: string;
  italic?: boolean;
  underline?: boolean;
  /** シアー（傾き）角度。度単位、未指定は0 */
  skewX?: number;
  skewY?: number;
  align: 'left' | 'center' | 'right';
  /** 字幕用の半透明背景ボックス（未指定なら背景なし） */
  backgroundColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
}

export interface ShapeLayer extends BaseLayer {
  type: 'shape';
  shape: 'rect' | 'circle' | 'line';
  fill: string;
  stroke?: string;
}

export interface AudioLayer extends BaseLayer {
  type: 'audio';
  mediaId: string;
  /** ソース音声内での再生開始位置 (ms)。再生される長さは常にシーンの duration に従う。 */
  trimStart: number;
  volume: number;
  role: 'voiceover' | 'music';
}

export type Layer = VideoLayer | ImageLayer | TextLayer | ShapeLayer | AudioLayer;

export interface Scene {
  id: string;
  duration: number;
  layers: Layer[];
  backgroundColor?: string;
  transitionOut?: TransitionConfig;
}

export interface MediaAsset {
  id: string;
  kind: 'video' | 'image' | 'audio';
  name: string;
  durationMs?: number;
  width?: number;
  height?: number;
  createdAt: number;
  sizeBytes: number;
  thumbnailBlobId?: string;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  aspectRatio: AspectRatio;
  resolution: { width: number; height: number };
  fps: number;
  scenes: Scene[];
  mediaLibrary: MediaAsset[];
}
