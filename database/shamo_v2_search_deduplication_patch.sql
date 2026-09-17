-- Shamo v2: return each main question only once in similarity search
--
-- Run this complete file once in the Supabase SQL Editor as the postgres role.
-- It replaces only the search function. It does not alter papers, questions,
-- mark schemes, assets or stored embeddings.

begin;

create or replace function public.shamo_match_similar_questions(
    query_embedding extensions.vector(512),
    requested_limit integer default 10,
    requested_qualification text default null,
    requested_syllabus_code text default null,
    excluded_question_id uuid default null
)
returns table (
    question_id uuid,
    question_part_id uuid,
    qualification text,
    syllabus_code text,
    year smallint,
    exam_session text,
    paper_variant text,
    question_number integer,
    similarity double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
    -- First retrieve a deliberately wider nearest-neighbour pool. Ordering by
    -- the distance expression itself allows the pgvector HNSW index to help.
    -- The wider pool gives questions with several embedded parts room to be
    -- collapsed without starving the final result list.
    with candidate_pool as materialized (
        select
            search_item.question_id,
            search_item.question_part_id,
            paper.qualification,
            paper.syllabus_code,
            paper.year,
            paper.exam_session,
            paper.paper_variant,
            question.question_number,
            search_item.embedding
                operator(extensions.<=>)
                query_embedding as distance
        from public.shamo_question_search as search_item
        join public.shamo_questions as question
            on question.id = search_item.question_id
           and question.ingestion_run_id =
               search_item.ingestion_run_id
        join public.shamo_papers as paper
            on paper.id = question.paper_id
           and paper.current_ingestion_run_id =
               search_item.ingestion_run_id
        where paper.status = 'published'
          and search_item.content_kind = 'question'
          and search_item.embedding is not null
          and (
              requested_qualification is null
              or paper.qualification = requested_qualification
          )
          and (
              requested_syllabus_code is null
              or paper.syllabus_code = requested_syllabus_code
          )
          and (
              excluded_question_id is null
              or search_item.question_id <>
                  excluded_question_id
          )
        order by
            search_item.embedding
            operator(extensions.<=>)
            query_embedding
        limit greatest(
            10,
            least(
                coalesce(requested_limit, 10) * 10,
                500
            )
        )
    ),
    best_per_question as (
        select distinct on (candidate.question_id)
            candidate.question_id,
            candidate.question_part_id,
            candidate.qualification,
            candidate.syllabus_code,
            candidate.year,
            candidate.exam_session,
            candidate.paper_variant,
            candidate.question_number,
            candidate.distance
        from candidate_pool as candidate
        order by
            candidate.question_id,
            candidate.distance,
            candidate.question_part_id nulls first
    )
    select
        best.question_id,
        best.question_part_id,
        best.qualification,
        best.syllabus_code,
        best.year,
        best.exam_session,
        best.paper_variant,
        best.question_number,
        1 - best.distance as similarity
    from best_per_question as best
    order by best.distance
    limit greatest(
        1,
        least(coalesce(requested_limit, 10), 50)
    );
$$;

revoke execute on function public.shamo_match_similar_questions(
    extensions.vector,
    integer,
    text,
    text,
    uuid
) from public, anon, authenticated;

grant execute on function public.shamo_match_similar_questions(
    extensions.vector,
    integer,
    text,
    text,
    uuid
) to service_role;

commit;

-- Verification 1: only the service role should be able to execute it.
select
    has_function_privilege(
        'service_role',
        'public.shamo_match_similar_questions(extensions.vector,integer,text,text,uuid)',
        'execute'
    ) as service_role_can_execute,
    has_function_privilege(
        'anon',
        'public.shamo_match_similar_questions(extensions.vector,integer,text,text,uuid)',
        'execute'
    ) as anon_can_execute,
    has_function_privilege(
        'authenticated',
        'public.shamo_match_similar_questions(extensions.vector,integer,text,text,uuid)',
        'execute'
    ) as authenticated_can_execute;

-- Verification 2: Question 6's results should contain no repeated question.
with seed as (
    select
        search_item.question_id,
        search_item.embedding
    from public.shamo_question_search as search_item
    join public.shamo_questions as question
        on question.id = search_item.question_id
       and question.ingestion_run_id =
           search_item.ingestion_run_id
    where search_item.ingestion_run_id =
        '1298c634-b404-4a36-9aa9-3739e88caf08'::uuid
      and question.question_number = 6
      and search_item.question_part_id is null
      and search_item.content_kind = 'question'
    limit 1
),
matches as (
    select matched.*
    from seed
    cross join lateral public.shamo_match_similar_questions(
        seed.embedding,
        10,
        'a_level',
        '9709',
        seed.question_id
    ) as matched
)
select
    count(*) as returned_rows,
    count(distinct question_id) as distinct_questions,
    count(*) = count(distinct question_id)
        as no_duplicate_questions
from matches;
