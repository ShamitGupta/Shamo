# Shamo — Pending Work for a Grant-Ready Prototype

> Created: 15 September 2026 · Last updated: 15 September 2026 (P0-1 and P3-11 shipped)
> Scope: everything still missing before the prototype can demonstrate the claims
> the grant application makes. **Hosting and deployment are explicitly excluded** —
> the founder is handling those.
> Verified: every "already exists" statement below was checked against the live
> Supabase instance and the current working tree on 15 September 2026, not taken
> from documentation. Re-verified on update: 2,596 search rows / 958 distinct
> questions, 106 published papers, 0 entitlement rows, 898 of 947 metadata records
> still `pending`, 958 question rows against 947 unique.

## What "grant-ready" means here

Narrower than production-ready. The bar is:

1. Every claim the pitch deck makes is **demonstrable by a reviewer who clicks**.
2. Nothing in the deck is a claim the product cannot back up.
3. The product behaves like a tutor across a session, not a single question.

Items are ordered by that standard, not by engineering difficulty. Effort sizes
are rough: **S** ≈ 1–3 days, **M** ≈ 3–7 days, **L** ≈ 2–3 weeks, assuming one
developer already familiar with this codebase.

---

## Shipped since this file was written

**P0-1 · Surface similar-question retrieval — DONE, 15 September 2026.**
The network claim is now clickable. `shamo_match_similar_questions_for_question`
(a new additive RPC taking a seed question id rather than an embedding) →
`GET /papers/.../questions/{n}/similar`, gated by a verified session →
a `SimilarQuestions` panel under the question. Costs nothing per call: it reuses
stored embeddings and makes no model call. Acceptance met — **83% (9709) / 76%
(0606) of published questions return three or more neighbours**, each labelled
with paper, year, topic and marks, each clickable. Full account in `CLAUDE.md`,
Development history, 15 September.

**P3-11 · Explainable similarity — DONE, same change.** Each recommendation
carries the shared `main_topic` and marks drawn from reviewed metadata. No model
writes a rationale, so a recommendation cannot be justified with an invented
reason — which is the version of "explainable" a Head of Department can actually
check.

**Two latent defects found and fixed while building it**, both confirmed live
rather than theoretical:

- An **integer overflow** in the pre-existing matcher (`requested_limit * 20`
  evaluated before clamping, in `integer`) that would have become a
  user-triggerable 500 the moment any endpoint forwarded a `limit` parameter.
  Clamped before delegation.
- The similarity floor applies **per search row, not per question**, so a question
  qualifies if any of its parts clears the bar. Measured at **39.8% of matches**.
  Kept deliberately — it is what keeps the 155 stemless questions servable — but
  now surfaced as a `matched_on_part` flag so it stays visible.

**What this changes elsewhere in this file:** P3-12 now has a real automated
baseline (below), P3-10 is re-scoped rather than eliminated (below), and P0-1 no
longer gates the suggested order.

---

## P0 — Without these, the central pitch claims are not demonstrable

### P0-2 · Persist conversations

A tutor that forgets everything on refresh is not a tutor, and a demo that loses
its thread mid-review is worse than no demo at all.

**Already exists:** `ChatTurn` in `models.py` already models a turn including its
mode and any visual artifacts; history is already sent to and used by the prompts.

**Missing:** a user-scoped `shamo_conversations` / `shamo_conversation_turns`
pair with RLS restricting rows to their owner, plus save-on-write and
load-on-open in `/chat`, `/respond` and `/visualize`.

**Acceptance:** refreshing the browser restores the open thread; returning to a
question later shows the previous conversation about it.

**Size: M.**

---

### P0-3 · Record student attempts

The prerequisite for every personalisation claim in the deck. Nothing downstream
(P1-4, P1-5, P1-6) is possible without it.

**Already exists:** Check mode already receives the student's own working as a
structured `attempt` field — it is used for diagnosis and then discarded.

**Missing:** a `shamo_attempts` table keyed to `(user, question, part)` storing
the submitted working, the mode, the diagnosis outcome, marks attributed where
available, and a timestamp. User-scoped RLS.

**Acceptance:** every Check submission writes a durable row tied to the exact
question identity, retrievable per user.

**Size: M.**

---

## P1 — Without these, the B2B pitch is not credible

