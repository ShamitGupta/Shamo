-- Shamo v2.1: read-only verification for the Paper 41 Question 7
-- post-publication metadata correction.
--
-- Expected: every row says PASS. This file makes no changes and no API calls.

with
target as (
    select
        '98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid
            as ingestion_run_id,
        '03382be6-bf6d-420e-b356-6a899a11a88c'::uuid
            as paper_id,
        'bc29b2d6-e513-4aca-b1f9-875f211d046c'::uuid
            as question_id
),
checks as (
    select
        1 as sort_order,
        'published run remains ready for embeddings'::text as check_name,
        run.status = 'search_pending'
            and run.review_status = 'approved'
            and run.published_at is not null
            and paper.status = 'published'
            and paper.current_ingestion_run_id = target.ingestion_run_id
            as passed,
        concat(
            'run=', run.status, '/', run.review_status,
            ', paper=', paper.status
        ) as actual
    from target
    join public.shamo_ingestion_runs as run
      on run.id = target.ingestion_run_id
    join public.shamo_papers as paper
      on paper.id = target.paper_id

    union all

    select
        2,
        'Question 7 main topic is reviewed Mechanics',
        count(*) = 1,
        count(*)::text
    from target
    join public.shamo_questions as question
      on question.id = target.question_id
     and question.paper_id = target.paper_id
     and question.ingestion_run_id = target.ingestion_run_id
    join public.shamo_question_metadata as metadata
      on metadata.question_id = question.id
     and metadata.ingestion_run_id = target.ingestion_run_id
    where question.question_number = 7
      and question.total_marks = 9
      and metadata.main_topic = 'Mechanics'
      and metadata.subtopics @>
          array['Kinematics with polynomial functions']::text[]
      and metadata.review_status = 'approved'
      and metadata.reviewer_note =
          'Human-reviewed after publication. This is a Mechanics kinematics question about velocity, acceleration and displacement of a particle.'

    union all

    select
        3,
        'all Paper 41 questions now use Mechanics as main topic',
        count(*) = 8
            and count(*) filter (
                where metadata.main_topic <> 'Mechanics'
            ) = 0,
        concat(
            'rows=', count(*),
            ', non_mechanics=', count(*) filter (
                where metadata.main_topic <> 'Mechanics'
            )
        )
    from target
    join public.shamo_question_metadata as metadata
      on metadata.ingestion_run_id = target.ingestion_run_id

    union all

    select
        4,
        'resolved correction audit record exists once',
        count(*) = 1
            and bool_and(issue.resolved),
        count(*)::text
    from target
    join public.shamo_ingestion_issues as issue
      on issue.ingestion_run_id = target.ingestion_run_id
    where issue.issue_code = 'POST_PUBLICATION_METADATA_CORRECTED'
      and issue.question_number = 7
      and issue.message =
          'Paper 41 Question 7 was classified as Algebra although it is a particle kinematics question.'

    union all

    select
        5,
        'search state is unchanged before embeddings',
        (select count(*)
         from public.shamo_question_search as search_item
         where search_item.ingestion_run_id = target.ingestion_run_id) = 0
        and
        (select count(*)
         from public.shamo_get_pending_search_items(500) as pending_item
         where pending_item.ingestion_run_id = target.ingestion_run_id) = 17,
        concat(
            'stored=',
            (select count(*)
             from public.shamo_question_search as search_item
             where search_item.ingestion_run_id = target.ingestion_run_id),
            ', pending=',
            (select count(*)
             from public.shamo_get_pending_search_items(500) as pending_item
             where pending_item.ingestion_run_id = target.ingestion_run_id)
        )
    from target

    union all

    select
        6,
        'global pending count remains 87',
        count(*) = 87,
        count(*)::text
    from public.shamo_get_pending_search_items(500)
)
select
    check_name,
    case when passed then 'PASS' else 'FAIL' end as result,
    actual
from checks
order by sort_order;
