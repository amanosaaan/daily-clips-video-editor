import type { AnimationConfig, PhotoFilter } from '../domain/types';
import { NumberField } from './NumberField';

const ANIMATION_GROUPS: { label: string; types: AnimationConfig['type'][] }[] = [
  { label: 'ループ', types: ['pulse', 'spin', 'hover', 'shake', 'bounce'] },
  { label: '登場', types: ['pop', 'rise', 'typewriter'] },
];

const ANIMATION_LABELS: Record<AnimationConfig['type'], string> = {
  pulse: 'パルス',
  spin: '回転',
  hover: 'ふわふわ',
  shake: 'シェイク',
  bounce: 'バウンド',
  pop: 'ポップ',
  rise: 'ライズ',
  typewriter: 'タイプライター',
};

/** ループ系は「1周期の長さ」、登場系は「登場にかかる時間」を表す。ラベルを出し分ける。 */
const ENTRANCE_TYPES: AnimationConfig['type'][] = ['pop', 'rise', 'typewriter'];
/** 詳細調整(強さ)が意味を持たないアニメーション種別。 */
const NO_INTENSITY_TYPES: AnimationConfig['type'][] = ['spin', 'typewriter'];

export function AnimationControl({
  animation,
  onChange,
}: {
  animation: AnimationConfig | undefined;
  onChange: (animation: AnimationConfig | undefined) => void;
}) {
  const isEntrance = animation ? ENTRANCE_TYPES.includes(animation.type) : false;
  const showIntensity = animation ? !NO_INTENSITY_TYPES.includes(animation.type) : false;
  return (
    <div className="context-toolbar__group">
      <label>
        アニメーション
        <select
          value={animation?.type ?? 'none'}
          onChange={(e) => {
            const value = e.target.value;
            onChange(
              value === 'none'
                ? undefined
                : {
                    type: value as AnimationConfig['type'],
                    durationMs: animation?.durationMs ?? (ENTRANCE_TYPES.includes(value as AnimationConfig['type']) ? 600 : 1500),
                    intensity: animation?.intensity ?? 50,
                  },
            );
          }}
        >
          <option value="none">なし</option>
          {ANIMATION_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.types.map((type) => (
                <option key={type} value={type}>
                  {ANIMATION_LABELS[type]}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {animation && (
        <label>
          {isEntrance ? '登場の速さ(秒)' : '周期(秒)'}
          <NumberField
            min={0.1}
            step={0.1}
            value={animation.durationMs / 1000}
            onChange={(v) => onChange({ ...animation, durationMs: Math.max(100, v * 1000) })}
          />
        </label>
      )}
      {animation && showIntensity && (
        <label>
          強さ ({animation.intensity ?? 50}%)
          <input
            type="range"
            min={0}
            max={100}
            value={animation.intensity ?? 50}
            onChange={(e) => onChange({ ...animation, intensity: Number(e.target.value) })}
          />
        </label>
      )}
    </div>
  );
}

export function PhotoFilterControl({
  filter,
  onChange,
}: {
  filter: PhotoFilter | undefined;
  onChange: (filter: PhotoFilter) => void;
}) {
  const current = filter ?? { brightness: 100, contrast: 100 };
  return (
    <div className="context-toolbar__group">
      <label>
        明るさ ({current.brightness}%)
        <input
          type="range"
          min={40}
          max={160}
          value={current.brightness}
          onChange={(e) => onChange({ ...current, brightness: Number(e.target.value) })}
        />
      </label>
      <label>
        コントラスト ({current.contrast}%)
        <input
          type="range"
          min={40}
          max={160}
          value={current.contrast}
          onChange={(e) => onChange({ ...current, contrast: Number(e.target.value) })}
        />
      </label>
    </div>
  );
}
