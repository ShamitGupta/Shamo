# Shamo — Funding Context and Decisions

> Created: 15 September 2026
> Purpose: the single record of Shamo's funding position, spend history, the
> grant currently being applied for, and the positioning decisions that shape how
> money is described externally.
> Companion documents: `PENDING.md` (what the money buys), `CLAUDE.md` /
> `AGENTS.md` (operating state), and the grant readiness review artifact
> (technical and commercial assessment, 15 Sep 2026).

**Never put API keys, card details, bank information, or signed agreements in
this file.** It records amounts, decisions and rationale only.

---

## 1. Current position

| | |
| --- | --- |
| External funding raised | **None** |
| Investors / equity issued | **None** |
| Revenue from Shamo (the product) | **None** — no billing exists |
| Funding to date | Self-funded by the founder |
| Related operating business | Shamo Classes, a live tuition business with a results guarantee — separate revenue, and the intended first cohort |

The product has never charged anyone. `shamo_user_entitlements` holds zero rows
and there is no payment integration in the codebase (see `PENDING.md` P2-7).

---

## 2. The grant being applied for

| | |
| --- | --- |
| Amount | **USD 10,000** |
| Type | Grant (non-dilutive) |
| Status | In preparation — pitch deck being written |
| Purpose | Close the gap between a working prototype and a sellable product |

**What the grant is explicitly not for:** building more corpus by machine. At
roughly 66 cents per paper, compute is a rounding error. The binding constraint
is expert human review and the product work in `PENDING.md`.

### Funding constraints — confirmed 15 September 2026

1. **Salary is disallowed.** The grant does not fund the founder's own time.
2. **The founder does the engineering**, and is **open to recruiting someone for
   technical implementation**. Contracted third-party engineering is therefore the
   route by which engineering work can legitimately be funded.
3. **No evidence exists for what a school pilot costs** in this market. Handled
   below by not carrying an unsupportable line item.

**Consequence, and it is the organising principle of the whole budget:** the grant
can only buy **capacity the founder cannot supply himself**. Every line in the
allocation must be a third-party cost — contracted people, services, compute or
advice — not founder effort recategorised.

### Still open

- **Grant-specific reporting requirements.** Some grants require milestone
  reporting, which should shape how the allocation is described and phased.
- **Where a contractor would be hired**, since that determines what the
  engineering line actually buys in weeks (see section 5).

---

## 3. Spend history

### Headline figure for external use

> **Approximately USD 70 in total API spend** produced the entire structured
> corpus: 106 published papers, 958 questions, 1,795 parts, 7,663 mark-scheme
> rows, 219 diagram assets and 2,596 embeddings.

That works out at roughly **66 cents per paper** and **7 cents per question**.

**Use $70 in all external material.** It is the founder's own accounting and the
conservative figure.

### Why the internal ledger disagrees

`shamo_api_cost_events` sums to about $9.20 across 474 finalized events. This is
**a known metering fault, not a cheaper truth**: a retried ingestion stage
re-calls and re-pays the provider, while `shamo_finalize_api_cost_event` treats
the repeat call as an idempotent replay and discards the second charge. Mistral
OCR spend is also absent from the ledger entirely.

Treat `shamo_ingestion_batches.actual_usd` as a **floor on real spend**. The fix
is tracked in `CLAUDE.md` under the operating plan; it is deliberately not a
blocker for the grant application.

### Approved budgets and caps to date

| Budget | Amount | Notes |
| --- | --- | --- |
| Overall mathematics-ingestion API budget | USD 70 | Founder-approved ceiling for all ingestion |
| IGCSE 0606 campaign cap | USD 15 | Ledger-recorded spend $3.56 across 4 batches |
| 9709 controller per-batch cap | USD 1 | Lowered from $3 as an interim guard pending ledger reconciliation |
| IGCSE controller per-batch cap | USD 3 | Raised live 19 Aug after retries pushed a batch past $1 |

---

## 4. Cost controls already built (an asset, not just housekeeping)

Worth naming in a grant application: spend discipline is engineered, not
intended.

- Every paid stage **reserves budget before the call and finalizes after it**,
  through `shamo_reserve_api_budget` / `shamo_finalize_api_cost_event`.
- Per-batch **and** campaign-wide ceilings are enforced at the database level, so
  a runaway workflow is rejected rather than trusted to behave.
- A database-size admission threshold (350 MB) halts ingestion before storage
  becomes a cost problem.
- Reservations are idempotent by key, so a retry cannot create duplicate ledger
  rows.

The gap in this system is the retry double-charge described above — the controls
prevent overspend at the *batch* level, but under-record it at the *event* level.

---

## 5. Draft use of funds

> Rebuilt 15 September 2026 after confirming salary is disallowed and the founder
> does the engineering. **Every line is now a third-party cost.** The compute line
> derives from measured cost per paper; the others are sized to be defensible, not
> quoted. Replace with real quotes where you can get them.

