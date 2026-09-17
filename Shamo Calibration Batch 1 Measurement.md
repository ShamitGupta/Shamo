# Shamo calibration batch 1 measurement

> Measurement date: 5 August 2026  
> Scope: 9709 variants 12, 21, 32, 41, 52, and 61 only. The February-March 2025 variant-12 pilot is excluded unless a figure is explicitly described as global.  
> Status: preliminary batch decision. Database and workflow evidence is live/read-only verified; semantic labels are a broad-pool baseline, while same-component semantic sign-off is deferred until enough cross-paper same-component content exists.

## Decision summary

Calibration measurement is the correct next stage, and the first measurement pass is complete.

The reviewed final database passes its batch-1 quality gate: all six papers are published and embedded, the exact content and vector counts pass, all recorded issues are resolved, and no search candidates remain pending. Cost and capacity are comfortably within the approved limits.

The raw pipeline does **not** yet justify unattended scale. Every paper triggered the workflow's automated OpenAI targeted-repair branch, every paper needed a recorded warning or correction, two papers needed recovery of source marks omitted by extraction, and 10 of 22 formerly pending higher-confidence metadata rows required substantive correction. The preliminary broad-pool semantic benchmark found only 40% useful results in the top five, but same-component semantic sign-off is now deferred because the current corpus is too sparse for Papers 2-6.

The recommendation is therefore:

- **Pass** final published-content integrity.
- **Pass** atomic publication and search-index integrity.
- **Pass** known OpenAI cost and database capacity.
- **Conditional go** for a guarded calibration batch 2 after the minimum controls below are in place.
- **No-go** for unattended corpus-scale ingestion or a student-facing similar-question feature.

## Final batch footprint

| Variant | Questions | Stored parts | Marks | Mark rows | Assets | Metadata approved | Search rows |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 12 | 11 | 17 | 75 | 73 | 3 | 11/11 | 26 |
| 21 | 7 | 12 | 50 | 66 | 1 | 7/7 | 17 |
| 32 | 10 | 20 | 75 | 99 | 1 | 10/10 | 27 |
| 41 | 8 | 9 | 50 | 53 | 4 | 8/8 | 17 |
| 52 | 6 | 17 | 50 | 71 | 1 | 6/6 | 23 |
| 61 | 7 | 18 | 50 | 51 | 1 | 7/7 | 25 |
| **Total** | **49** | **93** | **350** | **413** | **11** | **49/49** | **135** |

The batch also contains 12 source-document records covering 190 PDF pages and 104,730 bytes of extracted instructional assets. The global index, including the separate pilot, contains 164 valid search rows. Current database usage is approximately 199.35 MB.

All six ingestion runs are `complete/approved`. The 11 rows below 0.75 model confidence were source-reviewed on 4 August 2026: six were approved without a substantive topic/method/diagram correction and five were corrected. The remaining 22 rows at or above 0.75 were source-reviewed on 5 August 2026: 12 were approved without substantive correction and 10 were corrected. All 49 batch metadata rows are now explicitly approved, with original confidence scores preserved as pipeline evidence. The live metadata store function still writes newly published rows as `pending` even when the surrounding ingestion run is approved, so future batches require a deliberate row-level close-out and run approval must not be reported as metadata-row approval.

## Cost and elapsed time

| Measure | Result |
| --- | ---: |
| Successful v2 OpenAI extraction | $0.735881 |
| Earlier v1 diagnostic extraction | $0.094161 |
| Batch-1 embedding executions | $0.00022644 |
| Known charged provider total | $0.83026844 |
| Targeted-repair share of successful v2 extraction cost | $0.308360 / 41.90% |
| Successful v2 staging time | 6,192.7 seconds / 103.21 minutes |
| Mean staging time per paper | 17.20 minutes |
| Median staging time per paper | 16.91 minutes |
| Observed database growth from first batch admission | approximately 2.65 MB |

The successful v2 runs used 339,983 input tokens, including 250,368 cached input tokens, and 203,479 output tokens. Mistral OCR is currently free per operator clarification on 6 August 2026, so it should be reported as free/zero rather than as an unknown cost. Human reviewer minutes were not recorded, which still prevents a complete reviewer-effort figure.

## Repair, warning, and correction burden

In this report, **targeted repair** means the automated n8n path shown as **Repair Needed** -> **Prepare Repair Reservation** -> **OpenAI Targeted Repair** -> **Parse Targeted Repair**, followed by validation of the repaired bundle. It is a paid model call, not a human manually editing the paper. Each of the six live ingestion runs has exactly one finalized `targeted_question_repair` cost event.

Human source review and later source-checked SQL corrections happened separately. Those manual activities should be measured independently rather than inferred from the automated targeted-repair count.

