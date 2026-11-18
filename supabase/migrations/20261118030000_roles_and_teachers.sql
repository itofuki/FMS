-- 権限（root / admin）と、管理者が決める担当の先生
--
-- 1. root : profiles.is_root = true。admin の権限をほかのアカウントに付けたり外したりできる（root 自身も admin として扱う）。
--    root を付けるのは SQL Editor から（アプリからは付けられない）。
-- 2. admin: profiles.role = 'admin'（これまでどおり）。公式課題の追加、LMS コースの既定値（曜日・時限・教室・担当の先生）を決められる。
-- 3. lms_course_defaults.teacher : 管理者が決める担当の先生。時間割では LMS の担当より優先する。
-- 4. courses.representative_lms_url を API から読めないようにする（LMS カレンダーの認証トークン入りの URL が入っており、
--    ログインしていない人でも読めてしまっていた。アプリでは使っていない）。

-- ------------------------------------------------------------
-- 1・2. 権限
-- ------------------------------------------------------------
alter table public.profiles add column if not exists is_root boolean not null default false;

create or replace function public.is_root()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_root);
$$;

-- admin か root なら管理者として扱う
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles p where p.user_id = auth.uid() and (p.role = 'admin' or p.is_root));
$$;

revoke all on function public.is_root() from public, anon;
grant execute on function public.is_root() to authenticated;

-- root 用: アカウントの一覧（名前・LMS の ID・権限）。p_query で名前か ID を絞り込む
create or replace function public.root_list_users(p_query text default '')
returns table (user_id uuid, full_name text, lms_username text, role text, is_root boolean)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public.is_root() then
    raise exception 'forbidden';
  end if;
  return query
  select u.id,
         (u.raw_user_meta_data ->> 'full_name')::text,
         (u.raw_user_meta_data ->> 'lms_username')::text,
         p.role::text,
         coalesce(p.is_root, false)
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  where coalesce(p_query, '') = ''
     or (u.raw_user_meta_data ->> 'full_name') ilike '%' || p_query || '%'
     or (u.raw_user_meta_data ->> 'lms_username') ilike '%' || p_query || '%'
  order by coalesce(p.is_root, false) desc, (p.role = 'admin') desc nulls last, u.raw_user_meta_data ->> 'lms_username'
  limit 100;
end;
$$;

-- root 用: admin の権限を付ける・外す（root のアカウントは対象外）
create or replace function public.root_set_admin(p_user_id uuid, p_admin boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_root() then
    raise exception 'forbidden';
  end if;
  if exists (select 1 from public.profiles p where p.user_id = p_user_id and p.is_root) then
    raise exception 'root のアカウントの権限は変更できません';
  end if;
  insert into public.profiles (user_id, role)
  values (p_user_id, case when p_admin then 'admin' end)
  on conflict (user_id) do update set role = excluded.role;
end;
$$;

revoke all on function public.root_list_users(text) from public, anon;
revoke all on function public.root_set_admin(uuid, boolean) from public, anon;
grant execute on function public.root_list_users(text) to authenticated;
grant execute on function public.root_set_admin(uuid, boolean) to authenticated;

-- ------------------------------------------------------------
-- 3. 担当の先生の既定値
-- ------------------------------------------------------------
alter table public.lms_course_defaults add column if not exists teacher text check (char_length(teacher) <= 100);

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
      m.course_id,
      m.name,
      coalesce(m.m_teacher, case
        when cardinality(m.teachers) = 0 then ''
        when cardinality(m.teachers) <= 3 then array_to_string(m.teachers, '・')
        else array_to_string(m.teachers[1:2], '・') || ' ほか'
      end),
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

-- ------------------------------------------------------------
-- 4. courses の認証トークン入りの列を API から読めなくする
-- ------------------------------------------------------------
revoke select on public.courses from anon, authenticated;
grant select (id, department_id, name, created_at) on public.courses to anon, authenticated;
