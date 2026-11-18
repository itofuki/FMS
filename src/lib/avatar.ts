/* src/lib/avatar.ts
 * プロフィールのアイコン（アバター）の画像を扱う。
 *   - 選んだ画像を、ブラウザの中で中央を正方形に切り抜いて 256px に縮小する
 *     （容量を小さくし、写真の撮影場所などの情報（Exif）も消える）
 *   - Supabase Storage の avatars/<user_id>/avatar.webp に置き、URL を user_metadata.avatar_url に保存する
 */
import { supabase } from './supabaseClient';

const SIZE = 256;
const BUCKET = 'avatars';

/** 中央を正方形に切り抜いて SIZE×SIZE に縮小した画像（webp。対応していなければ jpeg） */
export async function toSquareAvatar(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('画像ファイルを選んでください');
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('画像を加工できませんでした');
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  bitmap.close();
  const toBlob = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
  const blob = (await toBlob('image/webp')) ?? (await toBlob('image/jpeg'));
  if (!blob) throw new Error('画像を加工できませんでした');
  return blob;
}

/** アイコンを設定する。保存した画像の URL を返す */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const blob = await toSquareAvatar(file);
  const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${userId}/avatar.${ext}`;
  // 前の画像（拡張子違いを含む）を消してから置く
  await supabase.storage.from(BUCKET).remove([`${userId}/avatar.webp`, `${userId}/avatar.jpg`]);
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: blob.type, upsert: true, cacheControl: '3600' });
  if (error) throw error;
  // 同じ URL だとブラウザが古い画像を出し続けるので、更新のたびに変わる印を付ける
  const url = `${supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
  const { error: metaError } = await supabase.auth.updateUser({ data: { avatar_url: url } });
  if (metaError) throw metaError;
  return url;
}

/** アイコンを消す（名前の 1 文字目の表示に戻る） */
export async function removeAvatar(userId: string): Promise<void> {
  await supabase.storage.from(BUCKET).remove([`${userId}/avatar.webp`, `${userId}/avatar.jpg`]);
  const { error } = await supabase.auth.updateUser({ data: { avatar_url: null } });
  if (error) throw error;
}
