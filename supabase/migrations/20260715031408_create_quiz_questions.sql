-- テスト対策ページ用の一問一答クイズ問題テーブル
create table public.quiz_questions (
  id bigint generated always as identity primary key,
  subject_id bigint not null references public.subjects(id) on delete cascade,
  question text not null,
  answer text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.quiz_questions enable row level security;

-- 認証済みユーザーは全問題を閲覧可（管理者が作った問題を全員に公開する）
create policy "quiz_questions_select_authenticated"
  on public.quiz_questions for select
  to authenticated
  using (true);

-- 作成・更新・削除は role='admin' の profiles を持つユーザーのみ
create policy "quiz_questions_write_admin"
  on public.quiz_questions for all
  to authenticated
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin'));
