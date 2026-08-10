# Shamo Batch 2 - Source Review Findings (all six papers)

> Review date: 7 August 2026
> Method: **agent-assisted source review**. Staged `paper_bundle` JSON compared against the official question papers and mark schemes downloaded from the URLs recorded in each run.
> Companion document: `Shamo Batch 2 Paper 62 Source Review.md` (full line-by-line review of Paper 62).

**This is not publication approval.** Agent-assisted review is recorded distinctly and does not replace the operator's final per-paper approval.

## Coverage - read this before using the numbers

Depth of review differs by paper. Do not read "no findings" as "verified clean".

| Paper | Question-paper side | Mark-scheme side |
| --- | --- | --- |
| 62 | Full line-by-line vs PDF | Full line-by-line vs PDF |
| 11 | Full line-by-line vs PDF | Q1-Q6 vs PDF; Q7-Q11 not yet source-compared |
| 22 | Deterministic checks only | Q2 verified vs PDF; remainder not source-compared |
| 31 | Deterministic checks only | Not source-compared |
| 42 | Deterministic checks only | Not source-compared |
| 51 | Deterministic checks only | Not source-compared |

Deterministic checks were run uniformly across all six papers: mark reconciliation per part, missing-diagram detection, fabricated-part detection, stem/part duplication, metadata vocabulary, and null critical fields. Every defect listed below is either verified against source or is a deterministic mismatch whose cause is stated.

## Headline

**No paper in batch 2 should be published as staged.** All six are marked `validation_report.passed = true` and `ready_for_approval = true`. Four of the six fail a basic mark-total reconciliation, one is missing a required diagram, and the taxonomy is internally inconsistent both within the batch and against batch 1.

## Finding 1 (critical, verified) - `*` dependency notation misread as "alternative method"

Cambridge uses a leading asterisk (`*M1`) to mark the mark that a later `DM1` depends on. It uses a separate, visually explicit convention for genuine alternatives: a bold "Alternative Method for Question N" header row plus bracketed mark codes such as `(B1)`, `(M1)`.

The pipeline conflates the two.

**Verified case - Paper 22 Question 2** (mark scheme page 6). Printed:

| Answer | Marks |
| --- | --- |
| (2x−1)ln 6 | M1 |
| ln 5 + 3x + 2 | **\*M1** |
| Attempt solution of linear equation | DM1 |
| Obtain 9.256 | A1 |
| | **4** |

All four are primary marks of one method. The staged bundle sets `is_alternative_method = true` on the `*M1` row. Consequences:

- The question's primary mark coverage drops from the printed 4 to 3.
- A required step would be presented to a student as an optional alternative route.

This is the documented rule "a leading `*` commonly indicates dependency; it does not automatically mean alternative method" being violated directly. It is the likely cause of the three `MARK_CODE_ALTERNATIVE_CLASSIFICATION` warnings (papers 22, 31, 51), which were treated as non-blocking.

The same page shows the pipeline handled Question 1's genuine alternative block correctly, so the capability exists - the asterisk case specifically defeats it.

## Finding 2 (critical) - mark totals do not reconcile on four of six papers

Summing the marks implied by non-alternative mark-scheme rows and comparing against the printed part marks:

| Paper | Question / part | Printed marks | Staged mark rows | Gap |
| --- | --- | ---: | ---: | ---: |
| 22 | Q2 (unparted) | 4 | 3 | −1 |
| 22 | Q5(a) | 3 | 4 | +1 |
| 31 | Q9(a) | 2 | 1 | −1 |
| 31 | Q9(b) | 2 | 1 | −1 |
| 31 | Q9(d) | 3 | 1 | −2 |
| 51 | Q3(a) | 4 | 3 | −1 |
| 51 | Q6(b) | 3 | 4 | +1 |
| 51 | Q7(c) | 5 | 7 | +2 |

Papers 11 and 42 reconcile cleanly.

**Correction (verified 7 August 2026):** an earlier version of this table also listed 62 Q7(b) as a
reconciliation failure. It is not one, and the reason matters. That fabricated `B1` was *also*
wrongly flagged `is_alternative_method = true`, so a reconciliation check excludes it and the part
balances at 3 = 3. The Paper 62 defect is real - it was found by line-by-line source comparison -
but it is invisible to this check. A fabricated mark code that is simultaneously mis-flagged as an
alternative evades detection entirely, which is a further argument for fixing the
alternative-method classification upstream rather than relying on downstream reconciliation.

Two distinct causes are visible in the staged data:

- **Under-count** (negative gaps) - continuation rows wrongly flagged `is_alternative_method = true`, removing them from the primary count. Paper 31 Q9 is the worst instance: the second row of parts (a), (b) and (d) is flagged as an alternative in each case, so a 2+2+3 mark block collapses to 1+1+1.
- **Over-count** (positive gaps) - non-mark table content parsed as mark rows. Paper 51 Q7(c) is a scenario-enumeration table whose body rows became seven mark rows against a printed five. Paper 62 Q7(b) fabricated a `B1` on a blank-marks special-case row.

**This check is cheap, deterministic and needs no model.** It found nine defects across four papers that deterministic validation passed. Adding it to the validator before batch 3 is the single highest-value change identified by this review.

## Finding 3 (critical, verified) - Paper 11 Q11 is missing its required diagram

