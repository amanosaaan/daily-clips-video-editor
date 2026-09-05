/**
 * iOS/WebKit実機では、複数の<video>/<audio>要素が「同時に」実際のデコード
 * (loadeddataを待つ=preload/play()で本当のデータ取得・デコードを要求する処理)を
 * 試みると、そのうちの一部、あるいは全部がloadeddata/errorのどちらも永久に
 * 発火しなくなることが実機のデバッグログで繰り返し確認されている
 * (サムネイル生成とプレビュー用先読みのタイムアウトが同一タイムスタンプで
 * 重なって出る、というログパターンが一貫していた)。
 *
 * 個々の要素の配置(画面内/外)やpreload属性の与え方、後片付けの手順を色々
 * 変えても再現し続けたことから、原因は端末側のデコーダー同時使用数の制限
 * (小さい、あるいは実質排他的)である可能性が高い。そのため、アプリ全体で
 * 「本当のデコードを要する読み込み」は常に1本ずつ直列に実行するようにする。
 *
 * 対象はloadeddata(またはそれに類する、実データが必要なイベント)を待つ処理のみ。
 * loadedmetadataだけを待つ処理(moovボックスの解析のみで済み、実機のログ上も
 * 一貫して高速・安定していた)はこのキューを通す必要はない。
 */
// 呼び出し元(mediaRepository.ts/useProjectPlaybackEngine.ts/exportPipeline.ts)は
// 各タスク自身に(せいぜい数十秒の)タイムアウトを掛けているが、それでも稀に
// タイムアウトの仕組みを持たない、あるいはタイムアウト自体が機能しない経路で
// タスクが永久に解決しないことがあり得る。この場合、下のqueueがそのタスクの
// 完了を待ち続けたままになり、以降にこのキューを使う「全ての」タスク(取り込み・
// プレビュー先読み・書き出しなど)が無期限に足止めされてしまう
// (実機で「書き出しボタンを押しても進捗0%のまま1時間以上動かない」不具合として
// 確認された)。そのため、個々のタスクの完了を待たずとも、一定時間経過したら
// キュー自体は強制的に先へ進めるようにする(その間だけ一時的に「排他」が崩れる
// ことになるが、永久デッドロックよりは遥かにまし)。
const QUEUE_ADVANCE_TIMEOUT_MS = 35000;

let queue: Promise<void> = Promise.resolve();

export function runExclusiveVideoDecode<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn, fn);
  const settled = result.then(
    () => undefined,
    () => undefined,
  );
  queue = new Promise<void>((resolve) => {
    settled.then(resolve);
    window.setTimeout(resolve, QUEUE_ADVANCE_TIMEOUT_MS);
  });
  return result;
}
