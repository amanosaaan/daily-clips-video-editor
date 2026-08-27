import { alignPatches, bringToFrontPatches, rotatePatches, sendToBackPatches, type LayerPatch } from '../domain/arrange';
import type { AudioLayer, Layer, Project, Scene } from '../domain/types';
import { reorientVideoPatch } from '../domain/videoOrientation';
import { useProjectStore } from '../state/projectStore';
import {
  AlignBottomIcon,
  AlignCenterHIcon,
  AlignLeftIcon,
  AlignMiddleIcon,
  AlignRightIcon,
  AlignTopIcon,
  BoldIcon,
  BringToFrontIcon,
  CropIcon,
  ItalicIcon,
  MinusIcon,
  MuteOffIcon,
  MuteOnIcon,
  PlusIcon,
  RotateLeftIcon,
  RotateRightIcon,
  SendToBackIcon,
  ShapeCircleIcon,
  ShapeLineIcon,
  ShapeRectIcon,
  TextAlignCenterIcon,
  TextAlignLeftIcon,
  TextAlignRightIcon,
  TrashIcon,
  UnderlineIcon,
} from './icons';
import { AnimationControl, PhotoFilterControl } from './LayerPropertyControls';
import { NumberField } from './NumberField';

const FONT_OPTIONS = ['sans-serif', 'serif', 'monospace', 'Roboto', 'Noto Sans JP', 'Georgia', 'Impact', 'Courier New'];

function ArrangeGroup({ project, scene, layers }: { project: Project; scene: Scene; layers: Layer[] }) {
  const updateLayer = useProjectStore((s) => s.updateLayer);

  function apply(results: LayerPatch[]) {
    results.forEach(({ id, patch }) => updateLayer(scene.id, id, patch));
  }

  return (
    <div className="context-toolbar__group context-toolbar__group--arrange">
      <div className="context-toolbar__icon-row">
        <button
          className="context-toolbar__icon-btn"
          title="最前面へ"
          onClick={() => apply(bringToFrontPatches(scene.layers, layers))}
        >
          <BringToFrontIcon />
        </button>
        <button
          className="context-toolbar__icon-btn"
          title="最背面へ"
          onClick={() => apply(sendToBackPatches(scene.layers, layers))}
        >
          <SendToBackIcon />
        </button>
      </div>
      <div className="context-toolbar__icon-row">
        <button className="context-toolbar__icon-btn" title="左揃え" onClick={() => apply(alignPatches(project, layers, 'left'))}>
          <AlignLeftIcon />
        </button>
        <button
          className="context-toolbar__icon-btn"
          title="左右中央"
          onClick={() => apply(alignPatches(project, layers, 'centerH'))}
        >
          <AlignCenterHIcon />
        </button>
        <button className="context-toolbar__icon-btn" title="右揃え" onClick={() => apply(alignPatches(project, layers, 'right'))}>
          <AlignRightIcon />
        </button>
        <button className="context-toolbar__icon-btn" title="上揃え" onClick={() => apply(alignPatches(project, layers, 'top'))}>
          <AlignTopIcon />
        </button>
        <button
          className="context-toolbar__icon-btn"
          title="上下中央"
          onClick={() => apply(alignPatches(project, layers, 'centerV'))}
        >
          <AlignMiddleIcon />
        </button>
        <button
          className="context-toolbar__icon-btn"
          title="下揃え"
          onClick={() => apply(alignPatches(project, layers, 'bottom'))}
        >
          <AlignBottomIcon />
        </button>
      </div>
      <div className="context-toolbar__icon-row">
        <button className="context-toolbar__icon-btn" title="反時計回りに90度回転" onClick={() => apply(rotatePatches(layers, -90))}>
          <RotateLeftIcon />
        </button>
        <button className="context-toolbar__icon-btn" title="時計回りに90度回転" onClick={() => apply(rotatePatches(layers, 90))}>
          <RotateRightIcon />
        </button>
      </div>
    </div>
  );
}


