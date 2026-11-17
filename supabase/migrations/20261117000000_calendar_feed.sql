-- カレンダー購読（時間割と課題の締切を iPhone / Google カレンダーなどに表示する）
--
-- カレンダーアプリはログインの情報を送れないため、ユーザーごとの推測できない URL（トークン）で公開する。
-- URL を知っている人は誰でも読めるので、作り直し（古い URL を無効にする）と停止をできるようにする。
-- 読み出しは Edge Function（calendar-feed）が service_role で行う。

create table public.calendar_feeds (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now()
);

alter table public.calendar_feeds enable row level security;

create policy "calendar_feeds_select_own"
  on public.calendar_feeds for select
  to authenticated
  using (user_id = auth.uid());

-- 自分の購読用トークンを返す（なければ作る）。p_rotate = true なら作り直して古い URL を無効にする
create or replace function public.ensure_calendar_feed(p_rotate boolean default false)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not p_rotate then
    select token into v_token from public.calendar_feeds where user_id = auth.uid();
    if v_token is not null then
      return v_token;
    end if;
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.calendar_feeds (user_id, token)
  values (auth.uid(), v_token)
  on conflict (user_id) do update set token = excluded.token, created_at = now();
  return v_token;
end;
$$;

-- 購読をやめる（URL を無効にする）
create or replace function public.delete_calendar_feed()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  delete from public.calendar_feeds where user_id = auth.uid();
end;
$$;

revoke all on function public.ensure_calendar_feed(boolean) from public, anon;
revoke all on function public.delete_calendar_feed() from public, anon;
grant execute on function public.ensure_calendar_feed(boolean) to authenticated;
grant execute on function public.delete_calendar_feed() to authenticated;
