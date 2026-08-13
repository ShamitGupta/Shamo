-- Read-only verification for
-- database/shamo_v2_3_backslash_word_corruption_correction.sql.
-- Run after the correction commits.
--
-- Every check below uses strpos(), never LIKE, for any pattern containing a
-- backslash. Postgres LIKE treats backslash as its own escape character, so
-- a LIKE pattern containing one is silently misinterpreted -- exactly the
-- trap that produced two false FAILs the first time this file was run.

with checks as (
    select
        '1. no row still contains the word backslash' as check_name,
        not exists (
            select 1 from shamo_mark_scheme_items
            where strpos(content_markdown, 'backslash') > 0
               or strpos(guidance_markdown, 'backslash') > 0
        ) as passed,
        (
            select count(*)::text from shamo_mark_scheme_items
            where strpos(content_markdown, 'backslash') > 0
               or strpos(guidance_markdown, 'backslash') > 0
        ) as detail

    union all

    -- Deliberately NOT a table-wide "no escaped brace outside \left{/\right}"
    -- scan: Cambridge separately and correctly uses `\{ ... \}` on its own
    -- terms to bracket discrete answer-elements in a shared multi-mark row
    -- (see mark_scheme_parser.mjs's "One answer awarded several marks"
    -- comment, e.g. `\{-16x^{-3}\}\{+40(2x-3)^{-3}\}`), on rows that never
    -- contained the word "backslash" and were never touched by this
    -- correction. A table-wide scan would misreport that pre-existing,
    -- correct notation as a leftover defect.
    select
        '2. resolved audit issues recorded for the affected questions',
        (select count(*) from shamo_ingestion_issues
         where issue_code = 'LATEX_BACKSLASH_WORD_CORRECTED' and resolved = true) > 0,
        (select count(*)::text || ' resolved issue row(s)' from shamo_ingestion_issues
         where issue_code = 'LATEX_BACKSLASH_WORD_CORRECTED' and resolved = true)

    union all

    select
        '3. sample fix landed -- 9709/31 M/J 2024 frac row',
        exists (
            select 1 from shamo_mark_scheme_items
            where strpos(content_markdown, '\frac{5}{2}') > 0
              and strpos(content_markdown, 'backslash') = 0
        ),
        coalesce(
            (select content_markdown from shamo_mark_scheme_items
             where strpos(content_markdown, '\frac{5}{2}') > 0 limit 1),
            'not found'
        )

    union all

    select
        '4. sample fix landed -- imaginary unit dropped its backslash',
        (select count(*) from shamo_mark_scheme_items
         where strpos(content_markdown, 'x\; +\; i\; y') > 0) > 0,
        (select count(*)::text || ' row(s)' from shamo_mark_scheme_items
         where strpos(content_markdown, 'x\; +\; i\; y') > 0)

    union all

    select
        '5. left{/right} delimiters were preserved, not stripped',
        (select count(*) from shamo_mark_scheme_items
         where strpos(content_markdown, '\left\{') > 0 or strpos(guidance_markdown, '\left\{') > 0) > 0,
        (select count(*)::text from shamo_mark_scheme_items
         where strpos(content_markdown, '\left\{') > 0 or strpos(guidance_markdown, '\left\{') > 0)

    union all

    select
        '6. the one residual row is flagged unresolved, not silently fixed',
        exists (
            select 1 from shamo_ingestion_issues
            where issue_code = 'LATEX_BACKSLASH_WORD_CORRUPTION_RESIDUAL'
              and resolved = false
        ),
        (
            select content_markdown from shamo_mark_scheme_items
            where id = '0fb584ce-8af7-456c-a985-827740f4cd0e'
        )

    union all

    select
        '7. mark-scheme row count unchanged (presentation-only correction)',
        (select count(*) from shamo_mark_scheme_items) = 6023,
        (select count(*)::text from shamo_mark_scheme_items)
)
select
    check_name,
    case when passed then 'PASS' else 'FAIL' end as result,
    detail
from checks
order by check_name;