| Allocation | What it buys, specifically | Amount | Share | Maps to |
| --- | --- | ---: | ---: | --- |
| **Pilot delivery** | Tutoring inference and animation rendering for schools using Shamo **free of charge** during the pilot | $2,800 | 28% | — |
| Contracted engineering | A hired developer for the B2B layer — attempt history, conversation persistence, teacher dashboard | $2,400 | 24% | P0-2, P0-3, P1-6 |
| Contracted content review | Subject teachers verifying expanded corpus against source PDFs | $1,700 | 17% | P3-12, P3-14 |
| Infrastructure and services, 12 months | Supabase Pro, monitoring and error tracking, email, anything beyond what the founder covers directly | $1,200 | 12% | P2-8, P2-9 |
| Marketing and school outreach | Sales materials, demo video, a case study from the pilot, outreach tooling | $900 | 9% | — |
| Legal and licensing advice | A written position on past-paper use, before procurement asks | $600 | 6% | P3-16 |
| Corpus expansion — API compute | Further papers at measured cost | $400 | 4% | — |
| **Total** | | **$10,000** | **100%** | |

### Pilot delivery — the largest line, and the one to sanity-check

Schools get the pilot **free**, but every tutoring turn and every animation still
costs real money. Funding that is a legitimate and clearly-stated use of the
grant: it is the cost of generating the evidence the B2B sale depends on.

**Two cautions before this number goes in the application.**

**First, it may be smaller than it looks.** Ingestion — OCR plus extraction plus
metadata — costs roughly 7 cents per question, and a single tutoring turn is far
lighter than that: one model call on a mini-tier model with the question and mark
scheme as context. A pilot of three schools at sixty students, three turns a week
for a term, is on the order of ten thousand turns. If a turn costs cents, **the
API component plausibly lands in the low hundreds, not thousands.**

What could make it genuinely large is **animation rendering**, which is compute
rather than API: renders are synchronous, 35–60 seconds, and memory-heavy enough
that the deployment caps a container at 3 GB. Heavy Visualize use across a cohort
needs real hosting capacity.

**So: measure one tutoring session's cost before submitting.** If the true figure
is materially lower, move the difference into contracted review or marketing
rather than carrying a line you cannot defend. A committee that probes an inflated
line damages every other number in the budget.

**Second, do not run a free pilot without usage metering in place.** `PENDING.md`
P2-8 is listed under P2, but it is effectively a **prerequisite for the pilot**:
nothing currently caps what a single user can spend on the project's API key. An
uncapped free tier across several hundred students is how a grant disappears.

Stated correctly, this becomes a strength rather than a risk: **"pilot inference is
budgeted at $2,800 and enforced by per-user rate limits."** A capped cost is
fundable even when it is not yet precisely measured. An uncapped one is not.

### Marketing — sales enablement, not paid acquisition

For a B2B-led strategy this line is mostly **materials that make the sale
possible**, not advertising spend:

- A demo video (the mode distinction does not survive being described in text).
- A one-page leaflet for Heads of Department.
- A written case study built from the pilot — the single most valuable marketing
  asset available, and it costs almost nothing beyond the pilot itself.
- Outreach tooling: email, a light CRM to track school conversations.

Paid advertising rarely reaches school decision-makers; direct outreach and
referral do. A small D2C test through the existing tuition parent base is a
reasonable secondary use of this line, and cheaper than acquiring strangers.

### Why this split, and how to defend it

**The founder keeps the work that needs subject judgement; the grant buys the work
that does not.** Retrieval quality, prompt behaviour, mark-scheme fidelity and
anything touching the corpus stay with the founder — four years of teaching this
syllabus is exactly the input they require, and it is not purchasable. Attempt
storage, conversation persistence and a class dashboard are well-specified
application work that a competent developer can build from a written spec.
`PENDING.md` is that spec.

That division is worth stating explicitly in the application. It shows the budget
was built around a real constraint rather than distributed evenly.

### Sizing the engineering line honestly

$3,500 buys very different amounts of contractor time depending on where the
contractor is hired. **Express it in the application as weeks of contracted
developer time at a stated rate, not as a bare figure** — a committee can evaluate
"six weeks at $X/day" and cannot evaluate "$3,500 of engineering."

Get one real quote before submitting if at all possible. A single quoted rate
converts this entire line from an estimate into evidence.

### What the pilot line does and does not cover

**Covered:** the running cost of schools using Shamo free of charge — tutoring
inference, animation rendering, and the additional hosting capacity a cohort
needs.

**Not covered, because it cannot be evidenced:** there is no basis for estimating
direct pilot expenses such as travel, printed materials, or a stipend for
participating teachers' feedback time. If such costs arise they come out of the
marketing line, which is adjacent in purpose. **Do not invent a separate pilot
expenses line** — an indefensible figure damages the credibility of the defensible
ones.

