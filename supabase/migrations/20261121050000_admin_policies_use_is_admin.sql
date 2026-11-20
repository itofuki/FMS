-- 公式課題・テスト対策の書き込みを、開発者（root）にも許す
--
-- アプリは「管理者（profiles.role = 'admin'）か開発者（profiles.is_root）」を管理者として扱い、管理者モードを出す。
-- ところが公式課題（assignment）とテスト対策（quiz_questions・その画像）の書き込みの許可は role = 'admin' だけを見ていたため、
-- role が admin でない開発者が管理者モードで公式課題を追加すると「権限がありません」になっていた。
-- どちらも public.is_admin()（role = 'admin' または is_root）で判定するようにそろえる。

-- 公式課題（assignment）
drop policy if exists "Admins can insert official assignments" on public.assignment;
create policy "Admins can insert official assignments"
  on public.assignment for insert
  to authenticated
  with check (classification = 'official' and public.is_admin());

drop policy if exists "Admins can update official assignments" on public.assignment;
create policy "Admins can update official assignments"
  on public.assignment for update
  to authenticated
  using (classification = 'official' and public.is_admin())
  with check (classification = 'official' and public.is_admin());

drop policy if exists "Admins can delete official assignments" on public.assignment;
create policy "Admins can delete official assignments"
  on public.assignment for delete
  to authenticated
  using (classification = 'official' and public.is_admin());

-- テスト対策の問題（quiz_questions）
drop policy if exists "quiz_questions_write_admin" on public.quiz_questions;
create policy "quiz_questions_write_admin"
  on public.quiz_questions for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- テスト対策の問題の画像（images バケットの quiz/ 配下）
drop policy if exists "quiz_images_admin_insert" on storage.objects;
create policy "quiz_images_admin_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'images' and (storage.foldername(name))[1] = 'quiz' and public.is_admin());

drop policy if exists "quiz_images_admin_update" on storage.objects;
create policy "quiz_images_admin_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'images' and (storage.foldername(name))[1] = 'quiz' and public.is_admin());

drop policy if exists "quiz_images_admin_delete" on storage.objects;
create policy "quiz_images_admin_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'images' and (storage.foldername(name))[1] = 'quiz' and public.is_admin());
