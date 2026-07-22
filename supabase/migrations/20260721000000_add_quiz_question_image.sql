-- クイズ問題に画像を添付できるようにする
alter table public.quiz_questions
  add column image_url text;

-- 問題画像の保存先バケット（既に存在する場合は何もしない）
insert into storage.buckets (id, name, public)
values ('images', 'images', true)
on conflict (id) do nothing;

-- 誰でも images バケットのファイルを閲覧可能（公開URLでの表示用）
create policy "images_public_read"
  on storage.objects for select
  to public
  using (bucket_id = 'images');

-- quiz/ 配下への書き込みは role='admin' の profiles を持つユーザーのみ
create policy "quiz_images_admin_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'images'
    and (storage.foldername(name))[1] = 'quiz'
    and exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin')
  );

create policy "quiz_images_admin_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'images'
    and (storage.foldername(name))[1] = 'quiz'
    and exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin')
  );

create policy "quiz_images_admin_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'images'
    and (storage.foldername(name))[1] = 'quiz'
    and exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin')
  );
