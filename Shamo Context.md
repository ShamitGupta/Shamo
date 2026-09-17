# Shamo Engineering Guide

> **Status date:** 5 August 2026  
> **Audience:** Experienced engineers joining the project without prior Shamo context  
> **Current phase:** Batch 1 is published and measured; close measurement/control gaps, then run guarded calibration batch 2  
> **Product scope:** Cambridge-style IGCSE Additional Mathematics and A-level Mathematics

This document explains what Shamo is intended to become, why the original implementation is being replaced, what has already been built, the exact state of the current ingestion campaign, and what should happen next.

It is both an onboarding guide and an operational handoff. Read it before changing the database, n8n workflows, or chatbot retrieval code.

## 1. Executive summary

Shamo is an AI mathematics tutor built around official past-paper questions and mark schemes. Its purpose is not merely to produce final answers. It should identify the exact question a student is working on, understand the official marking logic, and teach the solution in a clear, exam-aware way.

The original prototype demonstrated the user experience but was built on an unreliable database:

- Past papers were stored as large page-level text fragments.
- Questions, subparts, diagrams, and mark-scheme rows were not reliably separated.
- OCR and vision-model output was accepted with too little deterministic validation.
- The backend retrieved from two legacy tables rather than a structured question library.
- The deployed backend is no longer available.

The current engineering effort is therefore database-first. A normalized Supabase schema, guarded ingestion process, human-review workflow, publication transaction, mathematical metadata system, and semantic-search index have been created. The pilot paper and all six papers in calibration batch 1 are published, checked, embedded, and complete. The live index contains 164 search rows with no pending candidates.

Do not start by adding new chatbot features. First finish proving that the database and ingestion pipeline can produce trustworthy, searchable mathematics content at an acceptable cost.

## 2. Product vision

### 2.1 The student problem

Students often have a specific past-paper question in front of them but do not understand:

- what topic or technique it is testing;
- how to start;
- why a particular step is valid;
- how marks are awarded;
- where their own attempt went wrong;
- what similar questions they should practise next.

Generic chatbots can solve many mathematics problems, but they frequently lack the exact source context, diagram, examiner guidance, dependency marks, acceptable alternatives, and syllabus-specific expectations needed for reliable exam tutoring.

### 2.2 The intended Shamo experience

A student should be able to identify or upload a question and then interact with Shamo as a patient mathematics tutor. Shamo should:

1. Retrieve the exact question, all its subparts, required diagrams, and the official mark scheme.
2. Understand the mathematical topic, skills, likely methods, and expected difficulty.
3. Adapt the explanation to the student rather than immediately revealing the final answer.
4. Give hints, diagnose misconceptions, and explain how marks are earned.
5. Preserve mathematical notation and source fidelity.
6. Recommend genuinely similar questions using both meaning and structured metadata.
7. Track the student’s attempts and gradually build a picture of strengths and weaknesses.

### 2.3 Future capabilities

The intended product extends beyond text chat:

- **Similar-question discovery:** “Find questions like this one,” filtered by syllabus, topic, method, difficulty, paper type, and other constraints.
- **Personalized practice:** Recommend the next questions from a student’s error history and mastery profile.
- **Validated question generation:** Create new questions that test the same concepts without copying source papers, then independently verify the problem and solution.
- **Interactive graphs:** Produce structured Desmos or GeoGebra graphs when visualization materially helps.
- **Mathematical animation:** Generate carefully reviewed Manim animations for concepts that benefit from motion. This is a later-stage feature because rendering, quality control, and cost are more demanding.
- **Voice tutoring:** Allow natural spoken conversation while still displaying equations and diagrams visually.
- **Long-term learning memory:** Save conversations, attempts, misconceptions, progress, and goals under a real user account.

These capabilities depend on reliable structured content. That dependency is the reason the database rebuild comes first.

## 3. Product principles

Engineering decisions should follow these principles:

1. **Teach, do not merely answer.** Shamo should guide understanding and exam technique.
2. **Official source material is authoritative.** OCR and model output are interpretations that must be checked against source PDFs.
3. **Mathematical fidelity is non-negotiable.** A changed sign, reciprocal, exponent, variable, interval, or dependency mark can invalidate an otherwise fluent answer.
4. **Human approval remains part of publication.** Calibration uses deep source review. At scale, every paper receives automated validation while human review focuses on flagged papers and a controlled sample of otherwise clean papers. The pipeline must not silently auto-publish model-generated extraction.
5. **Structured data and semantic search complement each other.** Exact identity and filters come from database fields; conceptual similarity comes from embeddings.
6. **Spend gradually and measure quality.** Scale ingestion only after each calibration batch passes its quality and cost gates.
7. **Keep infrastructure appropriate to the current stage.** Supabase is sufficient; moving to AWS would add complexity without solving the primary data-quality problem.
8. **Preserve traceability.** A published row should be traceable to its paper, ingestion run, source page, and review history.

## 4. Repository map

The repository contains both the legacy prototype and the new data platform.

```text
Shamo/
├── AGENTS.md                         # This onboarding and operational guide
├── README.md                         # Original business and prototype overview
├── context.md                        # Historical technical snapshot
├── Shamo Product and Technical
│   Roadmap.md                        # Product review and longer-term roadmap
├── frontend/                         # React/Vite prototype
├── backend/                          # FastAPI legacy backend
├── database/                         # Supabase schema, patches, corrections, checks
└── workflows/
    └── n8n/                          # Ingestion, publication, and embedding workflows
```

### 4.1 Documentation precedence

Some repository documents describe different moments in the project:

- Use this file for the current high-level state and immediate sequence of work.
- Use `database/README.md` for database setup and database-specific operations.
- Use `workflows/n8n/README.md` for workflow import, configuration, and execution details.
- Use `Shamo Product and Technical Roadmap.md` for the broader product rationale.
- Treat `README.md` and `context.md` as valuable descriptions of the original prototype, but not as proof that its backend is still deployed or that it uses the new schema.

Update this file when a milestone materially changes. Do not leave exact operational status permanently buried in chat history.

## 5. Legacy prototype

### 5.1 Frontend

The frontend is a React application built with Vite. It currently provides:

- paper-selection controls for subject, year, session, variant, and question;
- a chat interface;
- streamed response rendering;
- Markdown and LaTeX rendering;
- a short in-memory conversation window of approximately ten messages;
- login and registration screens that are currently presentation-only.

