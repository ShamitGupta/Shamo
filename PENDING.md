# Shamo — Pending Work for a Grant-Ready Prototype

> Created: 15 September 2026 · Last updated: 17 September 2026 (P4-17 recorded:
> class-driven practice papers, planned but not grant-gating)
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
a `SimilarQuestions` panel under the question — **collapsed behind a single line
until asked for, as of 16 September**, so it no longer pushes the question a
reviewer is reading off the screen. Costs nothing per call: it reuses
stored embeddings and makes no model call. Acceptance met — **83% (9709) / 76%
(0606) of published questions return three or more neighbours**, each labelled
with paper, year, topic and marks, each clickable. Full account in `CLAUDE.md`,
Development history, 15 September.

**P3-11 · Explainable similarity — DONE, same change.** Each recommendation
carries the shared `main_topic` and marks drawn from reviewed metadata. No model
writes a rationale, so a recommendation cannot be justified with an invented
reason — which is the version of "explainable" a Head of Department can actually
check.

**P0-2 · Persist conversations — DONE, 15 September 2026.** Three new tables
(`shamo_v2_7`), five conversation endpoints, and a thread list with create /
rename / delete. Refreshing restores the thread **and the question**, so the
student can carry straight on. Acceptance met.

Two decisions worth knowing: a thread may span several questions (a student
works through a set and refers back), which required tagging every stored turn
with the question it was about and telling the model so — otherwise it reads
turns about question 4 while holding question 7's mark scheme. And deleting a
conversation is a **real** delete; keeping a hidden copy of a student's own
working after they asked for it to go is the wrong trade for a school pilot.
Recorded marks survive, by design.

**P0-3 · Record student attempts — DONE, same day.** Every Check submission
stores the working, the question, and the marks the tutor attributed. The
numbers come from a separate cheap model call that reads the finished reply
(option A) rather than re-marking it, so the record can never disagree with the
feedback the student saw, and the hardened Check prompt was not touched. Every
mark code is validated against that question's own mark scheme; a fabricated one
is discarded.

**P1-4 · Topic-weakness signal — DONE, same day.** `shamo_v2_8` ranks topics by
mark ratio, never shown alone: each row carries attempts, raw marks, recency and
example questions. A topic needs a minimum number of scored attempts before it
counts as a weakness — a single 0/5 would otherwise sort straight to the top —
and under-evidenced topics are shown separately rather than hidden.

**P1-5 · Practice sets — DONE, same day.** `shamo_v2_9` returns unattempted
questions on a topic, spread across papers, gentlest first, each with a reason
drawn from stored metadata rather than written by a model.

**Four defects found only by running the real thing**, none of which the 280
offline tests could have caught:

- **CORS allowed only GET and POST.** Every rename and delete failed on the
  preflight. `TestClient` does not enforce CORS, so the suite was green while
  the feature was broken in every browser.
- **The marking denominator was the whole question.** A tutor marking "1 out of
  2" for part (a) was recorded as 1 out of 5 — and the weak-topic ranking *is*
  the mark ratio, so it understated the student by more than half.
- **Mark-code matching accepted only the plain `A1` shape.** The corpus uses
  `B2,1,0`, `B1 FT`, `*M1`, `DM1` and `B1 B1`. On the first real submission the
  tutor correctly cited `B2`, the whitelist did not contain it, and the whole
  record was discarded as fabricated.
- **Weak topics were grouped by (topic, syllabus).** "Trigonometry" exists in
  both 9709 and 0606, so four attempts became a 3-attempt row and a 1-attempt
  row, pushing the smaller below the threshold. The verification script's own
  lookup hid it until a uniqueness check was added.

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

**UI pass, 16 September 2026 — no P-item opened or closed, but it changes what a
reviewer actually sees.** Five user-reported changes. The one that matters for
this document's own standard: **"Where you are struggling" now lives in the
sidebar, permanently.** It previously sat above the conversation, so it scrolled
out of sight the moment anyone started typing — a reviewer could click through
the whole demo and never see the personalisation claim the deck leads with. It
now also says what would fill it when a student has no attempts yet, instead of
rendering nothing.

The rest: "New chat" now visibly clears (it did clear before, but nothing on
screen moved, and clicking it while already on an unsaved thread genuinely did
nothing); the sidebar's secondary links shrank so the saved-thread list has room
to grow; rename and delete became icons; and similar questions became opt-in as
noted above. Frontend only — no schema, endpoint or prompt changed, so nothing
measured above is affected. Full account in `CLAUDE.md`, Development history,
16 September.

