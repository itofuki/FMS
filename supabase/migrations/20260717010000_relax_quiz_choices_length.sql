-- 実際の小テストには5〜8択の設問も存在するため、選択肢数の制約を「4択固定」から「2つ以上」に緩和する
alter table public.quiz_questions
  drop constraint quiz_questions_choices_check;

alter table public.quiz_questions
  add constraint quiz_questions_choices_check
    check (
      (question_type = 'free_response' and choices is null)
      or
      (question_type = 'multiple_choice' and jsonb_typeof(choices) = 'array' and jsonb_array_length(choices) >= 2)
    );
