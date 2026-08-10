# Shamo one-paper ingestion pilot

This folder contains a deliberately small pilot for the paper pair in the
workbook's `Test` sheet:

- Cambridge International A Level Mathematics
- Syllabus `9709`
- February/March 2025
- Paper variant `12`
- Question paper: 16 PDF pages
- Mark scheme: 22 PDF pages
- Expected result: 11 main questions and 75 marks

The pilot is split into two n8n workflows so that extraction can never publish
data automatically.

This is the third pilot version. Version 2 fixed the large examiner-guidance
omissions, reducing the pilot from 33 blockers to 9 recorded blockers.
Version 3 also handles unparted questions, guidance-only special-case rows and
one bounded targeted repair followed by complete revalidation.

## Files

- `../../database/shamo_v2_mark_scheme_guidance_patch.sql` — additive SQL patch
  that adds `guidance_markdown` and the v2 publication function.
- `../../database/shamo_v2_guidance_only_rows_patch.sql` - additive SQL patch
  that permits a source row whose Answer and Marks cells are blank but whose
  Guidance cell contains an examiner special case.

- `shamo_pilot_extract_and_stage.json` — reads the two spreadsheet rows, runs
  OCR and structured extraction, validates the result, and stages it for review.
- `shamo_pilot_approve_and_publish.json` — publishes a staged result only after
  you manually paste its ingestion run ID and click Execute.
- `shamo_paper_bundle.schema.json` — the exact JSON contract that extracted data
  must satisfy before it can be published.
- `shamo_pilot_input.json` — the known source details and expected paper totals.
- `build_pilot_workflows.mjs` — regenerates the workflow JSON files.
- `validate_pilot_workflows.mjs` — checks the generated files without calling
  any external APIs.
- `shamo_pilot_generate_search_embeddings.json` — batches the published
  question and part text into one inexpensive 512-dimension embedding request,
  validates the response, and stores it atomically.
- `build_search_workflow.mjs` — regenerates the search-indexing workflow.
- `validate_search_workflow.mjs` — performs offline structural and secret
  checks on the search-indexing workflow.

## Why there are two workflows

The first workflow is allowed to extract and store a draft, but it is not
allowed to populate the final question tables. The second workflow is the
approval gate. This prevents one poor OCR or AI response from silently becoming
student-facing data.

The first workflow checks:

- the spreadsheet contains exactly one question paper and one mark scheme;
- both rows describe the same syllabus, session, year, and paper variant;
- OCR returns exactly 16 question-paper pages and 22 mark-scheme pages;
- the extracted paper has questions 1 through 11;
- the question marks total 75;
- every question and part has valid page references;
- the mark scheme covers the extracted question structure;
- every mark-scheme row contains separate answer and guidance fields;
- primary mark codes cover the question's available marks;
- extracted images have OCR image data and were uploaded successfully;
- an independent second model agrees that the result is safe to review;
- when a blocker is found, one targeted repair corrects only the affected
  questions and then runs deterministic checks and independent verification
  again.

If a check fails, the run is staged with blocking issues and cannot be published.

## Before importing into n8n

You already created the private `past-paper-assets` bucket. Keep it private.

First run the complete
`database/shamo_v2_mark_scheme_guidance_patch.sql` file in the Supabase SQL
Editor as the `postgres` role. Its two verification queries should return:

- `content_markdown` and `guidance_markdown`;
- `shamo_get_question_context` and
  `shamo_publish_paper_bundle_v2`;
- `guidance_only_publication_fixed = true` and
  `atomic_approval_enabled = true`.

Rerun the latest version of this patch if upgrading from the first v2 wrapper.
The current wrapper publishes Guidance atomically and can safely recover a run
whose older approval workflow committed approval before publication failed.

Then run the complete
`database/shamo_v2_guidance_only_rows_patch.sql` file. Its verification query
should return
`shamo_mark_scheme_items_content_or_guidance_check` with
`constraint_valid = true`.

Confirm the existing n8n credentials:

1. **Google Sheets account** can read the spreadsheet used by the old workflow.
2. **OpenAi account** is valid.
3. **Supabase account** contains your project URL and the secret/service-role
   key, not the anon key. This credential is for trusted n8n use only.