The frontend still calls the old Railway backend:

- `POST /get_info`
- `POST /get_response`

That backend is no longer deployed, so requests may fail. Do not treat the old URL as a live production dependency.

### 5.2 Backend

The backend is a small FastAPI service. Its current responsibilities are:

- extract paper metadata from the frontend request;
- retrieve matching legacy database content;
- assemble an OpenAI prompt;
- stream a tutoring response.

The backend still queries the legacy tables:

- `documents` for IGCSE content;
- `A_level Math` for A-level content.

It does not use the normalized `shamo_*` schema. It also lacks production-grade authentication, persisted learning history, robust source selection, systematic observability, and an automated test suite.

The legacy backend is useful as a product prototype and prompt reference. It is not the backend architecture to scale.

### 5.3 Legacy database

The original ingestion process placed OCR/model output into broad page-fragment tables. At the start of the rebuild:

- `A_level Math` occupied roughly 140 MB;
- `documents` occupied roughly 42 MB;
- the whole database occupied roughly 195 MB.

Typical problems included:

- page fragments rather than question entities;
- unreliable question-number boundaries;
- combined or missing subparts;
- mark-scheme content detached from the correct question;
- diagrams represented only indirectly;
- weak provenance and review state;
- difficult exact retrieval;
- duplicated text and high storage usage;
- no safe foundation for similar-question search or learning analytics.

The legacy tables have deliberately not been deleted. Keep them until the replacement dataset and application behavior are proven.

## 6. Target architecture

The intended near-term architecture is:

```text
Official paper URLs
        ↓
Google Sheet manifest
        ↓
n8n guarded ingestion
        ↓
Mistral OCR + OpenAI structured extraction
        ↓
Deterministic checks + targeted repair
        ↓
Human source review
        ↓
Atomic publication to normalized Supabase tables
        ↓
Embedding generation and semantic-search verification
        ↓
New authenticated backend/tool layer
        ↓
React student application
```

Supabase remains the system of record. n8n handles offline ingestion orchestration. The future backend should expose carefully scoped tutoring and retrieval operations rather than allowing the browser to perform privileged database operations.

## 7. Why Supabase remains the database

The project is staying on Supabase for the current phase because it already provides:

- PostgreSQL;
- relational constraints and transactions;
- Row Level Security;
- authentication;
- object storage;
- the `pgvector` extension;
- generated APIs and RPC functions;
- a straightforward path from prototype to a modest production workload.

Moving to AWS would not repair OCR mistakes, source alignment, or mark-scheme interpretation. It would introduce more infrastructure, permissions, networking, deployment, and operational decisions while the central risk is still data quality.

Reconsider infrastructure only when measured scale, availability, regional, compliance, or workload requirements exceed Supabase’s practical limits. Do not migrate because AWS appears more “enterprise.”

## 8. Normalized database design

The v2 schema stores IGCSE Additional Mathematics and A-level Mathematics in one set of tables. Qualification, syllabus, paper type, year, session, and variant distinguish records. Do not create one set of tables per qualification or paper type.

This is a normalized relational design: distinct real-world entities are stored separately and connected by IDs. It reduces duplication, makes invalid states harder to create, and supports precise retrieval.

### 8.1 Core content entities

#### `shamo_papers`

One row represents a specific paper identity. It records fields such as:

- qualification;
- subject or syllabus;
- exam year and session;
- paper variant;
- publication state;
- the currently published ingestion run.

#### `shamo_paper_documents`

Records source documents associated with a paper, principally:

- question paper;
- mark scheme.

This separates the identity of a paper from its source files.

#### `shamo_questions`

One row per numbered question. It contains the shared stem, total marks, source positioning, and ingestion provenance.

#### `shamo_question_parts`

One row per meaningful subpart, such as `(a)`, `(b)(i)`, or `(c)`. Part paths are represented structurally instead of being folded into an unreliable question-number string.

#### `shamo_mark_scheme_items`

One row per mark-scheme instruction or award. Important fields distinguish:

- answer content;
- examiner guidance;
- mark code;
- sequence;
- part path;
- alternative method;
- dependency behavior;
- special-case guidance.

Answer and guidance are intentionally separate. A source row with a blank Answer cell and meaningful Guidance can be legitimate and must not be discarded.

#### `shamo_question_assets`

Represents instructional diagrams, graphs, tables, coordinate grids, geometry figures, and similar assets. The row stores:

- asset type;
- source page and image index;
- storage bucket and path;
- description;
- mathematical details;
- whether the asset is required to solve the question;
- a bounding box when reliable.

A bounding box may be `null` when the OCR provider does not return a valid one. The image crop and its structured description are both valuable.

#### `shamo_question_metadata`

Stores model-assisted classification for each question:

- main topic;
- subtopics;
- skills;
- methods;
- question style;
- difficulty;
- confidence;
- human-review status.

This metadata supports filtered search, practice recommendations, curriculum analytics, and future personalization. It is not authoritative until reviewed.

Paper-level approval and metadata-row approval are separate states. The live publication wrapper approves the ingestion run, but `shamo_store_question_metadata` hardcodes inserted or republished metadata rows to `review_status = pending`. Consequently, a pending metadata row is not evidence that its classification is wrong; it means row-level sign-off was not recorded. On 4 August 2026, all 11 pending batch-1 rows below the 0.75 confidence review threshold were checked against the official question papers and mark schemes: six were approved without a substantive topic/method/diagram correction and five were corrected. On 5 August 2026, the remaining 22 rows at or above 0.75 confidence were also source-reviewed: 12 were approved without substantive correction and 10 were corrected. Batch-1 row-level approval is now complete at 49/49 with zero pending. Across the earlier source corrections and both metadata audits, 18 inaccurate metadata classifications or method/diagram descriptions were corrected and approved. Original model-confidence values remain preserved as pipeline evidence.

The correction rates were 5/11 below 0.75 confidence and 10/22 at or above it. Because the supposedly higher-confidence group also required 45.5% substantive correction, the current confidence score is not a calibrated probability and cannot safely exempt rows from review. Source-review every metadata row in calibration batches 2-4, using low confidence, targeted repair, taxonomy or deterministic-rule failure, required diagrams/assets, null critical fields, cross-domain ambiguity and independent-verifier disagreement only to prioritize the queue. Present the exact question, relevant asset, proposed metadata and mark-scheme excerpt in one review screen. Only after controlled domain/taxonomy rules and at least three consecutive batches meet zero-critical-error and below-2%-correction targets should the process move to every risk-routed row plus a stratified 10-20% clean-paper sample; retain a 5-10% drift sample thereafter. Preserve whether approval came from exact human review, agent-assisted review or a documented sampling policy; the current single `review_status` field is not enough provenance for corpus scale.

