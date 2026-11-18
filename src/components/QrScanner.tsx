/* src/components/QrScanner.tsx
 * 出欠用の QR コードを、FMS の中でカメラを使って読み取る。
 * 読み取った URL が LMS（lms-tokyo.iput.ac.jp）のものなら「開く」ボタンを出す（自動で開くと、タップを伴わないため
 * iPhone の Safari などでポップアップとしてブロックされる）。それ以外は開かずに内容だけ見せる（知らないサイトの QR を開かないため）。
 *
 * 読み取りは、ブラウザに BarcodeDetector があればそれを使い、なければ jsQR を使う（iPhone の Safari など）。
 * このファイルは React.lazy で読み込むので、jsQR は QR を開いたときだけダウンロードされる。
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import jsQR from 'jsqr';
import { FiX, FiExternalLink } from 'react-icons/fi';
import { LMS_BASE } from '../lib/lms';

type Props = { onClose: () => void };

const LMS_HOST = new URL(LMS_BASE).host;

const isLmsUrl = (text: string) => {
  try {
    const u = new URL(text);
    return u.protocol === 'https:' && u.host === LMS_HOST;
  } catch {
    return false;
  }
};

type Detector = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type DetectorCtor = new (opts: { formats: string[] }) => Detector;

export default function QrScanner({ onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // 開いたら選択中の位置をダイアログの中（閉じるボタン）へ移し、閉じたら元のボタンへ戻す（キーボード操作用）
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
    const detector = Ctor ? new Ctor({ formats: ['qr_code'] }) : null;

    const found = (text: string) => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
      setResult(text);
    };

    const tick = async () => {
      if (stopped) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState >= 2 && video.videoWidth) {
        try {
          if (detector) {
            const codes = await detector.detect(video);
            if (codes[0]?.rawValue) return found(codes[0].rawValue);
          } else {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
              if (code?.data) return found(code.data);
            }
          }
        } catch {
          /* 1 コマ読めなくても次のコマで続ける */
        }
      }
      raf = requestAnimationFrame(tick);
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('このブラウザではカメラを使えません。');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        raf = requestAnimationFrame(tick);
      } catch (e) {
        const name = e instanceof DOMException ? e.name : '';
        setError(name === 'NotAllowedError'
          ? 'カメラの使用が許可されていません。ブラウザ（または端末）の設定で、このサイトのカメラを許可してください。'
          : 'カメラを起動できませんでした。');
      }
    })();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose();
      // Tab でダイアログの外へ出ないよう、最後の要素の次は最初へ戻す
      if (e.key === 'Tab') {
        const dialog = closeRef.current?.closest('[role="dialog"]');
        const items = dialog ? Array.from(dialog.querySelectorAll<HTMLElement>('button, a[href]')) : [];
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // 時間割の右の列の中ではなく body の直下に出す（外側の要素の重なり順・transform に縛られて、
  // 授業カードの後ろに回ってしまうのを防ぐ）
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="QR コードを読み取る" className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl bg-surface overflow-hidden shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <p className="text-[15px] font-bold text-fg">QR コードを読み取る</p>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="閉じる" className="p-1.5 -mr-1.5 rounded-md text-fg-muted hover:text-fg hover:bg-surface-3">
            <FiX size={20} />
          </button>
        </div>

        {error ? (
          <p className="px-4 py-8 text-sm text-warn text-center">{error}</p>
        ) : result && isLmsUrl(result) ? (
          <div className="px-4 py-5 space-y-3">
            <p className="text-sm font-semibold text-fg">LMS のページを読み取りました。</p>
            <a
              href={result}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onClose}
              className="flex items-center justify-center gap-1.5 h-11 rounded-md bg-accent-solid hover:bg-accent-solid-hover text-on-accent transition-colors"
            >
              <span className="text-sm font-bold">開く</span>
              <FiExternalLink size={14} aria-hidden="true" />
            </a>
            <p className="text-xs text-fg-subtle break-all">{result}</p>
          </div>
        ) : result ? (
          <div className="px-4 py-5 space-y-2">
            <p className="text-sm font-semibold text-fg">LMS の URL ではないため、開きませんでした。</p>
            <p className="text-xs text-fg-muted break-all bg-surface-2 rounded-md px-3 py-2">{result}</p>
          </div>
        ) : (
          <div className="relative bg-black aspect-square">
            <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
            {/* 読み取り枠の目安 */}
            <div className="absolute inset-[18%] border-2 border-white/80 rounded-lg pointer-events-none" aria-hidden="true" />
          </div>
        )}
        <canvas ref={canvasRef} className="hidden" />
        <p className="px-4 py-3 text-xs text-fg-muted">
          出欠の QR コードを枠に合わせてください。LMS のページなら「開く」が出ます。
        </p>
      </div>
    </div>,
    document.body,
  );
}
