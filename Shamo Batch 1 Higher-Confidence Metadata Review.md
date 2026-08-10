# Shamo batch 1 higher-confidence metadata review

> Review date: 5 August 2026  
> Scope: the 22 published batch-1 metadata rows with model classification confidence at or above 0.75 whose row-level review state was still `pending`.

## Review method

The review began with the agreed exception-and-sampling policy. Rows involving a source diagram/asset or a previously corrected issue path were risk-routed. Variants 12 and 41 were selected as a conservative clean-paper sample covering Pure Mathematics and Mechanics. The clean portion of that sample produced substantive corrections above the 5% expansion threshold, including an incorrect main topic and an incorrect collision method. The review therefore expanded to all 22 rows.

Every row was compared with its official question-paper page. The official mark scheme was used to check the assessed method and calculator need. The workflow's own diagram rule was applied: `diagram_required` is true only when a source-provided diagram, graph or table must be interpreted to answer the question; a graph that the candidate must draw or a merely illustrative source graph is false.

This was a Codex source review performed at the operator's request, not independent human-expert sign-off. The original model confidence values are retained as raw-pipeline evidence.

## Decisions

| Paper | Question | Confidence | Decision | Source-grounded result |
| --- | ---: | ---: | --- | --- |
| 9709/12 F/M 2024 | 2 | 0.80 | Approve | Trigonometric graph transformations are accurate; the source graph identifies the particular minimum point, so the diagram is required; calculator not required. |
| 9709/12 F/M 2024 | 3 | 0.78 | Correct | Retain Calculus but remove the inaccurate Differentiation subtopic; the assessed method is integration of a given derivative followed by use of a known point; calculator not required. |
| 9709/12 F/M 2024 | 5 | 0.86 | Correct | Change the main topic from Coordinate Geometry to Calculus because differentiation and the normal gradient form the principal method; retain coordinate geometry as a subtopic; calculator not required. |
| 9709/12 F/M 2024 | 6 | 0.82 | Approve | Algebra/binomial coefficient extraction is accurate; calculator not required. |
| 9709/12 F/M 2024 | 10 | 0.76 | Approve | Coordinate geometry, circle and segment methods are accurate; the shaded source diagram is required and numerical angle/segment answers require a calculator. |
| 9709/12 F/M 2024 | 11 | 0.77 | Correct | Retain Calculus but set `diagram_required=false`; the equation and text define the turning point, intercepts and region, so the graph is illustrative rather than required; calculator not required. |
| 9709/21 M/J 2024 | 2 | 0.78 | Approve | Implicit differentiation metadata is accurate; calculator not required. |
| 9709/21 M/J 2024 | 5 | 0.77 | Approve | Calculus with fixed-point iteration is accurate; numerical bracketing and iteration require a calculator. |
| 9709/21 M/J 2024 | 6 | 0.76 | Correct | Retain Calculus but set `diagram_required=false`; the curve equation and explicit bounds fully define both tasks. Trapezium-rule evaluation requires a calculator. |
| 9709/32 M/J 2024 | 1 | 0.78 | Correct | Retain Functions but set `diagram_required=false`; the candidate is asked to draw the graph and no source diagram is supplied; calculator not required. |
| 9709/32 M/J 2024 | 2 | 0.80 | Correct | Retain Algebra but replace the factor-numerator wording with polynomial division/constant-term handling, denominator factorisation and coefficient solving; calculator not required. |
| 9709/32 M/J 2024 | 3 | 0.82 | Approve | Exponential/logarithmic linearisation metadata is accurate; calculator not required. |
| 9709/32 M/J 2024 | 4 | 0.76 | Correct | Retain Calculus, remove the inaccurate parametric label, and add the required first step `e^x=2` before implicit differentiation and substitution; calculator not required. |
| 9709/32 M/J 2024 | 6 | 0.79 | Correct | Retain Calculus but set `diagram_required=false`; the equation and statement that `M` is the maximum fully define the exact differentiation and integration tasks; calculator not required. |
| 9709/32 M/J 2024 | 7 | 0.83 | Approve | Trigonometric identity and exact-integration metadata is accurate; calculator not required. |
| 9709/32 M/J 2024 | 8 | 0.80 | Approve | Three-dimensional vector-line, intersection and distance metadata is accurate; calculator not required. |
| 9709/32 M/J 2024 | 10 | 0.77 | Approve | Calculus, separation of variables and initial-condition methods are accurate; the required 3-significant-figure result needs a calculator. |
| 9709/41 O/N 2025 | 1 | 0.78 | Approve | Mechanics/Newton's second law and `P=Fv` metadata is accurate; calculator not required. |
| 9709/41 O/N 2025 | 2 | 0.80 | Approve | Conservation of linear momentum and kinetic-energy-loss metadata is accurate; calculator not required. |
| 9709/41 O/N 2025 | 5 | 0.80 | Approve | Limiting friction and equilibrium metadata is accurate; the force configuration must be read from the source diagram and the numerical angle requires a calculator. |
| 9709/41 O/N 2025 | 6 | 0.78 | Correct | Replace the invented coefficient-of-restitution/energy wording with the official sequence: incline kinematics, conservation of linear momentum with signed velocities, then constant-acceleration stopping distance; calculator not required. |
| 9709/41 O/N 2025 | 8 | 0.76 | Correct | Retain Mechanics and the source diagram, but replace the inaccurate force description with the official horizontal equation for `B`, vertical equilibrium for `A`, horizontal Newton's-second-law equation for `A`, and `mu=F/R`; calculator required. |

## Result

- Twelve rows are approved without a substantive topic, method or diagram correction; nullable calculator flags are resolved.
- Ten rows receive a source-grounded topic, subtopic, method or diagram correction.
- The substantive correction rate is 10/22, or 45.5%, despite every row having model confidence at or above 0.75.
- All 22 rows are individually source-reviewed; none is approved merely by inference from the sample.
- After application, batch-1 row-level metadata approval should be 49/49 with zero pending rows.
- Search text and the existing 512-dimensional embeddings are unchanged, so no re-embedding is required.

The result shows that the current confidence score is not calibrated well enough to approve higher-confidence output automatically. Before batch 2, use deterministic paper domain, a controlled topic vocabulary, explicit diagram rules and method-risk checks in addition to confidence-based routing.

## Reproducibility

- `database/shamo_v2_1_batch1_higher_confidence_metadata_review.sql` performs guarded corrections, records all 22 source-review decisions and appends ten resolved correction issues.
- `database/shamo_v2_1_batch1_higher_confidence_metadata_verification.sql` verifies every row, the 49/49 aggregate state, correction audit trail and unchanged embedding integrity.
- Official PDFs and rendered source-review pages are retained under `tmp/pdfs/batch1_metadata_review/`.
