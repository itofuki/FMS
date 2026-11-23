-- 臨時授業を管理者の機能にする
--
-- 20261122000000 では学生が自分の時間割に授業を足す形（user_extra_classes）にしたが、管理者が登録して
-- 対象の学生全員に出す形にする（授業の変更と同じく、全コース共通か特定のコース向け）。
--   - extra_classes : 名前・対象・日付・時限・時限ごとの時刻・教室・メモ（読むのはログイン中の全員、書くのは管理者だけ）
--   - get_class_exceptions : 自分が対象の臨時授業を「補講」と同じ形（kind = 'extra'、course_id は負の数）で一緒に返す
-- user_extra_classes はまだ使われていない（0 件）ので消す。

drop table if exists public.user_extra_classes;

create table if not exists public.extra_classes (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 100),
  -- 空なら全コース共通
  course_code text,
  date date not null,
  periods integer[] not null check (cardinality(periods) > 0),
  period_times jsonb,
  classroom text check (char_length(classroom) <= 50),
  note text check (char_length(note) <= 200),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create index if not exists extra_classes_date on public.extra_classes (date);

alter table public.extra_classes enable row level security;

drop policy if exists "extra_classes readable by signed-in users" on public.extra_classes;
create policy "extra_classes readable by signed-in users"
  on public.extra_classes for select
  to authenticated
  using (true);

drop policy if exists "extra_classes writable by admins" on public.extra_classes;
create policy "extra_classes writable by admins"
  on public.extra_classes for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update, delete on public.extra_classes to authenticated;

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
  -- 管理者が登録した臨時授業（LMS にない授業。補講と同じ形で、course_id は負の数）
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
  from public.extra_classes x
  where x.date between p_from and p_to
    and (x.course_code is null or x.course_code = v_course_code);
end;
$$;

revoke all on function public.get_class_exceptions(uuid, date, date) from public, anon;
grant execute on function public.get_class_exceptions(uuid, date, date) to authenticated, service_role;
