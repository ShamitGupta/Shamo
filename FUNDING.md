# Shamo — Funding Context and Decisions

> Created: 15 September 2026 · Last updated: 17 September 2026 (allocation reset
> by the founder, twice: figures set, then all external hiring ruled out;
> first traction facts recorded; differentiator settled and the programme's
> own past winners reviewed)
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

### Traction, stated at its real size (recorded 17 September 2026)

Two facts exist. Neither is a school, a user base or a commitment, and the
value of both depends on what is extracted from them **before submission**.

**A first teacher demo is booked for late September 2026.** One school teacher,
one meeting. It is the first time anyone outside the founder will use the
teacher dashboard. Call it "the first teacher demo, booked for <date>" and
never "a school pilot" — the specificity is the credibility, and one question
about student numbers punctures the larger phrasing.

Two things to do around it. Beforehand, confirm the sample cohort is intact
and labelled (`python backend_v2/tests/demo_cohort.py status`); the teacher
will be looking at six invented students and should be told so. Afterwards,
**ask for one written sentence, attributable by name and school.** A named
teacher saying the class view would change what they teach is worth more than
any other evidence currently obtainable, and it costs one email.

**One technical risk threatens this specific meeting, and it is already known.**
Opening `/dashboard` fires two concurrent requests — the roster from
`TeacherDashboard.jsx` and the class overview from its child `ClassOverview.jsx`,
each in its own effect. `PENDING.md` records that paired concurrent requests fail
roughly one time in four with a spurious 401 or 503, which in a browser reads as
being signed out. So the first screen of the first external demo carries about a
one-in-four chance of opening on an error. It is recorded here rather than only in
the engineering documents because it puts the sole pre-submission traction event
at risk. Sequencing the two fetches is a small change; the underlying fix (a
database client per request) is needed before any cohort regardless.

**A pre-prototype launched in May 2026 and drew strongly positive feedback.**
Qualitative: no user count, no written quotes, no attribution recorded
anywhere. It also predates nearly all of the product — the corpus completed in
August, and memory, practice sets and the teacher dashboard all shipped
15–16 September.

So it is evidence that **the problem is real**, not that the product works.
Used that way it is worth a line; used as product validation it invites a
question that cannot be answered. Before it enters any deck, recover what is
recoverable: how many users, who they were, and one quotable sentence. An
unquantified "really positive feedback" reads to a committee as padding and
weakens the measured claims sitting next to it.

---

## 2. The grant being applied for

| | |
| --- | --- |
| Amount | **USD 10,000** |
| Type | Grant (non-dilutive) |
| Status | In preparation — pitch deck being written |
| Purpose | Close the gap between a working prototype and a sellable product |

**What the grant is mostly not for:** building more corpus by machine. At roughly
66 cents per paper, compute is cheap; the binding constraint is expert human
review and the product work in `PENDING.md`.

Read that alongside the $1,000 compute line in section 5, which the founder set on
17 September. The two are consistent, and the consistency has to be stated or the
document contradicts itself in front of a reviewer: **staging a paper and
publishing it are separate steps in this pipeline.** Compute stages; review
publishes. The compute line therefore buys the *option* on a much larger corpus —
enough to stage the entire remaining back-catalogue of both syllabuses and move
into further ones — while review still sets how fast any of it becomes
student-visible. **Since 17 September that review is founder-supplied and
therefore unfunded**, which makes the throttle tighter, not looser. See "Corpus
expansion" in section 5.

### What this programme has funded before — reviewed 17 September 2026

Read the published winners list for this award (~150 projects across 21 cohorts,
2014 to April 2026). Three findings shape how the application should be written.

**It is not a scarce prize.** Six to eleven teams are funded per semester, twice a
year. "Unique" therefore cannot mean *category-novel* — it has to mean
*mechanism-unfamiliar*. A reviewer must not be able to file Shamo next to
something they funded last year.

**Education is the most recurring vertical on the list** — roughly 20 of ~150
projects. That is reassuring rather than alarming: the category is demonstrably
fundable. But **the two most recent cohorts contain no education projects at
all**, so the field is not crowded right now either.

**Four prior winners sit close enough to matter, and each dictates a phrase to
avoid:**

