import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { collectOverlayEntries, packOverlayRows, type OverlayTrackEntry, type OverlayTrackKind } from '../domain/overlayTrack';
import {
  SCENE_CHIP_GAP_PX,
  getSceneStartMs,
  sceneChipWidthPx,
  timelineOffsetPxToGlobalMs,
  timelinePositionToOffsetPx,
} from '../domain/timeline';
import type { Project } from '../domain/types';
import type { ProjectPlaybackEngine } from '../rendering/useProjectPlaybackEngine';
import { useProjectStore } from '../state/projectStore';
import { MosaicIcon, ShapeIcon, TextIcon } from './icons';

const ROW_H = 20;
const ROW_GAP = 4;
const ALL_KINDS: OverlayTrackKind[] = ['text', 'shape', 'mosaic'];
const KIND_META: Record<OverlayTrackKind, { label: string; Icon: typeof TextIcon }> = {
  text: { label: 'テキスト', Icon: TextIcon },
  shape: { label: '図形', Icon: ShapeIcon },
  mosaic: { label: 'モザイク', Icon: MosaicIcon },
};

function totalTimelineWidthPx(project: Project, zoom: number): number {
  return project.scenes.reduce(
    (sum, s, i) => sum + sceneChipWidthPx(s.duration, zoom) + (i > 0 ? SCENE_CHIP_GAP_PX : 0),
    0,
  );
}

function barLabelFor(entry: OverlayTrackEntry): string {
  if (entry.layer.type === 'text') return entry.layer.content.trim() || '(空のテキスト)';
  return KIND_META[entry.layer.type as OverlayTrackKind].label;
}

interface RowProps {
  kind: OverlayTrackKind;
  project: Project;
  zoom: number;
  selectedLayerIds: string[];
  msFromClientX: (clientX: number) => number;
  onSelectEntry: (entry: OverlayTrackEntry) => void;
}

function OverlayTrackRow({ kind, project, zoom, selectedLayerIds, msFromClientX, onSelectEntry }: RowProps) {
  const updateLayer = useProjectStore((s) => s.updateLayer);
  const entries = packOverlayRows(collectOverlayEntries(project, kind));
  if (entries.length === 0) return null;
  const rowsUsed = entries.reduce((m, e) => Math.max(m, e.row), 0) + 1;

  function startDrag(entry: OverlayTrackEntry, handle: 'start' | 'end') {
    return (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      onSelectEntry(entry);
      const sceneStartMs = getSceneStartMs(project, entry.sceneId);
      const localStart = entry.globalStartMs - sceneStartMs;
      const localEnd = entry.globalEndMs - sceneStartMs;
      const boundary = handle === 'start' ? localEnd : localStart;
      const move = (ev: PointerEvent) => {
        const localMs = Math.round(msFromClientX(ev.clientX) - sceneStartMs);
        if (handle === 'start') updateLayer(entry.sceneId, entry.layerId, { startMs: Math.max(0, Math.min(localMs, boundary)) });
        else updateLayer(entry.sceneId, entry.layerId, { endMs: Math.max(boundary, localMs) });
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
    <div className="overlay-track-row__lane" style={{ height: rowsUsed * (ROW_H + ROW_GAP) }}>
      {entries.map((entry) => {
        const scene = project.scenes[entry.sceneIndex];
        const sceneStartMs = getSceneStartMs(project, entry.sceneId);
        const left = timelinePositionToOffsetPx(project.scenes, entry.sceneIndex, entry.globalStartMs - sceneStartMs, scene.duration, zoom);
        const right = timelinePositionToOffsetPx(project.scenes, entry.sceneIndex, entry.globalEndMs - sceneStartMs, scene.duration, zoom);
        const isSelected = selectedLayerIds.includes(entry.layerId);
        const label = barLabelFor(entry);
        return (
          <div
            key={entry.layerId}
            className={`overlay-track-row__bar overlay-track-row__bar--${kind}${isSelected ? ' is-selected' : ''}`}
            style={{ left, width: Math.max(4, right - left), top: entry.row * (ROW_H + ROW_GAP) }}
            title={`${label}（シーン${entry.sceneIndex + 1}）`}
            onClick={() => onSelectEntry(entry)}
          >
            <span className="overlay-track-row__bar-label">{label}</span>
            <div className="overlay-track-row__handle overlay-track-row__handle--start" onPointerDown={startDrag(entry, 'start')} />
            <div className="overlay-track-row__handle overlay-track-row__handle--end" onPointerDown={startDrag(entry, 'end')} />
          </div>
        );
      })}
    </div>
  );
}

interface Props {
  project: Project;
  engine: ProjectPlaybackEngine;
  /** シーンチップ列(SceneTimelineStrip)と同じ倍率(1=100%)。目安として揃うようにしている。 */
  zoom: number;
}

/**
 * 文字・図形・モザイクのオーバーレイを、シーン(クリップ)をまたいで俯瞰できる統合タイムライン帯。
 * 上のシーンチップ列と同じ秒→pxの変換式(domain/timeline.ts)を使っているので、同じzoomであれば
 * 見た目の横幅は一致する(ただし別のスクロールコンテナのため、スクロール位置自体は同期していない)。
 * 種類ごとに1行、使われていない種類の行は表示しない(Python版のrenderOverlayTracksと同じ方針)。
 * バー本体のクリックは選択+該当シーンの先頭へのシーク、バー端をドラッグすると表示区間
 * (startMs/endMs)を調整できる(シーンをまたいだ移動はできない。既存の単一シーン版=
 * LayerTimelinePanelと同じ操作感)。
 */
export function OverlayTrackPanel({ project, engine, zoom }: Props) {
  const selectedLayerIds = useProjectStore((s) => s.selectedLayerIds);
  const selectLayer = useProjectStore((s) => s.selectLayer);
  const scrollRef = useRef<HTMLDivElement>(null);

  const visibleKinds = ALL_KINDS.filter((kind) => collectOverlayEntries(project, kind).length > 0);
  if (visibleKinds.length === 0) return null;

  const totalWidth = totalTimelineWidthPx(project, zoom);

  function msFromClientX(clientX: number): number {
    const rect = scrollRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return timelineOffsetPxToGlobalMs(project.scenes, clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0), zoom);
  }

  function handleSelectEntry(entry: OverlayTrackEntry) {
    selectLayer(entry.layerId);
    engine.seek(entry.globalStartMs);
  }

  return (
    <div className="overlay-track-panel">
      <div className="overlay-track-panel__grid">
        <div className="overlay-track-panel__labels">
          {visibleKinds.map((kind) => {
            const { label, Icon } = KIND_META[kind];
            return (
              <div className="overlay-track-row__label" key={kind}>
                <Icon size={13} />
                <span>{label}</span>
              </div>
            );
          })}
        </div>
        <div className="overlay-track-panel__scroll" ref={scrollRef}>
          <div className="overlay-track-panel__lanes" style={{ width: totalWidth }}>
            {visibleKinds.map((kind) => (
              <OverlayTrackRow
                key={kind}
                kind={kind}
                project={project}
                zoom={zoom}
                selectedLayerIds={selectedLayerIds}
                msFromClientX={msFromClientX}
                onSelectEntry={handleSelectEntry}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
