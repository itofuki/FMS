-- アカウントを消したときのデータの扱い
--
-- LMS の ID でのログインに切り替え、メールアドレスで登録した古いアカウントを消すための準備。
-- これまで次の 4 つの表がアカウントの削除を止めていた（外部キーが「消せない」設定だった）。
--   - quiz_questions.created_by  : テスト対策の問題は残し、作成者だけ空にする
--   - feedback.user_id           : ご意見の内容は残し、送った人だけ空にする
--   - lms_assignment_status      : LMS 課題の完了チェック（本人だけのもの）は一緒に消す
--   - user_subscriptions         : 以前の通知の仕組みの表（今は使っていない）は一緒に消す

alter table public.quiz_questions alter column created_by drop not null;
alter table public.quiz_questions drop constraint quiz_questions_created_by_fkey;
alter table public.quiz_questions
  add constraint quiz_questions_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;

alter table public.feedback alter column user_id drop not null;
alter table public.feedback drop constraint feedback_user_id_fkey;
alter table public.feedback
  add constraint feedback_user_id_fkey foreign key (user_id) references auth.users(id) on delete set null;

alter table public.lms_assignment_status drop constraint lms_assignment_status_user_id_fkey;
alter table public.lms_assignment_status
  add constraint lms_assignment_status_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.user_subscriptions drop constraint user_subscriptions_user_id_fkey;
alter table public.user_subscriptions
  add constraint user_subscriptions_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
