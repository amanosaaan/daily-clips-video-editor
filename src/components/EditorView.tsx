import { useEffect, useRef, useState } from 'react';
import { createCaptionLayer, createImageLayerForScene, createTextLayer, cropPatch } from '../domain/layerFactory';
import { getSceneStartMs } from '../domain/timeline';
import type { ImageLayer, VideoLayer } from '../domain/types';
import { exportProjectToMp4, type ExportQuality } from '../export/exportPipeline';
import { sendCompletionEmail } from '../utils/emailNotify';
import { shareOrDownloadVideo } from '../utils/exportShare';
import { useProjectPlaybackEngine } from '../rendering/useProjectPlaybackEngine';
import { useSceneSelection } from '../hooks/useSceneSelection';
import { addMediaFile } from '../storage/mediaRepository';
import { exportProjectFile } from '../storage/projectPortability';
import { useProjectStore } from '../state/projectStore';
import { ArrangeMenu } from './ArrangeMenu';
import { ClipBulkImport } from './ClipBulkImport';
import { ContextToolbar } from './ContextToolbar';
import { EditorToolbar } from './EditorToolbar';
import { ImageCropModal } from './ImageCropModal';
import { BackIcon, CaptionIcon, ChaptersIcon, CloseIcon, FolderOpenIcon, ImageIcon, MailIcon, TextIcon } from './icons';
import { Inspector } from './Inspector';
import { MediaLibraryPanel } from './MediaLibraryPanel';
import { MenubarMenu } from './MenubarMenu';
import { NotifySettingsModal } from './NotifySettingsModal';
import { PreviewPanel } from './PreviewPanel';
import { StoryboardPanel } from './StoryboardPanel';
import { YoutubeChaptersModal } from './YoutubeChaptersModal';

