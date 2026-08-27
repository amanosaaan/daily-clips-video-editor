import { useEffect, useRef } from 'react';
import { Circle, Group, Rect, Transformer } from 'react-konva';
import type Konva from 'konva';
import type { Layer } from '../domain/types';

interface Props {
  layer: Layer;
  scale: number;
  isSelected: boolean;
  onSelect: (additive: boolean) => void;
  onChange: (patch: { x: number; y: number; width: number; height: number; rotation: number }) => void;
  onSkewChange?: (patch: { skewX: number; skewY: number }) => void;
  onDoubleClick?: () => void;
  hidden?: boolean;
}

const MIN_SIZE = 10;
const SKEW_HANDLE_OFFSET = 20;
const MAX_SKEW_DEG = 70;
const SNAP_ANGLES = [-60, -45, -30, -15, 0, 15, 30, 45, 60];
const SNAP_TOLERANCE_DEG = 4;
const ROTATION_SNAPS = Array.from({ length: 24 }, (_, i) => i * 15);

function clampSkew(deg: number): number {
  return Math.max(-MAX_SKEW_DEG, Math.min(MAX_SKEW_DEG, deg));
}

/** キリのいい角度に近ければピタッと吸着させる（ちょっとカクッと止まる感触を出す） */
function snapAngle(deg: number): number {
  let closest = deg;
  let minDiff = SNAP_TOLERANCE_DEG;
  for (const snap of SNAP_ANGLES) {
    const diff = Math.abs(deg - snap);
    if (diff < minDiff) {
      minDiff = diff;
      closest = snap;
    }
  }
  return closest;
}

