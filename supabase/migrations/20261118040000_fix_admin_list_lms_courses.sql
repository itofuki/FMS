-- admin_list_lms_courses の修正
-- 「structure of query does not match function result type」になっていた。
-- 時限（integer[]）を array_agg でまとめると、配列の配列（2 次元）になり、宣言した戻り値の形と合わないため。
-- コースごとに最新の 1 行を distinct on で選ぶ形にし、各列の型も明示する。

create or replace function public.admin_list_lms_courses()
returns table (course_id integer, name text, fullname text, wday text, periods integer[], users bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  return query
  with latest as (
    -- コースごとに、いちばん最近取り込まれた行（名前・時限はそれを使う）
    select distinct on (c.course_id)
      c.course_id, c.name, c.fullname, c.wday, c.periods
    from public.user_lms_courses c
    order by c.course_id, c.updated_at desc
  ),
  counts as (
    select c.course_id, count(distinct c.user_id) as users
    from public.user_lms_courses c
    group by c.course_id
  )
  select l.course_id::integer, l.name::text, l.fullname::text, l.wday::text, l.periods::integer[], n.users::bigint
  from latest l
  join counts n on n.course_id = l.course_id
  order by l.name;
end;
$$;