4. Create an n8n **HTTP Header Auth** credential for Mistral:
   - Header name: `Authorization`
   - Header value: `Bearer YOUR_MISTRAL_API_KEY`

Do not paste the Mistral key into a workflow node.

## Import and configure the extraction workflow

1. In n8n, choose **Import from File**.
2. Import `shamo_pilot_extract_and_stage.json`.
3. Keep the workflow inactive while testing.
4. Open **Pilot Configuration** and replace
   `https://YOUR_PROJECT_REF.supabase.co` with your real Supabase project URL.
5. Open **Get Test Rows**:
   - confirm the Google credential;
   - reselect the spreadsheet if n8n asks;
   - select the sheet named `Test`;
   - confirm the node returns the two pilot rows only.
6. Open **Mistral OCR**, select the Mistral HTTP Header Auth credential, and
   save the node.
7. Open one Supabase node and confirm the `Supabase account` credential is
   selected. The imported workflow reuses that credential on all Supabase nodes.
8. Open one OpenAI node and confirm the `OpenAi account` credential is selected.
9. Save the workflow.

## Run the extraction pilot

Do not reuse or publish either failed diagnostic run:

- `411ebcbd-6dfa-4a39-a7bf-70f1816068a0`
- `00b9b60a-0703-48eb-a870-233ce293eed4`

The new workflow creates a fresh ingestion run while retaining both older runs
as diagnostic evidence.

Click **Execute workflow** once.

This run can take several minutes because it OCRs two PDFs and then performs
extraction and independent verification. Version 3 makes one focused
question-paper extraction call, eleven smaller mark-scheme calls (one per
question), and an independent verifier call. If the verifier finds a blocker,
the workflow makes one targeted repair call for only the affected questions and
then runs all checks and the verifier again. It does not publish questions.

The last node, **Pilot Stage Result**, returns:

- `ingestion_run_id`
- `paper_id`
- `ready_for_approval`
- a validation summary

Do not run the publication workflow unless `ready_for_approval` is `true` and
you have reviewed the result.

Review these Supabase views/tables:

```sql
select *
from public.shamo_ingestion_review_queue
order by created_at desc;
```

```sql
select *
from public.shamo_ingestion_issues
where ingestion_run_id = 'PASTE_INGESTION_RUN_ID_HERE'
order by severity desc, created_at;
```

To inspect the staged JSON:

```sql
select
    id,
    status,
    review_status,
    extraction_summary -> 'summary' as summary,
    extraction_summary -> 'paper_bundle' as paper_bundle
from public.shamo_ingestion_runs
where id = 'PASTE_INGESTION_RUN_ID_HERE';
```

Check several questions against the original PDFs, especially:

- a question with several parts;
- a question containing a diagram or graph;
- both `content_markdown` and `guidance_markdown` for the same marking row;
- Question 10(b), including the negative exponent in the derivative;
- the final question;
- the marks and mark-scheme steps for each selected question.

## Publish only after review

1. Import `shamo_pilot_approve_and_publish.json`.
2. Keep it inactive.
3. Open **Publish Configuration**.
4. Enter the same Supabase project URL.
5. Paste the reviewed `ingestion_run_id`.
6. Confirm the Supabase service-role credential is selected.
7. Click **Execute workflow** once.

This workflow refuses to publish if:

- the extraction or verifier did not pass;
- the run is neither awaiting review nor recovering from an approved
  publication failure;
- the staged JSON is missing;
- any open blocking issue exists.

Approval and normalized publication occur inside one database transaction. If
publication fails, a newly awaiting-review run is not left half-approved.

After a successful publication, it removes the large temporary staged JSON from
the ingestion run to conserve Supabase Free Plan space. The normalized paper,
questions, parts, mark-scheme items, and asset records remain.

Verify the publication:

```sql
select *
from public.shamo_published_question_overview
where syllabus_code = '9709'
  and year = 2025
  and exam_session = 'feb_march'
  and paper_variant = '12'
order by question_number;
```

Do not generate embeddings yet. First review the published rows and test the
question-context function. Embeddings should be the next step only after the
pilot content is correct.

## Generate the pilot search index

After the publication checks pass:

1. Run `database/shamo_v2_search_indexing_patch.sql` once in the Supabase SQL
   Editor as `postgres`.
