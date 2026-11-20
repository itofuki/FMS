-- サブメニューの表示・非表示（root が切り替える）
--
-- テスト対策などのサブメニューを、テスト期間だけ出すといった切り替えを、コードを直さずにできるようにする。
--   - menu_visibility : サブメニューの項目ごとに「全員に見せるか」を持つ。行がない項目は表示する
--   - 読むのはログイン中の全員（メニューを組み立てるため）。変えられるのは root だけ（root_set_menu_visibility）
--   - 設定（setting）は、ここから戻せなくならないよう対象にしない
-- 非表示にしても、その画面のデータ（テスト対策の問題など）は消さない。表示に戻せば前と同じ内容が出る。

create table if not exists public.menu_visibility (
  menu_id text primary key check (menu_id in ('test-prep', 'tips', 'feedback')),
  visible boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.menu_visibility enable row level security;

drop policy if exists "menu_visibility readable by signed-in users" on public.menu_visibility;
create policy "menu_visibility readable by signed-in users"
  on public.menu_visibility for select
  to authenticated
  using (true);

-- 書き込みは下の関数だけ（直接の insert / update / delete は誰にも許さない）
revoke insert, update, delete on public.menu_visibility from anon, authenticated;
grant select on public.menu_visibility to authenticated;

-- 今はテスト期間ではないので、テスト対策は隠しておく（Tips・ご意見は表示）
insert into public.menu_visibility (menu_id, visible) values
  ('test-prep', false),
  ('tips', true),
  ('feedback', true)
on conflict (menu_id) do nothing;

create or replace function public.root_set_menu_visibility(p_menu_id text, p_visible boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_root() then
    raise exception 'forbidden';
  end if;
  insert into public.menu_visibility (menu_id, visible, updated_at, updated_by)
  values (p_menu_id, p_visible, now(), auth.uid())
  on conflict (menu_id) do update
    set visible = excluded.visible, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
end;
$$;

revoke all on function public.root_set_menu_visibility(text, boolean) from public, anon;
grant execute on function public.root_set_menu_visibility(text, boolean) to authenticated;
