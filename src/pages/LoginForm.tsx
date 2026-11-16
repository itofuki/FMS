/* src/pages/LoginForm.tsx */

import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { Link, useNavigate } from "react-router-dom";
import { toast } from 'sonner';

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // SupabaseのsignInWithPasswordメソッドを呼び出す
      const { error } = await supabase.auth.signInWithPassword({
        email: email,
        password: password,
      });
      if (error) throw error;
      toast.success("ログインしました！");
      navigate("/mypage");
    } catch (error) {
      if (error instanceof Error) {
        toast.error(error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center text-fg mx-2">
      <div className="w-full max-w-md p-8 rounded-2xl bg-surface shadow-sm border border-line">
        <h2 className="text-3xl font-bold text-center mb-6 text-accent">
          🔮 Login Form
        </h2>
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Email */}
          <div>
            <label className="block text-sm mb-2 text-fg-muted">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-surface-2 text-fg placeholder-fg-subtle focus:ring-2 focus:ring-accent focus:outline-none border border-line"
              placeholder="you@example.com"
              required
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm mb-2 text-fg-muted">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-surface-2 text-fg placeholder-fg-subtle focus:ring-2 focus:ring-accent focus:outline-none border border-line"
              placeholder="********"
              required
            />
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            // ✨ 変更点: ローディング中はボタンを無効化し、スタイルも変更
            disabled={loading}
            className="w-full py-3 rounded-xl bg-accent-solid hover:bg-accent-solid-hover font-semibold text-lg text-on-accent transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {/* ✨ 変更点: ローディング状態に応じてボタンのテキストを変更 */}
            {loading ? 'ログイン中...' : 'Login'}
          </button>
        </form>

        {/* Register link */}
        <p className="text-center mt-6 text-sm text-fg-muted">
          Don't have an account?{" "}
          <Link to="/register" className="text-accent hover:underline">
            Register here
          </Link>
        </p>
      </div>
    </div>
  );
}