- Automated targeted repair: 6/6 papers (100%).
- Papers with a recorded issue, normalization, or correction: 6/6 (100%).
- Distinct flagged questions: 36/49 (73.5%).
- Recorded issue rows: 58; 58 resolved and 0 unresolved.
- Blocking issues: 2, both resolved.
- Source-omission recoveries: 2 papers (33.3%): variant 21 Question 5(c) and variant 32 Question 9(d).
- Post-publication metadata corrections: 18 questions. The initial three were variant 12 Questions 1 and 7 and variant 41 Question 7; the low-confidence review corrected five more; the higher-confidence review corrected another 10.
- Low-metadata-confidence warnings: 13 questions across all six papers.

The largest recorded issue groups were 18 post-publication metadata corrections, 13 low-metadata-confidence warnings, 9 low mark-code-coverage warnings, 4 mark-scheme format normalizations, and 3 duplicated Answer/Guidance corrections. These figures describe the work needed to reach the clean final database; they are not unresolved defects in the published output.

## Low-confidence metadata source review

The 11 pending rows below 0.75 confidence were checked field by field by Codex at the operator's request against the official question papers, with the official mark schemes used to resolve method and diagram ambiguity. This is recorded as a Codex source review, not an independent human-expert review. Six rows were accurate as extracted. Five needed correction:

- variant 12 Question 4: replaced the incorrect `tan(theta)=5/4` method with the official branches `tan(theta)=0` and `tan^2(theta)=2/5`;
- variant 21 Question 7: changed the broad topic from Algebra to Calculus because the principal six-mark task is integration;
- variant 32 Question 5: changed the broad topic from Calculus to Numerical Methods;
- variant 32 Question 9: set `diagram_required=false`, matching the mark scheme's explicit statement that the diagram is not required;
- variant 41 Question 4: replaced kinematics-method wording with the explicitly required whole-system work-energy balance.

Nullable calculator flags were resolved for all 11 rows. Live verification passed all 11 expected values, confirmed 27 approved and 22 pending metadata rows with zero pending low-confidence rows, confirmed all five new correction issues resolved, and re-confirmed 164/164 valid 512-dimensional vectors with zero pending search candidates. No re-embedding was needed because these changes affect classification and filtering metadata rather than the embedded question text. The full decision table and source-page trail are in `Shamo Batch 1 Low-Confidence Metadata Review.md`.

## Higher-confidence metadata source review

The 22 remaining rows at or above 0.75 confidence were reviewed against their official question papers and mark schemes. Review began with the risk-prioritized rows and a conservative clean sample. Because that sample contained substantive errors above the pre-agreed 5% expansion threshold, the pass was expanded to all 22 rows. Twelve were approved without substantive topic/method/diagram correction and 10 were corrected, a 45.5% correction rate.

The corrections covered wrong broad topics, inaccurate or invented methods, and diagram flags that treated illustrative or candidate-drawn graphs as source-required diagrams. Live verification passed 22/22 decisions, confirmed 49/49 approved and zero pending metadata rows, confirmed all 10 new audit issues resolved, and re-confirmed 164/164 valid search vectors with zero pending candidates. No re-embedding was needed because embedded question text did not change. The full field-level decisions and source-page trail are in `Shamo Batch 1 Higher-Confidence Metadata Review.md`.

This result invalidates confidence-only sampling for the remaining calibration. Source-review every metadata row in batches 2-4, then reconsider risk-plus-sampling only after deterministic domain/taxonomy controls and at least three consecutive measured batches meet zero-critical-error and below-2%-correction targets.

## Operational reliability

The v2 controller ultimately staged all six papers. One active paper attempt failed because of a provider-host configuration problem; the idempotency and processing-state guards prevented duplicate paid work on retry. Variant 21 records two attempts.

All six one-paper publication transactions ultimately succeeded. There was one failed publication RPC among seven real transaction attempts; an additional earlier execution failed at placeholder configuration before a publication call. Atomicity prevented partial paper publication.

Both batch-1 embedding executions succeeded. Search verification found 135/135 batch rows, non-null 512-dimensional non-zero vectors, zero duplicate search identities, and zero pending candidates.

## Preliminary semantic-retrieval benchmark

The benchmark uses 18 whole-question seeds: nine Pure Mathematics, three Mechanics, and six Statistics. For every seed it retrieves five deduplicated main-question matches from the current stored vectors, excluding the seed itself.

Graded relevance rubric:

- 3: same core method or concept; strong practice substitute.
- 2: closely related topic; meaningful adjacent practice.
- 1: same broad domain only or weak adjacency.
- 0: unrelated.

A result is counted as useful at grade 2 or 3.

| Measure | Preliminary result |
| --- | ---: |
| Judged results | 90 |
| Precision@5, useful grade >= 2 | 36/90 = **0.400** |
| Mean relevance grade | **1.322 / 3** |
| Exact/core-method grade-3 rate | 12/90 = **0.133** |
| Graded utility versus an all-grade-3 top five | **0.342** |
| Domain leakage | 6/90 = **0.067** |
| Duplicate main questions | **0** |

Precision@5 by domain was 0.333 for Pure Mathematics, 0.533 for Mechanics, and 0.433 for Statistics. Domain leakage was 2.2%, 6.7%, and 13.3%, respectively.

