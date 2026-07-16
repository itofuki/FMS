-- 一問一答の問題形式を「自由記述」「4択」の2パターンに対応させる
alter table public.quiz_questions
  add column question_type text not null default 'free_response',
  add column choices jsonb;

alter table public.quiz_questions
  add constraint quiz_questions_type_check
    check (question_type in ('free_response', 'multiple_choice'));

alter table public.quiz_questions
  add constraint quiz_questions_choices_check
    check (
      (question_type = 'free_response' and choices is null)
      or
      (question_type = 'multiple_choice' and jsonb_typeof(choices) = 'array' and jsonb_array_length(choices) = 4)
    );
