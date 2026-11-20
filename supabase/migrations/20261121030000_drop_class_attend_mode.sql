-- 授業前の通知の「出席する」で開くものを設定で選ぶのをやめ、通知の上のボタン（出席ページ / QR を読み取る）で選ぶようにした。
-- そのために足した profiles.class_attend_mode は使わないので消す。
alter table public.profiles drop column if exists class_attend_mode;
