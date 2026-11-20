/* src/pages/LoginForm.tsx
 * LMS の ID とパスワードでログインする（Open LMS アプリと同じ）。
 * サーバーの lms-login が LMS で本人確認し、FMS のログイン状態と LMS のトークンを返す。
 * パスワードはどこにも保存しない。ログインと同時に「LMS 連携」も済む。
 */
import { Suspense, lazy, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from 'sonner';
import { supabase } from "../lib/supabaseClient";
import { clearLmsSession, getLmsSession, saveLmsSession } from "../lib/lms";
import { ThemeToggleButton } from "../components/ThemeToggle";
import { FiEye, FiEyeOff } from "react-icons/fi";

// 背景のアニメーション（元のトップページと同じ）。ログイン画面を開いたときだけ読み込む
const ParticlesBackground = lazy(() => import("../components/ParticlesBackground"));

type LoginResponse = {
  session?: { access_token: string; refresh_token: string };
  lms?: { token: string; userId: number; username: string };
  error?: string;
};

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1/lms-login`;
// LMS のサイト。今は東京キャンパスだけ対応（サーバーの lms-login も同じサイトだけを受け付ける）
const DEFAULT_SITE = 'lms-tokyo.iput.ac.jp';

// LMS の ID には「@」が入らない。入っていれば、以前のメールアドレスでのログインの名残（ブラウザの自動入力など）
const looksLikeEmail = (v: string) => v.includes('@');
const OLD_EMAIL_NOTICE = '以前のメールアドレスが入力されたため消しました。LMS の ID とパスワードを入れてください。';

// ログインに成功した ID とパスワードを、ブラウザのパスワード マネージャーに保存してもらう（Chrome・Edge）。
// 次からは LMS の ID が候補の先頭に来るので、以前のメールアドレスが自動で入りにくくなる。
// 対応していないブラウザでは何もしない（フォームの autocomplete の印から、ブラウザがいつもどおり保存を提案する）
type PasswordCredentialCtor = new (data: { id: string; password: string; name?: string }) => Credential;
function rememberCredential(id: string, password: string, name?: string) {
  const Ctor = (window as unknown as { PasswordCredential?: PasswordCredentialCtor }).PasswordCredential;
  if (!Ctor || !navigator.credentials?.store) return;
  try {
    navigator.credentials.store(new Ctor({ id, password, name: name || id })).catch(() => {});
  } catch {
    // 保存できなくてもログインには関係ない
  }
}

export default function LoginForm() {
  const [site, setSite] = useState(DEFAULT_SITE);
  // LMS のログインが切れたときの入れ直し（/login?relogin=1）。ID は前回のものを入れておく
  const [searchParams] = useSearchParams();
  const relogin = searchParams.get('relogin') === '1';
  const [username, setUsername] = useState(() => (relogin ? getLmsSession()?.username ?? localStorage.getItem('fms_lms_username') ?? '' : ''));
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  // LMS のサイトの入力欄を出しているか（「変更」を押したときだけ）
  const [editSite, setEditSite] = useState(false);
  const navigate = useNavigate();

  // すでにログインしていれば、ログイン画面は飛ばしてマイページへ（入れ直しのときは飛ばさない）
  useEffect(() => {
    if (relogin) return;
    supabase.auth.getSession().then(({ data }) => { if (data.session) navigate('/mypage', { replace: true }); });
  }, [navigate, relogin]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // 念のため送る前にも確かめる（以前のパスワードを LMS に送らない）
    if (looksLikeEmail(username)) {
      setUsername(''); setPassword(''); setNotice(OLD_EMAIL_NOTICE);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(FUNCTION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string },
        body: JSON.stringify({ site: site.trim(), username: username.trim(), password }),
      });
      const data = (await res.json().catch(() => ({}))) as LoginResponse;
      if (!res.ok || !data.session || !data.lms) {
        setError(data.error ?? "ログインに失敗しました");
        return;
      }

      // 別の人の LMS の情報（課題・出席率のキャッシュなど）が残っていれば消してから保存する
      if (getLmsSession()?.username !== data.lms.username) clearLmsSession();
      saveLmsSession(data.lms);

      const { error: sessionError } = await supabase.auth.setSession(data.session);
      if (sessionError) throw sessionError;

      rememberCredential(username.trim(), password, data.lms.username);
      setPassword("");
      toast.success("ログインしました");
      navigate("/mypage", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "ログインに失敗しました");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-bg relative min-h-screen flex items-center justify-center text-fg px-4 py-10">
      <Suspense fallback={null}>
        <ParticlesBackground />
      </Suspense>
      {/* 上の帯は置かず、テーマの切り替えだけを右上に浮かせる */}
      <div className="absolute top-3 right-3 z-20 rounded-full login-card border border-line">
        <ThemeToggleButton />
      </div>

      {/* X のログインと同じ形: 上の中央にロゴ、左寄せの大きな見出し、枠の中にラベルがある入力欄、丸いボタン */}
      <div className="login-card relative z-10 w-full max-w-[440px] px-8 sm:px-12 pt-8 pb-10 rounded-2xl border border-line">
        <div className="flex justify-center mb-6">
          <img src="/favicon.svg" alt="FMS" className="w-11 h-11" />
        </div>
        <h1 className="text-[28px] sm:text-[31px] font-extrabold leading-tight text-fg">FMS にログイン</h1>
        <p className="mt-2 mb-7 text-[15px] text-fg-muted">
          {relogin
            ? 'LMS のログインの有効期限が切れました。もう一度パスワードを入れてください。'
            : 'LMS の ID とパスワードを使います'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <FloatingField
            id="lms-id"
            label="LMS の ID"
            name="username"
            autoComplete="username"
            value={username}
            onChange={(e) => {
              const v = e.target.value;
              // 自動入力で以前のメールアドレスが入ったら、ID とパスワードの両方を消して知らせる
              if (looksLikeEmail(v)) {
                // ブラウザが入れたパスワードは、触るまで React に伝わらないことがあるので、欄の値も直接消す
                const pw = e.target.form?.elements.namedItem('password');
                if (pw instanceof HTMLInputElement) pw.value = '';
                setUsername(''); setPassword(''); setNotice(OLD_EMAIL_NOTICE);
                return;
              }
              setUsername(v);
              if (notice) setNotice(null);
            }}
          />

          <FloatingField
            id="lms-password"
            label="パスワード"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            trailing={
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                aria-label={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}
                aria-pressed={showPassword}
                className="w-9 h-9 rounded-full flex items-center justify-center text-fg-muted hover:bg-surface-3 transition-colors"
              >
                {showPassword ? <FiEyeOff size={18} /> : <FiEye size={18} />}
              </button>
            }
          />

          {/* LMS のサイト: ほとんど変えないので 1 行にまとめ、「変更」を押したときだけ入力欄を出す */}
          {editSite ? (
            <FloatingField
              id="lms-site"
              label="LMS のサイト"
              inputMode="url"
              value={site}
              onChange={(e) => setSite(e.target.value)}
            />
          ) : (
            <p className="text-sm text-fg-muted">
              接続先: <span className="text-fg">{site}</span>
              <button type="button" onClick={() => setEditSite(true)} className="ml-2 text-link hover:underline">変更</button>
            </p>
          )}

          {notice && <p role="status" className="text-sm text-warn font-semibold">{notice}</p>}
          {error && <p role="alert" className="text-sm text-down font-semibold">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-[52px] mt-2 rounded-full bg-accent-solid hover:bg-accent-solid-hover text-on-accent transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="font-bold text-[17px]">{loading ? 'ログイン中...' : 'ログイン'}</span>
          </button>
        </form>

        <p className="mt-6 text-[13px] text-fg-subtle text-center">
          パスワードは FMS に保存されません。
        </p>
      </div>
    </div>
  );
}

/**
 * X・Google と同じ入力欄: ラベルは枠の中にあり、入力中や値があるときは上に小さく移る。
 * 選んでいる間は枠とラベルをアクセントの色にする。
 */
function FloatingField({ id, label, trailing, className = '', ...input }: React.InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className={`relative rounded-md border border-line-strong bg-transparent focus-within:border-accent focus-within:ring-1 focus-within:ring-accent transition-colors ${className}`}>
      <input
        id={id}
        placeholder=" "
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
        className={`peer block w-full h-14 bg-transparent px-3 pt-5 pb-1 text-[17px] text-fg outline-none rounded-md ${trailing ? 'pr-12' : ''}`}
        {...input}
      />
      <label
        htmlFor={id}
        className="pointer-events-none absolute left-3 top-1.5 text-[13px] text-fg-muted transition-all duration-150
          peer-[:placeholder-shown:not(:focus)]:top-4 peer-[:placeholder-shown:not(:focus)]:text-[17px]
          peer-focus:text-accent"
      >
        {label}
      </label>
      {trailing && <div className="absolute right-2 top-1/2 -translate-y-1/2">{trailing}</div>}
    </div>
  );
}
