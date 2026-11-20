/* src/components/AvatarSettings.tsx
 * 設定の「アカウント」のアイコン（アバター）の欄。画像を選ぶとすぐ保存する（正方形 256px に縮小してから送る）。
 */
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { FiCamera, FiTrash2 } from 'react-icons/fi';
import Avatar from './Avatar';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { removeAvatar, uploadAvatar } from '../lib/avatar';

const errorText = (e: unknown) => {
  const x = e as { message?: string };
  return x?.message || String(e);
};

export default function AvatarSettings() {
  const user = useCurrentUser();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const hasAvatar = !!user?.user_metadata?.avatar_url;

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 同じ画像を選び直しても反応するように
    if (!file || !user) return;
    if (file.size > 20 * 1024 * 1024) {
      toast.error('画像が大きすぎます（20MB まで）');
      return;
    }
    setBusy(true);
    try {
      await uploadAvatar(user.id, file);
    } catch (err) {
      toast.error(`アイコンを保存できませんでした: ${errorText(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await removeAvatar(user.id);
    } catch (err) {
      toast.error(`アイコンを削除できませんでした: ${errorText(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        aria-label="アイコンの画像を選ぶ"
        className="relative rounded-full group disabled:opacity-60"
      >
        <Avatar user={user} size={72} />
        <span className="absolute inset-0 rounded-full bg-black/40 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true">
          <FiCamera size={22} />
        </span>
      </button>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full border border-line-strong text-fg hover:bg-surface-2 transition-colors disabled:opacity-50"
          >
            <FiCamera size={14} aria-hidden="true" />
            <span className="text-sm font-bold">{busy ? '保存中...' : hasAvatar ? '画像を変える' : '画像を選ぶ'}</span>
          </button>
          {hasAvatar && (
            <button
              type="button"
              onClick={onRemove}
              disabled={busy}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-down hover:bg-down-soft transition-colors disabled:opacity-50"
            >
              <FiTrash2 size={14} aria-hidden="true" />
              <span className="text-sm font-bold">削除</span>
            </button>
          )}
        </div>
        <p className="text-xs text-fg-subtle">中央を正方形に切り抜いて使います</p>
      </div>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
    </div>
  );
}
