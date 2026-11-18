/* src/components/RootRedirect.tsx
 * トップ（/）は画面を持たず、ログイン済みならマイページ、未ログインならログイン画面へすぐ移る。
 */
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';

export default function RootRedirect() {
  const [to, setTo] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setTo(data.session ? '/mypage' : '/login'));
  }, []);
  return to ? <Navigate to={to} replace /> : null;
}