| Winner | Their one-line description | What it forbids |
| --- | --- | --- |
| **Ekko** (Oct 2024) | "AI tutor project designed specifically for A-Level economics students in China" | Never open with "an AI tutor for Cambridge A-Level maths" — that is their sentence with one noun changed |
| **Teebloc** (Oct 2024) | "uses LLM to automate sorting of past exam questions into topics"; also a real operating company selling custom worksheets built from past-year questions | Never present corpus ingestion *alone* as the novelty. "LLM + past papers" is occupied, and commercially proven |
| **Plio** (May 2025) | "AI-powered study platform for secondary students", personalised learning, with real traction | Avoid "personalised" as the headline. They own it here and have usage figures Shamo cannot match |
| **Evalumate** (May 2025) | "automates grading, feedback and performance analytics" | Do not describe the teacher dashboard as *analytics*, and do not lead on mark-level feedback quality |

**The most useful structural finding: all four sell to students or parents.**
Only three education winners in the programme's entire history were school-facing.
So the B2B decision of 15 September is not only a commercial choice — it is the
cleanest available escape from the category collision. Pitching to departments
puts Shamo somewhere the reviewers have essentially not been.

### Funding constraints — confirmed 15 September 2026

1. **Salary is disallowed.** The grant does not fund the founder's own time.
2. **No evidence exists for what a school pilot costs** in this market. Handled
   below by not carrying an unsupportable line item.

**Consequence, and it is the organising principle of the whole budget:** the grant
can only buy **capacity the founder cannot supply himself**. Every line in the
allocation must be a third-party cost — services, compute, licences or advice —
not founder effort recategorised.

### Constraint added 17 September 2026 — no external hiring

**The founder does not want to contract or hire anyone.** All people-cost lines
were removed from the allocation on 17 September: contracted engineering ($1,800)
and contracted content review ($1,600) are gone, and the grant now buys **only
services, compute, licences and advice**. Every remaining line is a supplier
invoice, not a person.

This tightens constraint 1 rather than relaxing it, and the consequence has to be
faced squarely rather than discovered by a reviewer:

**All labour on this project is now founder labour, and founder labour is
unfundable.** That is permitted — nothing requires a grant to fund every input —
but it means the grant buys *what the work runs on*, never the work. Two things
follow, and both are stated where they bite:

- **Engineering throughput is now bounded by one person's time.** `PENDING.md`
  still lists billing, metering, school scoping and analytics as unbuilt. They are
  now founder work, on founder time, and no line in this budget accelerates them.
- **Expert review is now bounded the same way.** It remains the binding constraint
  on corpus growth, and it is now supplied by the founder — which is credible,
  since four years teaching this syllabus is exactly the qualification the work
  needs, but it is one person's hours against a corpus that compute can stage far
  faster than he can check. See "Corpus expansion" in section 5.

**Say this plainly in the application rather than leaving it to be inferred.** A
single-operator delivery plan is not a weakness on its own — the 15–16 September
record shows the founder shipping persistence, attempt recording and a teacher
dashboard in two days — but a budget with no labour in it and an ambitious
delivery schedule invites the question of who is doing the work. Answer it first.

### Still open

- **Grant-specific reporting requirements.** Some grants require milestone
  reporting, which should shape how the allocation is described and phased.
- **Whether the grant programme permits an unallocated reserve line at all.** Many
  explicitly do not. This now matters directly — see "Reserve" in section 5.

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
>
> **Engineering line re-pointed 17 September 2026.** The work it originally named —
> conversation persistence (P0-2), attempt recording (P0-3) and the teacher
> dashboard (P1-6) — was built by the founder on 15–16 September and is now live.
> It now buys school scoping, billing, metering and analytics: **work that does not
> yet exist, which is the only version of this line a committee can be asked to
> fund.**
>
> **Allocation reset 17 September 2026, by the founder.** Three figures were set
> directly — pilot delivery **$3,000**, corpus expansion **$1,000**, marketing
> **$1,000**.
>
> **Reset again the same day, and more fundamentally.** Both contracted-people
> lines were judged a bad use of the money and removed outright: **contracted
> engineering ($1,800) and contracted content review ($1,600) are gone**, freeing
> $3,400. The founder set **feature expansion at $2,000**, and the remaining
> **$1,400 is held as a reserve** against overrun elsewhere. See the new constraint
> in section 2: the grant now buys only services, compute, licences and advice,
> and **all labour on the project is founder labour and unfunded.**

