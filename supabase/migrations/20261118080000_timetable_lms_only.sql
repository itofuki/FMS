-- 時間割を LMS のコースだけから作る
--
-- 全員が LMS の ID でログインし、学科・クラスは使わなくなったため、get_effective_timetable から
-- 学科・クラスから作る従来の時間割（get_user_timetable）への切り替えと、そこから教室の初期値を引く処理をなくす。
-- LMS のコースがない人は、時間割が空になる（画面では設定の「時間割（LMS のコース）」へ案内する）。
-- 優先順は変えない: 本人の設定 > 管理者のコース別の既定値 > 全コース共通の既定値 > LMS のコース名から読み取った値。

create or replace function public.get_effective_timetable(p_user_id uuid)
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
      coalesce(nullif(s.classroom, ''), nullif(dc.classroom, ''), nullif(da.classroom, '')) as m_classroom
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
    m.attendance_id::integer
  from merged m
  cross join lateral unnest(m.m_periods) as p(period)
  where m.m_wday is not null
  order by 4, 5;
end;
$$;
