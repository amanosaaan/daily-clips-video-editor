import { useRef, type ComponentType, type PointerEvent as ReactPointerEvent } from 'react';
import { getLayerVisibleRange } from '../domain/layerTiming';
import { getSceneStartMs } from '../domain/timeline';
import type { Project, Layer, Scene } from '../domain/types';
import type { ProjectPlaybackEngine } from '../rendering/useProjectPlaybackEngine';
import { useProjectStore } from '../state/projectStore';
import {
  AudioIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  ImageIcon,
  ShapeCircleIcon,
  ShapeLineIcon,
  ShapeRectIcon,
  TextIcon,
  VideoIcon,
} from './icons';

function formatSec(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** レイヤー種類ごとのアイコン・ラベル・帯の色分けキー(本家Google Vids風に種類ごとに配色を変える)。 */
function layerTypeMeta(layer: Layer): { Icon: ComponentType<{ size?: number }>; label: string; colorKey: string } {
  switch (layer.type) {
    case 'video':
      return { Icon: VideoIcon, label: '動画', colorKey: 'video' };
    case 'image':
      return { Icon: ImageIcon, label: '画像', colorKey: 'image' };
    case 'audio':
      return { Icon: AudioIcon, label: '音声', colorKey: 'audio' };
    case 'text':
      return { Icon: TextIcon, label: 'テキスト', colorKey: 'text' };
    case 'shape':
      switch (layer.shape) {
        case 'circle':
          return { Icon: ShapeCircleIcon, label: '円', colorKey: 'shape' };
        case 'line':
          return { Icon: ShapeLineIcon, label: '線', colorKey: 'shape' };
        default:
          return { Icon: ShapeRectIcon, label: '長方形', colorKey: 'shape' };
      }
  }
}

function LayerTrackLabel({
  layer,
  isSelected,
  onSelect,
}: {
  layer: Layer;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const { Icon, label } = layerTypeMeta(layer);
  return (
    <button
      type="button"
      className={`layer-track-row__label${isSelected ? ' is-selected' : ''}`}
      onClick={onSelect}
    >
      <Icon size={14} />
      <span>{label}</span>
    </button>
  );
}

function LayerTrackLane({
  layer,
  sceneDurationMs,
  isSelected,
  onSelect,
  onChange,
}: {
  layer: Layer;
  sceneDurationMs: number;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (patch: { startMs?: number; endMs?: number }) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const { Icon, colorKey } = layerTypeMeta(layer);
  const { start, end } = getLayerVisibleRange(layer, sceneDurationMs);
  const hasCustomRange = layer.startMs !== undefined || layer.endMs !== undefined;
  const startPct = sceneDurationMs > 0 ? (start / sceneDurationMs) * 100 : 0;
  const endPct = sceneDurationMs > 0 ? (end / sceneDurationMs) * 100 : 100;

  function msFromClientX(clientX: number) {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(ratio * sceneDurationMs);
  }

  function startDrag(handle: 'start' | 'end') {
    return (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      onSelect();
      const boundary = handle === 'start' ? end : start;
      const move = (ev: PointerEvent) => {
        const ms = msFromClientX(ev.clientX);
        if (handle === 'start') onChange({ startMs: Math.min(ms, boundary) });
        else onChange({ endMs: Math.max(ms, boundary) });
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };
  }

  return (
    <div className={`layer-track-row__lane${isSelected ? ' is-selected' : ''}`}>
      <div className="layer-track-row__track" ref={trackRef} onClick={onSelect}>
        <div
          className={`layer-track-row__bar layer-track-row__bar--${colorKey}`}
          style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
        >
          {layer.type === 'text' ? (
            <div className="layer-track-row__bar-caption" aria-hidden="true">
              <Icon size={12} />
              <span>{layer.content}</span>
            </div>
          ) : (
            <div className="layer-track-row__bar-pattern" aria-hidden="true">
              {Array.from({ length: 10 }).map((_, i) => (
                <Icon key={i} size={12} />
              ))}
            </div>
          )}
          <div className="layer-track-row__handle layer-track-row__handle--start" onPointerDown={startDrag('start')} />
          <div className="layer-track-row__handle layer-track-row__handle--end" onPointerDown={startDrag('end')} />
        </div>
      </div>
      {hasCustomRange && (
        <button
          type="button"
          className="layer-track-row__reset"
          title="全体表示に戻す"
          onClick={() => onChange({ startMs: undefined, endMs: undefined })}
        >
          <CloseIcon size={12} />
        </button>
      )}
    </div>
  );
}

/**
 * シーン切り替え用のナビゲーション(前へ/シーンN/全体数/次へ)。
 * ルーラー・レイヤー行と同じ幅の列(label/lanesの2カラム)には含めず、
 * パネル上部で独立した行として全幅を使う。以前は現在のシーンのチップを
 * トラック列と同じ幅まで広げる方式だったが、シーン数が多いと他シーンの
 * 分だけ幅を奪い合ってルーラー/バーとズレて見えるため、この方式に変更した。
 */
function SceneNav({ project, scene, engine }: { project: Project; scene: Scene; engine: ProjectPlaybackEngine }) {
  const index = project.scenes.findIndex((s) => s.id === scene.id);
  const total = project.scenes.length;

  function goTo(i: number) {
    const target = project.scenes[i];
    if (target) engine.seek(getSceneStartMs(project, target.id));
  }

  return (
    <div className="layer-track-panel__scenenav">
      <button type="button" onClick={() => goTo(index - 1)} disabled={index <= 0} aria-label="前のシーン">
        <ChevronLeftIcon size={14} />
      </button>
      <span>
        シーン {index + 1} / {total}
      </span>
      <button type="button" onClick={() => goTo(index + 1)} disabled={index >= total - 1} aria-label="次のシーン">
        <ChevronRightIcon size={14} />
      </button>
    </div>
  );
}

function SceneRuler({
  scene,
  project,
  engine,
}: {
  scene: Scene;
  project: Project;
  engine: ProjectPlaybackEngine;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);

  function seekFromClientX(clientX: number) {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    engine.seek(getSceneStartMs(project, scene.id) + ratio * scene.duration);
  }

  return (
    <div className="layer-track-row__lane">
      <div
        className="layer-track-row__ruler"
        ref={trackRef}
        onPointerDown={(e) => seekFromClientX(e.clientX)}
      >
        <span>0:00</span>
        <span>{formatSec(scene.duration)}</span>
      </div>
    </div>
  );
}

interface Props {
  scene: Scene;
  project: Project;
  engine: ProjectPlaybackEngine;
}

/**
 * シーン内の各レイヤーの表示タイミングを一覧表示・編集するトラックパネル。
 * 本家Google Vidsのシーン詳細タイムラインに準拠し、PC・スマホ共通で使う。
 * レイヤー種類ごとに1行、シーンの長さを基準にしたバーで表示区間を示し、
 * バー端をドラッグして開始/終了時刻を変更できる。
 */
export function LayerTimelinePanel({ scene, project, engine }: Props) {
  const selectedLayerIds = useProjectStore((s) => s.selectedLayerIds);
  const selectLayer = useProjectStore((s) => s.selectLayer);
  const updateLayer = useProjectStore((s) => s.updateLayer);

  const rows = [...scene.layers].reverse();
  const showPlayhead = engine.position?.scene.id === scene.id;
  const playheadPct = showPlayhead ? (engine.position!.localTimeMs / Math.max(1, scene.duration)) * 100 : 0;

  return (
    <div className="layer-track-panel">
      <SceneNav project={project} scene={scene} engine={engine} />
      <div className="layer-track-panel__grid">
        <div className="layer-track-panel__labels">
          <div className="layer-track-row__label layer-track-row__label--ruler" aria-hidden="true" />
          {rows.map((layer) => (
            <LayerTrackLabel
              key={layer.id}
              layer={layer}
              isSelected={selectedLayerIds.includes(layer.id)}
              onSelect={() => selectLayer(layer.id)}
            />
          ))}
        </div>
        <div className="layer-track-panel__lanes">
          {showPlayhead && <div className="layer-track-panel__playhead" style={{ left: `${playheadPct}%` }} />}
          <SceneRuler scene={scene} project={project} engine={engine} />
          {rows.length === 0 && (
            <div className="layer-track-row__lane">
              <p className="layer-track-panel__hint">このシーンにはまだ要素がありません</p>
            </div>
          )}
          {rows.map((layer) => (
            <LayerTrackLane
              key={layer.id}
              layer={layer}
              sceneDurationMs={scene.duration}
              isSelected={selectedLayerIds.includes(layer.id)}
              onSelect={() => selectLayer(layer.id)}
              onChange={(patch) => updateLayer(scene.id, layer.id, patch)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