Metadata approval is deliberately separable from exact-content tutoring. The live `shamo_get_question_context` function returns paper identity, document references, exact question text, parts, mark schemes and assets without using metadata. Current embeddings also use raw question/stem and part text, while similarity presently filters only qualification and syllabus. A basic exact-question chatbot can therefore operate on published, source-verified normalized content while metadata approval continues asynchronously. However, content verification cannot be delayed, and metadata-dependent similar-question, recommendation, topic-browsing and personalization features must remain gated. Before broad ingestion, stabilize deterministic paper domain, the controlled versioned question-topic vocabulary and review provenance; otherwise deferred approval becomes a large taxonomy backfill. Expand after the 24-paper calibration in rolling batches, not as one upload-everything-first campaign, and monitor the 350 MB admission threshold against the current approximately 199 MB database and legacy-table footprint. Metadata is produced during each staging batch and belongs to that batch's review lifecycle: source-review every row during calibration batches 2-4, correct the staged bundle where practical, publish papers individually, then record the formal row-level decisions and close the batch. Calibration batches must close this metadata gate before the next paid batch; after calibration, and only once the measured thresholds justify risk-plus-sampling, rolling ingestion may tolerate no more than a one-batch review lag.

#### `shamo_question_search`

Contains searchable whole-question and question-part records with embeddings. Current embeddings use:

- model: `text-embedding-3-small`;
- dimensions: 512.

Search records are created only after publication. Whole-question and part-level records are deliberately both supported.

### 8.2 Ingestion and audit entities

#### `shamo_ingestion_runs`

Tracks one attempt to extract and stage a paper. It stores status, review state, extraction summary, validation results, publication time, and model information.

#### `shamo_ingestion_issues`

Records blocking issues, warnings, resolutions, and review notes. This is part of the audit trail, not just temporary logging.

#### `shamo_ingestion_pages`

Stores temporary OCR page data. These records expire and should be cleaned up. Base64 images are not retained in the database.

#### `shamo_ingestion_batches`

Tracks guarded multi-paper calibration batches and their limits.

#### `shamo_api_cost_events`

Records reserved and actual API spend by operation. It prevents accidental repeated work and supports hard budget gates.

### 8.3 Important views

- `shamo_ingestion_review_queue`: staged runs and their review state.
- `shamo_published_question_overview`: compact view of published questions.
- `shamo_question_metadata_review`: metadata awaiting or recording human review.
- `shamo_database_usage`: database-size monitoring.
- `shamo_api_budget_overview`: reserved and actual API spending.

### 8.4 Important database functions

- `shamo_get_question_context`: returns a question with the context needed by a tutor.
- `shamo_match_similar_questions`: vector-based similarity retrieval.
- `shamo_get_pending_search_items`: returns published items still needing embeddings.
- publication functions: atomically publish a reviewed paper bundle and metadata.
- budget functions: reserve, finalize, or release an API-cost event.
- embedding storage functions: atomically store search embeddings and complete relevant runs.

Exact function signatures can change through patches. Inspect the active SQL definitions before building a client around them.

## 9. Security model

All new public `shamo_*` tables have RLS enabled. At present:

- privileged ingestion and publication functions are executable by `service_role`;
- `anon` cannot execute those routines;
- `authenticated` cannot execute those routines;
- no broad client policies have been added for the new content schema.

Consequences:

1. The n8n workflow and trusted backend may use service-role credentials.
2. The frontend must never receive the service-role key.
3. The browser cannot simply query all new tables until deliberate read policies or safe RPCs are designed.
4. Future student data requires user-scoped RLS policies, not only content-table protections.

The public Supabase anon key is not itself a secret, but RLS must be correct before relying on it. Provider keys, service-role keys, and workflow credentials are secrets.

Never copy credentials into documentation, commits, error reports, prompts, or screenshots. Local `.env` files may contain secrets; do not expose or commit their contents.

## 10. Storage and free-plan constraints

The database is intentionally designed for the Supabase Free Plan.

Current rules:

- Free Plan database allowance used for planning: 500 MB.
- Human safety line: stop and investigate near 400 MB.
- Workflow admission threshold: approximately 350 MB, leaving room for a batch and database overhead.
- Last measured size after all four remaining batch-1 publications, before embeddings: **198.82 MB**.

The large legacy tables still account for most usage. Normalized data is being added without deleting them.

Storage controls include:

- do not store OCR base64 in PostgreSQL;
- expire temporary OCR pages after seven days;
- keep only assets that are instructional or necessary;
- store asset files in the private `past-paper-assets` bucket;
- use 512-dimensional embeddings;
- monitor table and index growth after every batch.

Re-run the size check after the batch embedding run.

## 11. Ingestion pipeline

The active ingestion design is v2.1. Relevant files include:

- `workflows/n8n/shamo_budget_v2_1_stage_one_math_paper.json`
- `workflows/n8n/shamo_budget_v2_1_test2_six_paper_controller.json`
- `workflows/n8n/build_budget_v2_workflows.mjs`
- `workflows/n8n/validate_budget_v2_workflows.mjs`
- `workflows/n8n/shamo_budget_approve_reviewed_paper.json`
- `workflows/n8n/shamo_pilot_generate_search_embeddings.json`

Older pilot, v1, and v2 workflows remain for history and comparison. Do not assume the highest-looking filename has been imported into the user’s n8n instance; local JSON changes require a re-import.

### 11.1 Input manifest

A Google Sheet supplies clean paper metadata and official question-paper and mark-scheme URLs. The current calibration list is in the `Test 2` sheet and is intended to cover a balanced selection of A-level Mathematics paper types and exam sessions.

The source manifest should contain identifiers, not model-inferred guesses. Validate qualification, syllabus, year, session, variant, document type, and URL before spending on extraction.

### 11.2 Extraction sequence

For each paper:

