/* src/hooks/useUserProfile.ts
 * ログイン中のユーザーと、その profiles.role を取得する共通フック。
 * （Assignments / TestPrep などで重複していたクエリを集約）
 */
import { useQuery } from '@tanstack/react-query';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';

export type UserRole = 'admin' | 'user';

export function useCurrentUser() {
  return useQuery<User | null>({
    queryKey: ['currentUser'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      return user;
    },
    staleTime: Infinity,
  });
}

export function useUserProfile() {
  const { data: currentUser, isLoading: isLoadingUser } = useCurrentUser();

  const { data: userProfile, isLoading: isLoadingProfile } = useQuery({
    queryKey: ['userProfile', currentUser?.id],
    queryFn: async () => {
      if (!currentUser) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select('role, is_root')
        .eq('user_id', currentUser.id)
        .maybeSingle();
      if (error) {
        console.error('Profile fetch error:', error);
        return null;
      }
      return data as { role: string | null; is_root: boolean | null } | null;
    },
    enabled: !!currentUser?.id,
  });

  // root は admin の権限も持つ（公式課題の追加・コースの既定値）。さらにほかのアカウントに admin を付けられる
  const isRoot = !!userProfile?.is_root;
  const userRole: UserRole = userProfile?.role === 'admin' || isRoot ? 'admin' : 'user';

  return {
    currentUser: currentUser ?? null,
    userRole,
    isRoot,
    isLoading: isLoadingUser || isLoadingProfile,
  };
}
