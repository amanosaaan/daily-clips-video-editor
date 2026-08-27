import { useState } from 'react';
import { addRecentColor, getRecentColors } from '../state/recentColors';

interface Props {
  value: string;
  onChange: (color: string) => void;
  title?: string;
}

/**
 * カラーピッカー(<input type="color">)に、最近使った色(最大5件、全ピッカー共通)の
 * スウォッチ列を添えたもの。Python版の「最近使用した色」パネルのWeb版。
 */
export function ColorSwatchInput({ value, onChange, title }: Props) {
  const [recent, setRecent] = useState(getRecentColors);

  function commit(color: string) {
    onChange(color);
    setRecent(addRecentColor(color));
  }

  return (
    <div className="color-swatch-input">
      <input
        className="context-toolbar__swatch"
        type="color"
        title={title}
        value={value}
        onChange={(e) => commit(e.target.value)}
      />
      {recent.length > 0 && (
        <div className="color-swatch-input__recents">
          {recent.map((color) => (
            <button
              key={color}
              type="button"
              className="color-swatch-input__recent"
              style={{ background: color }}
              title={color}
              onClick={() => commit(color)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
