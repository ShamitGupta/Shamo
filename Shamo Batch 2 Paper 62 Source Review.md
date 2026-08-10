# Shamo Batch 2 - Paper 62 Source Review

> Paper: Cambridge A Level 9709/62, May/June 2024 (Probability & Statistics 2)
> Ingestion run: `e1892962-dbe3-4dfe-9ab8-f3cad91d1e38`
> Run state at review: `awaiting_review` / `pending`, `validation_report.passed = true`, `ready_for_approval = true`
> Review date: 7 August 2026
> Review method: **agent-assisted source review** (Codex/Claude). Staged bundle compared field by field against the official question paper and mark scheme.
> Sources: `9709_s24_qp_62.pdf` (12 pp) and `9709_s24_ms_62.pdf` (11 pp), both from the URLs recorded in the run's own `paper_bundle.documents`.

**This review does not constitute publication approval.** Per the operating guide, agent-assisted source review is recorded distinctly and does not replace the operator's final per-paper approval.

## Verdict

**Do not publish as staged.** Deterministic validation passed and the run is marked `ready_for_approval`, but direct comparison with the official PDFs found **three critical defects** and four further substantive defects. Two of the critical defects are silent mathematical corruptions that no current automated check would catch.

## What passed

| Check | Result |
| --- | --- |
| Question count / numbering | 7 questions, numbered 1-7, none missing or merged |
| Part structure | 15 parts; every `label_path` matches the printed (a)/(b)/(c) |
| Part marks | All 15 match the printed bracketed marks exactly |
| Paper mark total | Staged part marks sum to 50; printed paper total is 50 |
| Assets | 0 staged, and the paper genuinely contains no diagrams - the zero is legitimate |
| Source page numbers | All question-paper and mark-scheme page references correct |
| Mark-code vocabulary | `B2`, `A1 FT`, `B1 FT`, `DM1` all correctly recognised |
| Questions fully clean | **Q1, Q3, Q4** - no corrections required |

## Critical defects

### C1 - Question 2: entire intermediate stem block missing

The official paper (page 3) prints this between part (a) and part (b):

> There were 30 students in Henri's sample. He asked each of them how much time, *X* hours, they spent on social media each week, on average. He summarised the results as follows.
>
> *n* = 30    Σ*x* = 610    Σ*x*² = 12405

**None of this exists in the staged bundle.** The stem stops after "Henri's first two student numbers are 567 and 109."

Consequences:
- Part (b) reads "Use this information to calculate an unbiased estimate of the mean of *X*..." with no antecedent for "this information".
- Parts (b) and (c) are unanswerable as stored. The three numbers a student needs are gone.
- The staged mark scheme for 2(b) references `610/30` and `12405` - so the published data would contain a mark scheme quoting figures that appear nowhere in the question.

This is **not** a formatting convention difference. The same workflow correctly folded analogous intermediate paragraphs into the following part's prompt for Q6(b) and Q2(c). Q2's block was simply dropped.

This is the same class of failure as the two source-omission recoveries recorded in batch 1.

### C2 - Question 5(a): factorials extracted as squares

| | Expression |
| --- | --- |
| Printed | e^(-3.1)(1 + 3.1 + 3.1²/**2!** + 3.1³/**3!**) |
| Staged | `e^{-3.1}(1 + 3.1 + \frac{3.1^2}{2^2} + \frac{3.1^3}{3^2})` |

`2!` became `2^2` and `3!` became `3^2`. These are numerically different (2 vs 4, 6 vs 9). A tutor teaching from this row would present a wrong Poisson expansion.

Note the same workflow got the factorials right in 5(b) (`2!`, `3!`, `4!`) and 5(c) (`3!`, `2!`, `5!`), so this is an isolated corruption, not a systematic convention.

### C3 - Question 6(a): standardising denominator operator wrong

| | Expression |
| --- | --- |
| Printed | ±(508 − 510) / (10 **÷** √120) |
| Staged | `\pm \frac{508 - 510}{10 + \sqrt{120}}` |

Division became addition. `10 ÷ √120 ≈ 0.913` versus `10 + √120 ≈ 20.95` - the resulting z would be wrong by a factor of ~23.

Again isolated: the identical denominator is stored correctly as `10 \div \sqrt{120}` in sequences 6, 8 and in sequence 10's guidance.

## Substantive defects

### S1 - Question 7(b): fabricated mark code inflates the mark total

The printed mark scheme's final 7(b) row is a special-case note with a **blank Marks cell** and a blank Answer cell - it carries the SC instruction only.

The staged row (sequence 7) assigns `mark_code = "B1"`, with `is_alternative_method = true` and `is_final_answer = true`.

Consequences:
- 7(b) accumulates 4 marks of mark-scheme rows against a printed 3.
- The paper's mark-scheme rows now total **51 marks against a printed 50**.

This directly violates the documented rule that special-case marks must not inflate primary mark coverage. It also suggests a cheap deterministic check worth adding: *sum of mark-scheme row marks per part must equal the printed part marks.* That single rule would have caught this before review.

### S2 - Question 7(b): Guidance field contaminated with table structure

Staged sequence 5 `guidance_markdown` begins:

```
= 0.504 \text{ (3 sf)}$$ | $$= 0.504 \text{ (3 sf)}$$ | **A1** OR_{1}: 0.499 and 0.496. ...
```

The printed Guidance cell contains only the `OR₁ / OR₂ / OR₃` text. The leading fragment is bleed from the Answer cell and the Marks column of the split-cell table layout.

This violates the requirement to preserve Answer and Guidance as distinct source fields.

### S3 - Question 5(c): wrong exponent in guidance

| | Expression |
| --- | --- |
| Printed | (3.1³/3! × 2.4²/2!) ÷ (5.5**⁵**/5!) |
| Staged | `(\frac{3.1^3}{3!} \times \frac{2.4^2}{2!}) \div (\frac{5.5^4}{5!})` |