| Allocation | What it buys, specifically | Amount | Share | Maps to |
| --- | --- | ---: | ---: | --- |
| **Pilot delivery** | Tutoring inference and animation rendering for schools using Shamo **free of charge** during the pilot | $3,800 | 38% | — |
| Feature expansion | Third-party services behind new capability — speech-to-text and text-to-speech for voice mode, inference and translation for additional languages, any paid SDK or licence | $500 | 5% | Roadmap, not `PENDING.md` |
| Reserve | Held against overrun in the lines above, released only into a named one | $1,400 | 14% | — |
| Corpus expansion — API compute | Staging the remaining back-catalogue of both syllabuses and further syllabuses, at measured cost | $1,700 | 17% | — |
| Infrastructure and services, 12 months | Supabase Pro, monitoring and error tracking, email, anything beyond what the founder covers directly | $1,000 | 10% | P2-9 (the tooling itself) |
| Marketing and school outreach | Sales materials, demo video, a case study from the pilot, outreach tooling | $1,000 | 10% | — |
| Legal and licensing advice | A written position on past-paper use, before procurement asks | $600 | 6% | P3-16 |
| **Total** | | **$10,000** | **100%** | |

**Every row is now a supplier invoice.** No line pays a person, because the
founder does all the work and his time is not fundable. Read the table as *what
the product runs on for twelve months*, not as *what gets built* — what gets built
is `PENDING.md`, delivered on founder time.

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

Two corrections to that arithmetic before it is quoted. **A Check submission is
now two model calls, not one** — a small `gpt-5.4-nano` pass reads the finished
reply and records which marks were attributed (built 15 September). It is a
fraction of the turn it follows, but it is per-submission and it is real.
Pulling the other way, **similar questions, weak topics and practice sets cost
nothing per call** — they read stored embeddings and SQL, and make no model call
at all. Exclude them from the per-student figure or it comes out pessimistic.

What could make it genuinely large is **animation rendering**, which is compute
rather than API: renders are synchronous, 35–60 seconds, and memory-heavy enough
that the deployment caps a container at 3 GB. Heavy Visualize use across a cohort
needs real hosting capacity.

**So: measure one tutoring session's cost before submitting.** If the true figure
is materially lower, move the difference into feature expansion or marketing
rather than carrying a line you cannot defend. A committee that probes an inflated
line damages every other number in the budget.

**Second, do not run a free pilot without usage metering in place.** `PENDING.md`
P2-8 is listed under P2, but it is effectively a **prerequisite for the pilot**:
nothing currently caps what a single user can spend on the project's API key. An
uncapped free tier across several hundred students is how a grant disappears.

Stated correctly, this becomes a strength rather than a risk: **"pilot inference is
budgeted at $3,000 and enforced by per-user rate limits."** A capped cost is
fundable even when it is not yet precisely measured. An uncapped one is not.

### Corpus expansion — what $1,000 buys, and what it does not

Raised from $400 on 17 September. At the measured $0.66 per paper this is **roughly
1,500 papers of compute** — and the entire remaining back-catalogue of both current
syllabuses (9709 and 0606, 2020–2023, on top of the 2024–2025 already published) is
on the order of 200 papers, or about $140. So the line is not sized for the known
backlog. It is sized to **stage the backlog several times over and move into
further syllabuses** — Further Mathematics, IGCSE Mathematics — without returning
for more money.

Two reasons that is honest rather than padded, and both should be said aloud
rather than waited for:

1. **$0.66 is a floor, not a measurement.** The ledger under-records retried
   stages and omits Mistral OCR entirely (section 3). Real per-paper cost is
   higher by an unknown factor, so a compute line with headroom is the
   conservative choice, not the generous one.
2. **Staging and publishing are separate steps.** The pipeline stages a paper to
   `awaiting_review` and publication is a distinct gated transaction. Compute
   buys staged papers; it does not buy published ones.

**The caution, and it is the whole point of this subsection — and it got sharper
on 17 September, not softer.** Do not let anyone read $1,000 as *1,500 more papers
available to students*. The publishable rate is set by review, review is not a
skim, and **review is now entirely founder time**: the $1,600 line that used to
fund subject teachers was removed the same day this line was raised.

How much review each staged paper actually needs is a matter of record here. When
all 22 IGCSE papers were checked against the source PDFs, **real content defects
were found in the large majority — including in 7 of the 11 that had passed every
automated structural check.** Dropped exponents, a dropped square root, a
fabricated notation, a wrong final answer. One paper in 22 needed nothing.

