-- 課題（assignment）と完了状態（assignment_status）の、アカウントを消したときの扱い
--
-- assignment.user_id は profiles(user_id) に紐付いていて、アカウント（→ profiles）を消せなかった。
-- 公式課題にも作った人の user_id が入っているため、課題ごと消すと公式課題まで消えてしまう。
--   - assignment.user_id        : 作った人の欄を空にする（公式課題は残る。空になった個人課題は後片付けで消す）
--   - assignment_status.user_id : 本人だけの完了状態なので一緒に消す（profiles か auth.users への紐付きがあれば）

alter table public.assignment alter column user_id drop not null;
alter table public.assignment drop constraint assignment_user_id_fkey;
alter table public.assignment
  add constraint assignment_user_id_fkey foreign key (user_id) references public.profiles(user_id) on delete set null;

do $$
declare
  r record;
begin
  for r in
    select con.conname, con.confrelid::regclass as target, a.attname as col
    from pg_constraint con
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
    where con.conrelid = 'public.assignment_status'::regclass
      and con.contype = 'f'
      and con.confrelid in ('public.profiles'::regclass, 'auth.users'::regclass)
      and con.confdeltype <> 'c'
  loop
    execute format('alter table public.assignment_status drop constraint %I', r.conname);
    execute format(
      'alter table public.assignment_status add constraint %I foreign key (%I) references %s(%s) on delete cascade',
      r.conname, r.col, r.target, case when r.target::text = 'auth.users' then 'id' else 'user_id' end
    );
  end loop;
end;
$$;
