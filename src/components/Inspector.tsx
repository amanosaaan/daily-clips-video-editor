import { stepZIndexPatches } from '../domain/arrange';
import { createShapeLayer, createTextLayer } from '../domain/layerFactory';
import type { Layer, Scene } from '../domain/types';
import { useProjectStore } from '../state/projectStore';
import { CaptionIcon, ImageIcon, ShapeIcon, TextIcon, UploadIcon } from './icons';
import { NumberField } from './NumberField';

interface Props {
  scene: Scene;
  onOpenMedia: () => void;
  onAddCaption: () => void;
  onQuickInsertImage: () => void;
}

function shotDateInputValue(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function layerLabel(layer: Layer): string {
  switch (layer.type) {
    case 'text':
      return layer.content.trim() ? `テキスト: ${layer.content.slice(0, 12)}` : 'テキスト';
    case 'shape':
      return `図形 (${{ rect: '矩形', circle: '円', line: '線' }[layer.shape]})`;
    case 'video':
      return '動画';
    case 'image':
      return '画像';
    case 'audio':
      return `音声 (${layer.role === 'music' ? 'BGM' : 'ボイスオーバー'})`;
  }
}

export function Inspector({ scene, onOpenMedia, onAddCaption, onQuickInsertImage }: Props) {
  const selectedLayerIds = useProjectStore((s) => s.selectedLayerIds);
  const selectLayer = useProjectStore((s) => s.selectLayer);
  const updateLayer = useProjectStore((s) => s.updateLayer);
  const addLayerToScene = useProjectStore((s) => s.addLayerToScene);
  const updateSceneDuration = useProjectStore((s) => s.updateSceneDuration);
  const updateScene = useProjectStore((s) => s.updateScene);

  const sortedLayers = [...scene.layers].sort((a, b) => b.zIndex - a.zIndex);
  const hasVideo = scene.layers.some((l) => l.type === 'video');

  function moveLayer(target: Layer, direction: 'front' | 'back') {
    const result = stepZIndexPatches(scene.layers, target, direction === 'front' ? 'forward' : 'backward');
    if (!result) return;
    updateLayer(scene.id, target.id, result.targetPatch);
    updateLayer(scene.id, result.neighborId, result.neighborPatch);
  }

  function handleShotDateChange(value: string) {
    if (!value) return;
    const [y, m, d] = value.split('-').map(Number);
    // 時刻部分は元の値があれば維持する(同日内の並び順をなるべく変えないため)
    const prev = scene.shotDate ? new Date(scene.shotDate) : null;
    const hasPrevTime = prev && !Number.isNaN(prev.getTime());
    const next = new Date(y, m - 1, d, hasPrevTime ? prev.getHours() : 0, hasPrevTime ? prev.getMinutes() : 0, hasPrevTime ? prev.getSeconds() : 0);
    updateScene(scene.id, { shotDate: next.toISOString() });
  }

  return (
    <div className="panel inspector">
      <h2>設定</h2>
      <div className="inspector__section">
        <label>
          シーンの長さ (秒)
          <NumberField
            min={0.5}
            step={0.5}
            value={scene.duration / 1000}
            onChange={(v) => updateSceneDuration(scene.id, Math.max(500, v * 1000))}
          />
        </label>
        {(hasVideo || scene.shotDate) && (
          <label>
            撮影日(並び替え・日付焼き込みに使用)
            <input
              type="date"
              value={shotDateInputValue(scene.shotDate)}
              onChange={(e) => handleShotDateChange(e.target.value)}
            />
          </label>
        )}
      </div>

      <div className="inspector__section">
        <div className="insert-rail">
          <button className="insert-rail__button" onClick={onOpenMedia}>
            <UploadIcon size={20} />
            <span>アップロード</span>
          </button>
          <button className="insert-rail__button" onClick={onQuickInsertImage}>
            <ImageIcon size={20} />
            <span>画像</span>
          </button>
          <button className="insert-rail__button" onClick={() => addLayerToScene(scene.id, createShapeLayer(scene))}>
            <ShapeIcon size={20} />
            <span>図形</span>
          </button>
          <button className="insert-rail__button" onClick={() => addLayerToScene(scene.id, createTextLayer(scene))}>
            <TextIcon size={20} />
            <span>テキスト</span>
          </button>
          <button className="insert-rail__button" onClick={onAddCaption}>
            <CaptionIcon size={20} />
            <span>字幕</span>
          </button>
        </div>
        {sortedLayers.length > 0 && (
          <ul className="layer-list">
            {sortedLayers.map((l, i) => (
              <li key={l.id} className={`layer-list__item${selectedLayerIds.includes(l.id) ? ' is-selected' : ''}`}>
                <button
                  className="layer-list__select"
                  onClick={(e) => selectLayer(l.id, { additive: e.shiftKey })}
                >
                  {layerLabel(l)}
                </button>
                <button title="前面へ" disabled={i === 0} onClick={() => moveLayer(l, 'front')}>
                  ▲
                </button>
                <button title="背面へ" disabled={i === sortedLayers.length - 1} onClick={() => moveLayer(l, 'back')}>
                  ▼
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