So the honest line is: **compute stages, the founder publishes, and the founder is
the throttle.** Staged-but-unreviewed papers are not a product; they are inventory.
Say what the funded compute is for — removing the ingestion cost from the critical
path so review can run continuously, against a corpus already waiting rather than
one being fetched — and give the application a realistic publication rate in
papers per month, not a corpus size.

**If the committee pushes back on this line, it is still the right one to
concede**, but the money now has nowhere better to go inside the eligibility
rules, since review cannot be bought back. Move it to feature expansion or the
reserve, and say why: the constraint it would have relieved is one the grant is
not permitted to fund.

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

### Feature expansion — what $2,000 can and cannot buy

Set by the founder on 17 September, for voice AI and additional languages.

**It can buy the services those features run on.** Speech-to-text and
text-to-speech inference, per minute of audio; model inference and translation for
delivering the tutor in a second language; any paid SDK or licence the capability
depends on; the evaluation runs needed to show it is safe on mathematical content.
All of those are supplier invoices, which is what makes them eligible.

**It cannot buy the building of them.** The founder writes the code, and founder
time is disallowed. Describe this line as *running cost and licensing for new
capability*, never as *development of new capability* — the second phrasing
invites the reviewer to read it as salary by another name, which is the one thing
the constraints explicitly forbid.

**Three cautions before it goes in the application.**

**Voice is not built, and this document must never imply it is.** `PENDING.md`
puts voice mode explicitly out of scope for grant-readiness, and the roadmap in
`CLAUDE.md` describes what it would need — transcription, interruption, visual
confirmation, consent and deletion controls — none of which exists. This is
therefore the only line in the budget funding a capability the prototype cannot
demonstrate. That is legitimate for a grant closing the gap to a sellable product,
but it must be presented as **planned capability with a funded running cost**, and
never in the same breath as the features a reviewer can click.

**Voice on mathematics is genuinely hard, and the difficulty is on-brand.** This
project's whole claim is notational fidelity; dictating and reading back
mathematics is where that claim is most easily broken. The honest framing is that
the corpus and mark-scheme grounding are what make an equation-aware voice mode
plausible here and implausible for a general chatbot — but budget for evaluation,
not just for inference.

**Additional languages touch the corpus, not just the interface.** Translating the
tutor's explanations is inference. Translating or re-rendering Cambridge question
content is a licensing question as much as a technical one, and it belongs in the
conversation the legal line already funds. Do not present multi-language as a
purely front-end change.

### Reserve — how to present $1,400 without it being struck out

Set by the founder on 17 September to absorb overrun elsewhere. The intent is
sound: this budget carries at least two genuinely unmeasured numbers — pilot
inference and Manim rendering capacity — and a plan with no slack in it is a plan
that breaks on contact.

**The risk is presentational, and it is real.** Many grant programmes disallow an
unallocated contingency line outright, and some reviewers treat one as padding or
as a sign the other figures were not worked out. A bare "backup funds — $1,400"
is the version most likely to be struck out, and striking it out takes 14% of the
award with it.

**So do not present it bare.** Three things make a reserve survive review:

1. **Name what it is held against**, in order: pilot inference above the modelled
   figure, hosting capacity for animation rendering under real cohort load, and a
   Supabase plan change if usage forces one. All three are named as unmeasured
   elsewhere in this document, which makes the reserve consistent with the rest of
   the budget rather than an exception to it.
2. **State the release rule.** Reserve money is released only *into an existing
   line*, never spent as its own category, and every release stays within the
   eligibility rules — services, compute, licences and advice, never labour.
3. **Say what happens if it is not needed.** The honest answer is corpus expansion
   and further evaluation, both already-eligible lines that scale smoothly.

**Check the programme's rules before submitting.** If it forbids a reserve,
distribute the $1,400 across pilot delivery and feature expansion — the two lines
whose true cost is least certain — rather than dropping it, and keep the
contingency reasoning in the narrative where it reads as foresight.

### Why this allocation, and how to defend it

**The founder does the work; the grant buys what the work runs on.** After
17 September there is no labour in this budget at all. Retrieval quality, prompt
behaviour, mark-scheme fidelity, review against source PDFs and every remaining
`PENDING.md` item are founder-supplied and unfunded. What the grant pays for is
inference, rendering, storage, subscriptions, licences and one piece of legal
advice.