1. Validate the manifest row and check for an existing processing or completed run.
2. Reserve the allowed API budget.
3. OCR the question paper with Mistral.
4. OCR the mark scheme with Mistral.
5. Extract the question-paper structure with an OpenAI model.
6. Build a mark-scheme page map.
7. Extract the mark scheme one question at a time.
8. Classify question metadata.
9. Run deterministic validation.
10. If blocking problems remain, repair only the affected questions.
11. Extract and upload only useful instructional assets.
12. Stage the complete bundle for human review.
13. Stop. Do not publish automatically.

### 11.3 Current model roles

The v2.1 calibration uses model roles approximately as follows:

- question-paper structure: `gpt-5.4-mini`;
- mark-scheme page mapping: `gpt-5.4-nano`;
- per-question mark-scheme extraction: `gpt-5.4-nano`;
- question metadata: `gpt-5.4-nano`;
- targeted repair: `gpt-5.4-mini`;
- semantic embeddings: `text-embedding-3-small`, 512 dimensions.

Model names and pricing are time-sensitive. Verify them before a new campaign rather than silently assuming this document remains current.

### 11.4 Throttling and resilience

The workflow is intentionally conservative:

- at most six papers per controller run;
- papers processed sequentially;
- mark-scheme questions processed sequentially with spacing;
- a ten-minute pause after the fifth paper;
- automatic retry should use bounded exponential backoff for transient 429, 500, and 503 responses;
- paid completed stages should not be repeated merely because a later stage failed.

The user currently receives Mistral OCR at zero cost provided calls are sufficiently spaced. Preserve the throttling assumptions unless the provider terms or account behavior changes.

Laptop sleep can interrupt a self-hosted n8n execution. Prevent sleep during a batch. If interruption occurs, inspect the existing ingestion run and cost reservation before retrying; do not blindly restart all papers.

### 11.5 Deterministic validation

Model confidence is not a substitute for structural checks. The workflow validates conditions such as:

- expected question count;
- unique question numbers;
- valid page references;
- paper and question mark totals;
- known part paths;
- non-empty question content;
- non-empty meaningful mark-scheme rows;
- mark-code syntax;
- primary mark-code coverage;
- asset validity;
- metadata completeness;
- exact source relationships where a special case is known.

Blocking issues prevent approval. Warnings require review but may be accepted after source confirmation.

### 11.6 Targeted repair

Repair is limited to blocking questions and supplied with the relevant source documents. It must not regenerate an entire successful paper because one row is malformed.

Every repair should be followed by the same deterministic checks as the original extraction.

This is the automated n8n branch from **Repair Needed** through **OpenAI Targeted Repair**. A recorded `targeted_question_repair` cost event proves that the model branch ran; it does not prove or imply that a human manually edited the paper. Human source review and later source-checked SQL corrections are the separate stage below.

### 11.7 Human review and publication

During calibration, reviewers compare staged content deeply with the official PDFs to discover systematic extraction failures. At scale, deterministic checks still run on every paper, while human source review is mandatory for flagged/repaired papers and a controlled sample of otherwise clean papers. Publication remains an explicit approved batch action rather than an unattended side effect of extraction.

Publication is atomic: questions, parts, mark-scheme rows, assets, and metadata should either all be published together or not at all. The paper’s current ingestion-run pointer is updated only when the transaction succeeds.

Each paper should still publish in its own database transaction so one failure cannot corrupt the rest of a batch. That does not require a human to execute and inspect every transaction manually; n8n can publish approved papers sequentially and return one batch report.

### 11.8 Embeddings

Embeddings are generated after publication checks pass. The embedding workflow discovers all published search candidates that do not yet have stored embeddings; the operator does not manually list paper IDs.

After indexing, run search verification and semantic smoke tests. A successful API response alone is not sufficient.

## 12. API budget policy

The total user-approved API budget for the current mathematics ingestion work is **USD 70**. Do not expand that budget without explicit approval.

The current six-paper workflow uses conservative reservation ceilings:

| Operation | Reservation ceiling per paper |
| --- | ---: |
| Question-paper extraction | $0.12 |
| Mark-scheme page map | $0.02 |
| Mark-scheme extraction | $0.12 |
| Metadata classification | $0.02 |
| Targeted repair, only if needed | $0.20 |

Additional campaign guards include:

- hard batch cap: $3;
- current calibration campaign cap: $15;
- no automatic publication;
- no automatic embedding call.

These caps are admission controls, not forecasts of total lifetime cost. Before a larger campaign, calculate:

- actual cost per successfully published paper;
- cost per failed or repaired paper;
- percentage needing human correction;
- expected number of papers in the intended corpus;
- remaining approved budget.

Measured embedding costs have been negligible:

| Indexing run | Items | Tokens | Actual cost |
| --- | ---: | ---: | ---: |
| Pilot paper | 29 | 2,277 | $0.00004554 |
| Papers 52 and 61 | 48 | 4,713 | $0.00009426 |
| Remaining batch-1 papers 12, 21, 32 and 41 | 87 | 6,609 | $0.00013218 |
| **Recorded total** | **164** | **13,599** | **$0.00027198** |

Extraction and repair calls, not embeddings, are the meaningful variable API expense.

## 13. Current progress

### 13.1 Infrastructure completed

The following foundations are in place:

- normalized Supabase schema;
- database constraints and publication functions;
- RLS on new tables;
- service-role-only privileged routines;
- private asset bucket;
- temporary OCR-page expiry;
- ingestion issue and review queue;
- atomic reviewed publication with metadata;
- API budget reservation and finalization;
- semantic search table and matching function;
- atomic embedding storage;
- database-size checks;
- n8n v2.1 guarded six-paper controller;
- deterministic workflow validator;
- source-checked SQL correction and verification patterns.

### 13.2 Fully published and indexed papers

#### Pilot paper

- Ingestion run: `1298c634-b404-4a36-9aa9-3739e88caf08`
- Paper ID: `3d36bf44-03e3-4640-984e-60ff7d5db675`
- Questions: 11
- Parts: 20
- Assets: 4
- Mark-scheme items: 96
- Total marks: 75
- Search items: 29
- State: published, verified, embedded, complete

#### Calibration paper variant 52

- Ingestion run: `754da6c9-7ee7-4699-9cd9-718e63dc1a15`
- Paper ID: `664037d1-538d-4929-9da4-789a828a0395`
- Questions: 6
- Parts: 17
- Assets: 1
- Mark-scheme items: 71
- Metadata rows: 6
- Total marks: 50
- Search items: 23
- State: source-corrected, published, verified, embedded, complete

