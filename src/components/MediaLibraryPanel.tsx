import { useEffect, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import { createImageLayerForScene, createVideoLayerForScene } from '../domain/layerFactory';
import type { AudioLayer, MediaAsset, Project, Scene } from '../domain/types';
import { addMediaFile, deleteMedia, getThumbnailUrl } from '../storage/mediaRepository';
import { useProjectStore } from '../state/projectStore';
import { CloseIcon, LayersIcon, PlusIcon, TrashIcon } from './icons';

interface Props {
  project: Project;
  scene: Scene;
  onClose: () => void;
}

export function MediaLibraryPanel({ project, scene, onClose }: Props) {
  const addMediaAsset = useProjectStore((s) => s.addMediaAsset);
  const removeMediaAsset = useProjectStore((s) => s.removeMediaAsset);
  const addLayerToScene = useProjectStore((s) => s.addLayerToScene);
  const addSceneWithVideo = useProjectStore((s) => s.addSceneWithVideo);
  const sortScenesByDate = useProjectStore((s) => s.sortScenesByDate);
  const updateSceneDuration = useProjectStore((s) => s.updateSceneDuration);
  const updateScene = useProjectStore((s) => s.updateScene);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const asset of project.mediaLibrary) {
        if (!asset.thumbnailBlobId) continue;
        const url = await getThumbnailUrl(asset.thumbnailBlobId);
        if (url && !cancelled) {
          setThumbUrls((prev) => (prev[asset.id] ? prev : { ...prev, [asset.id]: url }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project]);

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      try {
        const asset = await addMediaFile(project.id, file);
        addMediaAsset(asset);
      } catch (err) {
        console.error(err);
      }
    }
    setUploading(false);
  }

  async function handleDelete(asset: MediaAsset) {
    if (!window.confirm(`「${asset.name}」を削除しますか？シーンで使用中の場合はそこからも取り除かれます。`)) return;
    removeMediaAsset(asset.id);
    try {
      await deleteMedia(asset.id);
    } catch (err) {
      console.error(err);
    }
  }

  // 動画は「日付順に並んだクリップ(シーン)」として1本ずつ追加していくのがこのアプリの
  // 基本の使い方。まとめて取り込んだ後に1本足すケースで、現在のシーンの上に重なって
  // しまう(=ピクチャーインピクチャー扱いになる)のは想定外だったため、動画をここから
  // 配置するときは既定で「新しいクリップ(シーン)として追加し、撮影日順に並べ直す」
  // ようにする(「動画を追加」ボタンと同じ挙動)。現在のシーンに重ねたい場合は
  // overlayVideoOnScene() を使う。
  function addVideoAsNewClip(asset: MediaAsset) {
    addSceneWithVideo(asset);
    sortScenesByDate();
  }

  function overlayVideoOnScene(asset: MediaAsset) {
    const { layer, isMain } = createVideoLayerForScene(project, scene, asset);
    addLayerToScene(scene.id, layer);
    if (isMain && asset.durationMs) updateSceneDuration(scene.id, asset.durationMs);
    if (isMain && asset.shotDatetime) updateScene(scene.id, { shotDate: asset.shotDatetime });
  }

  function placeOnScene(asset: MediaAsset) {
    if (asset.kind === 'video') {
      addVideoAsNewClip(asset);
    } else if (asset.kind === 'image') {
      addLayerToScene(scene.id, createImageLayerForScene(project, scene, asset));
    } else {
      const layer: AudioLayer = {
        id: nanoid(),
        type: 'audio',
        mediaId: asset.id,
        x: 0,
        y: 0,
        width: project.resolution.width,
        height: project.resolution.height,
        rotation: 0,
        opacity: 1,
        zIndex: scene.layers.length + 1,
        trimStart: 0,
        volume: 1,
        role: 'music',
      };
      addLayerToScene(scene.id, layer);
    }
  }

  return (
    <div className="media-flyout__backdrop" onClick={onClose}>
      <div className="media-flyout" onClick={(e) => e.stopPropagation()}>
        <div className="media-flyout__header">
          <h2>メディア</h2>
          <button className="btn-icon" onClick={onClose} aria-label="閉じる">
            <CloseIcon />
          </button>
        </div>
        <div className="media-flyout__body">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="video/*,image/*,audio/*"
            style={{ display: 'none' }}
            onChange={(e) => void handleFiles(e.target.files)}
          />
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? 'アップロード中…' : 'ファイルを追加'}
          </button>
          <ul className="media-library__list">
            {project.mediaLibrary.map((asset) => (
              <li key={asset.id} className="media-library__item">
                {thumbUrls[asset.id] ? (
                  <img src={thumbUrls[asset.id]} alt={asset.name} />
                ) : (
                  <div className="media-library__placeholder">{asset.kind}</div>
                )}
                <span className="media-library__name" title={asset.name}>
                  {asset.name}
                </span>
                <div className="media-library__item-actions">
                  <button
                    className="btn-icon media-library__place"
                    title={
                      asset.kind === 'audio'
                        ? 'シーンにBGMとして追加'
                        : asset.kind === 'video'
                          ? '新しいクリップとして追加(撮影日順に並ぶ)'
                          : 'シーンに配置'
                    }
                    aria-label={
                      asset.kind === 'audio'
                        ? 'シーンにBGMとして追加'
                        : asset.kind === 'video'
                          ? '新しいクリップとして追加'
                          : 'シーンに配置'
                    }
                    onClick={() => placeOnScene(asset)}
                  >
                    <PlusIcon size={14} />
                  </button>
                  {asset.kind === 'video' && (
                    <button
                      className="btn-icon media-library__place"
                      title="今のシーンに重ねる(ワイプ/ピクチャーインピクチャー)"
                      aria-label="今のシーンに重ねる"
                      onClick={() => overlayVideoOnScene(asset)}
                    >
                      <LayersIcon size={14} />
                    </button>
                  )}
                  <button
                    className="btn-icon media-library__delete"
                    title="素材を削除"
                    aria-label="素材を削除"
                    onClick={() => void handleDelete(asset)}
                  >
                    <TrashIcon size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