export function EditorView() {
  const project = useProjectStore((s) => s.project);
  const closeProject = useProjectStore((s) => s.closeProject);
  const renameProject = useProjectStore((s) => s.renameProject);
  const selectLayer = useProjectStore((s) => s.selectLayer);
  const selectedLayerIds = useProjectStore((s) => s.selectedLayerIds);
  const addLayerToScene = useProjectStore((s) => s.addLayerToScene);
  const addMediaAsset = useProjectStore((s) => s.addMediaAsset);
  const updateLayer = useProjectStore((s) => s.updateLayer);
  const setBurnDateSettings = useProjectStore((s) => s.setBurnDateSettings);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportQuality, setExportQuality] = useState<ExportQuality>('high');
  // オンにすると、プロジェクト全体ではなく現在選択中の1クリップ(シーン)だけを
  // 書き出す。「この1本だけ確認・共有したい」というニーズに対応するためのもの。
  const [exportSelectedOnly, setExportSelectedOnly] = useState(false);
  const [exportedVideo, setExportedVideo] = useState<{ blob: Blob; filename: string } | null>(null);
  const [isMediaOpen, setMediaOpen] = useState(false);
  const [isChaptersOpen, setChaptersOpen] = useState(false);
  const [isNotifySettingsOpen, setNotifySettingsOpen] = useState(false);
  const [croppingImageLayerId, setCroppingImageLayerId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const engine = useProjectPlaybackEngine(canvasRef, project);
  const currentSceneId = engine.position?.scene.id ?? null;
  const sceneSelection = useSceneSelection(project);

  function handleSceneChipClick(sceneId: string, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) {
    sceneSelection.handleChipClick(sceneId, e, () => {
      if (project) engine.seek(getSceneStartMs(project, sceneId));
    });
  }

  useEffect(() => {
    selectLayer(null);
  }, [currentSceneId, selectLayer]);

  useEffect(() => {
    // Python版と同じショートカット: スペースで再生/一時停止、←→で5秒シーク
    // (クリップの境界を越えて前後のクリップへも自然に移動する。engine.seek()が
    // 全体タイムライン上のグローバル時刻でクランプ/解決するため、単純な加減算で済む)。
    const SEEK_STEP_MS = 5000;
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (engine.isPlaying) engine.pause();
        else engine.play();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        engine.seek(engine.getLiveTimeMs() + SEEK_STEP_MS);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        engine.seek(engine.getLiveTimeMs() - SEEK_STEP_MS);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [engine]);

  if (!project) return null;
  const currentScene = engine.position?.scene ?? project.scenes[0];
  const selectedLayers = currentScene.layers.filter((l) => selectedLayerIds.includes(l.id));
  const croppingLayer = currentScene.layers.find(
    (l): l is ImageLayer | VideoLayer => l.id === croppingImageLayerId && (l.type === 'image' || l.type === 'video'),
  );

  async function handleQuickInsertImages(files: FileList | null) {
    if (!files || !project) return;
    for (const file of Array.from(files)) {
      // このinputはaccept="image/*"だが、それはブラウザのファイル選択ダイアログ側の
      // フィルタでしかないため、ドラッグ&ドロップ等で画像以外が来た場合に備えて
      // 念のためファイルの種類も確認する(動画等を誤って画像レイヤーにしない)。
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

  async function handleExport() {
    if (!project) return;
    setExporting(true);
    setExportProgress(0);
    setExportedVideo(null);
    // 「選択中のクリップだけ書き出す」がオンの場合、プロジェクト全体ではなく選択中の
    // シーンだけを含む一時的なプロジェクトを組み立てて渡す。書き出しパイプライン
    // (exportProjectToMp4)自体はどのプロジェクトが渡されても同じロジックで動くため、
    // scenesを差し替えるだけで実現できる(トランジションは前後のシーンが無くなる分、
    // 自動的に効かなくなる=単体のクリップとして正しく書き出される)。Ctrl/Shift+クリックで
    // 複数選択していればその全て、何も選択していなければ従来通り現在のシーン1つを使う。
    const selectedScenes = project.scenes.filter((s) => sceneSelection.selectedSceneIds.includes(s.id));
    const scenesToExport = selectedScenes.length > 0 ? selectedScenes : [currentScene];
    const exportTarget = exportSelectedOnly ? { ...project, scenes: scenesToExport } : project;
    try {
      const blob = await exportProjectToMp4(exportTarget, { onProgress: setExportProgress, quality: exportQuality });
      // navigator.share()はユーザー操作(クリック)から間を置かずに呼ばないと、ブラウザに
      // 拒否されることが実機で確認された(iOS版Chromeで確認、書き出し処理は数秒〜
      // 数十秒かかる非同期処理のため、完了時点ではボタンを押した操作の「有効期限」が
      // 切れてしまっていたと考えられる: NotAllowedError)。そのため書き出し完了直後に
      // 自動で保存を呼ぶのではなく、ユーザーが「保存する」ボタンを押した瞬間(新しい
      // ユーザー操作)にshareOrDownloadVideoを呼ぶよう変更した(MobileEditorView.tsxと同じ)。
      const filenameSuffix = exportSelectedOnly ? (scenesToExport.length > 1 ? `_選択クリップ${scenesToExport.length}本` : '_選択クリップ') : '';
      setExportedVideo({ blob, filename: `${project.name || 'video'}${filenameSuffix}.mp4` });
      const notifyErr = await sendCompletionEmail(
        '【デイリークリップス】書き出しが完了しました',
        `「${project.name || '新しいプロジェクト'}」の書き出しが完了しました。アプリの画面に戻って保存してください。`,
      );
      if (notifyErr) console.error('完了通知メールの送信に失敗しました(書き出し自体は成功しています):', notifyErr);
    } catch (err) {
      console.error(err);
      window.alert('書き出しに失敗しました。ブラウザがMP4書き出しに対応していない可能性があります。');
      const notifyErr = await sendCompletionEmail(
        '【デイリークリップス】書き出しに失敗しました',
        `「${project.name || '新しいプロジェクト'}」の書き出し中にエラーが発生しました。アプリの画面を確認してください。`,
      );
      if (notifyErr) console.error('失敗通知メールの送信にも失敗しました:', notifyErr);
    } finally {
      setExporting(false);
    }
  }

  async function handleSaveExportedVideo() {
    if (!exportedVideo) return;
    try {
      // PCでは「写真」のような特別な保存先が無く、共有シートはただ手間が増えるだけなので
      // 常に通常のダウンロードにする(preferShare=false)。
      await shareOrDownloadVideo(exportedVideo.blob, exportedVideo.filename, false);
    } catch (err) {
      console.error(err);
      window.alert('保存に失敗しました。');
    } finally {
      setExportedVideo(null);
    }
  }

  async function handleExportProjectFile() {
    if (!project) return;
    try {
      const blob = await exportProjectFile(project);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.name || 'project'}.veproj`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      window.alert('プロジェクトの書き出しに失敗しました。');
    }
  }

  return (
    <div className="editor">
      <header className="editor__toolbar">
        <button className="btn-icon" onClick={closeProject} aria-label="一覧へ戻る">
          <BackIcon />
        </button>
        <div className="editor__logo" />
        <span className="editor__app-name">デイリークリップス</span>
        <input className="editor__project-name" value={project.name} onChange={(e) => renameProject(e.target.value)} />
        <button className="btn-pill" onClick={() => void handleExportProjectFile()}>
          プロジェクトを書き出す
        </button>
        <button className="btn-icon" onClick={() => setChaptersOpen(true)} title="YouTubeチャプターを表示" aria-label="YouTubeチャプターを表示">
          <ChaptersIcon />
        </button>
        <label className="context-toolbar__checkbox">
          <input
            type="checkbox"
            checked={project.burnDateEnabled}
            onChange={(e) => setBurnDateSettings({ burnDateEnabled: e.target.checked })}
          />
          撮影日を焼き込む
        </label>
        {project.burnDateEnabled && (
          <div className="context-toolbar__segmented">
            <button
              className={project.burnDatePosition === 'left' ? 'is-active' : ''}
              onClick={() => setBurnDateSettings({ burnDatePosition: 'left' })}
            >
              左下
            </button>
            <button
              className={project.burnDatePosition === 'right' ? 'is-active' : ''}
              onClick={() => setBurnDateSettings({ burnDatePosition: 'right' })}
            >
              右下
            </button>
          </div>
        )}
        <label
          className="context-toolbar__checkbox"
          title="オンにすると、プロジェクト全体ではなく選択中のクリップだけを書き出します(シーン一覧でCtrl/Shift+クリックすると複数選択できます)"
        >
          <input
            type="checkbox"
            checked={exportSelectedOnly}
            disabled={exporting || !!exportedVideo}
            onChange={(e) => setExportSelectedOnly(e.target.checked)}
          />
          選択中のクリップだけ書き出す
        </label>
        <select
          className="editor__quality-select"
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
              className="btn-icon"
              onClick={() => setExportedVideo(null)}
              aria-label="書き出し結果を破棄"
              title="書き出し結果を破棄"
            >
              <CloseIcon size={16} />
            </button>
            <button className="btn-pill btn-pill--primary" onClick={() => void handleSaveExportedVideo()}>
              保存する
            </button>
          </>
        ) : (
          <button className="btn-pill btn-pill--primary" onClick={() => void handleExport()} disabled={exporting}>
            {exporting ? `書き出し中… ${Math.round(exportProgress * 100)}%` : 'MP4で書き出し'}
          </button>
        )}
      </header>
      <nav className="editor__menubar">
        <MenubarMenu label="ファイル" items={[{ label: '開く', icon: FolderOpenIcon, onClick: () => setMediaOpen(true) }]} />
        <span className="editor__menubar-item" aria-hidden="true">
          編集
        </span>
        <span className="editor__menubar-item" aria-hidden="true">
          表示
        </span>
        <MenubarMenu
          label="挿入"
          items={[
            { label: 'テキスト', icon: TextIcon, onClick: () => addLayerToScene(currentScene.id, createTextLayer(currentScene)) },
            {
              label: '字幕',
              icon: CaptionIcon,
              onClick: () => addLayerToScene(currentScene.id, createCaptionLayer(project, currentScene)),
            },
            { label: '画像', icon: ImageIcon, onClick: () => imageInputRef.current?.click() },
          ]}
        />
        <span className="editor__menubar-item" aria-hidden="true">
          表示形式
        </span>
        <span className="editor__menubar-item" aria-hidden="true">
          シーン
        </span>
        <ArrangeMenu project={project} scene={currentScene} layers={selectedLayers} />
        <MenubarMenu
          label="ツール"
          items={[{ label: 'メール通知設定', icon: MailIcon, onClick: () => setNotifySettingsOpen(true) }]}
        />
        <span className="editor__menubar-item" aria-hidden="true">
          ヘルプ
        </span>
      </nav>
      <EditorToolbar />
      <ContextToolbar
        project={project}
        scene={currentScene}
        layers={selectedLayers}
        onOpenCrop={(layerId) => setCroppingImageLayerId(layerId)}
      />
      <div className="editor__body">
        <div className="editor__center">
          <div className="editor__preview-area">
            <PreviewPanel
              project={project}
              canvasRef={canvasRef}
              engine={engine}
              onOpenCrop={(layerId) => setCroppingImageLayerId(layerId)}
            />
          </div>
          <ClipBulkImport project={project} />
          <StoryboardPanel
            project={project}
            currentSceneId={currentSceneId}
            onSelectScene={(sceneId) => engine.seek(getSceneStartMs(project, sceneId))}
            engine={engine}
            selectedSceneIds={sceneSelection.selectedSceneIds}
            onChipClick={handleSceneChipClick}
          />
        </div>
        <Inspector
          scene={currentScene}
          onOpenMedia={() => setMediaOpen(true)}
          onAddCaption={() => addLayerToScene(currentScene.id, createCaptionLayer(project, currentScene))}
          onQuickInsertImage={() => imageInputRef.current?.click()}
        />
      </div>
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
      {isChaptersOpen && <YoutubeChaptersModal project={project} onClose={() => setChaptersOpen(false)} />}
      {isNotifySettingsOpen && <NotifySettingsModal onClose={() => setNotifySettingsOpen(false)} />}
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