#### Calibration paper variant 61

- Ingestion run: `054f296f-e08c-4360-a27d-325d064b2496`
- Paper ID: `2f718302-24c2-48ee-b6bb-ee2ec932b722`
- Questions: 7
- Parts: 18
- Assets: 1
- Mark-scheme items: 51
- Metadata rows: 7
- Total marks: 50
- Search items: 25
- State: source-corrected, published, verified, embedded, complete

All 48 combined search records for variants 52 and 61 were stored with 512-dimensional `text-embedding-3-small` vectors, and their ingestion runs reached `complete`.

### 13.3 Published and embedded

#### Calibration paper variant 12

- Ingestion run: `414a7734-2afe-4bab-9896-02649106d027`
- Paper ID: `df50b0d6-0483-47ab-8192-798e5083a88d`
- Questions: 11
- Parts: 17
- Assets: 3
- Mark-scheme items: 73
- Metadata rows: 11
- Total marks: 75
- Search items: 26
- State: source-corrected, published, post-publication verified, embedded, `complete`

Variant 12 passed checks for publication state, paper pointer, counts, mark-code format, unresolved issues, the Question 7 `*M1` dependency mark, pending search candidates, and database size. Its Question 7 tutor context was inspected and contained the complete stem, both parts, official marking logic, dependency mark, dependent method mark, special-case guidance, and source pages.

Two post-publication metadata inaccuracies were corrected and audited before embeddings:

- Question 1 now describes direct improper-integral evaluation rather than the comparison test.
- Question 7 now describes substitution and a repeated-root/discriminant condition for an ellipse-type curve rather than calling the curve a circle.

Relevant files:

- `database/shamo_v2_1_paper12_post_publication_verification.sql`
- `database/shamo_v2_1_paper12_metadata_source_review_correction.sql`

#### Calibration paper variant 21

- Ingestion run: `0a03a500-c82c-473d-8f2f-8c8ebb126c0f`
- Paper ID: `4f105c50-6624-4e0a-a429-44c24d53d3e6`
- Questions: 7
- Parts: 12
- Assets: 1
- Mark-scheme items: 66
- Metadata rows: 7
- Total marks: 50
- Search items: 17
- State: source-corrected, published, combined database-verified, embedded, `complete`

#### Calibration paper variant 32

- Ingestion run: `466116cc-75de-423e-9745-e2e401cfbe29`
- Paper ID: `3987e648-872d-4649-9fa1-e234ab2516c8`
- Questions: 10
- Parts: 20
- Assets: 1
- Mark-scheme items: 99
- Metadata rows: 10
- Total marks: 75
- Search items: 27
- State: source-corrected, published, combined database-verified, embedded, `complete`

#### Calibration paper variant 41

- Ingestion run: `98e0a3fb-0b1d-4d92-82a0-813148cb7b71`
- Paper ID: `03382be6-bf6d-420e-b356-6a899a11a88c`
- Questions: 8
- Parts: 9
- Assets: 4
- Mark-scheme items: 53
- Metadata rows: 8
- Total marks: 50
- Search items: 17
- State: source-corrected, published, combined database-verified, embedded, `complete`

### 13.4 Completed post-publication audit for the remaining batch-1 papers

The shared correction and verification files are:

- `database/shamo_v2_1_remaining_batch1_source_checked_correction.sql`
- `database/shamo_v2_1_remaining_batch1_source_checked_verification.sql`

All six verification sections passed for variants 12, 21, 32, and 41:

- run readiness and zero unresolved issues;
- zero invalid codes, subtotal rows, empty rows, exact answer/guidance duplicates, or corrupted mark-scheme text;
- exact primary mark coverage for all 36 questions;
- all five source-recovery and special-code checks;
- all reviewed text and metadata corrections;
- 22 resolved audit records: 15 original warnings and 7 added correction records.

The combined read-only audit passed for variants 12, 21, 32, and 41 before indexing: paper pointers and expected counts matched, all document and asset references were present, metadata was structurally complete, marking-row hygiene passed, unresolved issues were zero, and all 87 expected search candidates were available. The later embedding execution stored all 87 and moved the four runs to `complete/approved`. Do not rerun ingestion or embeddings for these papers.

A metadata spot-check found and corrected one taxonomy anomaly before embeddings: variant 41 Question 7 was labelled `Algebra`, although its particle velocity/displacement content belongs under Mechanics/kinematics. The published metadata now uses `main_topic = Mechanics`, is marked human-reviewed, and has a resolved audit record. The question text, marking content, search candidates, and publication state were unchanged.

Relevant files:

- `database/shamo_v2_1_paper41_q7_metadata_correction.sql`
- `database/shamo_v2_1_paper41_q7_metadata_verification.sql`
- `database/shamo_v2_1_batch1_complete_search_verification.sql`

## 14. Data-quality discoveries and lessons

The calibration campaign exposed several failure modes that future engineers must understand.

### 14.1 Markdown is not source semantics

Models sometimes returned marks such as `**M1**` or otherwise wrapped a valid code in formatting. Validation initially treated many of these as invalid codes.

The parser now strips harmless Markdown wrappers before interpreting the code. Store semantic fields cleanly; presentation formatting belongs at render time.

### 14.2 Printed totals are not mark-scheme items

Rows such as `4`, `10`, or “Total marks” appeared in extracted mark-scheme structures. These are printed subtotals, not awards. They must not become standalone `shamo_mark_scheme_items`.

### 14.3 A leading star is not necessarily an alternative method

Cambridge mark schemes may use `*M1` to express dependency. Treating every star as “alternative method” corrupts primary mark coverage.

Dependency, alternative method, follow-through, and special-case semantics must be parsed independently.

### 14.4 Special-case marks are not ordinary additional marks

`SC B1` or similar guidance describes a special-case award. Counting it as another primary mark can make the apparent total exceed the printed question total.

### 14.5 Blank answer cells can be valid

Some official mark-scheme rows contain no Answer text but contain important Guidance. Do not synthesize content, copy guidance into the answer, or discard the row.

### 14.6 OCR descriptions help but do not replace assets

The content includes descriptions of graphs and diagrams, which is much better than having no visual information. However, descriptions can omit spatial relationships or introduce interpretation errors. Required instructional images are now stored as assets as well as described structurally.

### 14.7 Metadata confidence requires judgment

A classification score below a threshold is a review signal, not automatic evidence of a wrong label. Conversely, a high score is not proof. Several calibration labels required source-aware correction.