**What this changes elsewhere in this file:** P3-12 now has a real automated
baseline (below), P3-10 is re-scoped rather than eliminated (below), and P0-1 no
longer gates the suggested order.

---

## P0 — Without these, the central pitch claims are not demonstrable

**All P0 items are now shipped** (P0-1 similar questions, P0-2 persistence,
P0-3 attempt recording). See the shipped section above.

## P1 — Without these, the B2B pitch is not credible

P1-4 and P1-5 are shipped. P1-6 shipped in its pilot shape on 16 September; what
remains of it is three named successors, below, and the first two of them gate a
real school pilot.

### P1-6 · Teacher and class view — SHIPPED IN ITS PILOT SHAPE, 16 September 2026

A teacher signs up at `/teacher` with a shared invite code, lands on
`/dashboard`, and sees every student's usage, attempts and weakest topic, with a
per-student page carrying the same topic ranking the student sees and the work
they submitted for marking. Their conversations with the tutor are not shown and
are not reachable. Full account in `CLAUDE.md`, Development history, 16
September (teacher sprint).

**What shipped:** `shamo_user_roles` (v2.10, a server-side role the browser
cannot write), `shamo_get_student_roster` (v2.11), `POST /me/claim-staff-role`,
three `/staff/*` endpoints behind a `require_staff_user` gate, a routed teacher
surface reached from a link in the sidebar footer (Google sign-in as well as
email/password), and a labelled six-student sample cohort to demonstrate on.

**Acceptance met:** a staff account sees per-topic attempt and accuracy figures
across the class, under an explicit read policy — usage, questions practised and
submitted working are visible; `shamo_conversation_turns.content` and
`shamo_conversations.title` are not, enforced at the query rather than in the
interface.

**Extended, 16 September 2026 (same day, second pass).** The dashboard now
answers *"what do I teach on Monday?"* as well as *"how is this student doing?"*:
a class-level topic ranking led by the **headcount** struggling rather than a
pooled percentage, a **method-vs-accuracy** split of the marks being lost, and
**weekly activity** with a "gone quiet" flag on the roster. `shamo_v2_12` (three
additive service-role functions), `GET /staff/class/overview`, and
`GET /me/mark-codes` — the student sees the same mark split about themselves,
because a teacher knowing something about a student that the student cannot see
would have widened (b) below for the sake of one endpoint. Full account in
`CLAUDE.md`, Development history, 16 September (class insights).

**Three named successors, none of them optional before a real school:**

**(a) Admin-verified schools, and teachers scoped to their own.** The shipped
model is deliberately flat: **any account holding the invite code can read every
student in the database.** That is contained today by the code being handed out
by hand and by there being no real cohort — it stops being contained the moment
a pilot starts. What is needed: a school entity, students mapped to a school at
signup, staff verified by an admin rather than by a shared secret, and the
roster filtered to the caller's own school. The filter belongs in
`shamo_get_student_roster`; its header says so. **Size: M.**

**(b) The student-facing transparency notice. Deferred deliberately, and
required before a real cohort.** Students are not currently told that a teacher
can see their practice activity, attempts and topic performance. For minors'
data that is the wrong default, and it is a few lines of UI, not a feature.
**More pressing after the 16 September class-insights pass**, which gave a
teacher a better-organised view of the same data — a student is now more
legible to their teacher than before, while still not being told so.
**Size: S.**

**(c) Remove the sample cohort.** Six invented students
(`shamo-demo-student-*@example.com`, `shamo_profiles.is_sample = true`) live in
the production database so the dashboard is demonstrable on short notice. They
are labelled everywhere they appear. **They must be gone before a real cohort
joins** — a teacher scanning a roster should not have to tell invented children
from real ones:

```powershell
python backend_v2/tests/demo_cohort.py teardown
```

Their mark codes were re-seeded from the real mark schemes on 16 September
(`demo_cohort.py recode`). Before that every seeded attempt earned `M1` and
missed `A1`, which would have shown anyone being demoed a perfect 100% method /
0% accuracy split — a finding about the seeder, not about any student. Sample
data has to be plausible as well as labelled, or it misleads the person being
shown it.

Every usage figure quoted from this database must exclude them until then.

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
above) makes no model call — it reads stored embeddings. Weak topics and
practice sets are the same: both are pure SQL. They add database load, not
provider spend, so exclude them when modelling cost-per-active-student or the
figure will be pessimistic.

