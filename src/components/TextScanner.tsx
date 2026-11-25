/* src/components/TextScanner.tsx
 * 出席用のカメラ（QR コードと黒板のパスワードを 1 つの画面で読む）。
 *   - QR コード : 映すだけで自動で読む。LMS のページなら「開く」を出す（ほかのサイトは開かない）
 *   - パスワード : 白い枠に合わせて「撮影」すると、文字認識（OCR）で候補を出す。候補を押すとパスワードの欄に入る
 *                  （送信はしない。本人が確かめて「出席」を押す）
 * どちらも端末の中だけで読む（写真はどこにも送らない）。React.lazy で読み込み、Tesseract.js は撮ったときに初めて読み込む。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import jsQR from 'jsqr';
import { FiCamera, FiExternalLink, FiRotateCcw, FiX } from 'react-icons/fi';
import { LMS_BASE } from '../lib/lms';
import { pickCandidates, prepareImage, recognizeText } from '../lib/passwordOcr';

/** 読み取りの枠（映像に対する割合）。横長の 1〜2 行分 */
const CROP = { x: 0.08, y: 0.36, w: 0.84, h: 0.28 };

type Phase =
  | { kind: 'camera' }
  | { kind: 'qr'; text: string }
  | { kind: 'reading'; image: string }
  | { kind: 'result'; image: string; candidates: string[] };

type Detector = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type DetectorCtor = new (opts: { formats: string[] }) => Detector;

const isLmsUrl = (text: string) => {
  try {
    const u = new URL(text);
    return u.protocol === 'https:' && u.host === new URL(LMS_BASE).host;
  } catch {
    return false;
  }
};

