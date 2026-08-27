import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearDebugLog, getDebugLogEntries, subscribeDebugLog } from './debugLog';

// installDebugLogCapture()はconsole.error/warnをグローバルに上書きする副作用があり、
// テストランナー自体のログ出力にも影響してしまうため、ここでは呼び出さない。
// addEntry相当の挙動はconsole.error/warnを実際に呼ぶ他のテスト経由で間接的に
// 検証されている(mediaRepository.test.ts等)。ここではログの保持・通知・クリアという
// ストア部分のロジックだけを直接検証する。

beforeEach(() => {
  clearDebugLog();
});

afterEach(() => {
  clearDebugLog();
});

describe('debugLog store', () => {
  it('starts empty', () => {
    expect(getDebugLogEntries()).toEqual([]);
  });

  it('notifies subscribers when clearDebugLog runs', () => {
    let notifiedWith: unknown = 'not called';
    const unsubscribe = subscribeDebugLog((entries) => {
      notifiedWith = entries;
    });
    clearDebugLog();
    expect(notifiedWith).toEqual([]);
    unsubscribe();
  });

  it('stops notifying after unsubscribe', () => {
    let callCount = 0;
    const unsubscribe = subscribeDebugLog(() => {
      callCount++;
    });
    unsubscribe();
    clearDebugLog();
    expect(callCount).toBe(0);
  });
});