### 14.8 Model extraction can omit complete mark rows

The remaining batch contained genuine missing mark-scheme rows, not merely formatting problems. These were restored from the official mark schemes. Mark-total coverage checks are therefore essential.

### 14.9 Mathematical claims must be source-checked

During the pilot review, an inferred answer of `-4/3` was contradicted by the official mark scheme, which showed `-3/4`. The source was correct.

Never “correct” official mathematics from memory or a partial OCR context. Inspect the actual expression and, when appropriate, verify the calculation independently.

### 14.10 Verification code can be wrong

The source-recovery verifier initially reported that Paper 32 Question 10 had lost its `*M1` dependency mark. A read-only inspection showed the stored row was correct. The verifier used `LIKE 'Use $$\int%'`; PostgreSQL treated the LaTeX backslash as the pattern escape character and produced a false failure. The check now uses `strpos`.

When a verifier fails, inspect the exact stored row before changing data or weakening a constraint. A failed check can indicate bad data, a bad assumption, or a bug in the check itself.

### 14.11 Calibration review is not the production operating model

The first papers were reviewed exhaustively because the team was discovering failure modes. This work is not intended to be repeated manually for every paper in a 250-paper corpus. At scale, automated checks run for every paper; humans review all flagged and repaired papers plus a controlled sample of clean papers. Publication remains auditable and transactional even when approval and reporting happen at batch level.

## 15. Parser hardening already completed

The generated v2.1 workflow has been updated so future ingestion:

- strips Markdown wrappers around mark codes;
- normalizes compact follow-through and parenthetical formatting;
- recognizes multiple code forms more safely;
- removes pure numeric subtotal rows;
- distinguishes special-case marks from primary coverage;
- does not infer an alternative method from a dependency star alone.

The local workflow generator and validator currently report the expected structure:

- child workflow nodes: 67;
- controller nodes: 17;
- OpenAI request nodes: 5;
- batch cap: $3;
- campaign cap: $15.

These improvements only affect future executions after the updated workflow JSON is imported into n8n. Editing the repository does not mutate an already imported workflow.

## 16. Immediate next steps

The exhaustive pre-publication verification, publication, combined indexing, and post-index verification are complete. Do not rerun the embedding workflow: all 164 published search items are stored and no candidates are pending.

### Step 1: Close the completed batch's measurement gaps

The first measurement pass is recorded in `Shamo Calibration Batch 1 Measurement.md`. The final reviewed database passes its content/index integrity gate, but raw pipeline autonomy and student-facing similar-question usefulness do not yet pass an unattended-scale gate.

Measured baseline:

- 49 questions, 93 stored parts, 413 instructional mark rows, 11 assets, 49 metadata rows, and 135 batch search rows;
- 58 recorded issue rows, all resolved, with targeted model repair on 6/6 papers;
- two source-omission recoveries and 18 post-publication metadata corrections;
- approximately $0.83026844 known batch provider cost excluding unledgered Mistral OCR;
- approximately 103.21 minutes of successful v2 staging time and 2.65 MB observed database growth;
- 49/49 metadata rows explicitly approved after source review of both the low- and higher-confidence pending groups;
- preliminary agent-reviewed semantic Precision@5 of 0.400 at relevance grade 2 or 3, mean grade 1.322/3, 6.7% domain leakage, and zero duplicate main questions.

The semantic score is an end-to-end baseline over a sparse six-paper corpus, raw question-text embeddings, and qualification/syllabus-only filtering. It is not the intrinsic accuracy of the embedding model and still requires human sign-off. Standard nDCG@5 is deferred until a broader candidate pool receives independent human judgments.

Still close or explicitly mark unavailable:

- Mistral spend;
- human review time per paper;
- human/expert sign-off of the 18-seed semantic labels;

This is the evidence for deciding whether the pipeline is ready to scale.

### Step 2: Build scalable batch quality control

Before processing hundreds of papers, replace the current chat-driven SQL sequence with:

- one automated validation report per paper;
- one batch dashboard summarizing clean, warning, blocked, repaired, published, and indexed papers;
- automatic routing of blockers, repairs, low-confidence metadata, unusual assets, and count mismatches to human review;
- a controlled random human sample of otherwise clean papers;
- sequential atomic publication of approved papers from one batch approval action;
- one combined post-publication and search report.

Every paper must still pass automated checks. Human review should cover every flagged or repaired paper plus approximately 10-20% of clean papers during early scale-up. Reduce sampling only after multiple batches meet agreed error-rate targets.

### Step 6: Import the hardened v2.1 workflow

Before ingesting future papers, import the latest generated v2.1 child workflow into n8n and reconnect credentials/configuration as documented in `workflows/n8n/README.md`.

Validate the workflow JSON locally before import. Do not hand-edit generated JSON unless there is no generator path.

### Step 7: Start batch 2 only as guarded calibration

The controller currently defaults to batch 2 because batch 1 already exists. Start it only if:

- batch 1 is fully published and indexed;
- no unresolved data-quality problems remain;
- measured cost is compatible with the remaining $70 budget;
- database usage remains comfortably below the safety threshold;
- the updated v2.1 parser is the version actually imported;
- the minimum metadata-review and retrieval-domain controls from the batch-1 report are in place;
- the next run captures OCR cost, embedding cost, and reviewer minutes.

This is a conditional go for another measured six-paper batch, not a go for unattended corpus-scale ingestion.

## 17. Medium-term roadmap

### 17.1 Complete the calibration dataset

Process the balanced 24-paper A-level Mathematics calibration set in gated batches of six. Every paper receives deterministic validation, while source review becomes risk-based after the initial canary work. Every batch should repeat:

1. staged ingestion;
2. human review of every flagged/repaired paper and a controlled sample of clean papers;
3. corrections;
4. verification;
5. publication;
6. embeddings;
7. semantic search checks;
8. cost and storage review.

Do not ingest the entire corpus in one unattended campaign. The purpose of the remaining calibration papers is to measure residual error rates and determine whether the clean-paper sample can safely be reduced.

### 17.2 Establish measurable quality targets

Before broad ingestion, define and measure targets such as:

- question-boundary accuracy;
- part-path accuracy;
- paper and question mark-total agreement;
- mark-code accuracy;
- source-page accuracy;
- instructional-asset recall;
- topic/skill metadata agreement;
- percentage of papers requiring repair;
- reviewer minutes per paper;
- semantic-search relevance at top 5.