2. Import `shamo_pilot_generate_search_embeddings.json` into n8n.
3. In **Search Configuration**, replace
   `https://YOUR_PROJECT_REF.supabase.co` with the project URL.
4. Confirm the existing **OpenAi account** and **Supabase account** credentials.
5. Keep the workflow inactive and click **Execute workflow** once.
6. Run `database/shamo_v2_search_verification.sql` section by section.

The workflow requests at most 100 pending items, sends them in one OpenAI
embedding request, and refuses to continue if its conservative preflight
estimate exceeds $0.05. For the 29-item pilot, the expected cost is far below
one cent.

## Important pilot limitations

- This workflow is intentionally fixed to one known paper pair. It is not yet
  the bulk-ingestion workflow.
- The mark-scheme page map is fixed to this pilot. A later production workflow
  will discover question/page boundaries automatically.
- The page-count and paper-total checks are fixed to this pilot.
- n8n may require you to reselect credentials or the `Test` sheet after import.
- The workflow JSON has been checked statically, but actual API calls must be
  tested in your n8n instance because credentials and n8n versions are external
  to this workspace.

## Troubleshooting

### Mistral OCR reports `invalid syntax`

This was caused by an earlier workflow version placing the complete Mistral
request object inside an n8n expression. The corrected workflow builds the
object in **Expand Pilot Documents** and the **Mistral OCR** body now contains
only:

```text
={{ $json.mistral_request }}
```

Re-import the latest `shamo_pilot_extract_and_stage.json` rather than editing
only the Mistral node, because the preceding Code node was also changed.

## Guarded six-paper Test 2 workflow

These newer workflows replace the expensive three-verifier pilot pattern for
bulk calibration:

- `shamo_budget_stage_one_math_paper.json`: child workflow that stages one
  paper pair.
- `shamo_budget_test2_six_paper_controller.json`: selects and runs one balanced
  six-paper batch.
- `shamo_budget_approve_reviewed_paper.json`: publishes one manually reviewed
  paper and its topic/skill metadata atomically.

Before importing them, run
`database/shamo_v2_metadata_and_budget_patch.sql` and its verification script.

### Fixed safety limits

- Maximum six paper pairs per controller execution.
- One paper from each A-level paper type 1–6.
- The selection rotates through sessions/variants, so the first batch is not
  concentrated in one paper type or one exam session.
- Papers run sequentially.
- Ten-minute pause after paper 5.
- One `gpt-5.4-nano` structured extraction per new paper.
- Conservative $0.25 reservation per OpenAI call.
- $3 maximum committed cost for one six-paper batch.
- $15 maximum committed cost for the complete 24-paper Test 2 campaign.
- Database stop at 350 MB.
- No automatic publication and no automatic embeddings.

The $3 and $15 values are hard ceilings, not expected spend. Actual extraction
cost should be much lower, but quality and measured spend from batch 1 decide
whether batches 2–4 are allowed to run.

### Import and connect

1. Import `shamo_budget_stage_one_math_paper.json`.
2. On **Mistral OCR Both Documents**, select the existing Mistral HTTP Header
   Auth credential. The workflow intentionally does not contain that
   credential ID.
3. Import `shamo_budget_test2_six_paper_controller.json`.
4. Open **Run One Paper Sub-workflow** and select
   **Shamo Budget v1 - Stage One Maths Paper**.
5. In **Budget Configuration**, replace `YOUR_PROJECT_REF` with the Supabase
   project reference. Do not raise any safety limit.
6. Confirm the Google Sheets, OpenAI and Supabase credentials are selected.
7. Keep both workflows inactive.

### First execution

Keep `batch_number: 1` and run the controller manually once. It will select:

- one paper from each paper type 1, 2, 3, 4, 5 and 6;
- six complete question-paper/mark-scheme pairs;
- a mixture of February/March, May/June and October/November samples.

After it finishes, stop. Inspect:

```sql
select *
from public.shamo_api_budget_overview
order by created_at desc;
```

```sql
select *
from public.shamo_ingestion_review_queue
order by started_at desc;
```

```sql
select *
from public.shamo_question_metadata_review
order by syllabus_code, year, exam_session, paper_variant, question_number;
```

