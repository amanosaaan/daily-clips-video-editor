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
let queue: Promise<void> = Promise.resolve();

export function runExclusiveVideoDecode<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn, fn);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
