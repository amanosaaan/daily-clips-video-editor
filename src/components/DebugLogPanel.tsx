import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { clearDebugLog, getDebugLogEntries, subscribeDebugLog } from '../state/debugLog';
import { BugIcon, CloseIcon, CopyIcon, TrashIcon } from './icons';

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/**
 * Mac/devtoolsが無い環境(主にスマホ実機)でも不具合の原因を伝えられるようにするための、
 * 画面上に常駐する簡易デバッグログ。console.error/warnや未捕捉のエラーを表示し、
 * その場でスクリーンショットを撮って共有してもらう、またはコピーして貼ってもらうことを想定。
 * 常時右下に小さく浮かせておき、新しいログが増えると件数バッジで気づけるようにする。
 */
export function DebugLogPanel() {
  const entries = useSyncExternalStore(subscribeDebugLog, getDebugLogEntries);
  const [isOpen, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // refではなくstateにする(refの書き換えだけでは再レンダーされず、開いた直後も
  // バッジの表示が古いまま残ってしまうため)。
  const [lastSeenCount, setLastSeenCount] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) setLastSeenCount(entries.length);
  }, [isOpen, entries.length]);

  useEffect(() => {
    if (isOpen && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [isOpen, entries.length]);

  const unreadCount = Math.max(0, entries.length - lastSeenCount);

  async function handleCopyAll() {
    const text = entries.map((e) => `[${formatTime(e.timestamp)}] ${e.level.toUpperCase()}: ${e.message}`).join('\n\n');
    try {
      await navigator.clipboard.writeText(text || '(ログはまだありません)');
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // クリップボードAPIが使えない環境では何もしない(スクリーンショットで代替してもらう)
    }
  }

  return (
    <>
      <button
        type="button"
        className="debug-log__fab"
        onClick={() => setOpen((v) => !v)}
        aria-label="デバッグログを表示"
        title="デバッグログを表示"
      >
        <BugIcon size={18} />
        {unreadCount > 0 && <span className="debug-log__badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>
      {isOpen && (
        <div className="debug-log__panel">
          <div className="debug-log__header">
            <h2>デバッグログ</h2>
            <button className="btn-icon" onClick={() => setOpen(false)} aria-label="閉じる">
              <CloseIcon />
            </button>
          </div>
          <div className="debug-log__body" ref={bodyRef}>
            {entries.length === 0 ? (
              <p className="debug-log__empty">まだエラーは記録されていません。</p>
            ) : (
              entries.map((entry) => (
                <div key={entry.id} className={`debug-log__entry debug-log__entry--${entry.level}`}>
                  <div className="debug-log__entry-meta">
                    <span>{formatTime(entry.timestamp)}</span>
                    <span>{entry.level === 'error' ? 'ERROR' : 'WARN'}</span>
                  </div>
                  <pre className="debug-log__entry-message">{entry.message}</pre>
                </div>
              ))
            )}
          </div>
          <div className="debug-log__actions">
            <button className="btn-pill" onClick={() => void handleCopyAll()}>
              <CopyIcon size={14} /> {copied ? 'コピーしました' : '全部コピー'}
            </button>
            <button className="btn-pill" onClick={clearDebugLog}>
              <TrashIcon size={14} /> クリア
            </button>
          </div>
        </div>
      )}
    </>
  );
}