The founder's own time running the pilot is disallowed and is not claimed.

### If no contractor is hired

If the founder ends up doing all of the engineering, the $2,400 cannot be
redirected to founder time. **Reallocate it to contracted review and corpus
expansion** — more teachers verifying more papers — which is the other genuine
bottleneck and remains fully grant-eligible.

---

## 6. Unit economics and future cost drivers

### Known

| Metric | Value | Confidence |
| --- | --- | --- |
| Cost per paper ingested | ~$0.66 | Derived from $70 / 106 papers |
| Cost per question ingested | ~$0.07 | Derived from $70 / 958 questions |
| Current database size | 230 MB | Verified live 15 Sep 2026 |

### Unknown, and needed before pricing anything

- **Cost per active student per month.** Not measured. This is the single most
  important missing number: a per-seat school price cannot be set from evidence
  until it exists. Tracked as `PENDING.md` P2-8.
- **Cost per Manim render.** Renders are synchronous, 35–60 seconds, and
  memory-heavy (the deployment caps the container at 3 GB). Under a site licence
  with 200 students this needs bounding before signature.

### Costs that will arrive

- **Supabase Pro plan.** Currently on Free. Two forcing functions: leaked-password
  protection is Pro-only (confirmed rejected on Free, 18 Aug), and the Free plan
  caps at 500 MB against 230 MB used today.
- **Hosting and TLS.** Founder is handling this; excluded from `PENDING.md` scope.
- **Corpus expansion.** Linear and cheap in compute at ~$0.66 per paper; expensive
  in review time.

---

## 7. Positioning decisions affecting the funding narrative

Dated decision log. Later entries supersede earlier ones.

### 15 September 2026 — the product is an AI tutor

Shamo is positioned as an **AI tutor**, with the long-term vision being what a
student gets from private tuition, available continuously. An earlier draft of the
review recommended pitching "verified exam-corpus infrastructure with a tutor as
the interface"; **the founder corrected this, and the correction stands.** The
category is claimed directly; the corpus is the proof that makes it credible.

### 15 September 2026 — B2B-led, D2C as the evidence engine

Marketed primarily to schools, while remaining available direct to consumers.
Rationale: the network advantages matter far more to an institution, and a school
cannot substitute a free PDF upload the way an individual can.

Sequencing caveat to state in the deck before a reviewer raises it: **school
procurement runs on annual budget cycles, typically 6–12 months.** D2C is the
bridge — it produces cash and, more importantly, the usage evidence that turns a
school pilot from a demo into a case study. The founder's existing tuition
students are the intended first cohort.

### 15 September 2026 — the corpus network is the differentiator

The most common objection is *"a student can just upload the question paper and
mark scheme to ChatGPT."* The agreed answer concedes the premise immediately and
reframes on **unit of operation**: an upload is a document interaction bounded by
one session and a few attachments; Shamo is a corpus interaction across 958
cross-linked questions.

### 15 September 2026 — fidelity before continuity

The agreed framing for why the prototype is credible: Shamo built the hard half of
tutoring first (subject knowledge, mark-scheme accuracy, explanation that
withholds, visual teaching) and is missing the continuity half (memory, diagnosis,
planning). Most competitors have it inverted. Fidelity cannot be retrofitted;
continuity is ordinary engineering.

### 15 September 2026 — deployment assumed complete at submission

Materials are written on the basis that the platform is live and publicly
reachable by submission. **Verify the URL resolves from a machine that is not the
founder's before sending** — a dead demo link is worse than no demo link.

### Open positioning question

Against private tuition, two available lines, not interchangeable:

- *"Cheaper than a tutor"* — invites a price race and cannibalises Shamo Classes.
- *"The other 165 hours of the week"* — truer to what is built, and positions the
  product alongside tuition rather than against it.

**Recommendation: the second. Not yet decided by the founder.**

---

## 8. Money claims discipline

What may and may not be said about cost and commercial traction.

**Defensible:**

- "We built the corpus for about $70. Scaling it is a review-capacity problem, not
  a compute problem."
- "Spend controls are engineered: every paid stage reserves budget before the call
  and is capped per batch and per campaign."
- "Roughly 66 cents per paper, measured across 106 papers."

**Do not claim:**

- Revenue, paying users, signed schools, or letters of intent — none exist.
- A price per seat derived from cost — cost per active student is unmeasured.
- Any live usage, engagement or retention figure.
- That the ledger's $9.20 is the true spend. It under-reports; use $70.

---

## 9. Maintenance

Update this file when: an application is submitted or decided; any external funding
is received; the allocation changes; a cost per active student is first measured;
or a positioning decision in section 7 is revised. Add dated entries rather than
rewriting history, and keep the decision log append-only.