The printed Question 11 (question paper page 16) carries a graph of `y = f(x)`, and the stem states "The graph of y = f(x) is shown in the diagram." The staged question has **zero assets**.

The staged metadata for that same question sets `diagram_required = true`. So the bundle contradicts itself, and the contradiction is machine-detectable: *any question with `diagram_required = true` and an empty asset list is a defect.* This is the only such case in batch 2, and a second cheap validator rule would catch it.

Paper 11's other four diagram questions (Q2, Q6, Q7, Q9) all have their asset correctly attached, so the asset pipeline works in general.

## Finding 4 (substantive, verified) - Paper 11 structural fabrications

- **Q10 - fabricated part label.** The printed Question 10 is unparted: a single 8-mark instruction with no (a). The staged bundle creates one part with `label_path = ["a"]`. Compare Question 9, which is also unparted and was staged correctly with no parts. This would surface a non-existent "(a)" to students and inflates the paper's part count from 21 to 22.
- **Q5 - fabricated stem.** The printed Question 5 has no stem; it opens directly at "(a) Prove the identity…". The staged bundle copies part (a)'s prompt verbatim into `stem_markdown`, so the identity is stored twice.

## Finding 5 (substantive) - `main_topic` taxonomy is inconsistent within batch 2 and against batch 1

| Paper | Component | Distinct `main_topic` values |
| --- | --- | --- |
| 11 | Pure 1 | Algebra, Calculus, Geometry, Trigonometry |
| 22 | Pure 2 | Algebra, Calculus, Trigonometry |
| 31 | Pure 3 | Algebra, Calculus, Complex Numbers, Numerical Methods, Trigonometry, Vectors |
| 42 | Mechanics | Mechanics |
| 51 | Statistics 1 | **Algebra, Probability, Statistics** |
| 62 | Statistics 2 | **Probability, Statistics** |

Two problems:

1. **Mixed levels of abstraction**, as already recorded for batch 1: Paper 42 uses the paper-family name for all seven questions, while the Pure papers use content topics. Paper 31 alone produces six distinct values.
2. **New cross-batch inconsistency.** In batch 1, every published component 5 and 6 question used `Statistics`. In batch 2 the same components produce `Probability`, `Statistics` and - on Paper 51 - `Algebra`. Publishing as staged would leave the corpus with the same component classified differently depending on which batch ingested it, so any future topic filter behaves differently across batches.

`Algebra` on a Statistics 1 paper is almost certainly wrong and should be source-checked directly.

This is the direct consequence of the known gap: `main_topic` is unconstrained free text. It will not resolve itself with more review effort; it needs the controlled vocabulary the operating guide already calls for.

## Finding 6 (low) - `calculator_required` unresolved on 48 of 50 questions

Null on every question of papers 11, 31, 42, 51 and 62, and on 5 of 7 for Paper 22. Same pattern batch 1 resolved across 11 rows post-publication.

## Finding 7 (low) - inconsistent handling of blank-marks special-case rows

Paper 51 Q3 sequence 7 correctly stores a special-case row with an **empty** `mark_code`, matching the printed blank Marks cell. Paper 62 Q7(b) **fabricated** a `B1` for the equivalent construct. The same source pattern is handled two different ways in the same batch. Whichever convention is chosen, it needs to be applied consistently - and an empty string in `mark_code` should be a deliberate, validated value rather than an accident.

## Confidence signal - third independent confirmation that it is not calibrated

Batch 2 carries seven `LOW_METADATA_CONFIDENCE` warnings. They do not align with where the defects are:

- Paper 11 has two low-confidence rows, but its three verified defects are on Q5, Q10 and Q11 - and Q11's metadata confidence is not low.
- Paper 42 has one low-confidence row and is one of only two papers that reconcile cleanly.
- Paper 62's critical mathematical errors sit in its 0.93 and 0.86 rows.

Continue source-reviewing every metadata row through batch 4. Confidence remains queue-ordering only.

## Recommended actions

1. **Do not publish any batch-2 paper as staged.**
2. Add two deterministic validator rules before batch 3, both cheap and model-free:
   - per-part mark reconciliation (Finding 2);
   - `diagram_required = true` with an empty asset list (Finding 3).
3. Fix the `*`-dependency versus alternative-method classification in the extraction/validation logic (Finding 1). This is a systematic pipeline defect, not a per-paper data error, and will recur on every future batch until fixed.
4. Complete line-by-line source review of papers 22, 31, 42 and 51, and of Paper 11 questions 7-11. The deterministic checks above narrow where to look but do not substitute for reading the mathematics - Paper 62's factorial and operator corruptions were invisible to every automated check.
5. Decide the `main_topic` vocabulary before publishing batch 2, not after. Publishing first creates cross-batch backfill debt that grows with every batch.
6. Then correct the staged bundles via versioned `database/` SQL with paired read-only verification, re-run validation, and publish one paper at a time.

## Implication for the batch-3 go/no-go

Batch 1's conclusion was that final published quality was trustworthy but raw pipeline autonomy was not. Batch 2 sharpens that: the pipeline produced six papers that all passed deterministic validation and all declared themselves ready for approval, while four carry mark-integrity defects, one drops a required diagram, and one fabricates both a stem and a part label.

The gap is not the model's raw accuracy so much as the **thinness of the deterministic layer**. Two rules that could have been written in an afternoon would have caught nine of the defects here automatically. Prioritising those over further paid ingestion is the better use of the next work cycle.
