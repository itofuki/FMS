-- 同じ科目内で「過去問題」「予想問題」など複数の問題セットを分けて出題できるようにする
alter table public.quiz_questions
  add column question_set text not null default 'past_exam';

alter table public.quiz_questions
  add constraint quiz_questions_question_set_check
    check (question_set in ('past_exam', 'predicted'));
