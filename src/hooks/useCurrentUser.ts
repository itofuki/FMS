/* src/hooks/useCurrentUser.ts
 * ログイン中のユーザー（名前・アイコンなど）。ログイン・ログアウトやアイコンの変更にすぐ追従する。
 */
import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';

export function useCurrentUser(): User | null {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);
  return user;
}

/** 画面に出す名前（LMS の名前 → LMS の ID の順） */
export function displayName(user: User | null): string {
  const m = user?.user_metadata ?? {};
  return (m.full_name as string) || (m.lms_username as string) || '';
}
