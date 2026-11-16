-- ============================================================
-- プッシュ通知（課題の締切リマインダー / 授業開始前の通知）
-- ============================================================

-- ------------------------------------------------------------
-- 1. 端末ごとのプッシュ購読
--    旧 user_subscriptions（1ユーザー1端末・スキーマ未管理）の後継。
--    endpoint 単位で一意にし、複数端末に対応する。
-- ------------------------------------------------------------
create table public.push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index push_subscriptions_user_id_idx on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

create policy "push_subscriptions_select_own"
  on public.push_subscriptions for select
  to authenticated
  using (user_id = auth.uid());

create policy "push_subscriptions_delete_own"
  on public.push_subscriptions for delete
  to authenticated
  using (user_id = auth.uid());

-- 同じ端末（endpoint）で別ユーザーがログインし直した場合でも登録できるよう、
-- 登録は RPC 経由で行い、endpoint の持ち主を現在のユーザーに付け替える
create or replace function public.register_push_subscription(p_subscription jsonb, p_user_agent text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_endpoint text := p_subscription->>'endpoint';
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if v_endpoint is null or v_endpoint !~ '^https://' then
    raise exception 'invalid subscription';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, subscription, user_agent)
  values (auth.uid(), v_endpoint, p_subscription, p_user_agent)
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        subscription = excluded.subscription,
        user_agent = excluded.user_agent,
        updated_at = now();
end;
$$;

revoke all on function public.register_push_subscription(jsonb, text) from public, anon;
grant execute on function public.register_push_subscription(jsonb, text) to authenticated;

-- ------------------------------------------------------------
-- 2. 通知設定（profiles に追加）
-- ------------------------------------------------------------
alter table public.profiles
  -- 締切の何時間前に通知するか（null = 通知しない）
  add column if not exists deadline_reminder_hours integer default 24,
  -- 授業開始5分前の動作: auto_open = ページを自動で開く / notify = 通知する / none = 何もしない
  add column if not exists class_start_action text not null default 'notify';

alter table public.profiles
  add constraint profiles_deadline_reminder_hours_check
    check (deadline_reminder_hours is null or deadline_reminder_hours in (1, 3, 6, 12, 24, 48, 72)),
  add constraint profiles_class_start_action_check
    check (class_start_action in ('auto_open', 'notify', 'none'));

-- 既存ユーザーは従来の auto_open 設定を引き継ぐ（auto_open 列は後方互換のため残す）
update public.profiles
  set class_start_action = case when auto_open then 'auto_open' else 'none' end
  where auto_open is not null;

-- ------------------------------------------------------------
-- 3. 締切リマインダー対象の課題
--    LMS のトークンはサーバーに置かないため、アプリが課題一覧を取得するたびに
--    「未完了かつ締切前の課題」をここへ同期し、サーバーはこの表だけを見て通知する。
-- ------------------------------------------------------------
create table public.user_deadlines (
  user_id uuid not null references auth.users(id) on delete cascade,
  uid text not null,
  title text not null,
  deadline timestamptz not null,
  url text,
  updated_at timestamptz not null default now(),
  primary key (user_id, uid)
);

create index user_deadlines_deadline_idx on public.user_deadlines(deadline);

alter table public.user_deadlines enable row level security;

create policy "user_deadlines_all_own"
  on public.user_deadlines for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 自分の締切一覧を丸ごと置き換える（1トランザクションで delete + insert）
create or replace function public.sync_user_deadlines(p_items jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 500 then
    raise exception 'invalid items';
  end if;

  delete from public.user_deadlines where user_id = auth.uid();

  insert into public.user_deadlines (user_id, uid, title, deadline, url)
  select auth.uid(), i.uid, left(i.title, 300), i.deadline, left(i.url, 2000)
  from jsonb_to_recordset(p_items) as i(uid text, title text, deadline timestamptz, url text)
  where i.uid is not null and i.title is not null and i.deadline is not null
  on conflict (user_id, uid) do nothing;
end;
$$;

revoke all on function public.sync_user_deadlines(jsonb) from public, anon;
grant execute on function public.sync_user_deadlines(jsonb) to authenticated;

-- ------------------------------------------------------------
-- 4. 送信済み通知のログ（重複送信防止。service_role のみ読み書き）
-- ------------------------------------------------------------
create table public.notification_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  ref text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, kind, ref)
);

alter table public.notification_log enable row level security;
-- ポリシーなし = authenticated / anon からはアクセス不可

-- ------------------------------------------------------------
-- 5. 毎分 notify-scheduler を呼び出す cron ジョブ
--    URL と共有シークレットは Vault から読む（このファイルには値を書かない）。
--    事前に SQL Editor で以下を実行しておくこと:
--      select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/notify-scheduler', 'notify_scheduler_url');
--      select vault.create_secret('<NOTIFY_SCHEDULER_SECRET と同じ値>', 'notify_scheduler_secret');
-- ------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'notify-scheduler',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'notify_scheduler_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-scheduler-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notify_scheduler_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  )
  where exists (select 1 from vault.decrypted_secrets where name = 'notify_scheduler_url');
  $$
);
