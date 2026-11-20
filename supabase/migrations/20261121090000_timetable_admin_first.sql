-- 時間割は管理者の情報を正とする（学生が上書きできるのは「時間割に出すかどうか」だけ）
--
-- これまで学生が設定（user_course_settings）で入れた曜日・時限・教室は、管理者の既定値より優先していた。
-- 管理者が既定値や授業の変更（休講・補講）で時間割を管理するようになったため、学生の値が優先されると
-- 管理者が直しても反映されず、授業の変更も時限がずれて当たらなくなる。そこで:
--   - 曜日・時限 : 管理者の既定値 > LMS のコース名から読み取った値 > 本人が入れた値（ほかで決まらない授業のときだけ）
--   - 教室       : 管理者の既定値だけ（本人が入れた教室は使わない）
--   - 時間割に出すかどうか（hidden）: これまでどおり本人が決める
-- 本人が以前に入れた値は消さずに残す（曜日・時限が決まらない授業のときに使う）。

create or replace function public.get_effective_timetable(p_user_id uuid)
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
      -- 曜日・時限: 管理者の既定値（コース別 > 全コース共通）> LMS のコース名から読み取った値 > 本人が入れた値
      -- （本人の値は、ほかで決まらない授業のときだけ使う）
      coalesce(dc.wday, da.wday, c.wday, s.wday) as m_wday,
      coalesce(dc.periods, da.periods, c.periods, s.periods) as m_periods,
      -- 教室: 管理者の既定値だけ（本人が入れた教室は使わない）
      coalesce(nullif(dc.classroom, ''), nullif(da.classroom, '')) as m_classroom,
      -- 時刻は管理者の既定値だけ（コース別 > 全コース共通）
      coalesce(dc.period_times, da.period_times) as m_times,
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
    -- 時限ごとの時刻 > 以前の形（最初の時限の開始・最後の時限の終了）
    coalesce(
      nullif(m.m_times -> p.period::text ->> 'start', ''),
      case when p.period = (select min(x) from unnest(m.m_periods) as x) then to_char(m.m_start, 'HH24:MI') end
    )::text,
    coalesce(
      nullif(m.m_times -> p.period::text ->> 'end', ''),
      case when p.period = (select max(x) from unnest(m.m_periods) as x) then to_char(m.m_end, 'HH24:MI') end
    )::text
  from merged m
  cross join lateral unnest(m.m_periods) as p(period)
  where m.m_wday is not null
  order by 4, 5;
end;
$$;
