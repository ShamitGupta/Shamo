# Shamo accuracy harness

Measures extraction accuracy against stored OCR, offline and free, and provides
the only agent-executable path for running a paper end to end.

## Why it exists

Batches 1 and 2 each ended in hand-written SQL that corrected that batch's rows.
Nothing was added to the validator, so the same defect classes came back. This
harness exists so a review finding becomes a permanent check instead of a
one-off correction.

**The standing rule:** every review finding lands as a labelled defect plus
either a validator rule or a golden override, *before* any correction SQL is
written.

## Setup

```bash
cp workflows/n8n/harness/.env.example workflows/n8n/harness/.env
```

Paste the `service_role` key from Supabase → Project Settings → API. The anon
key returns 401 on `shamo_ingestion_pages`: RLS is enabled with no anon
policies, and that table is the harness's input. `.gitignore` excludes `.env`.

## Commands

| Command | Cost | What it does |
| --- | --- | --- |
| `node workflows/n8n/harness/check.mjs` | $0 | **The regression gate.** Regenerate, validate, unit-test, the parser/asset/blocked-paper gates, replay, then the review-triage reports. Exit 1 on failure. |
| `node workflows/n8n/harness/check_parser.mjs` | $0 | Three go/no-go gates against verbatim stored OCR |
| `node workflows/n8n/harness/check_asset_matching.mjs` | $0 | Deterministic asset-index resolution vs every asset the pipeline already matched |
| `node workflows/n8n/harness/check_blocked_papers.mjs` | $0 | The papers that stopped batch 4 must stay unblocked |
| `node workflows/n8n/harness/check_autonomy.mjs` | $0 | How many staged papers would still need a human |
| `node workflows/n8n/harness/replay.mjs` | $0 | Replay the real generated graph over stored OCR |
| `node workflows/n8n/harness/check_ocr_vs_pdf.mjs` | $0 | **OCR vs the PDF's own text layer** — the only check that sees OCR corruption |
| `node workflows/n8n/harness/check_content_vs_pdf.mjs` | $0 | Staged prose and printed mark allocations vs the printed paper |
| `node workflows/n8n/harness/check_ocr_integrity.mjs` | $0 | OCR internal consistency heuristics |
| `node workflows/n8n/harness/check_metadata_topics.mjs` | $0 | `main_topic` vs evidence in the question and mark scheme |
| `node workflows/n8n/harness/check_metadata_fields.mjs` | $0 | `subtopics`/`skills`/`methods`/`difficulty` — structure, named techniques, difficulty self-consistency |
| `node workflows/n8n/harness/score.mjs --write` | $0 | Emit `Shamo Batch N Scorecard.md` |
| `node workflows/n8n/harness/inspect_question.mjs 31 7 --raw` | $0 | Diagnose one question against its raw OCR |
| `node workflows/n8n/harness/snapshot_fixtures.mjs` | $0 | Refresh OCR fixtures from live Supabase |
| `node workflows/n8n/harness/export_staged.mjs --batch v2.2-batch-02` | $0 | Export staged bundles for offline review |
| `python workflows/n8n/harness/extract_pdf_text.py <pdf-dir>` | $0 | Cache PDF text layers (once per paper) |
| `node workflows/n8n/harness/deploy_harness.mjs` | $0 | Deploy the harness workflows to n8n |

Run `check.mjs` before deploying a workflow change and before spending anything.

## Reviewing a batch

Four commands turn a staged batch into a triage list. All free.

```bash
node workflows/n8n/harness/snapshot_fixtures.mjs                    # fresh OCR
node workflows/n8n/harness/export_staged.mjs --batch v2.2-batch-02  # staged bundles
python workflows/n8n/harness/extract_pdf_text.py <dir-of-pdfs>      # once per paper
node workflows/n8n/harness/check.mjs                                # everything
```

`export_staged.mjs` also pins which OCR run the checks score against. Several
runs exist per paper and their filenames sort by UUID, which is not
chronological — without the pin, 9709/62 scored against the superseded v2.1 run.

What this replaced: reading six papers page by page. On batch 2 it reduced the
whole batch to **four candidate pages** out of 201, of which two were real.

### What each check can and cannot see

| Check | Catches | Blind to |
| --- | --- | --- |
| mark reconciliation | lost or extra mark rows | a row that awards nothing |
| printed mark allocations | dropped or invented parts, wrong marks, reordering | anything not carrying a `[N]` |
| prose fidelity | **invented** text | **dropped** text — fewer words still all match |
| OCR vs PDF symbols | `2!`→`2^2`, `÷`→`+` | symbols pypdf cannot extract |
| `main_topic` evidence | a topic the question text does not support | a question that genuinely spans two topics |
| metadata fields | empty/duplicate fields, a named technique the source never uses | anything expressed only as paraphrase |
| asset resolution | a claimed `page:index` that misses, and claims with no image behind them | a diagram OCR never detected at all |
| autonomy floor | defects already met returning | anything about papers not yet seen |

