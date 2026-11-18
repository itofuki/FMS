/* src/components/Avatar.tsx
 * プロフィールのアイコン。画像がなければ、名前の 1 文字目を丸の中に出す。
 */
import { useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { displayName } from '../hooks/useCurrentUser';

export default function Avatar({ user, size = 36, className = '' }: { user: User | null; size?: number; className?: string }) {
  const url = user?.user_metadata?.avatar_url as string | undefined;
  const [broken, setBroken] = useState<string | null>(null);
  const name = displayName(user);
  const initial = name.replace(/^[\s（(]+/, '').charAt(0).toUpperCase() || '?';
  const style = { width: size, height: size };

  if (url && broken !== url) {
    return (
      <img
        src={url}
        alt=""
        style={style}
        onError={() => setBroken(url)}
        className={`rounded-full object-cover bg-surface-3 flex-shrink-0 ${className}`}
      />
    );
  }
  return (
    <span
      style={{ ...style, fontSize: Math.round(size * 0.42) }}
      className={`rounded-full bg-accent-soft text-accent font-bold flex items-center justify-center flex-shrink-0 select-none ${className}`}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}
