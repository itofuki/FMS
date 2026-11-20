-- 授業の 5 分前の通知で、「出席する」を押したときに開くもの
--
-- profiles.class_attend_mode
--   'link' : 出席ページ（LMS の出欠のページ）を開く（これまでどおり）
--   'qr'   : FMS の時間割を開き、出欠の QR コードの読み取りをすぐ始める
alter table public.profiles
  add column if not exists class_attend_mode text not null default 'link'
  check (class_attend_mode in ('link', 'qr'));
