-- Read-only verification for shamo_v2_2_main_topic_source_review_correction.sql.
--
-- Every check must return ok = true. Nothing here writes.

-- 1. The eleven corrected rows now hold the reviewed topic, and each carries a
--    reviewer note recording what changed and why.
select
    'corrected rows carry the new topic and a note' as check_name,
    count(*) = 11 as ok,
    count(*) as actual,
    11 as expected
from public.shamo_question_metadata as m
join (values
    ('420276eb-2df7-4ff8-8ce4-1d2fee8af7ef'::uuid, 'Continuous Random Variables'),
    ('87d8b57a-dfae-4bf7-8853-051b4b83501a'::uuid, 'Series'),
    ('57455615-e942-4aa3-a084-ada8d8afb3c2'::uuid, 'Series'),
    ('007ce42b-5e1b-4028-8241-96ff15d62084'::uuid, 'Algebra'),
    ('9be05521-f8bf-44dc-8a54-9f2958e15d2d'::uuid, 'Calculus'),
    ('b321e2a1-bf94-4eba-8411-201281f6e923'::uuid, 'Series'),
    ('2fbd571b-eaaa-49c5-b766-5b1b7805d2c0'::uuid, 'Functions'),
    ('d96d3011-efcd-4348-bf32-c00661afba40'::uuid, 'Series'),
    ('a5827000-bb95-4731-992b-6ade7cabc4d2'::uuid, 'Calculus'),
    ('db1e73c7-b1c3-4f2d-9dfa-2f67c42359c0'::uuid, 'Functions'),
    ('2bbc7a79-af1b-4233-8546-d123ea09df18'::uuid, 'Differential Equations')
) as expected(question_id, topic) on expected.question_id = m.question_id
where m.main_topic = expected.topic
  and m.reviewer_note like '%Agent-assisted source review 2026-08-09%';

-- 2. No metadata row was left on the superseded taxonomy label.
select
    'every metadata row is on taxonomy 9709-v3' as check_name,
    count(*) filter (where taxonomy_version <> '9709-v3') = 0 as ok,
    count(*) filter (where taxonomy_version <> '9709-v3') as actual,
    0 as expected
from public.shamo_question_metadata;

-- 3. Exactly one resolved audit row per correction.
select
    'eleven resolved audit rows' as check_name,
    count(*) = 11 and count(*) filter (where resolved) = 11 as ok,
    count(*) as actual,
    11 as expected
from public.shamo_ingestion_issues
where issue_code = 'METADATA_MAIN_TOPIC_CORRECTED';

-- 4. review_status is UNCHANGED. This is the point: only main_topic has been
--    checked against source, so the row-level gate must stay open and visible.
select
    'review_status distribution is unchanged' as check_name,
    count(*) filter (where review_status = 'pending') = 89
      and count(*) filter (where review_status = 'approved') = 49 as ok,
    count(*) filter (where review_status = 'pending') as pending_rows,
    count(*) filter (where review_status = 'approved') as approved_rows
from public.shamo_question_metadata;

-- 5. Content was not touched. Metadata corrections must never move a mark row.
select
    'published content totals unchanged' as check_name,
    (select count(*) from public.shamo_questions) = 149
      and (select count(*) from public.shamo_question_parts) = 280
      and (select count(*) from public.shamo_mark_scheme_items) = 1296 as ok,
    (select count(*) from public.shamo_questions) as questions,
    (select count(*) from public.shamo_mark_scheme_items) as mark_rows;

-- 6. Search rows are untouched and still complete. Re-embedding is not required
--    because embeddings are built from question and part text, never metadata.
select
    'search index unchanged and complete' as check_name,
    count(*) = 410 and count(*) filter (where embedding is null) = 0 as ok,
    count(*) as actual,
    410 as expected
from public.shamo_question_search;

-- 7. Topic distribution after correction, for the record.
select main_topic, count(*) as rows
from public.shamo_question_metadata
group by main_topic
order by count(*) desc, main_topic;