The last view remains empty until reviewed papers are published.

For every staged paper, compare the official PDFs with:

- all question numbers and printed part labels;
- all mathematical signs and values;
- question and part marks;
- every mark-code row and examiner guidance;
- every required graph or diagram;
- the proposed topic, skills and difficulty.

Do not publish a run containing a blocking issue. Low metadata confidence is a
warning that the topic labels need human checking.

### Publishing one reviewed paper

1. Import `shamo_budget_approve_reviewed_paper.json`.
2. Enter the Supabase project URL and one reviewed `ingestion_run_id`.
3. Run it manually once.

Publication and metadata storage use a single database transaction. After a
successful result, inspect `shamo_published_question_overview` and
`shamo_question_metadata_review`. Generate embeddings only after the published
content passes those checks.

### Cost decision after batch 1

Continue to batch 2 only if:

- all six papers can be corrected without redesigning the extraction prompt;
- topic and skill labels are useful;
- no repeated mathematical transcription error is found;
- actual OpenAI cost is comfortably within the budget;
- the database is still below the 350 MB workflow safety line.

If those conditions pass, change only `batch_number` to `2`. Batches 3 and 4
follow the same gate. Never increase `max_papers_per_run`,
`batch_budget_limit_usd`, or `campaign_budget_limit_usd`.

If an OpenAI request fails after its budget was reserved, retrying the same
paper uses the same reservation and idempotency key. Do not create a new batch
just to retry a temporary 500/503 error. A stale reservation can be released
manually with `shamo_release_api_budget`, but only after confirming that the
provider did not complete or bill the request.

## Budget v2 structured calibration

The first six-paper run showed that one model request was being asked to
extract the question paper, mark scheme and metadata simultaneously. The v2
calibration replaces that one-pass approach with smaller jobs:

1. `gpt-5.4-mini` extracts only question-paper structure and diagrams, using
   the official PDF plus OCR.
2. `gpt-5.4-nano` maps each mark-scheme question to its PDF pages.
3. `gpt-5.4-nano` extracts each mark-scheme question separately from only its
   relevant pages. n8n sends these requests one at a time with a two-second
   interval to avoid a burst of concurrent requests.
4. `gpt-5.4-nano` adds topic and skill metadata after the paper content has
   been assembled.
5. Deterministic checks run. Only questions with blocking problems are sent to
   `gpt-5.4-mini` for one targeted repair.
6. The result is staged for manual review. Publication remains a separate
   manual action.

The following files implement this calibration:

- `shamo_budget_v2_stage_one_math_paper.json`
- `shamo_budget_v2_test2_six_paper_controller.json`
- `build_budget_v2_workflows.mjs`
- `validate_budget_v2_workflows.mjs`

The existing `shamo_budget_approve_reviewed_paper.json` remains the publication
workflow. No new Supabase migration is required for v2.

### What changed in validation

- Parent and child part marks are no longer double-counted. When `(a)` contains
  `(i)` and `(ii)`, only the lowest-level parts are summed.
- A part path containing the main question number, such as `["3","a"]`, is a
  blocking issue.
- Empty mark-scheme rows, missing questions, invalid pages, unknown part paths
  and wrong paper totals remain blocking.
- `MARK_CODE_COVERAGE_TOO_LOW` blocks approval when all extracted mark codes
  still fall below the question total. This indicates that at least one code
  is missing or malformed.
- When all codes cover the total but the primary route does not,
  `MARK_CODE_ALTERNATIVE_CLASSIFICATION` remains a warning for manual review.

### Import v2

1. Import `shamo_budget_v2_stage_one_math_paper.json`.
2. On **Mistral OCR Both Documents**, select the existing Mistral HTTP Header
   Auth credential.
3. Import `shamo_budget_v2_test2_six_paper_controller.json`.
4. In **Run One Paper Sub-workflow**, select
   **Shamo Budget v2 - Structured Maths Paper Staging**.
5. In **Budget Configuration**, replace `YOUR_PROJECT_REF` with the Supabase
   project reference.
6. Confirm the existing Google Sheets, OpenAI and Supabase credentials.
7. Keep both workflows inactive and run the controller manually.

