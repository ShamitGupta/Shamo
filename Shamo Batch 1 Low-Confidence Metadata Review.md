# Shamo batch 1 low-confidence metadata review

> Review date: 4 August 2026  
> Scope: the 11 published batch-1 metadata rows with model classification confidence below 0.75 whose row-level review state was still `pending`.

## Review method

Each row was checked against the official question-paper page first. Every metadata field was then compared with what the candidate must actually do: broad topic, subtopics, skills, methods, question style, difficulty, calculator need, and whether a source-provided diagram must be interpreted. The official mark scheme was checked wherever the method, accepted reasoning, numerical requirement, or diagram role was ambiguous.

This was a Codex source review performed at the operator's request, not an independent human-expert review. The live reviewer notes state that provenance explicitly.

The workflow definition was also used as a consistency rule: `diagram_required` is true only for a source-provided diagram, graph or table that must be interpreted. A request to draw a graph does not make it true. The original model confidence score is retained after review so that the pipeline's raw confidence remains measurable.

## Decisions

| Paper | Question | Confidence | Decision | Source-grounded result |
| --- | ---: | ---: | --- | --- |
| 9709/12 F/M 2024 | 4 | 0.74 | Correct | Retain Trigonometry. Replace the incorrect `tan(theta)=5/4` method with the official branches `tan(theta)=0` and `tan^2(theta)=2/5`; calculator required. |
| 9709/12 F/M 2024 | 8 | 0.71 | Approve | Algebra, arithmetic progression and geometric series metadata is accurate; calculator not required. |
| 9709/12 F/M 2024 | 9 | 0.72 | Approve | Algebra/functions, composition, range and inverse-function metadata is accurate; calculator not required. |
| 9709/21 M/J 2024 | 1 | 0.74 | Approve | Calculus/stationary-point metadata is accurate; numerical answer to 3 significant figures requires a calculator. |
| 9709/21 M/J 2024 | 3 | 0.70 | Approve | Algebra/absolute-value graph and inequality metadata is accurate. `diagram_required=false` is correct because the candidate draws the graph; calculator required for the exponential comparison. |
| 9709/21 M/J 2024 | 4 | 0.72 | Approve | Trigonometric identity and equation metadata is accurate; calculator required for the numerical angles. |
| 9709/21 M/J 2024 | 7 | 0.69 | Correct | Change the broad topic from Algebra to Calculus because the principal six-mark task is integration; retain the polynomial and partial-fraction detail; calculator not required. |
| 9709/32 M/J 2024 | 5 | 0.70 | Correct | Change the broad topic from Calculus to Numerical Methods: the question is root bracketing and fixed-point iteration; calculator required. |
| 9709/32 M/J 2024 | 9 | 0.71 | Correct | Retain Complex Numbers but set `diagram_required=false`; the official mark scheme explicitly says the diagram is not required; calculator not required. |
| 9709/41 O/N 2025 | 3 | 0.66 | Approve | Mechanics/resultant-force metadata and required source-diagram flag are accurate; calculator required. |
| 9709/41 O/N 2025 | 4 | 0.74 | Correct | Retain Mechanics and the source-diagram flag. Replace the kinematics-method wording with the explicitly required whole-system energy balance; calculator not required. |

## Result

- Six metadata rows are approved without a substantive topic/method/diagram correction.
- Five rows receive a source-grounded metadata correction.
- Nullable calculator flags are resolved for the reviewed rows.
- All eleven original model confidence scores are preserved.
- After application, explicit row-level approval should rise from 16/49 to 27/49, leaving 22 pending rows and zero pending rows below 0.75 confidence.
- Search text and the existing 512-dimensional embeddings are unchanged; no re-embedding is required because these corrections affect classification/filter metadata rather than the embedded question text.

## Reproducibility

- `database/shamo_v2_1_batch1_low_confidence_metadata_review.sql` performs guarded updates and records five resolved correction issues.
- `database/shamo_v2_1_batch1_low_confidence_metadata_verification.sql` verifies every reviewed value, aggregate approval state, correction issues, and unchanged embedding integrity.
- Official PDFs and rendered review pages are retained under `tmp/pdfs/batch1_metadata_review/` for the local audit trail.