**That is a coherent position, and it should be stated as a choice.** The founder
has already shown what his own time delivers — persistence, attempt recording and
a teacher dashboard built in two days over 15–16 September, from the written spec
in `PENDING.md`. The argument is therefore: *the scarce input here is not
engineering capacity, it is the running cost of putting a working product in front
of schools, and that is exactly what this budget buys.*

**The weakness to pre-empt, because a reviewer will find it.** `PENDING.md` lists
billing, metering, school scoping and analytics as unbuilt, and metering in
particular is a prerequisite for opening a free pilot. With no funded engineering,
every one of those now sits on one person's time, in parallel with running the
pilot itself. **Give the application a sequence rather than a list** — metering and
the student transparency notice before any cohort joins, billing before any
revenue, school scoping before a second school — so the plan reads as ordered
rather than merely intended.

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

### 17 September 2026 — the continuity half is now built, and the framing shifts with it

Supersedes the framing immediately above, without contradicting it. The 15
September entry described continuity (memory, diagnosis, planning) as the missing
half. **It shipped over 15–16 September**: conversations and attempts persist, a
Check reply's attributed marks are recorded, topics are ranked by mark ratio with
practice sets on top, and a teacher sees the class's weakest topics and where the
marks are being lost.

Three consequences for the deck.

1. **The demo is no longer a single question.** A reviewer can now be shown a
   saved thread, a topic ranking built from the student's own attempts, and a
   practice set — which is the claim the deck leads with, now clickable.
2. **"Continuity is ordinary engineering" is now evidence, not a promise.** It was
   forecast on 15 September and delivered in two days. Say that; it is a stronger
   statement about execution than about the feature.
3. **Do not overclaim what it means.** What is stored is *which marks were
   missed*, not *why* — misconception tracking is not built. And whether mark
   ratio is the right definition of "weak" has been checked only against seeded
   numbers, never a real cohort. The first pilot settles it; until then say the
   evidence is stored beside every figure so a teacher can disagree with it.

The bottleneck therefore moves: what is missing is no longer tutoring capability
but the **commercial and operational layer** — billing, metering, school scoping,
analytics. That is precisely what section 5's engineering line now buys.

### 17 September 2026 — the differentiator is the pipeline, not the tutor's behaviour

Sharpens the 15 September "corpus network" entry rather than replacing it. Three
candidate headlines were tested against four questions — is it true, is it hard to
copy, can a reviewer verify it in the room, and is it unclaimed by a prior winner.
The founder rejected two.

- **"It cannot invent an answer."** True and structural, and still the hardest
  property to reproduce. Rejected as the *headline*: it is a negative, a reviewer
  must take the architecture on faith, the demo is a refusal, and to anyone who
  knows the term it reads as ordinary retrieval-augmented generation. **Demoted to
  the moat slide** — it is the reason the data can be trusted, not the reason to
  want it.
- **"It marks with the examiner's own M/A/B codes."** Rejected by the founder as
  too close to Evalumate. The mechanism genuinely differs — reading official
  Cambridge mark schemes across a corpus is not grading submitted work — but a
  differentiator that needs three minutes to separate from a previous winner is
  not a differentiator. **Demoted to a layer of the corpus**, which also removes
  the collision: the pitch becomes the data underneath, not feedback quality.
- **Accepted: the pipeline that produces the corpus.** Not the corpus as an asset
  — an asset invites *"so does Teebloc, so does every tuition centre's filing
  cabinet."* The claim is a repeatable machine that converts past papers into
  structured, verified, teachable data: 106 papers into 958 questions, 1,795
  parts, 7,663 mark-scheme rows, 219 diagrams and 2,596 embeddings, at 66 cents a
  paper. Most "past paper" products hold PDFs or cropped images. This is a
  different kind of object, and it is what every feature reads from — tutoring,
  similar questions, practice sets, weak topics, the class view.

**Why this one carries the weight:** it is the actual engineering (parser,
validator, targeted repair, budget reservation, offline harness); it has been
proven **twice**, since IGCSE 0606 was a second campaign through a parameterised
pipeline rather than a fork, and both syllabuses are servable side by side today;
it compounds, because each syllabus improves retrieval across the whole corpus;
and it is cheap in the resource that is easy to buy (compute) and expensive in the
one that is not (expert review). It also makes the $1,000 compute line coherent —
that money buys inventory *because the factory exists*.

