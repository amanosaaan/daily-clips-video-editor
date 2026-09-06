import { useRef, useState } from 'react';
import type { Project } from '../domain/types';
import { addMediaFile } from '../storage/mediaRepository';
import { useProjectStore } from '../state/projectStore';

export interface ClipImportFileStatus {
  name: string;
  /** HEVC等をH.264へ自動変換している最中の進捗(ffmpeg.wasm、時間が掛かるため表示用)。未設定はメタデータ取得等の通常処理中。 */
  convertingRatio?: number;
}

export interface ClipImportProgress {
  done: number;
  total: number;
  /** 現在処理中の全ファイル(並行して複数件処理されうる)。 */
  active: ClipImportFileStatus[];
}

// addMediaFile内部では、IndexedDB書き込み・動画メタデータ取得・サムネイル生成の
// それぞれに個別のタイムアウト(mediaRepository.tsのMETADATA_TIMEOUT_MS、現在30秒)が
// 順番に掛かりうるため、ここはその合計より確実に大きい値にしておく(そうしないと、
// 内側がまだ粘っている途中でここが先に諦めてしまい、本来成功したはずのファイルを
// 失敗扱いにしてしまう)。あくまで「内側の対策が万一すり抜けた場合」の最終防衛ラインで、
// 通常はここまで待たされることは無い想定。これが無いと、1ファイルでも詰まると
// 「次のファイルへ進まない(ボタンも反応しない)」まま importing が true に張り付いてしまう
// (既存のimportingで全ボタンを無効化するUIの副作用)。
// HEVC等の自動変換(ffmpeg.wasm、ソフトウェアエンコード)は動画の長さ・解像度次第で
// かなり時間が掛かる(実機検証では20秒程度の1080p動画で4〜5分程度掛かった)。
// この用途(たまに届く数十秒〜数分程度の動画)であれば十分足りるよう、30分という
// 大きめの値にしている(非常に長い動画では足りない可能性はあるが、その場合でも
// 書き出し自体は諦めて元のファイルのまま取り込みを続けるだけで、アプリ全体が
// 止まったままになることはない)。
const IMPORT_FILE_TIMEOUT_MS = 1800000;
function withImportTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('ファイルの取り込みがタイムアウトしました')), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * 動画ファイルを1つずつ、フレーム全体を使ったクリップ(シーン)として結合していく
 * 用途向けの一括取り込み。個別ファイル選択・フォルダ選択どちらからも使える
 * 共通ロジック(EditorView/MobileEditorView両方から使う)。
 * 全件取り込み終わったら、撮影日時順に自動で並び替える(Python版の挙動と同じ)。
 */
export function useClipImport(project: Project | null) {
  const addMediaAsset = useProjectStore((s) => s.addMediaAsset);
  const addSceneWithVideo = useProjectStore((s) => s.addSceneWithVideo);
  const sortScenesByDate = useProjectStore((s) => s.sortScenesByDate);
  const removeScene = useProjectStore((s) => s.removeScene);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<ClipImportProgress | null>(null);
  // 取り込んだ動画の中に、この端末/ブラウザでは映像コーデックがデコードできない
  // 可能性がある(HEVC/H.265等)ものが無かったか。プレビュー再生や書き出しで
  // 初めて気づくのではなく、取り込み直後にユーザーへ知らせるためのもの。
  const [codecWarnings, setCodecWarnings] = useState<string[]>([]);
  // 複数ファイルを並行して処理する際の進捗状況(Reactのstateだけだと非同期処理の
  // 途中経過を追いづらいため、確定した値をrefにも保持しつつstateへ反映する)。
  const activeFilesRef = useRef<Map<string, ClipImportFileStatus>>(new Map());
  const doneCountRef = useRef(0);

  async function importVideoFiles(files: FileList | File[] | null): Promise<void> {
    if (!files || !project) return;
    const projectId = project.id;
    const videoFiles = Array.from(files).filter((f) => f.type.startsWith('video/'));
    if (videoFiles.length === 0) return;

    setImporting(true);
    activeFilesRef.current = new Map();
    doneCountRef.current = 0;
    setProgress({ done: 0, total: videoFiles.length, active: [] });
    setCodecWarnings([]);
    const newCodecWarnings: string[] = [];

    function refreshProgress() {
      setProgress({
        done: doneCountRef.current,
        total: videoFiles.length,
        active: Array.from(activeFilesRef.current.values()),
      });
    }

    // 1ファイルずつ順番に「完全に取り込み終わってから次へ」進む方式だと、HEVC等の自動
    // 変換に数分掛かる1本のせいで、それ以外の(変換不要な)動画まで待たされてしまう
    // (実際にユーザーから報告された不具合)。そのため各ファイルの取り込みは同時に
    // 開始し、互いを待たせない(ffmpeg.wasm自体の変換はhevcConvert.ts内部で直列化
    // されるため、変換が必要な複数ファイル自体は結局1本ずつ処理されるが、変換が
    // 不要な他のファイルの取り込みはそれを待たずに並行して進む)。
    async function runOne(file: File): Promise<void> {
      const name = file.name;
      activeFilesRef.current.set(name, { name });
      refreshProgress();
      try {
        const onConvertProgress = (ratio: number) => {
          activeFilesRef.current.set(name, { name, convertingRatio: ratio });
          refreshProgress();
        };
        const asset = await withImportTimeout(addMediaFile(projectId, file, onConvertProgress), IMPORT_FILE_TIMEOUT_MS);
        addMediaAsset(asset);
        addSceneWithVideo(asset);
        if (asset.codecMaybeUnsupported) newCodecWarnings.push(name);
      } catch (err) {
        console.error('動画の取り込みに失敗しました(このファイルはスキップします):', name, err);
      } finally {
        activeFilesRef.current.delete(name);
        doneCountRef.current += 1;
        refreshProgress();
      }
    }

    // importingがtrueのままだと「追加」ボタン等が無効化されっぱなしになり、次のファイルを
    // 選ぶことすらできなくなる(disabledなボタンはクリックしても無反応に見える)。
    // 個々のファイル処理内の想定外のエラーだけでなく、その後(並び替え処理等)で何か
    // 起きた場合でも必ずfinallyでimporting/progressを解除する。
    try {
      await Promise.all(videoFiles.map(runOne));
      sortScenesByDate();

      // 新規プロジェクト作成時に自動で用意される、まだ何も置かれていない空のシーンは、
      // 実際のクリップを取り込んだ後は不要になる。Python版には「空のシーン」という概念自体が
      // 無く、クリップ=シーンだったため、これを残したままだと「3つしか追加していないのに
      // シーンが4つある」ように見えてしまう(実際に報告された不具合)。取り込み前から
      // 空だったものに限らず、この時点で空のシーンは(取り込み処理自体が空のシーンを
      // 作ることは無いため、他の理由で空のまま残っているものも含めて)まとめて取り除く。
      // 全シーンが空になってしまった場合はremoveScene側が自動で1つ空シーンを補うため安全。
      const latestProject = useProjectStore.getState().project;
      if (latestProject) {
        for (const scene of latestProject.scenes) {
          if (scene.layers.length === 0) removeScene(scene.id);
        }
      }
    } finally {
      setProgress(null);
      setImporting(false);
      setCodecWarnings(newCodecWarnings);
    }
  }

  return { importVideoFiles, importing, progress, codecWarnings };
}