function rgbaToHex(rgba: string): string {
  const match = rgba.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!match) return '#000000';
  const [, r, g, b] = match;
  return `#${[r, g, b].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
}

function rgbaAlpha(rgba: string): number {
  const match = rgba.match(/rgba\([^)]+,\s*([\d.]+)\s*\)/);
  return match ? Number(match[1]) : 1;
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface Props {
  project: Project;
  scene: Scene;
  layers: Layer[];
  onOpenCrop: (layerId: string) => void;
}

export function ContextToolbar({ project, scene, layers, onOpenCrop }: Props) {
  const sceneId = scene.id;
  const sceneDurationMs = scene.duration;
  const updateLayer = useProjectStore((s) => s.updateLayer);
  const removeLayer = useProjectStore((s) => s.removeLayer);

  if (layers.length === 0) return <div className="context-toolbar context-toolbar--empty" aria-hidden="true" />;

  if (layers.length > 1) {
    return (
      <div className="context-toolbar">
        <ArrangeGroup project={project} scene={scene} layers={layers} />
        <span className="context-toolbar__hint">{layers.length}個選択中</span>
        <button
          className="btn-icon context-toolbar__delete"
          title="選択したレイヤーを削除"
          onClick={() => layers.forEach((l) => removeLayer(sceneId, l.id))}
        >
          <TrashIcon />
        </button>
      </div>
    );
  }

  const layer = layers[0];
  const Arrange = <ArrangeGroup project={project} scene={scene} layers={layers} />;

  const DeleteButton = (
    <button className="btn-icon context-toolbar__delete" title="削除" onClick={() => removeLayer(sceneId, layer.id)}>
      <TrashIcon />
    </button>
  );

  if (layer.type === 'text') {
    return (
      <div className="context-toolbar">
        {Arrange}
        <div className="context-toolbar__group">
          <select
            className="context-toolbar__select"
            title="フォント"
            value={layer.fontFamily}
            onChange={(e) => updateLayer(sceneId, layer.id, { fontFamily: e.target.value })}
          >
            {FONT_OPTIONS.map((f) => (
              <option key={f} value={f} style={{ fontFamily: f }}>
                {f}
              </option>
            ))}
          </select>
          <div className="context-toolbar__stepper">
            <button
              className="context-toolbar__icon-btn"
              title="小さく"
              onClick={() => updateLayer(sceneId, layer.id, { fontSize: Math.max(1, layer.fontSize - 2) })}
            >
              <MinusIcon size={14} />
            </button>
            <NumberField value={layer.fontSize} onChange={(v) => updateLayer(sceneId, layer.id, { fontSize: v })} min={1} />
            <button
              className="context-toolbar__icon-btn"
              title="大きく"
              onClick={() => updateLayer(sceneId, layer.id, { fontSize: layer.fontSize + 2 })}
            >
              <PlusIcon size={14} />
            </button>
          </div>
          <input
            className="context-toolbar__swatch"
            type="color"
            title="文字色"
            value={layer.color}
            onChange={(e) => updateLayer(sceneId, layer.id, { color: e.target.value })}
          />
        </div>
        <div className="context-toolbar__group">
          <div className="context-toolbar__icon-row">
            <button
              className={`context-toolbar__icon-btn${layer.fontWeight === 'bold' ? ' is-active' : ''}`}
              title="太字"
              onClick={() => updateLayer(sceneId, layer.id, { fontWeight: layer.fontWeight === 'bold' ? 'normal' : 'bold' })}
            >
              <BoldIcon size={16} />
            </button>
            <button
              className={`context-toolbar__icon-btn${layer.italic ? ' is-active' : ''}`}
              title="斜体"
              onClick={() => updateLayer(sceneId, layer.id, { italic: !layer.italic })}
            >
              <ItalicIcon size={16} />
            </button>
            <button
              className={`context-toolbar__icon-btn${layer.underline ? ' is-active' : ''}`}
              title="下線"
              onClick={() => updateLayer(sceneId, layer.id, { underline: !layer.underline })}
            >
              <UnderlineIcon size={16} />
            </button>
          </div>
          <div className="context-toolbar__segmented">
            <button
              className={layer.align === 'left' ? 'is-active' : ''}
              title="左揃え"
              onClick={() => updateLayer(sceneId, layer.id, { align: 'left' })}
            >
              <TextAlignLeftIcon size={16} />
            </button>
            <button
              className={layer.align === 'center' ? 'is-active' : ''}
              title="中央揃え"
              onClick={() => updateLayer(sceneId, layer.id, { align: 'center' })}
            >
              <TextAlignCenterIcon size={16} />
            </button>
            <button
              className={layer.align === 'right' ? 'is-active' : ''}
              title="右揃え"
              onClick={() => updateLayer(sceneId, layer.id, { align: 'right' })}
            >
              <TextAlignRightIcon size={16} />
            </button>
          </div>
        </div>
        <div className="context-toolbar__group">
          <label className="context-toolbar__checkbox">
            <input
              type="checkbox"
              checked={!!layer.strokeColor}
              onChange={(e) =>
                updateLayer(sceneId, layer.id, {
                  strokeColor: e.target.checked ? '#000000' : undefined,
                  strokeWidth: e.target.checked ? (layer.strokeWidth ?? 2) : undefined,
                })
              }
            />
            文字のふちどり
          </label>
          {layer.strokeColor && (
            <>
              <input
                type="color"
                value={layer.strokeColor}
                onChange={(e) => updateLayer(sceneId, layer.id, { strokeColor: e.target.value })}
              />
              <NumberField
                min={1}
                max={20}
                value={layer.strokeWidth ?? 2}
                onChange={(v) => updateLayer(sceneId, layer.id, { strokeWidth: v })}
              />
            </>
          )}
        </div>
        <div className="context-toolbar__group">
          <label className="context-toolbar__checkbox">
            <input
              type="checkbox"
              checked={!!layer.backgroundColor}
              onChange={(e) =>
                updateLayer(sceneId, layer.id, { backgroundColor: e.target.checked ? 'rgba(0,0,0,0.6)' : undefined })
              }
            />
            背景ボックス
          </label>
          {layer.backgroundColor && (() => {
            const backgroundColor = layer.backgroundColor;
            return (
              <input
                type="color"
                value={rgbaToHex(backgroundColor)}
                onChange={(e) =>
                  updateLayer(sceneId, layer.id, { backgroundColor: hexToRgba(e.target.value, rgbaAlpha(backgroundColor)) })
                }
              />
            );
          })()}
        </div>
        <AnimationControl animation={layer.animation} onChange={(a) => updateLayer(sceneId, layer.id, { animation: a })} />
        {DeleteButton}
      </div>
    );
  }

  if (layer.type === 'shape') {
    return (
      <div className="context-toolbar">
        {Arrange}
        <div className="context-toolbar__group">
          <div className="context-toolbar__segmented">
            <button
              className={layer.shape === 'rect' ? 'is-active' : ''}
              title="矩形"
              onClick={() => updateLayer(sceneId, layer.id, { shape: 'rect' })}
            >
              <ShapeRectIcon size={16} />
            </button>
            <button
              className={layer.shape === 'circle' ? 'is-active' : ''}
              title="円"
              onClick={() => updateLayer(sceneId, layer.id, { shape: 'circle' })}
            >
              <ShapeCircleIcon size={16} />
            </button>
            <button
              className={layer.shape === 'line' ? 'is-active' : ''}
              title="線"
              onClick={() => updateLayer(sceneId, layer.id, { shape: 'line' })}
            >
              <ShapeLineIcon size={16} />
            </button>
          </div>
          <input
            className="context-toolbar__swatch"
            type="color"
            title="塗り色"
            value={layer.fill}
            onChange={(e) => updateLayer(sceneId, layer.id, { fill: e.target.value })}
          />
          <input
            className="context-toolbar__swatch"
            type="color"
            title="線の色"
            value={layer.stroke ?? '#000000'}
            onChange={(e) => updateLayer(sceneId, layer.id, { stroke: e.target.value })}
          />
        </div>
        <AnimationControl animation={layer.animation} onChange={(a) => updateLayer(sceneId, layer.id, { animation: a })} />
        {DeleteButton}
      </div>
    );
  }

  if (layer.type === 'video') {
    const asset = project.mediaLibrary.find((m) => m.id === layer.mediaId);
    const assetDurationSec = asset?.durationMs ? asset.durationMs / 1000 : undefined;
    const maxTrimStartSec = assetDurationSec !== undefined ? Math.max(0, assetDurationSec - sceneDurationMs / 1000) : undefined;
    return (
      <div className="context-toolbar">
        {Arrange}
        <div className="context-toolbar__group">
          <label>
            トリム開始(秒)
            <NumberField
              min={0}
              max={maxTrimStartSec}
              step={0.1}
              value={layer.trimStart / 1000}
              onChange={(v) => updateLayer(sceneId, layer.id, { trimStart: Math.max(0, v * 1000) })}
            />
          </label>
          <label>
            音量
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={layer.volume}
              onChange={(e) => updateLayer(sceneId, layer.id, { volume: Number(e.target.value) })}
            />
          </label>
          <button
            className={`context-toolbar__icon-btn${layer.muted ? ' is-active' : ''}`}
            title={layer.muted ? 'ミュート解除' : 'ミュート'}
            onClick={() => updateLayer(sceneId, layer.id, { muted: !layer.muted })}
          >
            {layer.muted ? <MuteOnIcon size={16} /> : <MuteOffIcon size={16} />}
          </button>
        </div>
        <div className="context-toolbar__group">
          <button className="btn-pill" onClick={() => onOpenCrop(layer.id)}>
            <CropIcon size={16} /> トリミング(ズーム/位置)
          </button>
          <div className="context-toolbar__icon-row">
            <button
              className="context-toolbar__icon-btn"
              title="動画の向きを反時計回りに90度直す"
              onClick={() => updateLayer(sceneId, layer.id, reorientVideoPatch(layer, asset, -90))}
            >
              <RotateLeftIcon />
            </button>
            <button
              className="context-toolbar__icon-btn"
              title="動画の向きを時計回りに90度直す"
              onClick={() => updateLayer(sceneId, layer.id, reorientVideoPatch(layer, asset, 90))}
            >
              <RotateRightIcon />
            </button>
          </div>
        </div>
        <PhotoFilterControl filter={layer.filter} onChange={(f) => updateLayer(sceneId, layer.id, { filter: f })} />
        <AnimationControl animation={layer.animation} onChange={(a) => updateLayer(sceneId, layer.id, { animation: a })} />
        {DeleteButton}
      </div>
    );
  }

  if (layer.type === 'image') {
    return (
      <div className="context-toolbar">
        {Arrange}
        <button className="btn-pill" onClick={() => onOpenCrop(layer.id)}>
          <CropIcon size={16} /> トリミング
        </button>
        <PhotoFilterControl filter={layer.filter} onChange={(f) => updateLayer(sceneId, layer.id, { filter: f })} />
        <AnimationControl animation={layer.animation} onChange={(a) => updateLayer(sceneId, layer.id, { animation: a })} />
        {DeleteButton}
      </div>
    );
  }

  // audio
  const asset = project.mediaLibrary.find((m) => m.id === layer.mediaId);
  const assetDurationSec = asset?.durationMs ? asset.durationMs / 1000 : undefined;
  const maxTrimStartSec = assetDurationSec !== undefined ? Math.max(0, assetDurationSec - sceneDurationMs / 1000) : undefined;
  return (
    <div className="context-toolbar">
      {Arrange}
      <div className="context-toolbar__group">
        <label>
          種類
          <select
            value={layer.role}
            onChange={(e) => updateLayer(sceneId, layer.id, { role: e.target.value as AudioLayer['role'] })}
          >
            <option value="music">BGM</option>
            <option value="voiceover">ボイスオーバー</option>
          </select>
        </label>
        <label>
          トリム開始(秒)
          <NumberField
            min={0}
            max={maxTrimStartSec}
            step={0.1}
            value={layer.trimStart / 1000}
            onChange={(v) => updateLayer(sceneId, layer.id, { trimStart: Math.max(0, v * 1000) })}
          />
        </label>
        <label>
          音量
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={layer.volume}
            onChange={(e) => updateLayer(sceneId, layer.id, { volume: Number(e.target.value) })}
          />
        </label>
      </div>
      {DeleteButton}
    </div>
  );
}
