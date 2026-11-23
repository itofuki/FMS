-- 自分で追加する授業（臨時授業など、LMS にない授業）
--
-- LMS のコースにない授業を、学生が自分の時間割に日付を指定して足せるようにする（本人だけに出る）。
--   - user_extra_classes : 名前・日付・時限・時限ごとの時刻・教室・メモ
--   - get_class_exceptions : 本人の追加授業を「補講」と同じ形（kind = 'extra'）で一緒に返す。
--     LMS のコースではないので course_id は負の数（-id）にし、画面・通知・カレンダーでは LMS へのリンクを付けない

create table if not exists public.user_extra_classes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  date date not null,
  periods integer[] not null check (cardinality(periods) > 0),
  period_times jsonb,
  classroom text check (char_length(classroom) <= 50),
  note text check (char_length(note) <= 200),
  created_at timestamptz not null default now()
);

create index if not exists user_extra_classes_user_date on public.user_extra_classes (user_id, date);

alter table public.user_extra_classes enable row level security;

drop policy if exists "user_extra_classes_all_own" on public.user_extra_classes;
create policy "user_extra_classes_all_own"
  on public.user_extra_classes for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.user_extra_classes to authenticated;

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

  return query
  -- 管理者が登録した授業の変更（同じ授業・同じ日に「全コース共通」と「自分のコース向け」があれば、自分のコース向け）
  (
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
    order by e.course_id, e.date, (e.course_code is null), e.id
  )
  union all
  -- 自分で追加した授業（補講と同じ形。course_id は負の数）
  select
    x.id,
    (-x.id)::integer,
    x.name::text,
    x.date,
    'extra'::text,
    x.periods,
    x.period_times,
    nullif(x.classroom, '')::text,
    nullif(x.note, '')::text,
    null::integer
  from public.user_extra_classes x
  where x.user_id = p_user_id
    and x.date between p_from and p_to;
end;
$$;

revoke all on function public.get_class_exceptions(uuid, date, date) from public, anon;
grant execute on function public.get_class_exceptions(uuid, date, date) to authenticated, service_role;
