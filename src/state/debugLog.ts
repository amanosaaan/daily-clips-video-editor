// Mac無しでもスマホ実機のエラーを確認できるようにするための、簡易デバッグログ。
// console.error/console.warn呼び出しと、未捕捉の例外/Promise拒否を横取りして記録し、
// DebugLogPanel.tsxで画面上に表示する(devtools/Web Inspectorが使えない環境向け)。

export interface DebugLogEntry {
  id: string;
  timestamp: number;
  level: 'error' | 'warn';
  message: string;
}

type Listener = (entries: DebugLogEntry[]) => void;

const MAX_ENTRIES = 200;

let entries: DebugLogEntry[] = [];
const listeners = new Set<Listener>();
let nextId = 0;

function formatArg(arg: unknown): string {
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  if (typeof arg === 'string') return arg;
  if (arg === undefined) return 'undefined';
  try {
    return JSON.stringify(
      arg,
      (_key, value: unknown) => {
        if (value instanceof Error) return { name: value.name, message: value.message };
        return value;
      },
      2,
    );
  } catch {
    return String(arg);
  }
}

function addEntry(level: 'error' | 'warn', args: unknown[]): void {
  const message = args.map(formatArg).join(' ');
  const entry: DebugLogEntry = { id: String(nextId++), timestamp: Date.now(), level, message };
  entries = [...entries, entry].slice(-MAX_ENTRIES);
  listeners.forEach((l) => l(entries));
}

export function getDebugLogEntries(): DebugLogEntry[] {
  return entries;
}

export function subscribeDebugLog(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearDebugLog(): void {
  entries = [];
  listeners.forEach((l) => l(entries));
}

let installed = false;

/** アプリ起動時に一度だけ呼び出す。console.error/warnと未捕捉エラーの横取りを開始する。 */
export function installDebugLogCapture(): void {
  if (installed) return;
  installed = true;

  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    origError(...args);
    addEntry('error', args);
  };

  const origWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    origWarn(...args);
    addEntry('warn', args);
  };

  window.addEventListener('error', (event) => {
    addEntry('error', [`未捕捉のエラー: ${event.message}`, event.error]);
  });
  window.addEventListener('unhandledrejection', (event) => {
    addEntry('error', ['未処理のPromise拒否:', event.reason]);
  });
}
