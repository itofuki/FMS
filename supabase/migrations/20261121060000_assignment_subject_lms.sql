-- 課題の科目を LMS のコースにする
--
-- 時間割を LMS のコースから作るようにしたため、課題を追加するときに選ぶ科目も LMS のコース（id = LMS のコース id）になった。
-- ところが assignment.subject_id は以前の科目の表（subjects）を参照する外部キーのままで、そこにない LMS のコースを選ぶと
-- 「violates foreign key constraint assignment_subject_id_fkey」で保存できなかった（公式課題・個人課題とも）。
--   1. subjects への外部キーを外す（subject_id は LMS のコース id。以前の科目の id も同じ番号なので、今ある課題はそのまま）
--   2. get_user_assignments の科目名は、以前の科目の表になければ LMS のコース名（本人のもの、なければ誰かのもの）から取る
--   3. テスト対策の問題（quiz_questions.subject_id）も同じく LMS のコースを選ぶので、subjects への外部キーを外す

alter table public.assignment drop constraint if exists assignment_subject_id_fkey;

-- quiz_questions.subject_id → subjects の外部キー（名前は作ったときの自動の名前なので、表から探して外す）
do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.quiz_questions'::regclass
      and con.contype = 'f'
      and con.confrelid = 'public.subjects'::regclass
  loop
    execute format('alter table public.quiz_questions drop constraint %I', r.conname);
  end loop;
end;
$$;

create or replace function public.get_user_assignments()
returns table(id bigint, name text, deadline timestamp with time zone, classification text, user_id uuid, subject_name text, done boolean, url text)
language plpgsql
as $function$
begin
    return query
    -- 自分が受けている授業 = LMS から取り込んだ自分のコース
    with my_subjects as (
        select lc.course_id::bigint as id
        from public.user_lms_courses lc
        where lc.user_id = auth.uid()
    )
    -- 課題のうち、自分に関係するもの
    select
        assignment.id,
        assignment.name::text,
        assignment.deadline,
        assignment.classification::text,
        assignment.user_id,
        coalesce(
            subjects.name::text,
            (select lc.name from public.user_lms_courses lc
              where lc.course_id = assignment.subject_id
              order by (lc.user_id = auth.uid()) desc
              limit 1)
        )::text as subject_name,
        coalesce(status.done, false) as done,
        assignment.url::text
    from
        public.assignment as assignment
    left join
        public.subjects as subjects on assignment.subject_id = subjects.id
    left join
        public.assignment_status as status
        on assignment.id = status.assignment_id
        and status.user_id = auth.uid()
    where
        -- 公式課題は、自分が受けている授業のものだけ
        (assignment.classification = 'official' and assignment.subject_id in (select ms.id from my_subjects ms))
        -- 自分が作った課題（個人課題と、管理者が自分の授業以外に追加した公式課題）
        or assignment.user_id = auth.uid()
    order by
        done asc,
        assignment.deadline asc;
end;
$function$;
