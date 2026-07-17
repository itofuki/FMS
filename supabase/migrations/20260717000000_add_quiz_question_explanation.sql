-- 正解・不正解にかかわらず解説を表示できるようにする
alter table public.quiz_questions
  add column explanation text;
