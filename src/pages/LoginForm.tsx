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

export default function LoginForm() {
  const [site, setSite] = useState(DEFAULT_SITE);
  // LMS のログインが切れたときの入れ直し（/login?relogin=1）。ID は前回のものを入れておく
  const [searchParams] = useSearchParams();
  const relogin = searchParams.get('relogin') === '1';
  const [username, setUsername] = useState(() => (relogin ? getLmsSession()?.username ?? localStorage.getItem('fms_lms_username') ?? '' : ''));
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  // すでにログインしていれば、ログイン画面は飛ばしてマイページへ（入れ直しのときは飛ばさない）
  useEffect(() => {
    if (relogin) return;
    supabase.auth.getSession().then(({ data }) => { if (data.session) navigate('/mypage', { replace: true }); });
  }, [navigate, relogin]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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

      setPassword("");
      toast.success("ログインしました");
      navigate("/mypage", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "ログインに失敗しました");
    } finally {
      setLoading(false);
    }
  };

  const inputClass = "w-full px-4 py-3 rounded-xl bg-surface-2 text-fg placeholder-fg-subtle focus:ring-2 focus:ring-accent focus:outline-none border border-line";

  return (
    <div className="relative min-h-screen flex items-center justify-center text-fg px-2">
      <Suspense fallback={null}>
        <ParticlesBackground />
      </Suspense>
      <div className="relative z-10 w-full max-w-md p-8 rounded-2xl bg-surface shadow-sm border border-line">
        <h2 className="text-2xl font-bold text-center text-fg">ログイン</h2>
        <p className="mt-2 mb-6 text-sm text-center text-fg-muted">
          {relogin
            ? 'LMS のログインの有効期限が切れました。もう一度パスワードを入れてください。'
            : 'LMS の ID とパスワードでログインします'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="lms-site" className="block text-sm font-semibold mb-2 text-fg">LMS のサイト</label>
            <input
              id="lms-site"
              type="text"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={site}
              onChange={(e) => setSite(e.target.value)}
              className={inputClass}
              required
            />
          </div>

          <div>
            <label htmlFor="lms-id" className="block text-sm font-semibold mb-2 text-fg">LMS の ID</label>
            <input
              id="lms-id"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={inputClass}
              required
            />
          </div>

          <div>
            <label htmlFor="lms-password" className="block text-sm font-semibold mb-2 text-fg">パスワード</label>
            <input
              id="lms-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              required
            />
          </div>

          {error && <p role="alert" className="text-sm text-down font-semibold">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-accent-solid hover:bg-accent-solid-hover text-on-accent transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="font-semibold text-lg">{loading ? 'ログイン中...' : 'ログイン'}</span>
          </button>
        </form>

        <p className="mt-6 text-xs text-fg-subtle leading-relaxed">
          パスワードは FMS に保存されません。LMS で本人確認したあと、LMS のアクセストークンだけをこの端末に保存します（課題・出席率・時間割の取り込みに使います）。
        </p>
      </div>
    </div>
  );
}
