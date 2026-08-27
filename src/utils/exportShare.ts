/**
 * 書き出したMP4を「ファイルとしてダウンロード」ではなく、iOS/Androidの共有シート経由で
 * 端末の写真(カメラロール)アプリへ直接保存できるようにする。
 *
 * ブラウザの<a download>によるダウンロードは、iOSではFilesアプリ(ダウンロード)に
 * 保存されるだけで、写真アプリには入らない。一方Web Share API(navigator.share)に
 * ファイルを渡すと、OS標準の共有シートが開き、そこから「ビデオを保存」を選ぶと
 * 写真アプリへ直接保存できる(iOS Safari/Chromeとも対応)。
 *
 * 対応していない環境(デスクトップ等)では、従来通りのファイルダウンロードに
 * フォールバックする。
 */
export async function shareOrDownloadVideo(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: 'video/mp4' });

  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (err) {
      // ユーザーが共有シートを自分でキャンセルした場合(AbortError)は、
      // ダウンロードへのフォールバックはせずそのまま終える(意図した操作のため)。
      if (err instanceof Error && err.name === 'AbortError') return;
      console.warn('共有シートでの保存に失敗したため、ファイルのダウンロードにフォールバックします:', err);
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
