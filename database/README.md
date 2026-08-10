# Shamo v2 Supabase setup

This folder contains the SQL for the normalized Shamo past-paper database.
The setup is designed for the Supabase Free Plan and leaves the existing
`documents` and `A_level Math` tables unchanged.

## Files

- `shamo_v2_setup.sql`: run-once table, index, function and permission setup.
- `shamo_v2_verification.sql`: read-only checks to run afterwards.
- `shamo_v2_mark_scheme_guidance_patch.sql`: additive pilot-v2 update that
  stores examiner guidance separately and adds the atomic v2 publication
  function, including recovery from an earlier half-approved run.
- `shamo_v2_guidance_only_rows_patch.sql`: permits an official guidance-only
  mark-scheme row when its Answer and Marks cells are blank.
- `shamo_v2_post_publication_verification.sql`: read-only checks for the
  published 9709/12 M25 pilot, including chatbot context and Free Plan usage.
- `shamo_v2_search_indexing_patch.sql`: additive function that validates and
  saves a batch of 512-dimension question embeddings atomically.
- `shamo_v2_search_verification.sql`: read-only checks for the completed search
  index and a no-cost similar-question smoke test.
- `shamo_v2_1_batch1_complete_search_verification.sql`: read-only structural,
  vector, deduplication, pending-state, capacity, and semantic smoke checks for
  the fully embedded six-paper calibration batch.
- `shamo_v2_1_batch1_calibration_measurement.sql`: read-only per-paper and
  batch totals for published content, successful v2 extraction cost/time,
  repair use, issue mix, metadata review state, and known measurement gaps.
- `shamo_v2_1_batch1_semantic_benchmark.sql`: read-only 18-seed, top-five
  semantic-retrieval candidate set for graded review without new API calls.
- `shamo_v2_1_batch1_semantic_benchmark_labels.csv`: provisional broad-pool
  relevance grades for that candidate set. Same-component human sign-off is
  deferred until enough cross-paper same-component content exists.
- `shamo_v2_1_batch1_low_confidence_metadata_review.sql` and
  `shamo_v2_1_batch1_low_confidence_metadata_verification.sql`: guarded
  source-review decisions and verification for the 11 batch-1 metadata rows
  below 0.75 confidence.
- `shamo_v2_1_batch1_higher_confidence_metadata_review.sql` and
  `shamo_v2_1_batch1_higher_confidence_metadata_verification.sql`: guarded
  source-review decisions and verification for the remaining 22 batch-1
  metadata rows at or above 0.75 confidence.
- `shamo_v2_1_batch2_q7_duplicate_guidance_false_positive_correction.sql` and
  `shamo_v2_1_batch2_q7_duplicate_guidance_false_positive_verification.sql`:
  guarded source-review correction and verification for two batch-2 Question 7
  duplicate Answer/Guidance validator false positives.
- `shamo_v2_search_deduplication_patch.sql`: updates similarity search so one
  main question cannot occupy several result slots through its part embeddings.
- `shamo_v2_1_similarity_component_guard_patch.sql`: adds service-role-only
  guarded retrieval functions that compare only within the same paper component
  and return no recommendations unless at least two same-component papers and
  five cross-paper candidate questions are embedded.
- `shamo_v2_metadata_and_budget_patch.sql`: adds mathematical topic/skill
  metadata, batch/campaign API-cost tracking, atomic budget reservations, and
  publication of a paper plus its metadata in one transaction.
- `shamo_v2_metadata_and_budget_verification.sql`: read-only checks for the
  metadata and API-budget additions.

## How to install

1. In Supabase, open **SQL Editor**.
2. Create a new query.
3. Copy the complete contents of `shamo_v2_setup.sql`.
4. Make sure the selected role is `postgres`.
5. Click **Run** once.
6. Open a second query and run `shamo_v2_verification.sql` section by section.

The setup runs inside a transaction. If any statement fails, PostgreSQL should
roll back the setup rather than leaving a partly created schema.

If a failed SQL Editor run leaves its session in an aborted transaction, run
`rollback;` by itself before rerunning the complete corrected setup.

## Create the image bucket

Create the Storage bucket through the Supabase Dashboard rather than by writing
directly to the internal `storage` schema:

1. Open **Storage**.
2. Create a bucket named `past-paper-assets`.
3. Keep it private.
4. Restrict accepted files to image MIME types.
5. Set a conservative per-file limit, such as 5 MB.

The later n8n workflow will use a trusted Supabase service-role credential to
upload extracted instructional diagrams.

## Security state after installation

- RLS is enabled on every new public table.
- No `anon` or `authenticated` policies are created yet.
- Only `service_role` is granted table and function access.
- The service-role key must only be used in n8n or a trusted backend.
- The old tables are not changed.

User-facing RLS policies will be added when authentication and the new backend
are implemented.

## Free Plan storage strategy

- OCR pages are temporary and expire after seven days.
- Complete Mistral response payloads are not stored permanently.
- Base64 image data is not stored in Postgres.
- Only instructional images are uploaded to Storage.
- Embeddings remain null until the pilot is approved.
- One 512-dimension embedding will be generated for each searchable question
  or question part.

Check usage at any time:

```sql
select * from public.shamo_database_usage;
```

Pause ingestion if usage approaches 400 MB so there is room below the Free
Plan's 500 MB read-only threshold.

## Values used by the future n8n workflow

Qualification:

- `igcse`
- `a_level`

Exam session:

- `feb_march`
- `may_june`
- `oct_nov`

Document type:

- `question_paper`
- `mark_scheme`

The workflow must write these exact normalized values.

## Install the guarded batch-ingestion additions

After the base setup and both mark-scheme patches are installed:

1. Run all of `shamo_v2_metadata_and_budget_patch.sql` once as `postgres`.
2. Run `shamo_v2_metadata_and_budget_verification.sql` section by section.
3. Do not start the six-paper workflow unless every Section 1 row says `PASS`,
   all Section 2 privilege columns are `true`, and Section 4 remains below
   350 MB.

The budget tables do not hold prepaid money. They are a database safety gate:
n8n reserves a conservative amount before an OpenAI request, then replaces it
with the actual token cost returned by the API.

The new question metadata records:

- one broad topic;
- more precise subtopics;
- the skills and methods a student needs;
- question style;
- estimated difficulty;
- whether a diagram is required;
- classification confidence and review status.

Topic rows are written only when a reviewed paper is published. Paper
publication and metadata storage occur in one transaction, so one cannot
succeed without the other.

## Correct the two v2 blank-Answer false positives

The v2 validator incorrectly rejected two faithfully extracted Cambridge
mark-scheme rows because their Answer cells were blank while Marks and
Guidance were populated. No schema change is needed: the existing database
constraint already accepts a nonblank Answer **or** nonblank Guidance.

Run `shamo_v2_1_false_positive_correction.sql` once as `postgres`, then run
`shamo_v2_1_false_positive_verification.sql` section by section. The correction
is deliberately limited to the two reviewed ingestion-run IDs. It retains the
issue records as a resolved audit trail, preserves every warning for manual
review, and does not publish either paper.