### P1-4 · Derive a topic-weakness signal

**Already exists:** metadata is effectively complete — 947 records carrying
`main_topic` (30 distinct topics), `subtopics` (921), plus `methods`, `skills`
and `difficulty_level` (947 each). Attempts only need aggregating against it.

**Missing:** aggregation logic and an endpoint exposing ranked weak topics with
the evidence behind each — attempt counts, accuracy, recency.

**Acceptance:** a student with attempt history sees their weakest topics ranked,
with the number of attempts supporting each. Do not reduce this to one opaque
score; preserve the evidence.

**Size: S–M.** Depends on P0-3.

---

### P1-5 · Generate practice sets

Turns "here are similar questions" (a search feature) into "here is what you
should work on next" (the tutoring claim).

**Missing:** set assembly — select N questions for a weak topic, exclude what the
student has already attempted, spread across papers and years, order by
difficulty.

**Acceptance:** "practise my weakest topic" returns a ranked set of unattempted
questions with a stated reason for the selection.

**Size: M.** Depends on P0-3 and P1-4. ~~P0-1~~ is done, and the retrieval half
of this — "questions like this one, from other papers" — is already working and
reusable; what is missing is selecting *for a student* rather than *for a
question*.

---

### P1-6 · Teacher and class view

**This is the artefact a school is actually buying.** None of it exists.

**Missing, all of it:**

- An organisation/school entity and class membership. Confirmed absent: there are
  no `school`, `organi*`, `class` or `subscription` tables in the database.
- A staff role distinct from student, with its own RLS policies.
- Seat allocation and bulk provisioning.
- A per-class topic view: where this cohort is weak, who needs intervention.

**Acceptance:** a staff account sees per-topic attempt and accuracy figures across
their class, under an explicit policy on how much individual student content staff
may read.

**Size: L.** The largest item here, and the one that most directly gates a
departmental sale.

---

## P2 — Commercial and operational

### P2-7 · Billing and entitlement automation

**Already exists:** the tier model is correct and server-side — Free / `premium` /
`shamo_student`, resolved through `shamo_user_entitlements` with no browser
access, exposed via `GET /me`.

**Missing:** any payment integration at all. There is no Stripe dependency in the
codebase and `shamo_user_entitlements` holds zero rows, so tiers can currently
only be granted by hand in a database console. For B2B there is additionally no
institutional purchase path.

**Acceptance:** a completed checkout creates or updates an entitlement row
server-side via webhook. Never treat a frontend or admin grant as the source of
truth.

**Size: M.**

---

### P2-8 · Rate limiting and usage metering

> **Effectively a P0 if a free school pilot is running.** Schools get the pilot
> free of charge, but every tutoring turn and animation costs real money, funded
> from the grant (`FUNDING.md`, pilot delivery line). Nothing currently caps what
> a single user can spend on the project's API key. **Do not open a free pilot to
> a cohort before this exists** — an uncapped free tier across several hundred
> students is how a grant disappears. It also converts an unmeasured cost into a
> capped one, which is what makes the budget line defensible.

Two distinct problems solved by one piece of work.

**Missing:** per-user request limits, and per-user cost accounting.

**Why both matter:** nothing currently caps what a single user can spend on the
project's OpenAI key, so a free tier without this is an open invoice. Separately,
**cost-per-active-student is unmeasured, which means a per-seat school price
cannot yet be set from evidence.** Manim renders are synchronous, 35–60 seconds
and memory-heavy; under a 200-student site licence this needs bounding before
signature, not after.

**One thing that is deliberately free:** similar-question retrieval (shipped
above) makes no model call — it reads stored embeddings. It adds database load,
not provider spend, so exclude it when modelling cost-per-active-student or the
figure will be pessimistic.

**Acceptance:** a per-tier request ceiling is enforced, and a monthly
cost-per-active-user figure can be read from stored data.

**Size: M.**

---

### P2-9 · Basic product analytics

**Missing:** any instrumentation. There is no analytics dependency anywhere in the
codebase.

**Why it matters for the grant specifically:** the pilot cohort exists to produce
evidence for the school pitch. Without instrumentation, a pilot produces
anecdotes rather than data.

**Acceptance:** mode usage, session length, questions attempted and return rate
are queryable per cohort.

