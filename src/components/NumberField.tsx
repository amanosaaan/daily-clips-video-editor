import { useEffect, useRef, useState } from 'react';

interface Props {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}

/**
 * <input type="number"> は value を外部状態に直結すると、入力途中の値が
 * clamp・再フォーマットされて上書きされ、自由に打鍵できなくなる。
 * ローカルにテキストを保持し、blur/Enter 時にだけ範囲を確定させる。
 */
export function NumberField({ value, onChange, min, max, step, className }: Props) {
  const [text, setText] = useState(String(value));
  const lastCommitted = useRef(value);

  useEffect(() => {
    if (value !== lastCommitted.current) {
      setText(String(value));
      lastCommitted.current = value;
    }
  }, [value]);

  function handleChange(raw: string) {
    setText(raw);
    const parsed = Number(raw);
    if (raw.trim() !== '' && !Number.isNaN(parsed)) {
      lastCommitted.current = parsed;
      onChange(parsed);
    }
  }

  function handleBlur() {
    let parsed = Number(text);
    if (Number.isNaN(parsed)) parsed = value;
    if (min !== undefined) parsed = Math.max(min, parsed);
    if (max !== undefined) parsed = Math.min(max, parsed);
    setText(String(parsed));
    lastCommitted.current = parsed;
    onChange(parsed);
  }

  return (
    <input
      className={className}
      type="number"
      value={text}
      min={min}
      max={max}
      step={step}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}