**Two commitments that come with leading on it.** First, **licensing moves to
slide two**: the moment the corpus is the pitch, "what right do you have to this
content commercially?" becomes the obvious next question rather than a later
procurement one. Section 5's $600 legal line and `PENDING.md` P3-16 exist for
this, but a one-paragraph answer is needed in hand before presenting this way.
Second, **do not let "more subjects" become a schedule** — compute stages, review
publishes, and review is founder time. Quote a publication rate in papers per
month, never a corpus size.

### 17 September 2026 — the claim boundary: Cambridge, two syllabuses, mathematics

Checked against the code on 17 September after a draft of the line above claimed
"any exam board". It does not hold, and the overclaim was removed.

**What is parameterised** (`workflows/n8n/lib/campaigns.mjs`): sheet,
qualification, syllabus code, subject, grade label, years, taxonomy version,
repair budget, output filenames. A new syllabus is a configuration entry.

**What is Cambridge-specific in code, in four places:** the mark-code grammar
(`*M1`/`M1*` dependency markers, `A1FT`/`A1 FT` follow-through, `DM1`/`DA1`/`DB1`,
banded `B2,1,0`, doubled `B1 B1`, `SC` sentences — every parser comment cites a
real 9709 or 0606 paper); the taxonomies, which are literally named `9709-v3` and
`cambridge-igcse-0606-v1`; the paper-domain map keyed on Cambridge component
digits; and the expected-total-marks rule, an explicit `if 9709 … else if 0606 …
else throw`. A third board needs engineering, not configuration.

The corpus is also **mathematics only**, so "different subjects" is unproven on
two axes rather than one.

**The honest expansion gradient, which should be stated rather than waited for:**
another Cambridge maths syllabus (9231, 0580, 0607) is a config entry plus a
taxonomy plus review — cheapest, and the path that fills the product out; another
Cambridge subject carries the conventions but not the taxonomy or marks logic —
moderate; another board is real engineering.

**And the reframe that turns the limit into an argument:** the parser is
specialist, not generic. It knows that one 9709 paper prints two marks as `B1B1`
in a single cell and another prints a bare `DA1`, because someone read those
papers when the pipeline got them wrong. A board-agnostic parser would be *worse*
at Cambridge. Depth in Cambridge is also not a small market — identical papers and
mark schemes are sat in international schools across dozens of countries.

### 17 September 2026 — the B2B case rests on a privacy line, not on analytics

The strongest school-facing asset is one sentence, and it was not being used:
**a teacher sees the work handed in, not the asking for help.** Submitted working,
questions practised and topic performance are visible; the student's conversations
with the tutor are not, enforced at the query and asserted against the serialized
response body in `test_staff_access.py`. A Head of Department and a data
protection officer both understand it immediately, and almost no edtech product
can say it, because almost none decided it before selling.

Pair it with what the class view answers — *what do I teach on Monday*, via topics
ranked by the headcount struggling and a method-versus-accuracy split — rather
than with the word "analytics", which is Evalumate's territory.

**Unchanged and still binding:** the dashboard is not scoped per school
(section 8), and students are not yet told a teacher can see their activity
(`PENDING.md` P1-6 (b)). Describe the access model as pilot-shape, and do not let
the privacy line above imply a completeness the successor items have not yet
delivered.

### 17 September 2026 — the application summary, and four answers it forced

Writing the programme's 200-word summary settled four things that had been open,
and produced one claim that had to be cut.

**Market: international schools in Malaysia first, Singapore later.** Recorded
here because every earlier document said "schools" without saying where. It also
explains the pilot line: a Malaysian cohort is reachable and the schools teach the
exact two syllabuses already published.

**Capacity: part-time, alongside studies.** This is the single most important
number for judging every milestone in this file, and it was never written down.
Milestones must be sized against it — one pilot wave, then a second, rather than
three concurrent schools.

**Month-12 endpoint: free three-month pilots completed, first paid contracts
started.** Tight against a 6–12 month procurement cycle, which is why the free
pilot has to open in months 4–6 and therefore why metering, the transparency
notice and school scoping have to land in months 1–3.

