-- クイズ問題に画像を複数枚添付できるようにする（image_url -> image_urls[]）
alter table public.quiz_questions
  add column image_urls text[];

update public.quiz_questions
  set image_urls = array[image_url]
  where image_url is not null;

alter table public.quiz_questions
  drop column image_url;