**Size: S.**

---

## P3 — Trust and quality (procurement will ask about these)

### P3-10 · Hybrid retrieval — vector plus metadata filter

**Re-scoped by the P0-1 work, not eliminated.** The original concern — short
questions returning weak neighbours — is now *suppressed* rather than solved: a
measured 0.60 similarity floor means weak matches are no longer shown at all.
So the failure mode is no longer "a student is shown a bad recommendation"; it is
"a student is shown nothing." That is the honest behaviour, and it is the right
default, but it costs coverage.

**The remaining prize is recovering those questions.** 7–8% of published questions
currently return nothing, and they skew towards exactly the short, text-poor stems
that embed badly. Filtering or re-ranking by `main_topic` and `methods` — both
effectively complete in the data — is what would let those questions return a
trustworthy neighbour instead of an empty panel.

**Acceptance:** the share of questions returning zero neighbours falls materially
below 7–8% without lowering the similarity floor.

**Size: S–M.**

---

### P3-12 · Measure retrieval relevance against human judgement

**Substantially advanced by the P0-1 work, but not closed.** There is now a real,
repeatable automated baseline, built into
`database/shamo_v2_6_similarity_by_question_verification.sql` so a future
embedding-model or threshold change shows up as a regression rather than a
surprise:

- Topic agreement rises monotonically with similarity — 43–46% at 0.50–0.60,
  56–68% at 0.60–0.70, 76–85% above 0.80. That monotonicity is itself the
  evidence the embeddings carry real topic signal.
- Corpus-wide at the shipped 0.60 floor: 83% (9709) / 76% (0606) of questions
  return three or more neighbours, 7–8% return none, and zero results leak below
  the floor.

**Still missing, and this is the part that matters for procurement:** all of the
above uses *shared `main_topic`* as a proxy for relevance. **Nobody has yet
judged a sample of recommendations by hand.** Two questions can share a topic and
still be poor practice for one another, and two genuinely similar questions can
sit under different topic labels. A proxy that correlates with quality is not a
measurement of quality.

**Acceptance:** a fixed set of seed questions with expert-rated neighbours, scored
repeatably alongside the automated proxy, so the two can be compared and the proxy
either trusted or corrected.

**Size: S**, plus review time. **Do not describe retrieval quality as "measured"
in front of a school without this** — say "measured against a topic proxy",
which is both true and still creditable.

---

### P3-13 · Make publication an actual human gate

**Confirmed gap:** none of `shamo_publish_paper_bundle`,
`shamo_publish_paper_bundle_v2` or `shamo_publish_paper_bundle_with_metadata`
takes an approver argument, and `verifier_report.passed` is set by the automated
validator itself. Nothing enforces a human signature.

Either add a required `approved_by` to the publish RPC, or state explicitly in the
deck that review is agent-assisted with automated gating. **Do not claim a human
approval gate the schema does not enforce.**

**Size: S.**

---

### P3-14 · Close the metadata review gate

**Current state:** 898 of 947 metadata records are `review_status = 'pending'`;
49 are approved. The content was reviewed in practice, but "reviewed" is not
provable from the data — and procurement asks for exactly that kind of proof.

Decide what sign-off means given that `main_topic` is source-reviewed while
`difficulty_level` has no ground truth in this corpus, then either close the gate
or document deliberately why it stays open.

**Size: M**, mostly review time rather than engineering.

---

### P3-15 · Deduplicate the pilot paper rows

**Confirmed live:** 11 duplicate question identities remain from the 9709/12
Feb–Mar 2025 pilot, published twice at row level before the paper pointer moved.
958 total question rows against 947 unique.

Needs reviewed SQL with asserted targets — **not a blind delete**.

**Size: S.**

---

### P3-16 · Write a content licensing position

**Not code.** One page on how Shamo treats Cambridge Assessment past papers and
mark schemes in a commercial product sold into schools. The repository does not
address this anywhere.

A school's legal review is far more likely to raise it than an individual parent,
which makes this a B2B blocker rather than housekeeping. You do not need a legal
opinion to apply for the grant; you should not be answering the question for the
first time in front of a customer.

**Size: S.**

---

## Known defects — disclose rather than necessarily fix

All real and documented. None blocks a grant application, but none should be
contradicted by a claim in the deck.