`5.5⁵` became `5.5⁴`. The correct value appears in sequence 7, so this is confined to the guidance text.

### S4 - Question 7 metadata: `main_topic` outside the de facto vocabulary

Q7 is classified `main_topic = "Probability"`. Every other question in this paper - and every published question in components 5 and 6 - uses `"Statistics"`.

This is the same defect class as the batch-1 Paper 41 Q7 correction (`main_topic` → `Mechanics`). It is a direct consequence of the known taxonomy gap: `main_topic` is an unconstrained free-text field, so the model can invent a sibling value.

Recommended correction: `"Statistics"`.

## Low-severity notation losses

Worth correcting if the fix is cheap; none of these change mathematical meaning.

| # | Question | Issue |
| --- | --- | --- |
| L1 | 7(c) seq 8 | Printed `M1*`; staged `M1`. The asterisk marks the mark that the following `DM1` depends on - the dependency link is lost |
| L2 | 6(b) seq 9 | Printed `Φ('2.421')`; staged `\Phi(\cdot 2.421')` - opening quote became `\cdot`, which renders as multiplication |
| L3 | 3 seq 3 | Printed `ɸ⁻¹('1.709') = 0.956 ; 1 − 2(1 − '0.956')`; staged drops both follow-through quote pairs |
| L4 | 5(c) seq 8 | Doubled prefix: staged `P(P(\text{exactly } 3 ...` |
| L5 | All 7 rows | `calculator_required` is `null` - same unresolved-flag pattern corrected across 11 rows in batch 1 |

## Confidence-score observation

Q2 carries `classification_confidence = 0.74`, the paper's single `LOW_METADATA_CONFIDENCE` warning, and Q2 does contain the worst defect (C1). That is one point in favour of the warning as a queue-ordering signal.

It is not evidence for confidence-based sampling. The other two critical defects sit in Q5 (`conf = 0.93`) and Q6 (`conf = 0.86`) - the two highest-confidence rows on the paper after Q1. This reproduces the batch-1 finding that high confidence does not predict correctness.

## Recommended next actions

1. Correct the staged bundle before publication - all three critical defects, S1-S4, and ideally L1-L5. Corrections belong in a versioned `database/` SQL file that asserts its exact targets and fails on mismatch, paired with a read-only verification file, following the batch-1 correction pattern.
2. Re-run deterministic validation after correction.
3. Only then publish this paper through the manual approval workflow, and check the returned counts - expect 7 questions, 15 parts, 0 assets, 7 metadata rows, 50 marks, and mark-scheme rows summing to 50 once S1 is fixed.
4. Consider adding the per-part mark reconciliation check (see S1) to the deterministic validator before batch 3. It is cheap and would have caught S1 automatically.
5. Record reviewer minutes for this paper as calibration evidence.

## Reviewer effort

Agent-assisted review of 7 questions, 15 parts, 50 mark-scheme rows and 7 metadata rows against 23 pages of source PDF. Defect rate: 3 of 7 questions carry a critical defect; 5 of 7 carry at least one substantive or low-severity defect; 2 of 7 (Q1, Q4) plus Q3 are fully clean.
