-- イレギュラーな授業回（管理者が日付を指定して登録する）
--
-- いつもの時間割（get_effective_timetable）とは別に、特定の日だけの変更を持つ。登録した日はこちらを優先する
-- （時間割の画面・授業前の通知・カレンダー連携）。
--   kind = 'change' : その日だけ時刻・教室が違う（start_time / end_time / classroom の入っているものだけ変える）
--   kind = 'cancel' : 休講
--   kind = 'extra'  : 補講・振替（いつもはない日・時限に授業を足す。period は必須）
--   period      : 対象の時限。change / cancel で空なら、その日のそのコースの全時限
--   course_code : 対象のコース（IA・IS など）。空なら全コース共通（コースの既定値と同じ考え方）

create table if not exists public.class_exceptions (
  id bigint generated always as identity primary key,
  course_id integer not null,
  course_code text,
  date date not null,
  kind text not null check (kind in ('change', 'cancel', 'extra')),
  period integer check (period between 1 and 6),
  start_time time,
  end_time time,
  classroom text check (char_length(classroom) <= 50),
  note text check (char_length(note) <= 200),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint class_exceptions_extra_has_period check (kind <> 'extra' or period is not null),
  constraint class_exceptions_time_order check (start_time is null or end_time is null or start_time < end_time)
);

create index if not exists class_exceptions_date on public.class_exceptions (date);

alter table public.class_exceptions enable row level security;

-- 読むのはログイン中の全員（自分に関係するものは get_class_exceptions で絞る）。書くのは管理者（管理者・開発者）だけ
drop policy if exists "class_exceptions readable by signed-in users" on public.class_exceptions;
create policy "class_exceptions readable by signed-in users"
  on public.class_exceptions for select
  to authenticated
  using (true);

drop policy if exists "class_exceptions writable by admins" on public.class_exceptions;
create policy "class_exceptions writable by admins"
  on public.class_exceptions for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update, delete on public.class_exceptions to authenticated;

-- その人に関係するイレギュラーな授業回（自分が取っている LMS のコースで、対象が全コース共通か自分のコース）。
-- コース名も一緒に返す（補講で時間割にない時限に足すときに使う）。
create or replace function public.get_class_exceptions(p_user_id uuid, p_from date, p_to date)
returns table (
  id bigint,
  course_id integer,
  name text,
  date date,
  kind text,
  period integer,
  start_time text,
  end_time text,
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
  select
    e.id,
    e.course_id,
    c.name::text,
    e.date,
    e.kind::text,
    e.period,
    to_char(e.start_time, 'HH24:MI')::text,
    to_char(e.end_time, 'HH24:MI')::text,
    nullif(e.classroom, '')::text,
    nullif(e.note, '')::text,
    c.attendance_id
  from public.class_exceptions e
  join public.user_lms_courses c on c.user_id = p_user_id and c.course_id = e.course_id
  where e.date between p_from and p_to
    and (e.course_code is null or e.course_code = v_course_code)
  order by e.date, e.period nulls first, e.id;
end;
$$;

revoke all on function public.get_class_exceptions(uuid, date, date) from public, anon;
grant execute on function public.get_class_exceptions(uuid, date, date) to authenticated, service_role;