“Workflow completed” is not a quality metric.

### 17.3 Expand the corpus

Once calibration is accepted:

1. Complete the chosen A-level Mathematics scope.
2. Add IGCSE Additional Mathematics through the same schema and validation process.
3. Preserve qualification and syllabus filters.
4. Continue sampling official sources during ingestion.
5. Reassess storage before considering deletion or archiving of legacy tables.

The current product scope is mathematics only. Do not silently broaden ingestion to unrelated subjects.

### 17.4 Build the new retrieval backend

Replace legacy table lookup with a service that:

- resolves exact paper identity;
- calls `shamo_get_question_context`;
- performs filtered semantic search when appropriate;
- includes required assets;
- applies source-aware tutoring prompts;
- records citations/provenance in internal traces;
- never exposes service-role credentials;
- handles missing or ambiguous paper selection explicitly.

The backend should distinguish operations:

- exact question retrieval;
- similar-question retrieval;
- hint generation;
- worked explanation;
- attempt diagnosis;
- mark-scheme comparison.

Do not send the entire database or irrelevant mark schemes to the model.

### 17.5 Build an evaluation harness

Before deploying the new tutor, create repeatable tests covering:

- exact retrieval for known paper metadata;
- questions with no parts;
- questions with shared stems and multiple parts;
- diagrams required to solve;
- guidance-only mark rows;
- alternatives, follow-through, dependency, and special-case marks;
- malformed or incomplete student requests;
- common mathematical misconceptions;
- answer withholding during hint mode;
- source-faithful final explanations.

Include both automated structural assertions and expert-reviewed tutoring examples.

### 17.6 Add real authentication and persistence

Use Supabase Auth and user-scoped RLS for:

- profiles;
- conversations;
- attempts;
- saved questions;
- mastery estimates;
- preferences;
- goals.

Keep public content, private student data, and privileged ingestion operations separated.

### 17.7 Add similar-question search

Use a hybrid strategy:

1. filter by qualification and syllabus;
2. optionally filter by paper type, topic, skills, method, or difficulty;
3. retrieve by vector similarity;
4. deduplicate whole-question and part-level matches;
5. apply diversity so results are not near-identical variants;
6. return a reason each result is considered similar.

Evaluate relevance with teacher-written query sets rather than a few anecdotal examples.

### 17.8 Add personalization

Introduce structured attempt and misconception data only after the content identity is stable. Useful future entities include:

- student attempt;
- submitted working;
- awarded rubric items;
- detected error type;
- hint usage;
- time spent;
- mastery evidence;
- recommended next question.

Avoid a single opaque “ability score.” Retain evidence and uncertainty.

### 17.9 Add graph tools

For Desmos or GeoGebra:

- have the model produce a validated structured graph specification;
- constrain expressions, domains, labels, and viewport;
- render through a trusted tool adapter;
- save the specification with the tutoring message;
- provide a text alternative;
- never rely on a graph when the student’s client cannot display it.

The model should request a graph because it improves the explanation, not decorate every answer.

### 17.10 Add voice mode

Voice mode requires more than speech-to-text:

- streaming transcription;
- interruption handling;
- short conversational turns;
- equation-aware display;
- a way to clarify ambiguous spoken notation;
- text-to-speech;
- synchronized visual working;
- stored transcript and privacy controls.

For example, “x squared minus four over three” is ambiguous without visual confirmation. The UI should display the interpreted expression before reasoning from it.

### 17.11 Add generated questions carefully

Generated questions should:

- be conditioned on explicit concepts and methods;
- avoid reproducing source wording;
- include a separately generated solution and mark logic;
- be checked by an independent solver or symbolic tool where possible;
- pass range, domain, uniqueness, and consistency checks;
- be labeled as generated rather than official;
- enter a review queue before being recommended broadly.

Prediction of “future exam questions” should be framed as practice generation based on historical patterns, not a claim to know future exam content.

## 18. Engineering and operational rules

### 18.1 Database changes

- Put schema changes in versioned SQL files under `database/`.
- Prefer additive, reversible changes.
- Use transactions for multi-table corrections.
- Lock and assert exact target rows before source corrections.
- Make correction scripts fail when preconditions do not match.
- Pair material correction scripts with read-only verification scripts.
- Run migrations or corrections as a whole unless the file explicitly says otherwise.
- Run multi-section verification scripts section by section.
- Do not weaken constraints merely to accept malformed model output.
- Do not delete legacy tables until migration acceptance and backup decisions are explicit.

### 18.2 Workflow changes

- Prefer updating the workflow generator over hand-editing generated JSON.
- Rebuild and validate JSON after generator changes.
- Keep paid stages idempotent.
- Preserve budget reservation/finalization around every paid operation.
- Separate staging, approval, and embeddings.
- Never make publication automatic.
- Never regenerate all papers because one paper or one stage failed.
- Document required n8n credentials without including secret values.
- Remember that local JSON changes require re-import into n8n.

### 18.3 Source review

- Compare with official PDFs, not OCR output alone.
- Check question numbering and part paths.
- Check every printed mark total.
- Check mathematical notation at high zoom where needed.
- Check diagrams and whether they are required to solve.
- Check mark-code semantics, not just regex validity.
- Check that answer and guidance columns remain separate.
- Record corrections and why they were made.

### 18.4 Publication

- No unresolved blockers.
- Warnings must be explicitly reviewed.
- Metadata must be structurally complete.
- Required assets must exist or have a documented exception.
- Publication must be atomic.
- Verify immediately after publication.
- Generate embeddings only after the published content passes checks.

### 18.5 Application code

- Do not build new features against `documents` or `A_level Math`.
- Do not assume the legacy Railway backend works.
- Do not expose provider or service-role keys to the frontend.
- Use typed request/response contracts.
- Preserve source and question IDs through the tutoring pipeline.
- Make ambiguity visible to the student rather than guessing a paper.
- Add tests before replacing the retrieval path.

### 18.6 Repository hygiene

- The working tree may contain user changes. Do not discard or overwrite unrelated work.
- Avoid destructive Git operations.
- Never commit `.env`, credential exports, execution dumps containing secrets, or private source files without explicit intent.
- Keep generated artifacts and temporary execution files out of source control where appropriate.
- Update documentation when filenames, runbooks, or architecture change.

## 19. Useful validation commands

