-- 授業の開始・終了時刻の調整（管理者）
--
-- 授業によっては、本来の時限（1限 9:15〜10:55 など）とずれた時刻で行われる。
-- 管理者がコースの既定値（lms_course_defaults）に開始・終了の時刻を入れられるようにし、
-- 時間割の表示・授業中の判定・出欠の時間・授業前の通知・カレンダー連携をその時刻に合わせる。
--   - start_time / end_time : 空ならその時限の本来の時刻。片方だけでもよい
--   - 2 コマ続きの授業（periods が 2 つ以上）は、開始を最初の時限に、終了を最後の時限に当てはめる
-- get_effective_timetable は戻り値に start_time / end_time（'HH:MM'、ずれていなければ null）を足すため、作り直す。

alter table public.lms_course_defaults
  add column if not exists start_time time,
  add column if not exists end_time time;

alter table public.lms_course_defaults drop constraint if exists lms_course_defaults_time_order;
alter table public.lms_course_defaults
  add constraint lms_course_defaults_time_order check (start_time is null or end_time is null or start_time < end_time);

drop function if exists public.get_effective_timetable(uuid);

create function public.get_effective_timetable(p_user_id uuid)
returns table (
  id integer,
  name text,
  teacher text,
  wday text,
  period integer,
  classroom text,
  category_code text,
  attendance_id integer,
  start_time text,
  end_time text
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_course_code text;
begin
  -- ログイン中のユーザーは自分の分だけ（service_role は auth.uid() が null なので誰の分でも読める）
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  select p.course_code into v_course_code from public.profiles p where p.user_id = p_user_id;

  return query
  with merged as (
    select
      c.course_id,
      c.name,
      c.teachers,
      coalesce(nullif(dc.teacher, ''), nullif(da.teacher, '')) as m_teacher,
      c.attendance_id,
      coalesce(s.wday, dc.wday, da.wday, c.wday) as m_wday,
      coalesce(s.periods, dc.periods, da.periods, c.periods) as m_periods,
      coalesce(nullif(s.classroom, ''), nullif(dc.classroom, ''), nullif(da.classroom, '')) as m_classroom,
      -- 時刻は管理者の既定値だけ（コース別 > 全コース共通）
      coalesce(dc.start_time, da.start_time) as m_start,
      coalesce(dc.end_time, da.end_time) as m_end
    from public.user_lms_courses c
    left join public.user_course_settings s on s.user_id = c.user_id and s.course_id = c.course_id
    left join public.lms_course_defaults dc on dc.course_id = c.course_id and dc.course_code = v_course_code
    left join public.lms_course_defaults da on da.course_id = c.course_id and da.course_code is null
    where c.user_id = p_user_id
      and not coalesce(s.hidden, false)
  )
  select
    m.course_id::integer,
    m.name::text,
    coalesce(m.m_teacher, case
      when cardinality(m.teachers) = 0 then ''
      when cardinality(m.teachers) <= 3 then array_to_string(m.teachers, '・')
      else array_to_string(m.teachers[1:2], '・') || ' ほか'
    end)::text,
    m.m_wday::text,
    p.period::integer,
    m.m_classroom::text,
    null::text,
    m.attendance_id::integer,
    case when p.period = (select min(x) from unnest(m.m_periods) as x) then to_char(m.m_start, 'HH24:MI') end::text,
    case when p.period = (select max(x) from unnest(m.m_periods) as x) then to_char(m.m_end, 'HH24:MI') end::text
  from merged m
  cross join lateral unnest(m.m_periods) as p(period)
  where m.m_wday is not null
  order by 4, 5;
end;
$$;

revoke all on function public.get_effective_timetable(uuid) from public, anon;
grant execute on function public.get_effective_timetable(uuid) to authenticated, service_role;
