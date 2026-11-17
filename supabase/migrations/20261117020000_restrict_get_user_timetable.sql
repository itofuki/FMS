-- get_user_timetable の権限を絞る
--
-- これまで: ログインしていない人（anon）も含め、誰でも任意の p_user_id を指定して他人の時間割を読めた。
-- これから:
--   - 元の関数は get_user_timetable_unchecked に名前を変え、service_role だけが呼べるようにする（中身は変えない）
--   - 同じ名前 get_user_timetable で入口を作り直す。ログイン中のユーザーは自分の分だけ、
--     service_role（auth.uid() が null）は誰の分でも読める。anon は呼べない。
-- 呼び出し側（MyPage の切り替え用・get_effective_timetable）は変更不要。

do $$
declare
  v_sig regprocedure;
begin
  select p.oid::regprocedure into v_sig
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_user_timetable';

  if v_sig is null then
    raise exception 'public.get_user_timetable が見つかりません';
  end if;
  if v_sig::text <> 'get_user_timetable(uuid)' then
    raise exception '想定と違う引数です: %（uuid 1 つを想定）', v_sig;
  end if;

  execute format('alter function %s rename to get_user_timetable_unchecked', v_sig);
end;
$$;

revoke all on function public.get_user_timetable_unchecked(uuid) from public, anon, authenticated;
grant execute on function public.get_user_timetable_unchecked(uuid) to service_role;

create function public.get_user_timetable(p_user_id uuid)
returns table (
  id integer,
  name text,
  teacher text,
  wday text,
  period integer,
  classroom text,
  category_code text,
  attendance_id integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- 他人の時間割は読めない（service_role は auth.uid() が null なので通る。anon は実行権限がない）
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  return query
  select t.id::integer, t.name::text, t.teacher::text, t.wday::text, t.period::integer,
         t.classroom::text, t.category_code::text, t.attendance_id::integer
  from public.get_user_timetable_unchecked(p_user_id) t;
end;
$$;

revoke all on function public.get_user_timetable(uuid) from public, anon;
grant execute on function public.get_user_timetable(uuid) to authenticated, service_role;