The controller uses a new batch key ending in `v2-batch-01`, while ingestion
runs begin with `budget-v2`. Therefore the v1 evidence is preserved and the
same six source papers can be compared directly.

### Budget behavior

The v2 controller retains:

- at most six papers;
- sequential paper execution;
- the 10-minute pause after paper 5;
- a $3 batch guard;
- the existing $15 Test 2 campaign guard, including the v1 spend;
- the 350 MB database safety stop;
- no automatic publication or embeddings.

Each paid stage gets a separate Supabase reservation and actual-cost record.
The optional $0.20 repair reservation is made only when validation finds a
blocking issue. The reservation values are conservative admission checks, not
predictions of the final bill; the controller must still be stopped after this
calibration so measured quality and cost can be reviewed.

Run the local static validator after regenerating the JSON:

```powershell
& 'C:\Users\sheli\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' `
  'workflows\n8n\validate_budget_v2_workflows.mjs'
```

## Budget v2.1 correction

The first v2 calibration exposed an important Cambridge mark-scheme case:
the printed Answer cell can be blank while the Marks cell contains a code and
the Guidance cell explains the award. That row is valid source data and must
not be "filled in" by the model.

Budget v2.1 therefore:

- preserves a blank `content_markdown` with its printed `mark_code` and
  `guidance_markdown`;
- never asks the model to invent Answer text or copy Guidance into Answer;
- blocks common broken-text encoding fragments before approval;
- warns when Answer and Guidance contain the same substantial text;
- counts general Cambridge mark codes such as `M2`, `A2`, `B4` and dependency
  forms;
- distinguishes low total mark-code coverage from rows that may simply have
  been classified as alternative methods.
- rejects numeric part totals stored as mark codes or standalone rows;
- rejects a question part where every marked method was labelled alternative.
- tolerates an OpenAI targeted-repair response that repeats the exact same
  corrected question object, collapsing identical duplicates while still
  rejecting missing requested questions or conflicting duplicate repairs.

Files:

- `shamo_budget_v2_1_stage_one_math_paper.json`
- `shamo_budget_v2_1_test2_six_paper_controller.json`
- `build_budget_v2_workflows.mjs`
- `validate_budget_v2_workflows.mjs`

The controller defaults to `batch_number: 2`. Do not change it back to 1:
the first six source papers are already staged and should be corrected and
reviewed without repeating paid API work. The v2.1 batch and ingestion
idempotency keys are new, but the existing $15 campaign budget remains shared
across v1, v2 and v2.1.

The checked-in v2.1 controller workflow name is
**Shamo Budget v2.1 - Test 2 Six Paper Calibration**. If n8n shows
**Shamo Budget v2 - Test 2 Six Paper Calibration**, you are probably looking at
an older imported workflow or a duplicate; import the v2.1 JSON file and use the
workflow whose **Budget Configuration** contains `workflow_version: 'v2.1'` and
`batch_number: 2`.

Before allowing the controller to reach **Run One Paper Sub-workflow**, inspect
the output of **Pair and Select Test 2 Papers**. Batch 2 should select six
papers that are different from the published batch-1 identities:

- 2024 February/March 12
- 2024 May/June 21
- 2024 May/June 32
- 2025 October/November 41
- 2024 February/March 52
- 2024 May/June 61

If any selected batch-2 pair matches those identities, stop and inspect the
sheet ordering, imported workflow version, and `batch_number` before running
paid OCR/OpenAI work. The one-paper child can skip retries of the same v2.1
idempotency key, but the preflight selection check is the operator-facing guard
against accidentally reprocessing an already published paper from an older
workflow version.

Import the two v2.1 JSON files, reconnect the same credentials, and select
**Shamo Budget v2.1 - Structured Maths Paper Staging** in the controller's
sub-workflow node. Do not run batch 2 until all warnings from batch 1 have
been audited.

If **Parse Targeted Repair** reports that repair did not return exactly the
requested questions, compare `repair_question_numbers` with the returned
`corrected_questions[*].question_number`. A 6 August 2026 batch-2 Paper 51
failure was caused by OpenAI returning two byte-identical corrected objects for
Question 7. The checked-in v2.1 export now collapses identical duplicates and
records `repair_duplicate_question_numbers`; update the imported child workflow
before retrying from the failed execution.