**One thing that got slightly more expensive, 15 September:** every Check
submission now makes a *second* model call — a small `gpt-5.4-nano` pass that
reads the tutor's finished reply and records which marks it attributed. It is a
fraction of the tutoring call it follows, but it is per-submission and it is
real, so fold it into the per-student figure rather than counting one call per
turn.

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

## P4 — Planned capability, not required for grant-readiness

Added 17 September 2026 at the founder's direction. It sits below every P3 item
on this document's own standard: **nothing in the deck currently depends on it,
and a reviewer cannot click it.** Recorded here rather than under "out of scope"
because it is intended to be built, and because working out what it needs
surfaced a missing prerequisite that is probably worth more than the feature.

### P4-17 · Class-driven practice papers

A teacher sees the questions their class is collectively struggling with, and
turns that set into a practice paper with its mark scheme — every question and
every mark row taken from real past papers, nothing generated.

**Why it is on-thesis rather than a bolt-on:** it is *compilation*, not
generation. Most AI edtech would invent questions here; this product does not
have to, and refusing to is the stronger claim. It also closes the loop the rest
of the system already builds — attempt → mark-code diagnosis → class weakness →
targeted paper → back to practice — and it makes a **printable artifact**, which
is the first thing in the product a department can hold.

It costs almost nothing per use: attempts, mark codes, mark schemes, diagrams and
embeddings are all stored, and none of this needs a model call.

**Split into two halves, because they are not equally ready.**

**(a) Question-level class weakness.** The class view already ranks *topics* by
the headcount struggling (`shamo_get_class_topic_summary`, v2.12). Ranking
individual *questions* the same way is a small extension of work that exists.

**The problem is the data, not the query.** Students currently choose their own
questions. The chance that twenty students in a class independently attempt the
same question is near zero, so "the questions the class is struggling with" has
almost no overlap to aggregate. **This feature is blocked on a prerequisite that
is not yet scoped anywhere in this document: a teacher assigning a question set
to a class.**

That prerequisite may be the more valuable feature. Assignment turns a teacher
from an observer of a dashboard into a user of a workflow, and it is what makes
(a), (b) and the existing class insights all read from the same shared set of
work. **Size: S** once assignment exists; **M** including it.

**(b) Compiled practice papers.** Buildable today, if it is driven by *topic*
weakness — which is shipped and real — rather than by question-level overlap,
which is not. Take the class's weakest topics, draw unattempted questions from
`shamo_get_practice_set`, and render the questions with their diagrams plus a
separate mark-scheme document.

The new engineering is rendering, not selection: KaTeX/LaTeX to a printable
document, with signed diagram assets resolved at build time. **Size: M.**

**Acceptance:** a teacher can produce a practice paper and its mark scheme for
their class, in which every question and every mark-scheme row traces to a
published paper, and no text is model-generated.

**Three honest cautions before this is promised to anyone.**

1. **It sharpens P3-16 from "should" to "must".** Tutoring a student on a
   question they already own is one thing; compiling official Cambridge questions
   into a redistributable document handed to a school is materially closer to
   what the board licenses commercially. **Do not ship (b) before the licensing
   position exists.**
2. **A competitor already does the worksheet half.** Teebloc (a VIP@SoC alumnus
   and an operating Singapore company) builds custom worksheets from past-year
   questions. The novelty here is not the worksheet — it is *why these
   questions*: mark-code diagnosis of the class's own attempts. Lead with the
   diagnosis or this reads as a rebuild of something that already exists.
3. **It competes for founder time with P2-8**, which gates the free pilot. This
   is a post-pilot feature; the pilot is what would generate the attempt volume
   (a) needs in the first place.

### P4-18 · School-uploaded materials as a second grounding layer

Added 17 September 2026 at the founder's direction, and now referenced in the
grant application, which is the only reason it is written up before it is built.

**Status changed the same day, and it matters: this is now a committed months
10–12 milestone in the submitted application**, not a roadmap aspiration. It is
therefore no longer honestly "P4, not grant-gating" — failing to ship it is a
missed milestone on a funded grant. It stays in P4 because nothing in the pitch
*demonstrates* it, but it should now be planned and sequenced as if it were P2.
Two consequences: the dependency below (P1-6 (a)) is on the critical path and is
correctly scheduled in months 1–3 of the same application; and an **L**-sized
item now sits in the final quarter alongside converting pilots to paid contracts,
for a part-time founder. If something has to give, this is the milestone to
renegotiate — not the paid contracts, and not the pilot.

