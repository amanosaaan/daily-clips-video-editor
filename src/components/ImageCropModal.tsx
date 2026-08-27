import { useEffect, useRef, useState } from 'react';
import type { ImageLayer, VideoLayer } from '../domain/types';
import { getMediaObjectUrl } from '../storage/mediaRepository';
import { CloseIcon } from './icons';

interface Props {
  layer: ImageLayer | VideoLayer;
  onConfirm: (crop: { x: number; y: number; width: number; height: number }) => void;
  onCancel: () => void;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_CROP_PX = 24;

type DragMode = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

function pointFromEvent(e: MouseEvent | TouchEvent): { x: number; y: number } {
  if ('touches' in e && e.touches.length > 0) {
    return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  if ('changedTouches' in e && e.changedTouches.length > 0) {
    return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  }
  const me = e as MouseEvent;
  return { x: me.clientX, y: me.clientY };
}

export function ImageCropModal({ layer, onConfirm, onCancel }: Props) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [imgSize, setImgSize] = useState<{ width: number; height: number } | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [maxDisplay, setMaxDisplay] = useState(560);
  const dragRef = useRef<{ mode: DragMode; startX: number; startY: number; startRect: Rect } | null>(null);

  useEffect(() => {
    function updateMaxDisplay() {
      setMaxDisplay(Math.max(200, Math.min(560, window.innerWidth - 64)));
    }
    updateMaxDisplay();
    window.addEventListener('resize', updateMaxDisplay);
    return () => window.removeEventListener('resize', updateMaxDisplay);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getMediaObjectUrl(layer.mediaId).then((url) => {
      if (!cancelled && url) setImgUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [layer.mediaId]);

  function applyNaturalSize(naturalW: number, naturalH: number) {
    if (!naturalW || !naturalH) return;
    const scale = Math.min(maxDisplay / naturalW, maxDisplay / naturalH, 1);
    const width = naturalW * scale;
    const height = naturalH * scale;
    setImgSize({ width, height });
    const crop = layer.crop ?? { x: 0, y: 0, width: 1, height: 1 };
    setRect({ x: crop.x * width, y: crop.y * height, width: crop.width * width, height: crop.height * height });
  }

  function handleImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    applyNaturalSize(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight);
  }

  function handleVideoLoadedData(e: React.SyntheticEvent<HTMLVideoElement>) {
    const video = e.currentTarget;
    // 実際に動画で使っているトリム開始位置のフレームを表示する(先頭が真っ黒/無地な
    // 動画でも、トリミング対象として分かりやすいフレームになるようにする)。
    if (layer.type === 'video') {
      const seekSec = layer.trimStart / 1000;
      if (Number.isFinite(seekSec) && seekSec > 0 && seekSec < (video.duration || 0)) {
        video.currentTime = seekSec;
        return;
      }
    }
    applyNaturalSize(video.videoWidth, video.videoHeight);
  }

  function handleVideoSeeked(e: React.SyntheticEvent<HTMLVideoElement>) {
    applyNaturalSize(e.currentTarget.videoWidth, e.currentTarget.videoHeight);
  }

  useEffect(() => {
    function handleMove(e: MouseEvent | TouchEvent) {
      const drag = dragRef.current;
      if (!drag || !imgSize) return;
      if ('touches' in e) e.preventDefault();
      const p = pointFromEvent(e);
      const dx = p.x - drag.startX;
      const dy = p.y - drag.startY;
      setRect(() => clampRect(applyDrag(drag.mode, drag.startRect, dx, dy), imgSize));
    }
    function handleEnd() {
      dragRef.current = null;
    }
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleEnd);
    window.addEventListener('touchcancel', handleEnd);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
      window.removeEventListener('touchcancel', handleEnd);
    };
  }, [imgSize]);

  function startDrag(mode: DragMode) {
    return (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!rect) return;
      const p = pointFromEvent(e.nativeEvent);
      dragRef.current = { mode, startX: p.x, startY: p.y, startRect: rect };
    };
  }

  function handleConfirm() {
    if (!rect || !imgSize) return;
    onConfirm({
      x: rect.x / imgSize.width,
      y: rect.y / imgSize.height,
      width: rect.width / imgSize.width,
      height: rect.height / imgSize.height,
    });
  }

  return (
    <div className="crop-modal__backdrop" onClick={onCancel}>
      <div className="crop-modal" onClick={(e) => e.stopPropagation()}>
        <div className="crop-modal__header">
          <h2>トリミング</h2>
          <button className="btn-icon" onClick={onCancel} aria-label="閉じる">
            <CloseIcon />
          </button>
        </div>
        <div className="crop-modal__body">
          {imgUrl && (
            <div className="crop-modal__stage" style={imgSize ? { width: imgSize.width, height: imgSize.height } : undefined}>
              {layer.type === 'video' ? (
                <video
                  src={imgUrl}
                  muted
                  playsInline
                  preload="auto"
                  onLoadedData={handleVideoLoadedData}
                  onSeeked={handleVideoSeeked}
                />
              ) : (
                // eslint-disable-next-line jsx-a11y/alt-text
                <img src={imgUrl} onLoad={handleImageLoad} draggable={false} />
              )}
              {rect && imgSize && (
                <>
                  <div className="crop-modal__mask" style={{ clipPath: maskClipPath(rect) }} />
                  <div
                    className="crop-modal__rect"
                    style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
                    onMouseDown={startDrag('move')}
                    onTouchStart={startDrag('move')}
                  >
                    {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as DragMode[]).map((h) => (
                      <div
                        key={h}
                        className={`crop-modal__handle crop-modal__handle--${h}`}
                        onMouseDown={startDrag(h)}
                        onTouchStart={startDrag(h)}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <div className="crop-modal__footer">
          <button className="btn-pill" onClick={onCancel}>
            キャンセル
          </button>
          <button className="btn-pill btn-pill--primary" onClick={handleConfirm}>
            完了
          </button>
        </div>
      </div>
    </div>
  );
}

function applyDrag(mode: DragMode, start: Rect, dx: number, dy: number): Rect {
  let { x, y, width, height } = start;
  if (mode === 'move') {
    x += dx;
    y += dy;
    return { x, y, width, height };
  }
  if (mode.includes('n')) {
    y += dy;
    height -= dy;
  }
  if (mode.includes('s')) {
    height += dy;
  }
  if (mode.includes('w')) {
    x += dx;
    width -= dx;
  }
  if (mode.includes('e')) {
    width += dx;
  }
  return { x, y, width, height };
}

function clampRect(rect: Rect, bounds: { width: number; height: number }): Rect {
  let { x, y, width, height } = rect;
  width = Math.max(MIN_CROP_PX, width);
  height = Math.max(MIN_CROP_PX, height);
  x = Math.max(0, Math.min(x, bounds.width - width));
  y = Math.max(0, Math.min(y, bounds.height - height));
  width = Math.min(width, bounds.width - x);
  height = Math.min(height, bounds.height - y);
  return { x, y, width, height };
}

function maskClipPath(rect: Rect): string {
  const x1 = rect.x;
  const y1 = rect.y;
  const x2 = rect.x + rect.width;
  const y2 = rect.y + rect.height;
  return `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 ${y1}px, ${x1}px ${y1}px, ${x1}px ${y2}px, ${x2}px ${y2}px, ${x2}px ${y1}px, 0 ${y1}px)`;
}
