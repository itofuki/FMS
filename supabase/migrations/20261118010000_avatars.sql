-- プロフィールのアイコン（アバター）の置き場
--
-- avatars バケット（公開。画像の URL を知っていれば誰でも表示できる）に、各ユーザーが自分のフォルダ
-- （<user_id>/...）にだけ画像を置ける。ブラウザ側で正方形 256px に縮小してから送るので、上限は 1MB。
-- 画像の URL は auth.users の user_metadata.avatar_url に保存する（画面のどこでも追加の問い合わせなしで使える）。

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 自分のフォルダ（先頭のフォルダ名が自分の user id）だけ、置く・置き換える・消す・一覧できる
create policy "avatars_insert_own"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars_update_own"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars_delete_own"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars_select_own"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