A school uploads its own material — homework sheets, internal exam papers,
worksheets — and Shamo grounds tutoring on that too. **Official past papers stay
the base layer; the school's own content is an additional layer on top of it.**

**Why it is commercially the strongest item in P4.** It converts a subscription
into a deposit. A department that has put three years of its own exams into Shamo
does not casually switch, and it answers the standing objection — *"a student can
just upload the paper to ChatGPT"* — at the institutional level, where an upload
per session is not a substitute for a department's material being permanently
searchable alongside 958 cross-linked official questions. It is also the clearest
reason a school renews in year two.

**The engineering boundary, which must be stated before this is promised.**

1. **It cannot use the ingestion pipeline as built.** That pipeline is Cambridge-
   specific in four places (mark-code grammar, taxonomies named `9709-v3` and
   `cambridge-igcse-0606-v1`, the paper-domain map keyed on Cambridge component
   digits, and the expected-total-marks rule). A school's homework sheet has no
   mark codes, usually no mark scheme at all, and no syllabus component. This is
   a **second, separate path** — OCR, chunk, embed, retrieve — which is easier
   engineering but far less distinctive.
2. **The "cannot invent an answer" guarantee does not transfer, and this is the
   real risk.** That property holds because the tutor retrieves a complete
   question, its parts, its diagrams and its official mark scheme. Material with
   no mark scheme cannot support mark-level explanation or Check-mode marking.
   **There are therefore two tiers of grounding, and the interface has to show
   which tier a question sits on** — otherwise the weaker tier silently dilutes
   the guarantee across the whole product, which is the one claim this project
   cannot afford to blur.
3. **It is hard-blocked on P1-6 (a), school scoping.** Uploaded material is
   third-party content owned by that school. Storing it in a database where any
   invite-code holder can reach it is not a shortcut, it is a breach. It also
   needs retention and deletion terms, and the `past-paper-assets` bucket still
   has no MIME-type restriction or per-file size limit.

**Size: L.** Ingestion path, per-school isolation, tier labelling in the UI, and
a storage/cost model that nothing in section 6 of `FUNDING.md` currently covers.

**Acceptance:** a teacher uploads a worksheet; a student is tutored on a question
from it; and the interface states plainly that the question carries no official
mark scheme, with Check-mode marking unavailable or explicitly caveated on it.

**Two cautions.**

1. **Do not pitch it as "the same tutor, on your own material."** It is a weaker
   grounding tier wearing the same interface. Say "your material becomes
   searchable and teachable alongside the official corpus" — true, and still the
   strongest sentence available to a school.
2. **It changes unit economics per school**, in storage and in inference over a
   larger retrieval set. Nothing in the pricing model accounts for it, and the
   pilot will not measure it unless the pilot includes an upload.

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
| Marking record drops out when the tutor names an unknown mark code | Measured 15 Sep: a reply citing a code the mark scheme does not contain records **nothing** rather than dropping just that code. Two prompt revisions did not shift it | Safe direction — it never stores an invented mark. But do not present a missing outcome as proof a student was not assessed |
| **Two concurrent API requests can come back 401 or 503** | Found 16 Sep. `backend_v2` shares ONE Supabase client across FastAPI's threadpool; two requests landing together intermittently fail. Reproduced against `/me` alone, ~1 in 4 paired calls, so it predates every recent feature. In the browser a spurious 401 reads as being signed out | Not user-visible on any page today — the one page that fetched two things in parallel was changed to fetch one. Fix before any real concurrent load: give each request its own client, or pool per thread |
| "Weak" is defined as mark ratio, validated only against seeded numbers | The aggregation, ordering and evidence threshold are verified exactly; whether mark ratio is the right *pedagogical* definition is not | Say the evidence is stored beside every figure so a teacher can disagree with it — that is the honest and the stronger claim |

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

**Superseded 17 September 2026: the founder builds everything.** External hiring
was ruled out and both contracted-people lines were removed from the grant
allocation (`FUNDING.md`, section 2, "no external hiring"). Founder time is not
grant-fundable, so the grant now buys only what the work runs on, and every row
below is founder work regardless of what it says.

The table is kept because the **reason** for the split still holds and still
orders the work: items needing subject judgement cannot be delegated even in
principle, while the rest could be handed over the moment that decision changes.
Read "Contractor" as *delegable if ever wanted*, not as *planned*.

