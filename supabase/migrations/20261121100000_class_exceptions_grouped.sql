-- 授業の変更を「1 つの授業・1 日につき 1 件」にまとめる
--
-- これまでは時限ごとに 1 件（period・start_time・end_time）だったため、2 限と 3 限の時刻を変えると 2 件になり、
-- 時限を動かす（例: 2 限 → 4 限）には休講と補講の 2 件が要った。1 件に時限の一覧と時限ごとの時刻を持たせる。
--   periods      : その日の授業の時限（変更: 動かした先も含めたその日の時限 / 休講: 休む時限 / 補講: 足す時限）。
--                  空なら既定値の時限すべて（休講・教室だけの変更）
--   period_times : 時限ごとの時刻 {"2": {"start": "11:00", "end": "12:30"}}（既定値と違う時限だけ）
-- 以前の 1 件ずつの行は、この形に移す。

alter table public.class_exceptions
  add column if not exists periods integer[],
  add column if not exists period_times jsonb;

update public.class_exceptions
set periods = case when period is null then null else array[period] end,
    period_times = case
      when period is not null and (start_time is not null or end_time is not null) then
        jsonb_build_object(period::text, jsonb_strip_nulls(jsonb_build_object(
          'start', to_char(start_time, 'HH24:MI'), 'end', to_char(end_time, 'HH24:MI'))))
      else null
    end;

-- 同じ授業・同じ日・同じ対象の行を 1 件（いちばん古い行）にまとめる（時限と時刻を合わせる。種類はいちばん古い行のもの）
do $$
declare
  g record;
begin
  for g in
    select min(id) as keep_id, course_id, coalesce(course_code, '') as code, date
    from public.class_exceptions
    group by course_id, coalesce(course_code, ''), date
    having count(*) > 1
  loop
    update public.class_exceptions k
    set periods = (
          select case when bool_or(e.periods is null) then null
                      else (select array_agg(distinct p order by p)
                            from public.class_exceptions e2, unnest(e2.periods) as p
                            where e2.course_id = g.course_id and coalesce(e2.course_code, '') = g.code and e2.date = g.date) end
          from public.class_exceptions e
          where e.course_id = g.course_id and coalesce(e.course_code, '') = g.code and e.date = g.date),
        period_times = (
          select jsonb_object_agg(t.k, t.v)
          from public.class_exceptions e3, jsonb_each(coalesce(e3.period_times, '{}'::jsonb)) as t(k, v)
          where e3.course_id = g.course_id and coalesce(e3.course_code, '') = g.code and e3.date = g.date)
    where k.id = g.keep_id;

    delete from public.class_exceptions e
    where e.course_id = g.course_id and coalesce(e.course_code, '') = g.code and e.date = g.date and e.id <> g.keep_id;
  end loop;
end;
$$;

alter table public.class_exceptions drop constraint if exists class_exceptions_extra_has_period;
alter table public.class_exceptions drop constraint if exists class_exceptions_time_order;
alter table public.class_exceptions drop column if exists period;
alter table public.class_exceptions drop column if exists start_time;
alter table public.class_exceptions drop column if exists end_time;
alter table public.class_exceptions
  add constraint class_exceptions_extra_has_periods check (kind <> 'extra' or (periods is not null and cardinality(periods) > 0));

-- 1 つの授業・1 日・1 対象につき 1 件
create unique index if not exists class_exceptions_one_per_day
  on public.class_exceptions (course_id, coalesce(course_code, ''), date);

drop function if exists public.get_class_exceptions(uuid, date, date);

create function public.get_class_exceptions(p_user_id uuid, p_from date, p_to date)
returns table (
  id bigint,
  course_id integer,
  name text,
  date date,
  kind text,
  periods integer[],
  period_times jsonb,
  classroom text,
  note text,
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

  select p.course_code into v_course_code from public.profiles p where p.user_id = p_user_id;

  -- 同じ授業・同じ日に「全コース共通」と「自分のコース向け」の両方があれば、自分のコース向けを使う
  return query
  select distinct on (e.course_id, e.date)
    e.id,
    e.course_id,
    c.name::text,
    e.date,
    e.kind::text,
    e.periods,
    e.period_times,
    nullif(e.classroom, '')::text,
    nullif(e.note, '')::text,
    c.attendance_id
  from public.class_exceptions e
  join public.user_lms_courses c on c.user_id = p_user_id and c.course_id = e.course_id
  where e.date between p_from and p_to
    and (e.course_code is null or e.course_code = v_course_code)
  order by e.course_id, e.date, (e.course_code is null), e.id;
end;
$$;

revoke all on function public.get_class_exceptions(uuid, date, date) from public, anon;
grant execute on function public.get_class_exceptions(uuid, date, date) to authenticated, service_role;
