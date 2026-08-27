import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Project, Scene, TransitionConfig } from '../domain/types';
import type { ProjectPlaybackEngine } from '../rendering/useProjectPlaybackEngine';
import { useProjectStore } from '../state/projectStore';
import { NumberField } from './NumberField';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  MinusIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  ScissorsIcon,
  SwapIcon,
  TrashIcon,
} from './icons';
import { LayerTimelinePanel } from './LayerTimelinePanel';
import { OverlayTrackPanel } from './OverlayTrackPanel';
import { SceneTimelineStrip } from './SceneTimelineStrip';

const TRANSITION_OPTIONS: { type: TransitionConfig['type'] | 'none'; label: string; preview: string }[] = [
  { type: 'none', label: 'なし', preview: '—' },
  { type: 'crossfade', label: 'クロスフェード', preview: '◐' },
  { type: 'slide', label: 'スライド', preview: '→' },
  { type: 'wipe', label: 'ワイプ', preview: '▤' },
];

interface TransitionButtonProps {
  scene: Scene;
  disabled: boolean;
}

/** 選択中シーンの「次のシーンへの切り替え効果」を設定するボタン＋フライアウト */
function TransitionButton({ scene, disabled }: TransitionButtonProps) {
  const [isOpen, setOpen] = useState(false);
  const [flyoutPos, setFlyoutPos] = useState<{ left: number; top: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const updateScene = useProjectStore((s) => s.updateScene);
  const transitionOut = scene.transitionOut;

  function openFlyout() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setFlyoutPos({ left: rect.left + rect.width / 2, top: rect.top });
    setOpen(true);
  }

  return (
    <>
      <button
        ref={buttonRef}
        className="mobile-icon-btn"
        onClick={() => (isOpen ? setOpen(false) : openFlyout())}
        disabled={disabled}
        title="次のシーンへの切り替え効果"
        aria-label="次のシーンへの切り替え効果"
      >
        <SwapIcon size={18} />
      </button>
      {isOpen &&
        flyoutPos &&
        createPortal(
          <>
            <div className="transition-flyout__backdrop" onClick={() => setOpen(false)} />
            <div
              className="transition-flyout"
              style={{ left: flyoutPos.left, top: flyoutPos.top }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3>切り替え効果</h3>
              <div className="transition-flyout__grid">
                {TRANSITION_OPTIONS.map((opt) => (
                  <button
                    key={opt.type}
                    className={`transition-flyout__option${
                      (transitionOut?.type ?? 'none') === opt.type ? ' is-selected' : ''
                    }`}
                    onClick={() =>
                      updateScene(scene.id, {
                        transitionOut:
                          opt.type === 'none'
                            ? undefined
                            : { type: opt.type, durationMs: transitionOut?.durationMs ?? 600 },
                      })
                    }
                  >
                    <span className="transition-flyout__preview">{opt.preview}</span>
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
              {transitionOut && (
                <label className="transition-flyout__duration">
                  長さ (秒)
                  <NumberField
                    min={0.1}
                    max={Math.max(0.1, scene.duration / 1000)}
                    step={0.1}
                    value={transitionOut.durationMs / 1000}
                    onChange={(v) =>
                      updateScene(scene.id, { transitionOut: { ...transitionOut, durationMs: Math.max(100, v * 1000) } })
                    }
                  />
                </label>
              )}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

const ZOOM_MIN = 50;
const ZOOM_MAX = 400;
const ZOOM_STEP = 10;

/** シーンチップ列の拡大・縮小スライダー(本家Google Vidsのズームスライダーと同様、PC向け)。 */
function ZoomControl({ zoomPercent, onChange }: { zoomPercent: number; onChange: (v: number) => void }) {
  return (
    <div className="storyboard__zoom">
      <button
        type="button"
        onClick={() => onChange(Math.max(ZOOM_MIN, zoomPercent - ZOOM_STEP))}
        disabled={zoomPercent <= ZOOM_MIN}
        aria-label="縮小"
      >
        <MinusIcon size={14} />
      </button>
      <input
        type="range"
        min={ZOOM_MIN}
        max={ZOOM_MAX}
        step={ZOOM_STEP}
        value={zoomPercent}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="シーンチップの拡大率"
      />
      <button
        type="button"
        onClick={() => onChange(Math.min(ZOOM_MAX, zoomPercent + ZOOM_STEP))}
        disabled={zoomPercent >= ZOOM_MAX}
        aria-label="拡大"
      >
        <PlusIcon size={14} />
      </button>
      <span className="storyboard__zoom-value">{zoomPercent}%</span>
    </div>
  );
}

interface Props {
  project: Project;
  currentSceneId: string | null;
  onSelectScene: (sceneId: string) => void;
  engine: ProjectPlaybackEngine;
}

function formatTime(ms: number): string {
  return (ms / 1000).toFixed(1);
}

export function StoryboardPanel({ project, currentSceneId, onSelectScene, engine }: Props) {
  const [isTimingOpen, setTimingOpen] = useState(false);
  const [zoomPercent, setZoomPercent] = useState(100);
  const addScene = useProjectStore((s) => s.addScene);
  const duplicateScene = useProjectStore((s) => s.duplicateScene);
  const removeScene = useProjectStore((s) => s.removeScene);
  const splitScene = useProjectStore((s) => s.splitScene);

  const currentSceneIndex = project.scenes.findIndex((s) => s.id === currentSceneId);
  const currentScene = currentSceneIndex !== -1 ? project.scenes[currentSceneIndex] : null;

  function handleAddScene() {
    const newId = addScene();
    if (newId) onSelectScene(newId);
  }

  function handleDuplicateScene() {
    if (!currentSceneId) return;
    const newId = duplicateScene(currentSceneId);
    if (newId) onSelectScene(newId);
  }

  function handleRemoveScene() {
    if (currentSceneId) removeScene(currentSceneId);
  }

  function handleSplit() {
    const position = engine.position;
    if (!position) return;
    // グローバル時刻自体は変わらないため、分割後は自動的に新しい後半シーンの先頭に位置する
    // （resolvePositionが境界ちょうどの時刻を次シーンの先頭として扱うため、seek不要）。
    splitScene(position.scene.id, position.localTimeMs);
  }

  const canSplit = !!engine.position && engine.position.localTimeMs > 0 && engine.position.localTimeMs < engine.position.scene.duration;

  return (
    <div className="storyboard">
      <div className="storyboard__header">
        <button className="btn-pill layer-track-toggle" onClick={() => setTimingOpen((v) => !v)}>
          {isTimingOpen ? 'タイミングを非表示' : 'タイミングを表示'}
          {isTimingOpen ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
        </button>
        <button className="btn-icon" onClick={engine.isPlaying ? engine.pause : engine.play} aria-label="再生">
          {engine.isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>
        <span className="storyboard__time">
          {formatTime(engine.currentTimeMs)}s / {formatTime(engine.totalDurationMs)}s
        </span>
        <button
          className="btn-icon storyboard__split"
          onClick={handleSplit}
          disabled={!canSplit}
          title="再生位置でシーンを分割"
          aria-label="再生位置でシーンを分割"
        >
          <ScissorsIcon size={16} />
        </button>
        <ZoomControl zoomPercent={zoomPercent} onChange={setZoomPercent} />
      </div>
      <SceneTimelineStrip
        project={project}
        engine={engine}
        currentSceneId={currentSceneId}
        autoCenter={false}
        zoom={zoomPercent / 100}
      />
      <OverlayTrackPanel project={project} engine={engine} zoom={zoomPercent / 100} />
      {isTimingOpen && currentScene && <LayerTimelinePanel scene={currentScene} project={project} engine={engine} />}
      <div className="storyboard__actions">
        <button
          className="mobile-icon-btn"
          onClick={handleDuplicateScene}
          disabled={!currentSceneId}
          title="このシーンを複製"
          aria-label="このシーンを複製"
        >
          <CopyIcon size={18} />
        </button>
        <button
          className="mobile-icon-btn"
          onClick={handleRemoveScene}
          disabled={!currentSceneId}
          title="このシーンを削除"
          aria-label="このシーンを削除"
        >
          <TrashIcon size={18} />
        </button>
        {currentScene && <TransitionButton scene={currentScene} disabled={currentSceneIndex >= project.scenes.length - 1} />}
        <button className="mobile-scene-add" onClick={handleAddScene} aria-label="シーン追加">
          <PlusIcon size={18} />
        </button>
      </div>
    </div>
  );
}