Run commands from the repository root unless stated otherwise.

### 19.1 Build generated n8n workflows

```powershell
& 'C:\Users\sheli\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' `
  'workflows\n8n\build_budget_v2_workflows.mjs'
```

### 19.2 Validate generated n8n workflows

```powershell
& 'C:\Users\sheli\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' `
  'workflows\n8n\validate_budget_v2_workflows.mjs'
```

If the bundled Node runtime path changes, use a compatible local Node installation rather than hard-coding a new machine-specific path into workflow source.

### 19.3 Frontend

```powershell
Set-Location frontend
npm.cmd run lint
npm.cmd run build
```

### 19.4 Legacy backend syntax check

```powershell
python -m compileall backend
```

There is not yet a sufficient automated backend or end-to-end test suite. That is a known gap, not evidence that manual testing is enough.

## 20. Mark-scheme conventions

Engineers working on parsing or retrieval should become familiar with Cambridge-style notation. At minimum:

- `M1`: method mark;
- `A1`: accuracy mark;
- `B1`: independent mark;
- `DM1`: dependent method mark;
- `FT`: follow-through;
- a leading `*`: often dependency-related, not automatically an alternative method;
- `SC`: special case;
- alternative solutions may have multiple valid rows but must not inflate primary mark coverage.

The exact printed scheme remains authoritative. Regexes are useful guards, not complete semantic parsers.

Primary-code coverage should normally agree with the printed question total after alternatives, special cases, and subtotals are interpreted correctly.

## 21. Data conventions

Use the database enums and normalized values rather than introducing variants casually.

Current important values include:

| Concept | Values |
| --- | --- |
| Qualification | `igcse`, `a_level` |
| Session | `feb_march`, `may_june`, `oct_nov` |
| Document type | `question_paper`, `mark_scheme` |

Additional conventions:

- `question_number` is the top-level printed number, not a value like `4(a)`.
- nested components belong in `part_path`.
- `part_path` should be structurally valid and `null` where the row applies to the whole question.
- page numbers should refer to the source document consistently.
- empty strings and `null` are not interchangeable when source blankness is meaningful.
- content Markdown may contain LaTeX, but structured columns should not contain decorative Markdown wrappers.
- published content is tied to a specific ingestion run.

## 22. Known gaps and risks

### Product and application

- The active frontend still targets a dead legacy backend.
- Authentication screens are not wired to production auth behavior.
- Conversations and progress are not persisted.
- The new database is not connected to the tutor.
- No production deployment represents the new architecture.

### Data

- Three papers are fully published and indexed.
- Variants 12, 21, 32, and 41 are published, combined database-verified, and awaiting 87 embeddings in total.
- The 24-paper calibration is incomplete.
- IGCSE Additional Mathematics has not yet gone through the new calibrated pipeline.
- All 49 batch-1 metadata rows have an agent-assisted source review and recorded disposition, but independent expert sign-off and a controlled versioned taxonomy are still absent; the 10/22 higher-confidence correction result requires full-row review during the remaining calibration batches.
- Similarity search has a preliminary 18-seed graded baseline, but the labels still need human sign-off and the current Precision@5 of 0.400 does not pass a student-facing usefulness gate.

### Engineering

- No comprehensive automated test suite.
- No continuous-integration quality gate for SQL/workflows/application code.
- n8n is self-hosted on a laptop and vulnerable to sleep or local connectivity interruption.
- Workflow imports can drift from repository JSON.
- Current exact operational state is partly manual and must be documented after each batch.
- A combined batch publication/quality dashboard has not yet replaced the paper-by-paper SQL workflow.

### Security and operations

- Content RLS policies for safe application reads still need design.
- Student-data tables and policies do not yet exist.
- Secret rotation and deployment secret management need a production plan.
- Monitoring, alerting, backup/restore exercises, and incident procedures are not yet mature.

## 23. Definition of done for the current milestone

The database-calibration milestone is complete only when:

- all 24 selected A-level calibration papers are staged, automatically validated, published, and embedded;
- structural validation passes for every paper;
- every flagged or repaired paper and the agreed clean-paper sample agree with official sources;
- mark-scheme semantics are reliable enough for tutoring;
- asset handling works across graphs, tables, and diagrams;
- metadata review accuracy is measured;
- semantic retrieval meets an agreed relevance target;
- actual cost fits within the approved budget;
- database growth remains compatible with the Free Plan;
- retry and interruption behavior does not cause duplicate paid work;
- the team has a repeatable risk-based reviewer runbook and batch quality report.

Completion of this milestone authorizes planning broad corpus ingestion. It does not by itself mean the student product is production-ready.

## 24. Definition of done for the next product milestone

The rebuilt tutor milestone should require:

- a new backend using only normalized content APIs;
- exact paper/question retrieval;
- source-aware tutoring context including required assets;
- tested hint, explanation, and answer-review modes;
- useful similar-question retrieval;
- real authentication;
- persisted conversations and attempts;
- safe RLS policies;
- automated tests and evaluation cases;
- a deployable frontend and backend;
- cost, latency, and error monitoring.

## 25. Handoff checklist

When taking over current work:

1. Read this file.
2. Read `database/README.md`.
3. Read `workflows/n8n/README.md`.
4. Inspect the latest SQL patches and their verification companions.
5. Confirm which workflow version is actually imported into n8n.
6. Query current run states and database size rather than assuming this dated snapshot is still exact.
7. Do not rerun ingestion for variants 12, 21, 32, or 41.
8. Do not rerun embeddings for batch 1; all six runs are complete and the global index has 164 rows with zero pending candidates.
9. Record cost, storage, quality, correction rate, and reviewer time.
10. Build the batch quality/approval workflow and define the clean-paper sampling rate.
11. Make an explicit go/no-go decision for batch 2.

If in doubt, prefer a read-only verification step over a paid rerun or destructive correction.

## 26. Final orientation

Shamo has moved beyond a simple “PDF text plus chatbot prompt” prototype. The project is now building a trustworthy mathematical content platform that can support tutoring, search, personalization, visualization, voice, and generated practice.

The main engineering challenge is not connecting another model endpoint. It is preserving exact mathematical meaning from source documents, representing it cleanly, proving its quality, and retrieving only the right context for a student.

The work completed so far establishes that foundation, but the calibration is not finished. The best next contribution is to complete and measure the remaining database pipeline before expanding either the corpus or the feature surface.
