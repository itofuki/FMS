-- 時間割を LMS から作る
--
-- 1. user_lms_courses     : ブラウザが LMS から取った今学期のコース（コース名から読み取った曜日・時限、担当、出欠ページ）
-- 2. user_course_settings : ユーザーが設定画面で入れた補足（曜日・時限の上書き、教室、時間割に出さない）
-- 3. get_effective_timetable(p_user_id) : 画面・授業前の通知・カレンダー購読が共通で使う時間割。
--      LMS のコースがあればそれを使い、なければ従来の get_user_timetable（学科・クラスからの時間割）を返す。

-- ------------------------------------------------------------
-- 1. LMS のコース
-- ------------------------------------------------------------
create table public.user_lms_courses (
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id integer not null,
  name text not null,
  fullname text not null,
  wday text check (wday in ('Mon', 'Tue', 'Wed', 'Thu', 'Fri')),
  periods integer[],
  teachers text[] not null default '{}',
  attendance_id integer,
  updated_at timestamptz not null default now(),
  primary key (user_id, course_id)
);

alter table public.user_lms_courses enable row level security;

create policy "user_lms_courses_all_own"
  on public.user_lms_courses for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 自分のコース一覧を丸ごと置き換える（LMS から取り直すたびに呼ぶ）
create or replace function public.sync_user_lms_courses(p_items jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 100 then
    raise exception 'invalid items';
  end if;

  delete from public.user_lms_courses where user_id = auth.uid();

  insert into public.user_lms_courses (user_id, course_id, name, fullname, wday, periods, teachers, attendance_id)
  select
    auth.uid(),
    i.course_id,
    left(i.name, 200),
    left(i.fullname, 300),
    case when i.wday in ('Mon', 'Tue', 'Wed', 'Thu', 'Fri') then i.wday end,
    (select array_agg(p) from unnest(i.periods) p where p between 1 and 6),
    coalesce((select array_agg(left(t, 100)) from unnest(i.teachers[1:20]) t), '{}'),
    i.attendance_id
  from jsonb_to_recordset(p_items) as i(
    course_id integer, name text, fullname text, wday text, periods integer[], teachers text[], attendance_id integer
  )
  where i.course_id is not null and i.name is not null and i.fullname is not null
  on conflict (user_id, course_id) do nothing;
end;
$$;

revoke all on function public.sync_user_lms_courses(jsonb) from public, anon;
grant execute on function public.sync_user_lms_courses(jsonb) to authenticated;

-- ------------------------------------------------------------
-- 2. 設定画面で入れる補足
-- ------------------------------------------------------------
create table public.user_course_settings (
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id integer not null,
  -- null なら LMS のコース名から読み取った値を使う
  wday text check (wday in ('Mon', 'Tue', 'Wed', 'Thu', 'Fri')),
  periods integer[],
  classroom text check (char_length(classroom) <= 50),
  hidden boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, course_id)
);

alter table public.user_course_settings enable row level security;

create policy "user_course_settings_all_own"
  on public.user_course_settings for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ------------------------------------------------------------
-- 3. 共通で使う時間割
-- ------------------------------------------------------------
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
begin
  -- ログイン中のユーザーは自分の分だけ（service_role は auth.uid() が null なので誰の分でも読める）
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  if exists (select 1 from public.user_lms_courses c where c.user_id = p_user_id) then
    return query
    with legacy as (
      -- 教室・カテゴリーは、従来の時間割に同じコース・曜日・時限があればそれを初期値にする
      select t.id::integer as id, t.wday::text as wday, t.period::integer as period,
             t.classroom::text as classroom, t.category_code::text as category_code
      from public.get_user_timetable(p_user_id) t
    )
    select
      c.course_id,
      c.name,
      case
        when cardinality(c.teachers) = 0 then ''
        when cardinality(c.teachers) <= 3 then array_to_string(c.teachers, '・')
        else array_to_string(c.teachers[1:2], '・') || ' ほか'
      end,
      coalesce(s.wday, c.wday),
      p.period,
      coalesce(nullif(s.classroom, ''), l.classroom),
      l.category_code,
      c.attendance_id
    from public.user_lms_courses c
    left join public.user_course_settings s on s.user_id = c.user_id and s.course_id = c.course_id
    cross join lateral unnest(coalesce(s.periods, c.periods)) as p(period)
    left join legacy l on l.id = c.course_id and l.wday = coalesce(s.wday, c.wday) and l.period = p.period
    where c.user_id = p_user_id
      and not coalesce(s.hidden, false)
      and coalesce(s.wday, c.wday) is not null
    order by 4, 5;
  else
    return query
    select t.id::integer, t.name::text, t.teacher::text, t.wday::text, t.period::integer,
           t.classroom::text, t.category_code::text, t.attendance_id::integer
    from public.get_user_timetable(p_user_id) t;
  end if;
end;
$$;

revoke all on function public.get_effective_timetable(uuid) from public, anon;
grant execute on function public.get_effective_timetable(uuid) to authenticated, service_role;
