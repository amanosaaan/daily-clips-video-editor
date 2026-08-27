import { useEffect, useRef, useState, type RefObject } from 'react';
import { Layer as KonvaLayer, Stage } from 'react-konva';
import type Konva from 'konva';
import type { Project, TextLayer } from '../domain/types';
import type { ProjectPlaybackEngine } from '../rendering/useProjectPlaybackEngine';
import { useProjectStore } from '../state/projectStore';
import { LayerOverlayNode } from './LayerOverlayNode';

const MAX_DISPLAY_WIDTH = 640;
const MIN_DISPLAY_WIDTH = 160;

interface Props {
  project: Project;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  engine: ProjectPlaybackEngine;
  onOpenCrop: (layerId: string) => void;
  /** スマホ等、shiftキーが無い環境向けの複数選択モード。trueの間は追加選択になる。 */
  multiSelectMode?: boolean;
}

function InlineTextEditor({
  layer,
  scale,
  onCommit,
}: {
  layer: TextLayer;
  scale: number;
  onCommit: (content: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  return (
    <textarea
      ref={textareaRef}
      className="inline-text-editor"
      defaultValue={layer.content}
      style={{
        left: (layer.x + layer.width / 2) * scale,
        top: (layer.y + layer.height / 2) * scale,
        width: layer.width * scale,
        height: layer.height * scale,
        transform: `translate(-50%, -50%) rotate(${layer.rotation}deg)`,
        fontFamily: layer.fontFamily,
        fontSize: layer.fontSize * scale,
        fontWeight: layer.fontWeight,
        color: layer.color,
        textAlign: layer.align,
      }}
      onBlur={(e) => onCommit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export function PreviewPanel({ project, canvasRef, engine, onOpenCrop, multiSelectMode }: Props) {
  const updateLayer = useProjectStore((s) => s.updateLayer);
  const selectLayer = useProjectStore((s) => s.selectLayer);
  const selectedLayerIds = useProjectStore((s) => s.selectedLayerIds);
  const [editingTextLayerId, setEditingTextLayerId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [displayWidth, setDisplayWidth] = useState(MAX_DISPLAY_WIDTH);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function measure() {
      if (!el) return;
      const width = el.getBoundingClientRect().width;
      if (width > 0) setDisplayWidth(Math.max(MIN_DISPLAY_WIDTH, Math.min(MAX_DISPLAY_WIDTH, width)));
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const scale = displayWidth / project.resolution.width;
  const displayHeight = project.resolution.height * scale;
  const scene = engine.position?.scene ?? null;

  const interactiveLayers = scene
    ? scene.layers.filter(
        (l) => l.type === 'text' || l.type === 'shape' || l.type === 'mosaic' || l.type === 'image' || l.type === 'video',
      )
    : [];
  const editingLayer = editingTextLayerId
    ? (interactiveLayers.find((l) => l.id === editingTextLayerId) as TextLayer | undefined)
    : undefined;

  useEffect(() => {
    // シーン切り替えなどでレイヤーが無くなったら編集状態を解除する
    if (editingTextLayerId && !editingLayer) {
      setEditingTextLayerId(null);
      engine.setHiddenLayerId(null);
    }
  }, [editingTextLayerId, editingLayer, engine]);

  function startEditing(layerId: string) {
    setEditingTextLayerId(layerId);
    engine.setHiddenLayerId(layerId);
  }

  function commitEditing(content: string) {
    if (scene && editingTextLayerId) updateLayer(scene.id, editingTextLayerId, { content });
    setEditingTextLayerId(null);
    engine.setHiddenLayerId(null);
  }

  function handleStageMouseDown(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (e.target === e.target.getStage()) selectLayer(null);
  }

  return (
    <div className="scene-preview" ref={containerRef}>
      <div className="scene-preview__stage" style={{ width: displayWidth, height: displayHeight }}>
        <canvas
          ref={canvasRef}
          width={project.resolution.width}
          height={project.resolution.height}
          style={{ width: displayWidth, height: displayHeight }}
        />
        <div className="scene-preview__overlay">
          <Stage width={displayWidth} height={displayHeight} onMouseDown={handleStageMouseDown} onTouchStart={handleStageMouseDown}>
            <KonvaLayer>
              {interactiveLayers.map((layer) => (
                <LayerOverlayNode
                  key={layer.id}
                  layer={layer}
                  scale={scale}
                  isSelected={selectedLayerIds.includes(layer.id)}
                  hidden={layer.id === editingTextLayerId}
                  onSelect={(additive) => selectLayer(layer.id, { additive: additive || !!multiSelectMode })}
                  onChange={(patch) => scene && updateLayer(scene.id, layer.id, patch)}
                  onSkewChange={(patch) => scene && updateLayer(scene.id, layer.id, patch)}
                  onDoubleClick={() => {
                    if (layer.type === 'text') startEditing(layer.id);
                    else if (layer.type === 'image' || layer.type === 'video') onOpenCrop(layer.id);
                  }}
                />
              ))}
            </KonvaLayer>
          </Stage>
          {editingLayer && <InlineTextEditor layer={editingLayer} scale={scale} onCommit={commitEditing} />}
        </div>
      </div>
    </div>
  );
}
