/* src/lib/passwordOcr.ts
 * 黒板・スライドに書かれた出席のパスワードを、写真から文字認識（OCR）で読み取る。端末の中だけで動く（Tesseract.js）。
 *   - prepareImage    : 写真の枠の中を切り出し、白黒にしてコントラストを上げる。黒板（暗い地に明るい字）は反転して
 *                       「明るい地に暗い字」にそろえる（OCR はこの形がいちばん読める）
 *   - recognizeText   : 英数字だけに絞って読む。Tesseract.js は使うときに初めて読み込む（初回は認識用のデータも取りに行く）
 *   - pickCandidates  : 読めた語から、パスワードらしいもの（英数字 3〜16 文字）を、確からしい順に並べる
 * 読み取った文字は欄に入れるだけで、送信は本人が「出席」を押したときだけ。
 */

/** 認識の結果の 1 語（確からしさは 0〜100） */
export type OcrWord = { text: string; confidence: number };

/** 枠の中を切り出して、白黒・高コントラストにした canvas を返す */
export function prepareImage(
  source: CanvasImageSource & { videoWidth?: number; videoHeight?: number; width?: number; height?: number },
  crop: { x: number; y: number; w: number; h: number },
): HTMLCanvasElement {
  const srcW = source.videoWidth || (source.width as number);
  const srcH = source.videoHeight || (source.height as number);
  const sx = Math.round(crop.x * srcW), sy = Math.round(crop.y * srcH);
  const sw = Math.round(crop.w * srcW), sh = Math.round(crop.h * srcH);
  // 小さい字が読めるよう、横 1200px 前後まで拡大する（大きすぎる写真は縮める）
  const scale = Math.min(3, Math.max(0.5, 1200 / sw));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const gray = new Uint8ClampedArray(d.length / 4);
  let sum = 0;
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    gray[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    sum += gray[j];
  }
  const mean = sum / gray.length;
  // 暗い地（黒板）なら反転する
  const invert = mean < 128;
  // 明るさの 5%〜95% を 0〜255 に引き伸ばす
  const hist = new Uint32Array(256);
  for (const g of gray) hist[g]++;
  const lo = percentile(hist, gray.length, 0.05), hi = percentile(hist, gray.length, 0.95);
  const range = Math.max(1, hi - lo);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    let v = ((gray[j] - lo) / range) * 255;
    if (invert) v = 255 - v;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function percentile(hist: Uint32Array, total: number, p: number): number {
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= total * p) return v;
  }
  return 255;
}

type TesseractWorker = Awaited<ReturnType<typeof import('tesseract.js').createWorker>>;
let workerPromise: Promise<TesseractWorker> | null = null;

/** 認識の準備（初回だけ Tesseract.js と英字の認識データを読み込む。2 回目からは端末に残ったものを使う） */
function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, PSM } = await import('tesseract.js');
      const worker = await createWorker('eng');
      await worker.setParameters({
        // パスワードは英数字だけ。まばらに書かれた字も拾えるよう、ページ全体ではなく語ごとに探す
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      });
      return worker;
    })().catch((e) => {
      workerPromise = null;
      throw e;
    });
  }
  return workerPromise;
}

/** 画像から語を読む */
export async function recognizeText(canvas: HTMLCanvasElement): Promise<OcrWord[]> {
  const worker = await getWorker();
  const { data } = await worker.recognize(canvas, {}, { blocks: true, text: true });
  const words = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)));
  return words.map((w) => ({ text: w.text, confidence: w.confidence }));
}

/**
 * 読めた語から、パスワードの候補（英数字 3〜16 文字）を確からしい順に最大 6 個。
 * 同じ文字列は 1 つにまとめる（確からしさは高いほう）。数字と英字が混じったものを少し優先する（パスワードらしいため）
 */
export function pickCandidates(words: OcrWord[], max = 6): string[] {
  const best = new Map<string, number>();
  for (const w of words) {
    const text = w.text.replace(/[^A-Za-z0-9]/g, '');
    if (text.length < 3 || text.length > 16) continue;
    const mixed = /[0-9]/.test(text) && /[A-Za-z]/.test(text);
    const score = w.confidence + (mixed ? 10 : 0);
    if (score > (best.get(text) ?? -1)) best.set(text, score);
  }
  return [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([t]) => t);
}