**The value proposition is two-sided, and neither side is "cheaper than a
tutor".** This closes the open question at the end of this section. For the
teacher: knowing which topics their students struggle with and how much they
practise. For the student: **the links between papers** — attempts on one paper
identify weak points and pull targeted practice from every other. That
cross-paper relationship is the student-facing form of the corpus argument, and
it is the thing no competitor holding PDFs can do at all.

**A new roadmap item entered the pitch: schools upload their own materials**
(homework, internal exams) and Shamo grounds on those too, with the official
corpus as the base layer. Commercially it is the strongest renewal argument
available — a department that has loaded three years of its own exams does not
switch. Written up as `PENDING.md` P4-18, with the boundary that must be stated
alongside it: it cannot use the Cambridge ingestion pipeline, and **the "cannot
invent an answer" guarantee does not extend to material with no mark scheme**, so
the product has to show which grounding tier a question sits on.

### 17 September 2026 — corpus size is a budget decision: the defensible version

The founder's framing is right and is now in the application: **the constraint on
corpus size is funding, not capability — the pipeline already exists.** This
reframes "only 106 papers" from a weakness into the direct justification for the
$1,000 compute line.

**One version of it was cut, because it does not survive a follow-up.** A draft
claimed the pipeline could reach 1,000 papers in a day given funds. It cannot, on
two independent grounds, and both are in this repository:

1. **Throughput.** `build_budget_batch_workflows.mjs` sets `max_papers_per_run: 6`
   and **throws** if anyone raises it past 6 — a safety stop in code, not a
   default. Papers run sequentially with a ten-minute pause after the fifth.
   Demonstrated rate is the 22 IGCSE papers over parts of three days, including
   manual recovery. Parallelising is real engineering, and operating-plan item 13
   (a single paper's failure aborts the whole batch) has to be fixed first.
2. **Review, which is the harder one.** Staging is not publishing. The IGCSE
   source review found genuine mathematical defects in **7 of the 11 papers that
   passed every automated check**. Review is founder time and no longer buyable.
   A thousand staged papers is a thousand papers queued behind one part-time
   person.

**The wording that keeps the strength and survives scrutiny**, and the only one
that should be used externally: *"Corpus size is a budget decision, not an
engineering one — 106 papers is what we have funded, not what we can process."*
True, checkable, and it still does the whole job. Never attach a throughput figure
to it, and never quote a target corpus size; quote a publication rate in papers
per month, per the claim-boundary entry above.

### 17 September 2026 — pitch deck: reallocation, competitor set, and a currency problem

Planning the seven-slide deck against a previous winner's deck (UnpackAI, supplied
by the founder) produced four decisions and one unresolved problem.

**UNRESOLVED, AND IT AFFECTS EVERY FIGURE IN THIS FILE: the award may be SGD, not
USD.** The winning deck's budget table reads **"Usage of S$10,000 VIP Award"** and
totals S$10,000. This file has recorded USD 10,000 throughout. If the award is
Singapore dollars, every allocation below is overstated by roughly a third in real
terms. **Confirm against the programme's own terms before the deck or the budget
slide is built**, and restate the whole of section 5 in the right currency.

**Reallocated at the founder's direction**, after the deck plan flagged that 20% of
the award going to capabilities the prototype cannot demonstrate sits badly beside a
deck whose entire strength is a working product. Feature expansion **$2,000 → $500**;
pilot delivery **$3,000 → $3,800**; corpus expansion **$1,000 → $1,700**. Reserve,
infrastructure, marketing and legal unchanged. Reconciles to $10,000 / 100%.

**One tension this creates, recorded rather than smoothed over.** This file's own
"Corpus expansion" subsection argues compute is the line to concede, because
**review — not compute — is what throttles publication**, and review is unfunded
founder time at part-time capacity. Raising compute to $1,700 buys roughly 2,575
staged papers at $0.66 against a known backlog of about 200. The defensible reading
is that this is *inventory bought once*, not a throughput promise; the alternative
split of **pilot $4,000 / corpus $1,500** is stronger on that argument and remains
available. Either way, **quote a publication rate in papers per month, never a
corpus size.**

**The competitor set, supplied by the founder:** MathGPT.ai, "rubber-duck" Socratic
AI tutors (the CS50 Duck being the known instance), and general AI solvers such as
DeepAI. Deliberately **excludes Teebloc and Evalumate** — both are past winners of
this same programme, and explaining on a slide why you beat something the panel
funded is a risk with no upside. MathGPT.ai is the serious one: it is instructor-led,
curriculum-aligned to textbooks, Socratic, "cheat-proof", and it already has voice
interaction and generated animated explanations. **The separation is not features —
it is that it is aligned to textbooks, not to an exam board's own past papers and
published mark schemes.** Do not claim a capability lead over it.

