import type { ReactNode } from 'react';
import { CloseIcon } from './icons';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** タイトルと閉じるボタンの間に表示する追加コントロール（複数選択トグルなど） */
  headerExtra?: ReactNode;
  /** 動画プレビューにかからない範囲で計算した最大高さ(px)。未指定ならCSSの既定値を使う */
  maxHeightPx?: number;
}

export function BottomSheet({ title, onClose, children, headerExtra, maxHeightPx }: Props) {
  return (
    <div className="mobile-sheet__backdrop" onClick={onClose}>
      <div
        className="mobile-sheet"
        onClick={(e) => e.stopPropagation()}
        style={maxHeightPx ? { maxHeight: maxHeightPx } : undefined}
      >
        <div className="mobile-sheet__header">
          <h2>{title}</h2>
          <div className="mobile-sheet__header-actions">
            {headerExtra}
            <button className="mobile-icon-btn" onClick={onClose} aria-label="閉じる">
              <CloseIcon size={18} />
            </button>
          </div>
        </div>
        <div className="mobile-sheet__body">{children}</div>
      </div>
    </div>
  );
}
