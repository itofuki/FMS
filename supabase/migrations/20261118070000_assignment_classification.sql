-- 課題の種類を official / private に統一し、LMS で作った時間割の人にも公式課題を出す
--
-- 1. classification は 'official'（公式課題）か 'private'（個人課題）だけにする。
--    以前の版が入れていた 'individual' は 'private' に置き換える（アプリと RLS はすでに 'private' を使っている）。
-- 2. get_user_assignments: 公式課題を「自分が受けている授業」で絞り込む部分が、学科・クラス（profiles.class_id）
--    からしか授業を決めていなかった。LMS の ID でログインした人は学科・クラスがないため、公式課題が 1 件も出なかった。
--    学科・クラスからの絞り込みはやめ、LMS から取り込んだ自分のコース（user_lms_courses.course_id。
--    FMS の科目の id と同じ番号）だけで決める。

update public.assignment set classification = 'private' where classification = 'individual';

alter table public.assignment drop constraint if exists assignment_classification_check;
alter table public.assignment
  add constraint assignment_classification_check check (classification in ('official', 'private'));

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
        subjects.name::text as subject_name,
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