export default function TextScanner({ onPick, onClose }: { onPick: (text: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'camera' });
  const [manual, setManual] = useState('');

  /** カメラを起動する。isCancelled が true になった起動（画面を閉じた・やり直した）は、途中でも止めてエラーにしない */
  const startCamera = useCallback(async (isCancelled: () => boolean) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('このブラウザではカメラを使えません。');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      if (isCancelled()) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
    } catch (e) {
      // 起動のやり直しで前の再生が止められたとき（AbortError）は失敗ではない
      if (isCancelled() || (e instanceof DOMException && e.name === 'AbortError')) return;
      const name = e instanceof DOMException ? e.name : '';
      setError(name === 'NotAllowedError'
        ? 'カメラの使用が許可されていません。ブラウザ（または端末）の設定で、このサイトのカメラを許可してください。'
        : 'カメラを起動できませんでした。');
    }
  }, []);
  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  useEffect(() => {
    if (phase.kind !== 'camera') return;
    let stopped = false;
    startCamera(() => stopped);
    // 映っている QR コードを、撮影を待たずに読み続ける（BarcodeDetector があればそれ、なければ jsQR）
    let raf = 0;
    let frame = 0;
    const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
    const detector = Ctor ? new Ctor({ formats: ['qr_code'] }) : null;
    const canvas = document.createElement('canvas');
    const tick = async () => {
      if (stopped) return;
      const video = videoRef.current;
      // 3 コマに 1 回だけ読む（撮影の操作を重くしないため）
      if (video && video.readyState >= 2 && video.videoWidth && frame++ % 3 === 0) {
        try {
          let text: string | null = null;
          if (detector) {
            text = (await detector.detect(video))[0]?.rawValue ?? null;
          } else {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(video, 0, 0);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              text = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
            }
          }
          if (text && !stopped) {
            stopped = true;
            stopCamera();
            setPhase({ kind: 'qr', text });
            return;
          }
        } catch {
          /* 1 コマ読めなくても次のコマで続ける */
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stopCamera();
    };
  }, [phase.kind, startCamera]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const shoot = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    // 画面の映像は枠いっぱいに拡大して端を切っている（object-cover）ので、画面の白い枠を元の映像の位置に直す
    const vw = video.videoWidth, vh = video.videoHeight;
    const scale = Math.max(video.clientWidth / vw, video.clientHeight / vh);
    const visW = video.clientWidth / scale, visH = video.clientHeight / scale;
    const offX = (vw - visW) / 2, offY = (vh - visH) / 2;
    const crop = { x: (offX + CROP.x * visW) / vw, y: (offY + CROP.y * visH) / vh, w: (CROP.w * visW) / vw, h: (CROP.h * visH) / vh };
    const canvas = prepareImage(video, crop);
    const image = canvas.toDataURL('image/png');
    stopCamera();
    setPhase({ kind: 'reading', image });
    try {
      const candidates = pickCandidates(await recognizeText(canvas));
      setPhase({ kind: 'result', image, candidates });
      setManual(candidates[0] ?? '');
    } catch {
      setError('文字の読み取りの準備ができませんでした（初回はインターネットへの接続が必要です）。');
    }
  };

  const pick = (text: string) => {
    if (!text.trim()) return;
    onPick(text.trim());
    onClose();
  };

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="カメラで読み取る" className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl bg-surface overflow-hidden shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <p className="text-[15px] font-bold text-fg">カメラで読み取る</p>
          <button type="button" onClick={onClose} aria-label="閉じる" className="p-1.5 -mr-1.5 rounded-md text-fg-muted hover:text-fg hover:bg-surface-3">
            <FiX size={20} />
          </button>
        </div>

        {error ? (
          <p className="px-4 py-8 text-sm text-warn text-center">{error}</p>
        ) : phase.kind === 'camera' ? (
          <>
            <div className="relative bg-black aspect-[4/3]">
              <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
              {/* 読み取りの枠（この中の文字だけを読む） */}
              <div
                className="absolute border-2 border-white/90 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.35)] pointer-events-none"
                style={{ left: `${CROP.x * 100}%`, top: `${CROP.y * 100}%`, width: `${CROP.w * 100}%`, height: `${CROP.h * 100}%` }}
                aria-hidden="true"
              />
            </div>
            <div className="px-4 py-3 flex flex-col items-center gap-2">
              <p className="text-xs text-fg-muted text-center">QR コードは映すだけで読み取ります。<br />黒板のパスワードは白い枠に合わせて撮影してください。</p>
              <button type="button" onClick={shoot} className="inline-flex items-center gap-2 h-11 px-6 rounded-full bg-accent-solid hover:bg-accent-solid-hover text-on-accent font-bold transition-colors">
                <FiCamera size={17} aria-hidden="true" />パスワードを撮影
              </button>
            </div>
          </>
        ) : phase.kind === 'qr' ? (
          // QR コード: LMS のページなら「開く」（自動で開くと iPhone でブロックされるため、押してもらう）
          <div className="px-4 py-5 space-y-3">
            {isLmsUrl(phase.text) ? (
              <>
                <p className="text-sm font-semibold text-fg">LMS のページの QR コードを読み取りました。</p>
                <a href={phase.text} target="_blank" rel="noopener noreferrer" onClick={onClose} className="flex items-center justify-center gap-1.5 h-11 rounded-md bg-accent-solid hover:bg-accent-solid-hover text-on-accent transition-colors">
                  <span className="text-sm font-bold">開く</span>
                  <FiExternalLink size={14} aria-hidden="true" />
                </a>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-fg">LMS の URL ではないため、開きませんでした。</p>
                <p className="text-xs text-fg-muted break-all bg-surface-2 rounded-md px-3 py-2">{phase.text}</p>
              </>
            )}
            <button type="button" onClick={() => setPhase({ kind: 'camera' })} className="w-full inline-flex items-center justify-center gap-1.5 h-10 rounded-full border border-line-strong text-fg text-sm font-semibold hover:bg-surface-3 transition-colors">
              <FiRotateCcw size={14} aria-hidden="true" />もう一度読み取る
            </button>
          </div>
        ) : (
          <div className="px-4 py-4 space-y-3">
            {/* 読み取りに使った画像（白黒にしたもの） */}
            <img src={phase.image} alt="読み取った部分" className="w-full max-h-28 object-contain rounded-md bg-white border border-line" />
            {phase.kind === 'reading' ? (
              <p className="py-3 text-center text-sm text-fg-muted">読み取り中...（初回は準備に少し時間がかかります）</p>
            ) : (
              <>
                {phase.candidates.length > 0 ? (
                  <div>
                    <p className="text-xs text-fg-muted mb-1.5">押すとパスワードの欄に入ります。<span className="font-semibold text-warn">大文字・小文字（x と X、o と O など）は読み違えやすい</span>ので、黒板と見比べて、違えば下で直してください。</p>
                    <div className="flex flex-wrap gap-2">
                      {phase.candidates.map((c) => (
                        <button key={c} type="button" onClick={() => pick(c)} className="h-9 px-3.5 rounded-lg border border-accent text-accent font-bold font-mono text-base hover:bg-accent-soft transition-colors">
                          {c}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-fg-muted">文字を読み取れませんでした。枠に合わせて、近づいて撮り直してください。</p>
                )}
                {/* 読み違えたときは、ここで直してから入れる */}
                <form onSubmit={(e) => { e.preventDefault(); pick(manual); }} className="flex gap-2">
                  <input
                    value={manual}
                    onChange={(e) => setManual(e.target.value)}
                    aria-label="読み取った文字を直す"
                    placeholder="直して入れる"
                    autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
                    className="flex-1 min-w-0 h-10 px-3 rounded-lg border border-line-strong bg-surface text-fg text-base font-mono focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                  <button type="submit" disabled={!manual.trim()} className="h-10 px-4 rounded-lg bg-accent-solid hover:bg-accent-solid-hover text-on-accent text-sm font-bold disabled:opacity-40">入れる</button>
                </form>
                <button type="button" onClick={() => setPhase({ kind: 'camera' })} className="w-full inline-flex items-center justify-center gap-1.5 h-10 rounded-full border border-line-strong text-fg text-sm font-semibold hover:bg-surface-3 transition-colors">
                  <FiRotateCcw size={14} aria-hidden="true" />撮り直す
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