### Why the autonomy number is a floor and not a rate

`check_autonomy.mjs` reads 12 of 12 clean. Every fix in the pipeline was written
with those twelve papers in view, so it answers "would a defect we have already
met still stop a batch" — not "will the next six be clean". Quote it as a
regression floor. The honest measurement is the first batch nobody has looked at.

The same caution applies to asset resolution. It reproduces all 18 assets the
pipeline already matched, which is the right bar for replacing a model's
judgement with code, but 18 is a small corpus and every one sits at index 0 or 1.

### The limit that matters, stated plainly

`methods`, `subtopics` and `skills` are **prose about mathematics**; the source
**is** mathematics. There is very little lexical overlap to mine, so absence of a
word proves almost nothing. The first version of `check_metadata_fields.mjs`
tested exactly that and produced 108 findings on 138 rows, nearly all wrong —
`"Rewrite in completed-square form"` on a question that literally prints
`y = 4(x-3)^2 - 8`.

What survived is narrow on purpose: only **named techniques** with both a prose
form and a notation form, so the source has somewhere to leave a trace. Even
then the trace lists needed widening four times against real false positives
(Poisson marked as `e^{-3.1}(...)`, binomial as bare coefficients, implicit
differentiation as `\frac{dy}{dx}`, friction called "resistance").

`difficulty_level` is not checkable at all. There is no ground truth for it in
this corpus, so the script reports only self-consistency against the model's own
output for questions of similar size, and says so in its own footer.

Both metadata scripts carry an `ADJUDICATED` list. A row read against source and
judged correct stops being re-raised. Without that the reports never converge and
a reviewer learns to skim them — which is precisely how the
`MARK_CODE_ALTERNATIVE_CLASSIFICATION` warning on 9709/12 Q6(b) went unheeded
until it had cost a published mark.

## Running a paper for real

The production controller and child use `manualTrigger`, and n8n's public API
has no execute endpoint for those — an agent cannot fire them. The harness
runner uses a **webhook**, which an agent can fire. It stages one paper.

```bash
curl -X POST http://localhost:5678/webhook/shamo-harness-one-paper \
  -H "Content-Type: application/json" \
  -d '{"label":"r0","paper_variant":"62","year":2024,"exam_session":"may_june",
       "question_paper_url":"https://.../9709_s24_qp_62.pdf",
       "mark_scheme_url":"https://.../9709_s24_ms_62.pdf"}'
```

Both harness workflows must be **active**. A run takes roughly 5–15 minutes
depending on paper size and whether the repair branch fires.

## Isolation

Four independent controls, all re-asserted at runtime by `Guard Harness
Isolation` so a mistake fails closed:

1. **`-h` paper_variant suffix.** `shamo_papers` is unique on
   `(qualification, syllabus_code, year, exam_session, paper_variant)`, so
   `62-h` is a different row from `62`. This matters more than it looks:
   `Upsert Paper` sets `status='staging'`, so without the suffix a harness run
   would flip a *published* paper back to staging.
2. **`harness` idempotency namespace.** The column is globally unique.
3. **Separate campaign** `shamo-harness-v1` with a database-enforced $7 ceiling
   inside `shamo_reserve_api_budget`. Production's $15 is untouched.
4. **Staging only.** Publication lives in a workflow the harness never calls.

The production child (`fAa1IGsa6OKOq8xO`) is never written to by the deploy
script — it refuses any workflow whose name does not start with `Shamo Harness`.

### Teardown

```sql
delete from shamo_ingestion_runs where idempotency_key like '%shamo-harness-v1%';
delete from shamo_papers where paper_variant like '%-h';
delete from shamo_ingestion_batches where campaign_key = 'shamo-harness-v1';
```

## Promotion

The harness child is the candidate; the production child is not modified.
When the scorecard passes, copy `shamo_harness_stage_one_math_paper.json` over
the production child in the n8n UI, or point the production controller at the
harness child after renaming. Do this deliberately, not as a side effect.

## What the harness cannot tell you

- **Dropped source content.** `check_content_vs_pdf.mjs` detects text the bundle
  invented, not text it lost: a question missing a block simply has fewer words
  and every one of them still matches. 9709/62 Q2's lost stem would still slip
  through. Closing this needs question-region alignment against the PDF and is
  not built. The printed-mark-allocation check covers the case where the lost
  content took a `[N]` with it, which is the common one.
- **Whether a topic value is *right*.** Vocabulary membership is checkable;
  correctness is not.
- **Asset resolution.** The snapshot stores OCR text, not base64 image data, so
  `ASSET_SOURCE_NOT_FOUND` is expected offline and is excluded as an artefact.
