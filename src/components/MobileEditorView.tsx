import { useEffect, useRef, useState } from 'react';
import {
  createCaptionLayer,
  createImageLayerForScene,
  createMosaicLayer,
  createShapeLayer,
  createTextLayer,
  cropPatch,
} from '../domain/layerFactory';
import { getSceneStartMs } from '../domain/timeline';
import type { ImageLayer, VideoLayer } from '../domain/types';
import { exportProjectToMp4, type ExportQuality } from '../export/exportPipeline';
import { shareOrDownloadVideo } from '../utils/exportShare';
import { useProjectPlaybackEngine } from '../rendering/useProjectPlaybackEngine';
import { addMediaFile } from '../storage/mediaRepository';
import { useProjectStore } from '../state/projectStore';
import { BottomSheet } from './BottomSheet';
import { ContextToolbar } from './ContextToolbar';
import { ImageCropModal } from './ImageCropModal';
import {
  AlignCenterHIcon,
  CaptionIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  CopyIcon,
  ExpandIcon,
  ImageIcon,
  MosaicIcon,
  MultiSelectIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RedoIcon,
  ScissorsIcon,
  ShapeIcon,
  TextIcon,
  TrashIcon,
  UndoIcon,
  UploadIcon,
} from './icons';
import { ClipBulkImport } from './ClipBulkImport';
import { LayerTimelinePanel } from './LayerTimelinePanel';
import { MediaLibraryPanel } from './MediaLibraryPanel';
import { PreviewPanel } from './PreviewPanel';
import { SceneTimelineStrip } from './SceneTimelineStrip';

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function MobileEditorView() {
  const project = useProjectStore((s) => s.project);
  const closeProject = useProjectStore((s) => s.closeProject);
  const selectedLayerIds = useProjectStore((s) => s.selectedLayerIds);
  const addLayerToScene = useProjectStore((s) => s.addLayerToScene);
  const addMediaAsset = useProjectStore((s) => s.addMediaAsset);
  const updateLayer = useProjectStore((s) => s.updateLayer);
  const addScene = useProjectStore((s) => s.addScene);
  const duplicateScene = useProjectStore((s) => s.duplicateScene);
  const removeScene = useProjectStore((s) => s.removeScene);
  const splitScene = useProjectStore((s) => s.splitScene);
  const canUndo = useProjectStore((s) => s.past.length > 0);
  const canRedo = useProjectStore((s) => s.future.length > 0);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const engine = useProjectPlaybackEngine(canvasRef, project);
  const currentSceneId = engine.position?.scene.id ?? null;

  const [exportQuality, setExportQuality] = useState<ExportQuality>('high');
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportedVideo, setExportedVideo] = useState<{ blob: Blob; filename: string } | null>(null);
  const [isArrangeOpen, setArrangeOpen] = useState(false);
  const [isMediaOpen, setMediaOpen] = useState(false);
  const [croppingImageLayerId, setCroppingImageLayerId] = useState<string | null>(null);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [isTimingOpen, setTimingOpen] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const [sheetMaxHeight, setSheetMaxHeight] = useState<number>();
  // CapCutと同様、キャンバスで要素を選択（または別の要素に選択し直）したら自動で
  // プロパティ編集シートを開き、選択解除したら自動で閉じる。
  // 「何か選択された状態」から「別の何かが選択された状態」への変化も検知しないと、
  // 一度シートを手動で閉じた後に別のツール（図形・字幕など）で新しい要素を
  // 追加したときにシートが開かないままになってしまう。
  const prevSelectionKeyRef = useRef('');
  useEffect(() => {
    const key = selectedLayerIds.join(',');
    if (key !== prevSelectionKeyRef.current) {
      setArrangeOpen(key !== '');
      if (key === '') setMultiSelectMode(false);
    }
    prevSelectionKeyRef.current = key;
  }, [selectedLayerIds]);

  // 配置シートが動画プレビューにかからないよう、プレビュー枠の下端から
  // 画面下端までの残り高さを最大高さとして使う。シートを開く前から値を
  // 用意しておくことで、開いた瞬間にCSSの既定値からガクッと変わるのを防ぐ。
  useEffect(() => {
    function updateSheetMaxHeight() {
      const el = previewRef.current;
      if (!el) return;
      const bottom = el.getBoundingClientRect().bottom;
      setSheetMaxHeight(Math.max(160, window.innerHeight - bottom - 8));
    }
    updateSheetMaxHeight();
    window.addEventListener('resize', updateSheetMaxHeight);
    return () => window.removeEventListener('resize', updateSheetMaxHeight);
  }, []);

  if (!project) return null;
  const currentScene = engine.position?.scene ?? project.scenes[0];
  const selectedLayers = currentScene.layers.filter((l) => selectedLayerIds.includes(l.id));
  const croppingLayer = currentScene.layers.find(
    (l): l is ImageLayer | VideoLayer => l.id === croppingImageLayerId && (l.type === 'image' || l.type === 'video'),
  );

  async function handleExport() {
    if (!project) return;
    setExporting(true);
    setExportProgress(0);
    setExportedVideo(null);
    try {
      const blob = await exportProjectToMp4(project, { onProgress: setExportProgress, quality: exportQuality });
      // navigator.share()はユーザー操作(タップ)から間を置かずに呼ばないと、ブラウザに
      // 拒否されることが実機で確認された(iOS版Chromeで確認、書き出し処理は数秒〜
      // 数十秒かかる非同期処理のため、完了時点ではボタンを押した操作の「有効期限」が
      // 切れてしまっていたと考えられる: NotAllowedError)。そのため書き出し完了直後に
      // 自動で保存を呼ぶのではなく、ユーザーが「保存する」ボタンを押した瞬間(新しい
      // ユーザー操作)にshareOrDownloadVideoを呼ぶよう変更した。
      setExportedVideo({ blob, filename: `${project.name || 'video'}.mp4` });
    } catch (err) {
      console.error(err);
      window.alert('書き出しに失敗しました。ブラウザがMP4書き出しに対応していない可能性があります。');
    } finally {
      setExporting(false);
    }
  }

  async function handleSaveExportedVideo() {
    if (!exportedVideo) return;
    try {
      // モバイルでは共有シート経由で写真アプリへ直接保存できるようにする(preferShare=true)。
      await shareOrDownloadVideo(exportedVideo.blob, exportedVideo.filename, true);
    } catch (err) {
      console.error(err);
      window.alert('保存に失敗しました。');
    } finally {
      setExportedVideo(null);
    }
  }

  async function handleQuickInsertImages(files: FileList | null) {
    if (!files || !project) return;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const asset = await addMediaFile(project.id, file);
        addMediaAsset(asset);
        addLayerToScene(currentScene.id, createImageLayerForScene(project, currentScene, asset));
      } catch (err) {
        console.error(err);
      }
    }
  }

  function handleAddScene() {
    const newId = addScene();
    if (newId && project) engine.seek(getSceneStartMs(project, newId));
  }

  function handleDuplicateScene() {
    if (!currentSceneId) return;
    const newId = duplicateScene(currentSceneId);
    if (newId && project) engine.seek(getSceneStartMs(project, newId));
  }

  function handleRemoveScene() {
    if (currentSceneId) removeScene(currentSceneId);
  }

  function handleSplitScene() {
    const position = engine.position;
    if (!position) return;
    // グローバル時刻自体は変わらないため、分割後は自動的に新しい後半シーンの先頭に位置する
    // （resolvePositionが境界ちょうどの時刻を次シーンの先頭として扱うため、seek不要）。
    splitScene(position.scene.id, position.localTimeMs);
  }

  const canSplit = !!engine.position && engine.position.localTimeMs > 0 && engine.position.localTimeMs < engine.position.scene.duration;

  return (
    <div className="mobile-editor">
      <header className="mobile-editor__top">
        <button className="mobile-icon-btn" onClick={closeProject} aria-label="閉じる">
          <CloseIcon size={20} />
        </button>
        <span className="mobile-editor__app-name">デイリークリップス</span>
        <div className="mobile-editor__top-right">
          <select
            className="mobile-editor__quality-select"
            value={exportQuality}
            onChange={(e) => setExportQuality(e.target.value as ExportQuality)}
            disabled={exporting || !!exportedVideo}
          >
            <option value="low">画質: 低</option>
            <option value="medium">画質: 中</option>
            <option value="high">画質: 高</option>
            <option value="veryHigh">画質: 最高</option>
          </select>
          {exportedVideo ? (
            <>
              <button
                className="mobile-icon-btn"
                onClick={() => setExportedVideo(null)}
                aria-label="書き出し結果を破棄"
                title="書き出し結果を破棄"
              >
                <CloseIcon size={16} />
              </button>
              <button className="mobile-editor__export" onClick={() => void handleSaveExportedVideo()}>
                保存する
              </button>
            </>
          ) : (
            <button className="mobile-editor__export" onClick={() => void handleExport()} disabled={exporting}>
              {exporting ? `${Math.round(exportProgress * 100)}%` : 'エクスポート'}
            </button>
          )}
        </div>
      </header>

      <div className="mobile-editor__preview" ref={previewRef}>
        <PreviewPanel
          project={project}
          canvasRef={canvasRef}
          engine={engine}
          onOpenCrop={(layerId) => setCroppingImageLayerId(layerId)}
          multiSelectMode={multiSelectMode}
        />
      </div>

      <div className="mobile-editor__playback">
        <div className="mobile-editor__playback-left">
          <button className="mobile-icon-btn" disabled title="全画面表示（未対応）">
            <ExpandIcon size={18} />
          </button>
        </div>
        <div className="mobile-editor__playback-center">
          <button className="mobile-icon-btn" onClick={engine.isPlaying ? engine.pause : engine.play} aria-label="再生">
            {engine.isPlaying ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
          </button>
        </div>
        <div className="mobile-editor__playback-right">
          <button className="mobile-icon-btn" onClick={undo} disabled={!canUndo} title="元に戻す">
            <UndoIcon size={18} />
          </button>
          <button className="mobile-icon-btn" onClick={redo} disabled={!canRedo} title="やり直す">
            <RedoIcon size={18} />
          </button>
        </div>
      </div>

      <div className="mobile-editor__timeline">
        <div className="mobile-editor__time-row">
          <div className="mobile-editor__time">
            {formatTime(engine.currentTimeMs)} / {formatTime(engine.totalDurationMs)}
          </div>
          <button className="btn-pill layer-track-toggle" onClick={() => setTimingOpen((v) => !v)}>
            タイミング
            {isTimingOpen ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
          </button>
          <button
            className="mobile-icon-btn"
            onClick={handleSplitScene}
            disabled={!canSplit}
            title="再生位置でシーンを分割"
            aria-label="再生位置でシーンを分割"
          >
            <ScissorsIcon size={16} />
          </button>
        </div>
        <div className="mobile-editor__scenes">
          <ClipBulkImport project={project} />
          <SceneTimelineStrip project={project} engine={engine} currentSceneId={currentSceneId} autoCenter />
          {isTimingOpen && <LayerTimelinePanel scene={currentScene} project={project} engine={engine} />}
          <div className="mobile-editor__scenes-actions">
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
            <button className="mobile-scene-add" onClick={handleAddScene} aria-label="シーン追加">
              <PlusIcon size={18} />
            </button>
          </div>
        </div>
      </div>

      <nav className="mobile-editor__tabs">
        <button className={`mobile-tab${isMediaOpen ? ' is-active' : ''}`} onClick={() => setMediaOpen(true)}>
          <UploadIcon size={20} />
          アップロード
        </button>
        <button className="mobile-tab" onClick={() => imageInputRef.current?.click()}>
          <ImageIcon size={20} />
          画像
        </button>
        <button className="mobile-tab" onClick={() => addLayerToScene(currentScene.id, createShapeLayer(currentScene))}>
          <ShapeIcon size={20} />
          図形
        </button>
        <button className="mobile-tab" onClick={() => addLayerToScene(currentScene.id, createTextLayer(currentScene))}>
          <TextIcon size={20} />
          テキスト
        </button>
        <button className="mobile-tab" onClick={() => addLayerToScene(currentScene.id, createMosaicLayer(currentScene))}>
          <MosaicIcon size={20} />
          モザイク
        </button>
        <button
          className="mobile-tab"
          onClick={() => addLayerToScene(currentScene.id, createCaptionLayer(project, currentScene))}
        >
          <CaptionIcon size={20} />
          字幕
        </button>
        <button className={`mobile-tab${isArrangeOpen ? ' is-active' : ''}`} onClick={() => setArrangeOpen(true)}>
          <AlignCenterHIcon size={20} />
          配置
        </button>
      </nav>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          void handleQuickInsertImages(e.target.files);
          e.target.value = '';
        }}
      />

      {isMediaOpen && <MediaLibraryPanel project={project} scene={currentScene} onClose={() => setMediaOpen(false)} />}

      {isArrangeOpen && (
        <BottomSheet
          title="配置"
          onClose={() => setArrangeOpen(false)}
          maxHeightPx={sheetMaxHeight}
          headerExtra={
            selectedLayers.length > 0 ? (
              <button
                className={`mobile-icon-btn${multiSelectMode ? ' is-active' : ''}`}
                title="複数選択"
                aria-pressed={multiSelectMode}
                onClick={() => setMultiSelectMode((v) => !v)}
              >
                <MultiSelectIcon size={18} />
              </button>
            ) : undefined
          }
        >
          {selectedLayers.length === 0 ? (
            <p className="mobile-sheet__hint">キャンバスで要素を選択してください</p>
          ) : (
            <ContextToolbar
              project={project}
              scene={currentScene}
              layers={selectedLayers}
              onOpenCrop={(layerId) => setCroppingImageLayerId(layerId)}
            />
          )}
        </BottomSheet>
      )}

      {croppingLayer && (
        <ImageCropModal
          layer={croppingLayer}
          onConfirm={(crop) => {
            const asset = project.mediaLibrary.find((m) => m.id === croppingLayer.mediaId);
            updateLayer(currentScene.id, croppingLayer.id, cropPatch(croppingLayer, crop, asset));
            setCroppingImageLayerId(null);
          }}
          onCancel={() => setCroppingImageLayerId(null)}
        />
      )}
    </div>
  );
}