**Market sizing will be bottom-up from Cambridge's own published data, not a TAM.**
Researched 17 September: Cambridge released June 2025 results to **over 680,000
students**, on **nearly 1.7 million entries**, from **5,507 Cambridge International
Schools across 149 countries**, with schools making entries up 38% over five years.
**Malaysia alone: over 70,500 entries in June 2025.** Malaysia holds roughly 348
international schools serving about 111,185 students (ISC Research, July 2024).
The private-tutoring TAM figures found in the same search were mutually
inconsistent — one report puts Malaysian K-12 online tutoring at $5.04bn while
another puts *all* of Asia-Pacific private tutoring at $13.56bn, which cannot both
be true. **Do not cite them.** A verifiable bottom-up count from the exam board is
both more honest and more persuasive to a reviewer who has seen a hundred TAM
slides.

**Two deck decisions also settled:** the teacher-dashboard screenshot is cropped to
the class-level panels, so no sample-student names or badges appear; and the
prototype gets its own slide, because the benchmark deck's equivalent slide proposes
a proof-of-concept that does not exist yet, and the contrast is the strongest single
move available.

### Open positioning question

Against private tuition, two available lines, not interchangeable:

- *"Cheaper than a tutor"* — invites a price race and cannibalises Shamo Classes.
- *"The other 165 hours of the week"* — truer to what is built, and positions the
  product alongside tuition rather than against it.

**Resolved 17 September 2026, and the founder chose neither.** Shamo is not
positioned against private tuition at all. The value proposition is stated
two-sided — what a teacher learns about their class, and the cross-paper
personalisation a student gets — which sidesteps the price comparison entirely
and protects Shamo Classes. Keep *"the other 165 hours of the week"* in reserve
as an answer if a reviewer raises tuition directly; do not lead with it.

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
- **Any usage figure taken from the current database without excluding the six
  labelled sample students** (`shamo_profiles.is_sample = true`). They hold most
  of the recorded attempts.
- That the teacher dashboard is scoped per school. It is not — any account with
  the invite code can currently read every student (`PENDING.md` P1-6 (a)).
  Demonstrate it freely; describe it as a pilot-shape access model.
- **Voice mode or multi-language support, in any tense that implies they exist.**
  The feature-expansion line funds their running cost; neither is built, and
  `PENDING.md` puts voice explicitly out of scope for grant-readiness. "Funded to
  build" is true. "Available" is not.
- **Any delivery date that assumes funded engineering.** There is none — all build
  work is founder time. Give a sequence, not a schedule.
- **The September teacher demo as a pilot, a partnership or a school.** It is one
  teacher and one booked meeting (section 1). Until it happens it is a date; after
  it happens it is one teacher's opinion unless they put something in writing.
- **The May 2026 pre-prototype feedback as evidence the product works.** It was a
  much earlier build and the feedback is unquantified. It evidences demand only,
  and should be described as an earlier version every time it is mentioned.
- **That the ingestion pipeline works for "any exam board".** It is proven on
  Cambridge only, two syllabuses (9709, 0606), mathematics only. The mark-code
  grammar, taxonomies and paper-domain map are Cambridge-specific in code; a new
  board is engineering, not configuration.
- **Any ingestion throughput figure** — "1,000 papers in a day", or any papers-
  per-hour rate. The controller hard-caps at 6 papers per run and throws above it;
  the demonstrated rate is 22 papers over parts of three days. Say *"corpus size is
  a budget decision, not an engineering one"* instead — it makes the same point and
  is true.
- **School-uploaded materials, in any tense that implies they exist.**
  `PENDING.md` P4-18, unbuilt and hard-blocked on school scoping. It may be
  described as roadmap. It may **never** be described as carrying the same
  grounding guarantee — material with no mark scheme cannot support mark-level
  teaching, and blurring that dilutes the one claim the product rests on.

---

## 9. Maintenance

Update this file when: an application is submitted or decided; any external funding
is received; the allocation changes; a cost per active student is first measured;
or a positioning decision in section 7 is revised. Add dated entries rather than
rewriting history, and keep the decision log append-only.
