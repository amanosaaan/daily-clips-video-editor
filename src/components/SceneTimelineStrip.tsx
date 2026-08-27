import { useEffect, useRef, useState, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  getSceneStartMs,
  resolvePosition,
  sceneChipWidthPx,
  timelineOffsetPxToGlobalMs,
  timelinePositionToOffsetPx,
} from '../domain/timeline';
import type { Project, Scene } from '../domain/types';
import type { ProjectPlaybackEngine } from '../rendering/useProjectPlaybackEngine';
import { getThumbnailUrl } from '../storage/mediaRepository';
import { useProjectStore } from '../state/projectStore';

interface Props {
  project: Project;
  engine: ProjectPlaybackEngine;
  currentSceneId: string | null;
  /**
   * trueならCapCut風に、再生位置の線を画面中央に固定してチップ列側を追従スクロール
   * させ、チップ列自体をドラッグしても再生位置になる（スマホ向け）。
   * falseなら本家Google Vidsのシークバーのように、線はチップ列の中の実際の位置に
   * 表示され、チップ列は普通にスクロールするだけ（PC向け）。
   */
  autoCenter: boolean;
  /** チップ列の表示倍率(1=100%)。省略時は1。本家Google Vidsのズームスライダー用（PC向け）。 */
  zoom?: number;
  /**
   * Ctrl+ホイール(トラックパッドの2本指ピンチも、多くのブラウザではctrlKey付きの
   * wheelイベントとして送られてくる)でのズーム操作を有効にする場合に渡すコールバック。
   * PC向け(autoCenter=falseのシーク兼用チップ列)専用。呼び出し元でzoom(倍率)状態を
   * 更新すること。省略時はこの操作自体を無視する(スクロールは従来通り機能する)。
   */
  onZoomChange?: (nextZoom: number) => void;
}

const WHEEL_ZOOM_MIN = 0.5;
const WHEEL_ZOOM_MAX = 4;

/** シーンのプレビューに使う「主役」の動画/画像レイヤーのmediaIdを返す（無ければnull） */
function getSceneMainMediaId(scene: Scene): string | null {
  const visual = scene.layers
    .filter((l) => l.type === 'video' || l.type === 'image')
    .sort((a, b) => a.zIndex - b.zIndex)[0];
  return visual && 'mediaId' in visual ? visual.mediaId : null;
}

/**
 * シーンタイムライン。シーンチップ（各シーンの長さに比例した幅で、素材のサムネイルを
 * 背景に表示）の列を横スクロール表示する。autoCenterに応じて2つの見た目・挙動を切り替える
 * （詳しくはPropsのコメント参照）。PC・スマホ共通で使う。
 */