| Issue | State | Deck implication |
| --- | --- | --- |
| Check-mode leniency on marks requiring complete evidence | Measurably improved 13 Aug, never proven eliminated — it is a stochastic system | Do not claim marking is infallible |
| Cost ledger under-reports retried stages | Known metering fault: a retry re-pays the provider while the ledger records only the first charge | Use the founder's ~$70 figure, not the ledger |
| Corpus depth is two years (2024–2025) | Complete and clean for those years; 9709 and 0606 only | Present further years as funded capacity, not existing coverage |
| 71 open blocking ingestion issue records | **Re-checked 15 Sep: all 71 sit on superseded or abandoned runs. Zero open blocking issues sit on any ingestion run that is actually published.** | Better than previously stated. You may say every published paper carries no unresolved blocking issue — but not that the project has never had one |
| Leaked-password protection unavailable | Requires a Supabase Pro plan; confirmed rejected on Free, 18 Aug | Mention only if security is raised |

---

## Explicitly out of scope for grant-readiness

Listed so the work does not sprawl. All are real; none is needed to make the pitch
honest and demonstrable.

- **Hosting, deployment, TLS, domain** — founder is handling these.
- Corpus expansion beyond the current 106 papers (funded work, not prototype work).
- Trend-based question generation — roadmap only; do not claim it.
- Voice mode.
- A pre-request visual capability map (which questions support Desmos/GeoGebra/Manim).
- Reviewed visual-spec admin tooling.
- Redeploying the fixed parser to the live IGCSE staging child — nothing needs to
  ingest through it while the campaign is complete.

---

## Who should build what

Relevant because the grant disallows founder salary but can fund a contracted
developer — see `FUNDING.md`. The split is not by difficulty, it is by **whether
the work needs subject judgement**.

| Item | Owner | Why |
| --- | --- | --- |
| P0-2 Conversation persistence | **Contractor** | Well-specified application work: schema, RLS, save and load |
| P0-3 Attempt recording | **Contractor** | Same — the diagnosis already exists, it only needs storing |
| P1-6 Teacher and class view | **Contractor** | Largest separable block; entities, roles, aggregate views |
| P2-7 Billing | **Contractor** | Standard webhook-to-entitlement work |
| P2-8 Rate limiting and metering | **Contractor** | Infrastructure, not pedagogy |
| P2-9 Analytics | **Contractor** | Instrumentation |
| P3-15 Deduplicate pilot rows | **Either** | Needs care with asserted targets, not subject knowledge |
| P1-4 Topic weakness signal | **Founder** | What counts as "weak" is a teaching judgement |
| P1-5 Practice sets | **Founder** | Sequencing and difficulty ordering is the tutoring itself |
| P3-10 Hybrid retrieval | **Founder** | Requires knowing which topic and method distinctions actually matter |
| P3-12 Relevance benchmark | **Founder + hired teachers** | The automated proxy exists; only expert rating can validate it |
| P3-13 Publication gate | **Founder** | A policy decision, not a feature |
| P3-14 Metadata review | **Hired teachers** | Volume review work, the genuine bottleneck |
| P3-16 Licensing position | **Founder + legal advice** | Not engineering |

A contractor can start on P0-2, P0-3 and P1-6 from this document alone without
blocking on any founder work.

## Suggested order

~~P0-1~~ and ~~P3-11~~ are done. Remaining, in order:

1. **P0-2, P0-3** — the foundation everything personalised stands on, and now the
   single largest gap between the product and the pitch. A reviewer who refreshes
   the page currently loses the thread.
2. **P3-10** — recovers the 7–8% of questions that return no neighbours. Cheap,
   and it removes the one visibly thin spot in the feature that was just shipped.
3. **P1-4, P1-5** — turns retrieval into tutoring.
4. **P2-7, P2-8** — revenue and cost safety, together.
5. **P1-6** — the school product. Largest, and worth starting only once the pilot
   cohort is generating data.
6. **P3-12 … P3-16** — before the first serious procurement conversation. P3-12
   in particular needs booked teacher time, so start arranging it earlier than you
   intend to do the work.

If only one item ships before submission, make it **P0-2** — persistence. It is
now the most visible gap in a live demo: the tutor forgets everything on refresh,
and a reviewer will find that within a minute of clicking.