| Item | Owner | Why |
| --- | --- | --- |
| ~~P0-2 Conversation persistence~~ (done) | Delegable — **built by the founder** | Well-specified application work: schema, RLS, save and load |
| ~~P0-3 Attempt recording~~ (done) | Delegable — **built by the founder** | Same — the diagnosis already exists, it only needs storing |
| ~~P1-6 Teacher and class view~~ (pilot shape done) | **Founder** (delegable) | Successors (a)-(c) remain: school scoping, transparency notice, sample-cohort removal |
| P2-7 Billing | **Founder** (delegable) | Standard webhook-to-entitlement work |
| P2-8 Rate limiting and metering | **Founder** (delegable) | Infrastructure, not pedagogy |
| P2-9 Analytics | **Founder** (delegable) | Instrumentation |
| P3-15 Deduplicate pilot rows | **Either** | Needs care with asserted targets, not subject knowledge |
| ~~P1-4 Topic weakness signal~~ (done) | **Founder** | What counts as "weak" is a teaching judgement |
| ~~P1-5 Practice sets~~ (done) | **Founder** | Sequencing and difficulty ordering is the tutoring itself |
| P3-10 Hybrid retrieval | **Founder** | Requires knowing which topic and method distinctions actually matter |
| P3-12 Relevance benchmark | **Founder** | The automated proxy exists; only expert rating can validate it, and that rating is now founder-supplied |
| P3-13 Publication gate | **Founder** | A policy decision, not a feature |
| P3-14 Metadata review | **Founder** | Volume review work, the genuine bottleneck — and no longer buyable, so it bounds corpus growth directly |
| P3-16 Licensing position | **Founder + legal advice** | Not engineering |
| P4-17 Class-driven practice papers | **Founder** | Question selection is the tutoring judgement; rendering is delegable |
| P4-18 School-uploaded materials | **Founder** | The grounding-tier boundary is a product judgement; the upload path itself is delegable |

P0-2, P0-3, P1-4, P1-5 and the pilot shape of P1-6 are done. The remaining items
are well-specified enough that someone could pick up P1-6's successors — school
scoping in particular — from this document alone; the roles table, the roster
function and the staff gate they extend already exist. That remains true and
worth preserving, even though nobody is being hired to do it.

**The consequence of the 17 September decision, stated plainly:** every unbuilt
item is now serialised behind one person, in parallel with running a pilot. The
two review items (P3-12, P3-14) are the ones that suffer most, because they are
the only ones that could previously have been parallelised by paying people, and
they are what governs how fast the corpus grows. Sequence accordingly.

## Suggested order

~~P0-1~~, ~~P3-11~~, ~~P0-2~~, ~~P0-3~~, ~~P1-4~~, ~~P1-5~~ and the pilot
shape of ~~P1-6~~ are done.
Remaining, in order:

1. **P3-10** — recovers the 7–8% of questions that return no neighbours. Cheap,
   and it removes the one visibly thin spot in similar-question retrieval.
2. **P2-8, P2-7** — cost safety first, then revenue. P2-8 matters more than it
   did a day ago: every Check submission now also makes a second (small) model
   call to record the marks, so an uncapped free tier costs slightly more per
   student than it did.
3. **P1-6 (a) and (b)** — school scoping and the transparency notice. Both are
   prerequisites for letting real students and real teachers into the same
   database, and (b) is a few lines. The dashboard itself already exists.
4. **P2-9** — analytics.
5. **P3-12 … P3-16** — before the first serious procurement conversation. P3-12
   needs booked teacher time, so start arranging it earlier than you intend to
   do the work.
6. **P4-17** — after the pilot, and after P3-16. It needs attempt volume that
   does not exist yet, and its second half should not ship without the licensing
   position.
7. **P4-18** — after P1-6 (a), never before it. It is the strongest renewal
   argument in this document and the easiest one to damage by shipping early:
   without school scoping it is a data breach, and without visible grounding
   tiers it weakens the claim the whole product rests on.

**The open question that matters most now is not engineering.** The weak-topic
ranking works, but whether *mark ratio* is the right definition of "weak" for a
real student is a teaching judgement, and it has only been checked against
seeded numbers. The first cohort of real attempt data is what settles it — and
the evidence is deliberately stored alongside every figure so it can be argued
with rather than taken on trust.
