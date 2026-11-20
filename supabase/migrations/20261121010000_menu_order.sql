-- サブメニューの並び順（root が変える）
--
-- menu_visibility に並び順（sort_order。小さいほど上）を足す。
-- 設定（setting）は対象外で、いつもサブメニューのいちばん下に置く（アプリ側で固定）。
-- 並べ替えは root_set_menu_order に、上から順の項目の id を配列で渡す。

alter table public.menu_visibility add column if not exists sort_order integer not null default 0;

update public.menu_visibility set sort_order = case menu_id
  when 'test-prep' then 1
  when 'tips' then 2
  when 'feedback' then 3
  else sort_order
end;

create or replace function public.root_set_menu_order(p_menu_ids text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_root() then
    raise exception 'forbidden';
  end if;
  -- 渡された順に 1, 2, 3 ... を振る（行がない項目は表示の状態で作る）
  insert into public.menu_visibility (menu_id, visible, sort_order, updated_at, updated_by)
  select m.id, true, m.ord::integer, now(), auth.uid()
  from unnest(p_menu_ids) with ordinality as m(id, ord)
  on conflict (menu_id) do update
    set sort_order = excluded.sort_order, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
end;
$$;

revoke all on function public.root_set_menu_order(text[]) from public, anon;
grant execute on function public.root_set_menu_order(text[]) to authenticated;
