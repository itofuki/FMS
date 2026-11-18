-- ユーザーのコース（IA・IS など）と、管理者が決める LMS コースの既定値（曜日・時限・教室）
--
-- 1. profiles.course_code : ユーザーが所属するコースの記号（courses.code。例: IA = AI 戦略コース）。
--    LMS のコース名（「…_IA3A/IA3B」）から自動で入れ、設定で変えられる。
-- 2. lms_course_defaults  : LMS のコースごとの既定値。course_code が null なら全コース共通、
--    値があればそのコースのユーザーだけに使う。読むのは全員、書くのは管理者だけ。
-- 3. get_effective_timetable : 時間割に使う値の優先順を
--    本人の設定 > 管理者のコース別の既定値 > 管理者の全コース共通の既定値 > LMS のコース名から読み取った値 にする。

alter table public.profiles add column if not exists course_code text;

-- 管理者かどうか（RLS・RPC で共通に使う）
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin');
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create table public.lms_course_defaults (
  id bigint generated always as identity primary key,
  course_id integer not null,
  -- null は全コース共通
  course_code text,
  wday text check (wday in ('Mon', 'Tue', 'Wed', 'Thu', 'Fri')),
  periods integer[],
  classroom text check (char_length(classroom) <= 50),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

-- 同じコース・同じ対象（全コース共通 / 各コース）の既定値は 1 つだけ
create unique index lms_course_defaults_unique on public.lms_course_defaults (course_id, coalesce(course_code, ''));

alter table public.lms_course_defaults enable row level security;

create policy "lms_course_defaults_select_all"
  on public.lms_course_defaults for select
  to authenticated
  using (true);

create policy "lms_course_defaults_write_admin"
  on public.lms_course_defaults for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 管理者用: 誰かの時間割に出てくる LMS のコースの一覧（既定値を決める対象を選ぶため）
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
  select c.course_id,
         (array_agg(c.name order by c.updated_at desc))[1],
         (array_agg(c.fullname order by c.updated_at desc))[1],
         (array_agg(c.wday order by c.updated_at desc))[1],
         (array_agg(c.periods order by c.updated_at desc))[1],
         count(distinct c.user_id)
  from public.user_lms_courses c
  group by c.course_id
  order by 2;
end;
$$;

revoke all on function public.admin_list_lms_courses() from public, anon;
grant execute on function public.admin_list_lms_courses() to authenticated;

-- 時間割（既定値を使うように作り直す。返す列は同じ）
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

  if exists (select 1 from public.user_lms_courses c where c.user_id = p_user_id) then
    select p.course_code into v_course_code from public.profiles p where p.user_id = p_user_id;

    return query
    with legacy as (
      select t.id::integer as id, t.wday::text as wday, t.period::integer as period,
             t.classroom::text as classroom, t.category_code::text as category_code
      from public.get_user_timetable(p_user_id) t
    ),
    merged as (
      select
        c.course_id,
        c.name,
        c.teachers,
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
      m.course_id,
      m.name,
      case
        when cardinality(m.teachers) = 0 then ''
        when cardinality(m.teachers) <= 3 then array_to_string(m.teachers, '・')
        else array_to_string(m.teachers[1:2], '・') || ' ほか'
      end,
      m.m_wday,
      p.period,
      coalesce(m.m_classroom, l.classroom),
      l.category_code,
      m.attendance_id
    from merged m
    cross join lateral unnest(m.m_periods) as p(period)
    left join legacy l on l.id = m.course_id and l.wday = m.m_wday and l.period = p.period
    where m.m_wday is not null
    order by 4, 5;
  else
    return query
    select t.id::integer, t.name::text, t.teacher::text, t.wday::text, t.period::integer,
           t.classroom::text, t.category_code::text, t.attendance_id::integer
    from public.get_user_timetable(p_user_id) t;
  end if;
end;
$$;
