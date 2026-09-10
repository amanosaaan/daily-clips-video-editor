import { useRef, useState } from 'react';
import { generateYoutubeChapters } from '../domain/youtubeChapters';
import type { Project } from '../domain/types';
import { CloseIcon, CopyIcon } from './icons';

interface Props {
  project: Project;
  onClose: () => void;
}

/**
 * YouTubeのチャプター欄にそのまま貼り付けられるテキスト(撮影日が変わるタイミングごとの
 * タイムスタンプ)を表示するモーダル。Python版の「YouTubeチャプター(撮影日ごと)」パネルの
 * Web版。書き出し完了を待たず、いつでもプロジェクトの現在の状態から生成して確認できる。
 */
export function YoutubeChaptersModal({ project, onClose }: Props) {
  const chapters = generateYoutubeChapters(project);
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function handleCopy() {
    textareaRef.current?.select();
    try {
      await navigator.clipboard.writeText(chapters);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // クリップボードAPIが使えない環境では、テキストエリアを選択状態にするところまでで留める
      // (ユーザーが手動でCtrl+Cできる)。
    }
  }

  function handleDownload() {
    // 動画の書き出しとは無関係に、チャプターのテキストだけを単体でダウンロードする。
    const blob = new Blob([chapters], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name || 'video'}_chapters.txt`;
    a.rel = 'noopener';
    // 一部ブラウザ(Firefox等)はDOMに繋がっていない<a>のclick()を無視する。
    document.body.appendChild(a);
    a.click();
    a.remove();
    // click()直後にrevokeするとダウンロードが始まる前にURLが無効化されて
    // 失敗することがあるため、少し遅らせて解放する。
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  return (
    <div className="media-flyout__backdrop" onClick={onClose}>
      <div className="media-flyout" onClick={(e) => e.stopPropagation()}>
        <div className="media-flyout__header">
          <h2>YouTubeチャプター(撮影日ごと)</h2>
          <button className="btn-icon" onClick={onClose} aria-label="閉じる">
            <CloseIcon />
          </button>
        </div>
        <div className="media-flyout__body">
          {chapters ? (
            <>
              <p className="youtube-chapters__hint">
                YouTubeの概要欄に貼り付けると、動画にチャプターが付きます(先頭が0:00で始まる行が3つ以上必要です)。
              </p>
              <textarea ref={textareaRef} className="youtube-chapters__textarea" readOnly value={chapters} />
              <div className="youtube-chapters__actions">
                <button className="btn-pill btn-pill--primary" onClick={() => void handleCopy()}>
                  <CopyIcon size={16} /> {copied ? 'コピーしました' : 'コピー'}
                </button>
                <button className="btn-pill" onClick={handleDownload}>
                  テキストファイルをダウンロード
                </button>
              </div>
            </>
          ) : (
            <p className="youtube-chapters__hint">シーンがまだありません。クリップを追加すると生成されます。</p>
          )}
        </div>
      </div>
    </div>
  );
}