This is an end-to-end retrieval baseline, not the intrinsic accuracy of `text-embedding-3-small`. The current six-paper corpus has genuine topic gaps, and the stored embedding text contains the raw question stem or part prompt rather than controlled component/domain/topic metadata. The current call also filters by qualification and syllabus, not by paper component, domain, or topic.

Corpus scarcity explains some weak results, especially because only Paper 1 currently has more than one published paper; Paper 2 through Paper 6 each have one published paper. It does not explain all weaknesses: two known peers were ranked too low to enter the top five, with the other partial-fractions question appearing at rank 29 and a second hypothesis-testing question appearing at rank 10. The current search therefore needs component/domain/topic controls, a minimum-similarity or "no strong match" outcome, and likely enriched embedding text or reranking.

Standard nDCG@5 is deliberately not claimed yet. Computing it defensibly requires human relevance judgments over a broader candidate pool, not only the five items returned by the system being evaluated. The 0.342 graded-utility figure instead compares the observed ranked grades with an explicit all-perfect top-five ceiling.

The component-filtered review now uses Paper 1 with Paper 1, Paper 2 with Paper 2, and so on. With batch 1 alone, only Paper 1 has a cross-paper same-component pool; Papers 2-6 can only return same-paper neighbours. Therefore the current same-component review is a deterministic smoke test for filtering, seed exclusion, pool-size reporting, result shape, and no-result behavior, not a human semantic-relevance sign-off gate before batch 2. Human semantic scoring should resume once each paper component has enough cross-paper candidates, beginning after batch 2 if it adds one more paper per component.

## Measurement gaps

- Mistral OCR is free and should be explicitly recorded as free/zero in future batch reports.
- Embedding cost is reported by n8n but not stored in `shamo_api_cost_events`.
- Human review time per paper was not recorded.
- Human/expert same-component semantic sign-off is deferred until enough cross-paper same-component candidates exist. Keep the current review as a deterministic smoke-test baseline only.
- Database growth is reconstructed from execution snapshots rather than a dedicated time-series measurement.

## Minimum gate before calibration batch 2

1. Separate deterministic paper component/type and paper domain from a controlled question-topic taxonomy, and use the component as the default retrieval boundary. The live `shamo_v2_1_similarity_component_guard_patch.sql` patch implements and verifies the first same-component retrieval guard.
2. Keep the minimum no-result policy for sparse same-component pools; rerun deterministic same-component checks after each embedding batch and defer human semantic scoring until the corpus has enough cross-paper candidates.
3. Require source review and a recorded disposition for every metadata row in calibration batches 2-4; capture correction reason and reviewer minutes.
4. Record Mistral OCR as free/zero, and record embedding cost plus reviewer minutes in the next batch.
5. Import and confirm the hardened v2.1 staging workflow, then retain sequential, atomic, stop-on-failure publication.

After those controls are present, batch 2 should proceed as another guarded six-paper calibration run. It should not be treated as authorization for unattended ingestion.

## Reproducibility files

- `database/shamo_v2_1_batch1_calibration_measurement.sql`: live batch counts, successful v2 cost/time, issue mix, and measurement gaps.
- `database/shamo_v2_1_batch1_semantic_benchmark.sql`: the 18-seed top-five candidate set.
- `database/shamo_v2_1_batch1_semantic_benchmark_labels.csv`: provisional graded labels and per-seed notes for human review.
- `database/shamo_v2_1_batch1_semantic_review_sheet.sql`: read-only reviewer sheet showing each seed question, its five returned matches, provisional grade, similarity, topic metadata, and assembled full question text.
- `database/shamo_v2_1_batch1_component_similarity_review.sql`: read-only same-component reviewer sheet that uses Paper 1 with Paper 1, Paper 2 with Paper 2, and so on, while reporting whether enough cross-paper same-component content exists for a meaningful benchmark.
- `database/shamo_v2_1_similarity_component_guard_patch.sql`: service-role-only guarded retrieval patch enforcing same-component matching and sparse-corpus no-result policy.
- `database/shamo_v2_1_batch1_complete_search_verification.sql`: final vector, deduplication, and pending-state assertions.
- `Shamo Batch 1 Low-Confidence Metadata Review.md`: source-review method and all 11 row decisions.
- `database/shamo_v2_1_batch1_low_confidence_metadata_review.sql`: guarded review-state updates and five source-grounded corrections.
- `database/shamo_v2_1_batch1_low_confidence_metadata_verification.sql`: row-level, aggregate approval, correction-issue and embedding-integrity checks.
- `Shamo Batch 1 Higher-Confidence Metadata Review.md`: source-review method and all 22 higher-confidence row decisions.
- `database/shamo_v2_1_batch1_higher_confidence_metadata_review.sql`: guarded review-state updates and 10 source-grounded corrections.
- `database/shamo_v2_1_batch1_higher_confidence_metadata_verification.sql`: row-level, aggregate approval, correction-issue and embedding-integrity checks.