export function SceneTimelineStrip({ project, engine, currentSceneId, autoCenter, zoom = 1, onZoomChange }: Props) {
  const reorderScenes = useProjectStore((s) => s.reorderScenes);
  const [sceneThumbUrls, setSceneThumbUrls] = useState<Record<string, string>>({});
  const scenesScrollRef = useRef<HTMLDivElement>(null);
  const inlinePlayheadRef = useRef<HTMLDivElement>(null);

  // シーンチップのドラッグ&ドロップによる並び替え(デスクトップのみ、ネイティブHTML5
  // Drag and Dropを使う)。チップ列コンテナ側の既存のpointerdown/pointermoveは
  // シーク(スクラブ)用に既に使われているため、それとは別イベント系統である
  // ネイティブD&D(dragstart/dragover/drop)を使うことで競合を避けている。
  const dragSceneIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  function handleChipDragStart(index: number) {
    return (e: ReactDragEvent<HTMLButtonElement>) => {
      dragSceneIndexRef.current = index;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
    };
  }
  function handleChipDragOver(index: number) {
    return (e: ReactDragEvent<HTMLButtonElement>) => {
      if (dragSceneIndexRef.current === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragOverIndex(index);
    };
  }
  function handleChipDrop(index: number) {
    return (e: ReactDragEvent<HTMLButtonElement>) => {
      e.preventDefault();
      const from = dragSceneIndexRef.current;
      setDragOverIndex(null);
      dragSceneIndexRef.current = null;
      if (from === null || from === index) return;
      reorderScenes(from, index);
    };
  }
  function handleChipDragEnd() {
    dragSceneIndexRef.current = null;
    setDragOverIndex(null);
  }

  // ユーザーが指/マウスでチップ列に触れている（またはその余韻の慣性スクロール中）かどうか。
  // autoCenterモードでのみ使う（チップ列自体がシークバーを兼ねるため、自動追従との
  // 競合を避ける必要があるモード限定）。
  //
  // 以前はここを「自動追従で書き換えた値と実際のscrollLeftを比較して一致すれば無視」
  // という方式にしていたが、再生中は毎フレームscrollLeftを書き換えるため、
  // ブラウザがscrollイベントを間引き・非同期で発火させるタイミングとズレると
  // 「狙った値」の記録が次のフレームの値で上書きされてしまい、比較が一致せず
  // ユーザー操作と誤判定してengine.seek()を呼んでしまうことがあった。
  // それが毎フレーム発生すると、実際の再生位置(timeRef.current)を外から
  // 継続的に書き換えてしまい、動画・音声の再生自体が進まなくなる重大な不具合になっていた。
  // ポインター（指/マウス）が実際に触れているかという確実な信号で判定するよう変更し、
  // この種のタイミング競合を根本から無くした。
  const isUserScrollingRef = useRef(false);
  const resumeAutoScrollTimeoutRef = useRef<number | null>(null);
  function scheduleResumeAutoScroll() {
    if (resumeAutoScrollTimeoutRef.current !== null) window.clearTimeout(resumeAutoScrollTimeoutRef.current);
    resumeAutoScrollTimeoutRef.current = window.setTimeout(() => {
      isUserScrollingRef.current = false;
      resumeAutoScrollTimeoutRef.current = null;
    }, 150);
  }
  // マウスはタッチと違い、触れているだけではOSが横スクロールしてくれないため、
  // autoCenterモード（チップ列＝シークバー）ではクリック&ドラッグでscrollLeftを
  // 手動に動かす（タッチはブラウザのネイティブなパン操作に任せ、二重に動かない
  // ようにする）。autoCenterがfalseの場合はチップ列は普通のスクロール領域なので、
  // ここでの特別なドラッグ処理は行わない（ネイティブスクロール/ホイールに任せる）。
  const mouseDragRef = useRef<{ startX: number; startScrollLeft: number } | null>(null);
  // autoCenterがfalse(PC)のモード用: チップ列自体をクリック/ドラッグして、その位置に
  // 直接シークする（本家Google Vidsのシークバーと同様、チップ列がシークバーを兼ねる）。
  // 以前は別に<input type="range">を並べて置いていたが、チップ列がスクロール可能な
  // 一方でそちらは常に幅100%で動くため、再生位置を示す縦線同士がズレて見える問題が
  // あった。シークの役割をこのチップ列に一本化することで解消する。
  const pcScrubRef = useRef(false);
  function seekFromClientX(clientX: number) {
    const container = scenesScrollRef.current;
    if (!container) return;
    const offsetPx = clientX - container.getBoundingClientRect().left + container.scrollLeft;
    engine.seek(timelineOffsetPxToGlobalMs(project.scenes, offsetPx, zoom));
  }
  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!autoCenter) {
      const container = scenesScrollRef.current;
      if (!container) return;
      pcScrubRef.current = true;
      seekFromClientX(e.clientX);
      try {
        container.setPointerCapture(e.pointerId);
      } catch {
        // ポインターが既に無効等の場合は無視する(シーク自体は上で済んでいる)
      }
      return;
    }
    isUserScrollingRef.current = true;
    if (resumeAutoScrollTimeoutRef.current !== null) {
      window.clearTimeout(resumeAutoScrollTimeoutRef.current);
      resumeAutoScrollTimeoutRef.current = null;
    }
    if (e.pointerType === 'mouse') {
      const container = scenesScrollRef.current;
      if (container) {
        mouseDragRef.current = { startX: e.clientX, startScrollLeft: container.scrollLeft };
        container.setPointerCapture(e.pointerId);
      }
    }
  }
  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!autoCenter) {
      if (pcScrubRef.current) seekFromClientX(e.clientX);
      return;
    }
    const drag = mouseDragRef.current;
    const container = scenesScrollRef.current;
    if (!drag || !container) return;
    container.scrollLeft = drag.startScrollLeft - (e.clientX - drag.startX);
  }
  function handlePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (!autoCenter) {
      const container = scenesScrollRef.current;
      if (pcScrubRef.current && container) {
        try {
          container.releasePointerCapture(e.pointerId);
        } catch {
          // すでに解放済みなら何もしなくてよい
        }
      }
      pcScrubRef.current = false;
      return;
    }
    const container = scenesScrollRef.current;
    if (mouseDragRef.current && container) {
      try {
        container.releasePointerCapture(e.pointerId);
      } catch {
        // すでに解放済みなら何もしなくてよい
      }
    }
    mouseDragRef.current = null;
    // タップ/クリックだけで指を離した場合などスクロールイベントがこの後来ないケースに備え、
    // ここでも一旦タイマーを仕掛けておく。実際に慣性スクロールが続いていれば
    // handleScroll側で随時延長されるので問題ない。
    scheduleResumeAutoScroll();
  }
  useEffect(() => {
    return () => {
      if (resumeAutoScrollTimeoutRef.current !== null) window.clearTimeout(resumeAutoScrollTimeoutRef.current);
    };
  }, []);

  // トラックパッドの2本指スクロール（や、マウスホイール）でチップ列を横スクロール
  // できるようにする。deltaXが無い（縦方向として送られてくる）環境でもdeltaYを
  // 横スクロールに流用することで、環境によらず動くようにする。
  // React合成イベントのonWheelはパッシブリスナーとして登録されpreventDefault()が
  // 効かないため、ネイティブのaddEventListenerで登録する。
  useEffect(() => {
    const container = scenesScrollRef.current;
    if (!container) return;
    function onWheel(e: WheelEvent) {
      // Ctrl+ホイール(トラックパッドの2本指ピンチもブラウザはこれとして送ってくる)は
      // スクロールではなくズームとして扱う。カーソル位置の時刻が画面上でずれないよう、
      // 倍率の変化に合わせてscrollLeftを補正する(Python版のtimelineScroll wheelハンドラと同じ方式)。
      if (e.ctrlKey && onZoomChange) {
        e.preventDefault();
        const rect = container!.getBoundingClientRect();
        const cursorX = e.clientX - rect.left;
        const anchorContentX = container!.scrollLeft + cursorX;
        const factor = Math.exp(-e.deltaY * 0.01);
        const nextZoom = Math.min(WHEEL_ZOOM_MAX, Math.max(WHEEL_ZOOM_MIN, zoom * factor));
        onZoomChange(nextZoom);
        // チップ幅はzoom propが更新された次の描画でしか反映されないため、1フレーム遅らせて補正する。
        requestAnimationFrame(() => {
          if (!scenesScrollRef.current) return;
          scenesScrollRef.current.scrollLeft = anchorContentX * (nextZoom / zoom) - cursorX;
        });
        return;
      }
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (delta === 0) return;
      e.preventDefault();
      if (autoCenter) {
        isUserScrollingRef.current = true;
        scheduleResumeAutoScroll();
      }
      container!.scrollLeft += delta;
    }
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCenter, zoom, onZoomChange]);

  // タイムラインの先頭（0秒）や末尾も画面中央まで持って来られるよう、チップ列の
  // 前後にビューポート半分ぶんの余白を持たせる（autoCenterモードのみ）。これが無いと、
  // 最初のシーンはどんなにスクロールしてもプレイヘッド（画面中央）まで届かない
  // （scrollLeftは0未満にできないため）。
  const [viewportHalfWidth, setViewportHalfWidth] = useState(0);
  useEffect(() => {
    if (!autoCenter) return;
    function updateHalfWidth() {
      const el = scenesScrollRef.current;
      if (el) setViewportHalfWidth(el.clientWidth / 2);
    }
    updateHalfWidth();
    window.addEventListener('resize', updateHalfWidth);
    return () => window.removeEventListener('resize', updateHalfWidth);
  }, [autoCenter]);

  // CapCutのように、シーンチップに「主役」の動画/画像素材のサムネイルを表示する。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const scene of project.scenes) {
        const mediaId = getSceneMainMediaId(scene);
        const asset = mediaId ? project.mediaLibrary.find((m) => m.id === mediaId) : undefined;
        if (!asset?.thumbnailBlobId) continue;
        const url = await getThumbnailUrl(asset.thumbnailBlobId);
        if (url && !cancelled) {
          setSceneThumbUrls((prev) => (prev[scene.id] ? prev : { ...prev, [scene.id]: url }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project]);

  // autoCenterモード: 再生位置を示す線を常に画面中央に固定し、シーンチップ側を
  // 横スクロールさせて追従させる。engine.position（約66ms間隔でしか更新されない
  // React state）ではなくengine.getLiveTimeMs()を毎フレーム読むrAFループで
  // 追従させることで、再生中のスクロールを滑らかにする
  // （stateの間引きに引っ張られてカクつくのを防ぐ）。
  // チップ列にはビューポート半分ぶんの余白(viewportHalfWidth)を前後に付けているため、
  // scrollLeftはそのままoffsetと一致する（offset - clientWidth/2 + 余白(clientWidth/2) = offset）。
  useEffect(() => {
    if (!autoCenter) return;
    let raf = 0;
    function tick() {
      const container = scenesScrollRef.current;
      // ユーザーがドラッグ中/慣性スクロール中は指・マウスの動きを優先し、自動追従は行わない。
      if (container && !isUserScrollingRef.current) {
        const position = resolvePosition(project, engine.getLiveTimeMs());
        if (position) {
          const target = timelinePositionToOffsetPx(
            project.scenes,
            position.sceneIndex,
            position.localTimeMs,
            position.scene.duration,
            zoom,
          );
          if (Math.abs(container.scrollLeft - target) > 0.5) {
            container.scrollLeft = target;
          }
        }
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [project, engine.getLiveTimeMs, autoCenter, zoom]);

  // autoCenterがfalseのモード: 線はチップ列の中の実際の時刻位置に表示する
  // （チップ列と一緒にスクロールする、本家Google Vidsのシークバーに近い見た目）。
  // こちらもgetLiveTimeMs()を毎フレーム読み、DOMを直接書き換えて滑らかに動かす。
  useEffect(() => {
    if (autoCenter) return;
    let raf = 0;
    function tick() {
      const el = inlinePlayheadRef.current;
      if (el) {
        const position = resolvePosition(project, engine.getLiveTimeMs());
        if (position) {
          const offset = timelinePositionToOffsetPx(
            project.scenes,
            position.sceneIndex,
            position.localTimeMs,
            position.scene.duration,
            zoom,
          );
          el.style.left = `${offset}px`;
        }
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [project, engine.getLiveTimeMs, autoCenter, zoom]);

  // ユーザーがシーンチップ列を直接ドラッグ/スクロールしたら、その位置を再生位置として
  // 扱う（＝チップ列自体がシークバーを兼ねる。autoCenterモードのみ）。
  // isUserScrollingRefがfalseの間のscrollイベントは自動追従由来なので無視する
  // （詳しい経緯は上のrefのコメント参照）。
  function handleScroll() {
    if (!autoCenter) return;
    const container = scenesScrollRef.current;
    if (!container || !isUserScrollingRef.current) return;
    scheduleResumeAutoScroll(); // まだスクロール（慣性含む）が続いているのでタイマーを延長
    // 前後の余白ぶんscrollLeftとoffsetが一致するので、そのままpx→時刻変換にかける。
    engine.seek(timelineOffsetPxToGlobalMs(project.scenes, container.scrollLeft, zoom));
  }

  return (
    <div className={`scene-timeline${autoCenter ? ' scene-timeline--drag' : ''}`}>
      <div className="scene-timeline__viewport">
        <div
          className="scene-timeline__scroll"
          ref={scenesScrollRef}
          onScroll={handleScroll}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={autoCenter ? { paddingLeft: viewportHalfWidth, paddingRight: viewportHalfWidth } : undefined}
        >
          {project.scenes.map((scene, i) => (
            <button
              key={scene.id}
              className={`scene-timeline__chip${scene.id === currentSceneId ? ' is-active' : ''}${sceneThumbUrls[scene.id] ? ' has-thumb' : ''}${dragOverIndex === i ? ' is-drag-over' : ''}`}
              style={{
                width: sceneChipWidthPx(scene.duration, zoom),
                ...(sceneThumbUrls[scene.id] ? { backgroundImage: `url(${sceneThumbUrls[scene.id]})` } : undefined),
              }}
              onClick={autoCenter ? () => engine.seek(getSceneStartMs(project, scene.id)) : undefined}
              draggable={!autoCenter}
              onDragStart={handleChipDragStart(i)}
              onDragOver={handleChipDragOver(i)}
              onDrop={handleChipDrop(i)}
              onDragEnd={handleChipDragEnd}
              title={!autoCenter ? `シーン${i + 1}(ドラッグで並び替え)` : undefined}
            >
              {i + 1}
            </button>
          ))}
          {/* スクロールする内容の一部として置くことで、チップ列と一緒にスクロールする。 */}
          {!autoCenter && engine.position && (
            <div className="scene-timeline__playhead scene-timeline__playhead--inline" ref={inlinePlayheadRef} />
          )}
        </div>
        {/* スクロールするコンテナの外(兄弟要素)に置くことで、scrollLeftの影響を受けず
            常に画面中央に固定表示される。追従はJS側でscrollLeftを調整して行う。 */}
        {autoCenter && engine.position && <div className="scene-timeline__playhead" />}
      </div>
    </div>
  );
}
