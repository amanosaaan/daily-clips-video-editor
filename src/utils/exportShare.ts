/**
 * 書き出したMP4を「ファイルとしてダウンロード」ではなく、iOS/Androidの共有シート経由で
 * 端末の写真(カメラロール)アプリへ直接保存できるようにする。
 *
 * ブラウザの<a download>によるダウンロードは、iOSではFilesアプリに保存されるだけで
 * 写真アプリには入らない。一方Web Share API(navigator.share)にファイルを渡すと、
 * OS標準の共有シートが開き、そこから「ビデオを保存」を選ぶと写真アプリへ直接
 * 保存できる(iOS Safari/Chromeとも対応)。
 *
 * ただし、Windows PC(Chrome/Edge)でもnavigator.share/canShareがファイル共有に
 * 対応しており、この共有シートを開いてしまうことが実機で確認された。PCでは
 * 「写真」のような特別な保存先が無く、共有シート経由の保存は単に手間が増えるだけ
 * (ユーザーは単純にダウンロードフォルダへの保存を期待している)なので、
 * 呼び出し元(モバイル向けUIかどうか)からpreferShareで明示的に指定してもらい、
 * モバイルの場合だけ共有シートを試す。PCでは常に<a download>で保存する。
 */
export async function shareOrDownloadVideo(blob: Blob, filename: string, preferShare: boolean): Promise<void> {
  const file = new File([blob], filename, { type: 'video/mp4' });

  // ブラウザによってnavigator.share/canShareの対応状況やfiles対応が異なり、
  // 「共有シートが期待通り開かない/写真アプリが選択肢に出ない」という報告があった際の
  // 切り分け用に、どの経路を通ったかデバッグログ(DebugLogPanel)に残す。
  const hasShare = typeof navigator.share === 'function';
  const hasCanShare = typeof navigator.canShare === 'function';
  const canShareFiles = preferShare && hasCanShare && navigator.canShare({ files: [file] });
  console.warn(
    'shareOrDownloadVideo: preferShare=',
    preferShare,
    'hasShare=',
    hasShare,
    'hasCanShare=',
    hasCanShare,
    'canShareFiles=',
    canShareFiles,
  );

  if (canShareFiles) {
    try {
      await navigator.share({ files: [file], title: filename });
      console.warn('shareOrDownloadVideo: navigator.share succeeded');
      return;
    } catch (err) {
      // ユーザーが共有シートを自分でキャンセルした場合(AbortError)は、
      // ダウンロードへのフォールバックはせずそのまま終える(意図した操作のため)。
      if (err instanceof Error && err.name === 'AbortError') {
        console.warn('shareOrDownloadVideo: user cancelled share sheet');
        return;
      }
      console.warn('共有シートでの保存に失敗したため、ファイルのダウンロードにフォールバックします:', err);
    }
  } else {
    console.warn('shareOrDownloadVideo: preferShare=false or canShare(files) unsupported, using <a download>');
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
