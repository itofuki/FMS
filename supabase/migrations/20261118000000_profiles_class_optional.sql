-- profiles の学科・クラスを任意にする
--
-- LMS の ID でログインするようになり、時間割は LMS のコースから作るため、設定画面で学科・クラスを選ばなくなった。
-- これまで class_id が必須（NOT NULL）だったため、新しいアカウントでは通知の設定などを保存する行を作れなかった
-- （null value in column "class_id" violates not-null constraint）。
-- 既存の値はそのまま残す。class_id が空の人は、従来の時間割（get_user_timetable）は空になり、LMS の時間割を使う。

alter table public.profiles alter column class_id drop not null;

-- 英語のクラスも同じ扱い（列があれば。もともと任意なら何も変わらない）
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'english_id'
  ) then
    alter table public.profiles alter column english_id drop not null;
  end if;
end;
$$;