export function LayerOverlayNode({ layer, scale, isSelected, onSelect, onChange, onSkewChange, onDoubleClick, hidden }: Props) {
  const shapeRef = useRef<Konva.Rect>(null);
  const trRef = useRef<Konva.Transformer>(null);

  useEffect(() => {
    if (isSelected && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected]);

  const scaledWidth = layer.width * scale;
  const scaledHeight = layer.height * scale;

  if (hidden) return null;

  return (
    <>
      <Rect
        ref={shapeRef}
        // compositor.ts はレイヤーの中心を軸に回転させる（layer.x/y は常に「未回転時の左上」）ため、
        // Konva側もオフセットを中心に合わせて同じ回転軸で動くようにする。ここを揃えないと、
        // 回転させたときに選択枠と実際の描画結果の位置がずれてしまう。
        x={(layer.x + layer.width / 2) * scale}
        y={(layer.y + layer.height / 2) * scale}
        offsetX={scaledWidth / 2}
        offsetY={scaledHeight / 2}
        width={scaledWidth}
        height={scaledHeight}
        rotation={layer.rotation}
        fill="rgba(255,255,255,0.001)"
        stroke={isSelected ? '#1a73e8' : undefined}
        strokeWidth={isSelected ? 2 : 0}
        draggable
        onClick={(e) => onSelect(e.evt.shiftKey)}
        onTap={(e) => onSelect('shiftKey' in e.evt && e.evt.shiftKey)}
        onDblClick={onDoubleClick}
        onDblTap={onDoubleClick}
        onDragEnd={(e) => {
          const node = e.target;
          onChange({
            x: node.x() / scale - layer.width / 2,
            y: node.y() / scale - layer.height / 2,
            width: layer.width,
            height: layer.height,
            rotation: layer.rotation,
          });
        }}
        onTransformEnd={() => {
          const node = shapeRef.current;
          if (!node) return;
          const scaleX = node.scaleX();
          const scaleY = node.scaleY();
          node.scaleX(1);
          node.scaleY(1);
          const newWidth = Math.max(MIN_SIZE, node.width() * scaleX) / scale;
          const newHeight = Math.max(MIN_SIZE, node.height() * scaleY) / scale;
          onChange({
            x: node.x() / scale - newWidth / 2,
            y: node.y() / scale - newHeight / 2,
            width: newWidth,
            height: newHeight,
            rotation: node.rotation(),
          });
        }}
      />
      {isSelected && (
        <Transformer
          ref={trRef}
          // モザイクは回転させると「読み戻す画面上の矩形範囲」の計算が複雑になるため、
          // Python版と同じく常に軸並行(回転なし)に限定する(compositor.tsのdrawMosaic参照)。
          rotateEnabled={layer.type !== 'mosaic'}
          flipEnabled={false}
          borderStroke="#1a73e8"
          borderStrokeWidth={2}
          anchorSize={10}
          anchorCornerRadius={5}
          anchorFill="#ffffff"
          anchorStroke="#1a73e8"
          anchorStrokeWidth={2}
          rotateAnchorOffset={28}
          rotationSnaps={ROTATION_SNAPS}
          rotationSnapTolerance={5}
          anchorStyleFunc={(anchorNode) => {
            if (anchorNode.hasName('rotater')) {
              anchorNode.fill('#1a73e8');
              anchorNode.stroke('#ffffff');
              anchorNode.strokeWidth(2);
              anchorNode.width(20);
              anchorNode.height(20);
              anchorNode.offsetX(10);
              anchorNode.offsetY(10);
              anchorNode.cornerRadius(10);
            }
          }}
          boundBoxFunc={(oldBox, newBox) =>
            newBox.width < MIN_SIZE || newBox.height < MIN_SIZE ? oldBox : newBox
          }
        />
      )}
      {isSelected && layer.type === 'text' && onSkewChange && (() => {
        const halfW = scaledWidth / 2;
        const halfH = scaledHeight / 2;
        const skewXRad = ((layer.skewX ?? 0) * Math.PI) / 180;
        const skewYRad = ((layer.skewY ?? 0) * Math.PI) / 180;
        const topHandleX = halfW - Math.tan(skewXRad) * (halfH + SKEW_HANDLE_OFFSET);
        const sideHandleY = halfH + Math.tan(skewYRad) * (halfW + SKEW_HANDLE_OFFSET);
        const currentSkewX = layer.skewX ?? 0;
        const currentSkewY = layer.skewY ?? 0;
        return (
          <Group
            x={(layer.x + layer.width / 2) * scale}
            y={(layer.y + layer.height / 2) * scale}
            offsetX={halfW}
            offsetY={halfH}
            rotation={layer.rotation}
          >
            {/* 上辺のハンドル：横方向にドラッグして水平シアー(skewX)を調整 */}
            <Circle
              x={topHandleX}
              y={-SKEW_HANDLE_OFFSET}
              radius={6}
              fill="#1a73e8"
              stroke="#ffffff"
              strokeWidth={1.5}
              draggable
              onDragMove={(e) => {
                const node = e.target;
                const rawDeg = (Math.atan2(halfW - node.x(), halfH + SKEW_HANDLE_OFFSET) * 180) / Math.PI;
                const snappedDeg = clampSkew(snapAngle(rawDeg));
                node.x(halfW - Math.tan((snappedDeg * Math.PI) / 180) * (halfH + SKEW_HANDLE_OFFSET));
                node.y(-SKEW_HANDLE_OFFSET);
              }}
              onDragEnd={(e) => {
                const node = e.target;
                const rawDeg = (Math.atan2(halfW - node.x(), halfH + SKEW_HANDLE_OFFSET) * 180) / Math.PI;
                const deg = clampSkew(snapAngle(rawDeg));
                onSkewChange({ skewX: deg, skewY: currentSkewY });
              }}
            />
            {/* 右辺のハンドル：縦方向にドラッグして垂直シアー(skewY)を調整 */}
            <Circle
              x={scaledWidth + SKEW_HANDLE_OFFSET}
              y={sideHandleY}
              radius={6}
              fill="#1a73e8"
              stroke="#ffffff"
              strokeWidth={1.5}
              draggable
              onDragMove={(e) => {
                const node = e.target;
                const rawDeg = (Math.atan2(node.y() - halfH, halfW + SKEW_HANDLE_OFFSET) * 180) / Math.PI;
                const snappedDeg = clampSkew(snapAngle(rawDeg));
                node.x(scaledWidth + SKEW_HANDLE_OFFSET);
                node.y(halfH + Math.tan((snappedDeg * Math.PI) / 180) * (halfW + SKEW_HANDLE_OFFSET));
              }}
              onDragEnd={(e) => {
                const node = e.target;
                const rawDeg = (Math.atan2(node.y() - halfH, halfW + SKEW_HANDLE_OFFSET) * 180) / Math.PI;
                const deg = clampSkew(snapAngle(rawDeg));
                onSkewChange({ skewX: currentSkewX, skewY: deg });
              }}
            />
          </Group>
        );
      })()}
    </>
  );
}
