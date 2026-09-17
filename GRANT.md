# Grant application answers

> Programme: NUS School of Computing Venture Initiation Programme (VIP@SoC),
> USD 10,000 non-dilutive.
> Started 17 September 2026. One section per form question, in form order.
>
> **This file holds submitted and draft answer text only.** Reasoning, budget
> arithmetic and positioning decisions live in `FUNDING.md`; unbuilt work lives
> in `PENDING.md`. When an answer here depends on a decision, cite the decision
> rather than restating it, so the two cannot drift apart.
>
> **Before editing any answer, read `FUNDING.md` section 8 (money claims
> discipline).** Every sentence below was checked against it. The list forbids,
> among other things: revenue or signed schools, any usage figure that includes
> the six sample students, any ingestion throughput rate, voice or
> multi-language in a tense implying they exist, and describing school uploads
> as carrying the same grounding guarantee as official papers.
>
> Never put credentials, bank details or signed agreements in this file.

---

## Q1 — Summary in 4 bullet points (200 words max)

**As printed on the form:**

> Summary in 4 bullet points (200 words max) *
>
> - *What is the project about; what are you trying to achieve?*
> - *Who will benefit from it or what is the value proposition?*
> - *What is the innovation or competitive advantage over other solutions?*
> - *What are the key milestones for the project duration (12 months)?*

### Answer — 200 words exactly

- Shamo is an AI tutor for Cambridge IGCSE and A-Level mathematics. Students pick any past-paper question and get a hint, a worked explanation, or their attempt marked against the official mark scheme. Because it works only from papers we have processed, it cannot invent answers.

- Every question links to similar ones across the library. A student's mistakes reveal their weak topics, and Shamo draws practice from across it — a plan built from their own work. Teachers see what their class struggles with, and whether students are choosing wrong methods or slipping on arithmetic — but never read their conversations with the tutor.

- Others offer past papers as PDFs. We turn them into structured data — every question, part, diagram and mark separated and searchable — with a pipeline costing US$0.66 per paper. Library size is limited by funding, not ability. Schools will also be able to add their own homework and exams.

- Months 1–3: public launch, cost controls, each school sees only its own students. Months 4–6: first free three-month pilot in Malaysian international schools. Months 7–9: second pilot, case study published, paid subscriptions live, more papers added. Months 10–12: convert pilots to paid contracts, school uploads, enter Singapore.

### If the form's word counter rejects it

It is at the limit with no margin, and counters disagree about hyphenated ranges
(`Months 1–3`) and `US$0.66`. To reach 197 by any counting method, delete
**"case study published"** from the milestones and **"and searchable"** from
bullet three. Neither loss is material. Do not cut the privacy clause or the
cost-per-paper figure — they are the two lines doing the most work.

### Decisions embedded in this answer — do not undo them accidentally

| Wording | Why it is that way |
| --- | --- |
| Does not open "an AI tutor for Cambridge A-Level" alone | That is almost verbatim a 2024 winner of this same grant (Ekko, A-Level economics). The corpus/pipeline claim is what separates the first line from theirs |
| "official mark scheme", never "teaches to the mark scheme" | The latter reads to an education-literate reviewer as *teaching to the test*, which is a criticism |
| "choosing wrong methods or slipping on arithmetic" | Plain-English rendering of Cambridge M/A mark codes. Do not restore the jargon — a non-teaching reviewer cannot parse it |
| "but never read their conversations with the tutor" | The strongest single school-facing sentence available, and almost no competitor can say it. `FUNDING.md` section 7, 17 Sep, "the B2B case rests on a privacy line" |
| "Library size is limited by funding, not ability" | The surviving form of *corpus size is a budget decision, not an engineering one*. **Never attach a throughput figure** — the controller hard-caps at 6 papers per run, and review is unfunded founder time. See `FUNDING.md` section 7, 17 Sep |
| No corpus count in the box | 106 papers invites "only 106?". The figures belong wherever the form asks for current status, where they read as evidence rather than as a defensive aside |
| "Schools will also be able to add" — future tense | Unbuilt (`PENDING.md` P4-18). It may never be described as existing, nor as carrying the same grounding guarantee |
| Prerequisites sit in months 1–3 | Cost controls and per-school separation gate the free pilot and the upload feature respectively. A reviewer who knows schools looks for exactly these |

### Facts this answer commits us to

Recorded because they were decided while drafting it and are now in a submitted
document. Full versions in `FUNDING.md` section 7, 17 September.

- **Market:** international schools in Malaysia first, Singapore later.
- **Founder capacity:** part-time, alongside studies. Every milestone is sized
  against this.
- **Month-12 endpoint:** free three-month pilots completed, first paid contracts
  started.
- **Value proposition is two-sided** — teacher visibility plus cross-paper
  personalisation for the student. Shamo is deliberately *not* positioned
  against private tuition on price.
- **School uploads became a committed milestone**, which changed its status in
  `PENDING.md` P4-18 from roadmap to a funded deliverable. If the final quarter
  slips, this is the milestone to renegotiate — not the paid contracts, and not
  the pilot.

### Open before submission

- The `/dashboard` concurrency defect (`PENDING.md`, Known defects) still stands,
  and "public launch" is now a written commitment in months 1–3.
- Verify the platform URL resolves from a machine that is not the founder's
  (`FUNDING.md` section 7, 15 Sep).

---

## Q2 — What skills does your team possess to carry out this project?

**As printed on the form:** open free-text box, no stated word limit.

### Answer — 332 words

I am the sole founder. This project needs three things that rarely sit in one person — the engineering to build it, the subject knowledge to verify it, and the commercial experience to sell it. I have spent four years accumulating all three.

**Engineering.** I am a third-year Computer Engineering student at NUS, currently interning at a startup where I lead development of an AI customer-service chatbot — vector RAG over our knowledge base, connected by MCP to internal software so it can resolve specific order queries — the end-to-end hardware and software build of an IoT smart fridge that bills customers automatically for what they take, and internal Android apps that automate company processes. Shamo itself — ingestion pipeline, tutor backend, database and teacher dashboard — I built alone.

**Subject knowledge, which here is a technical requirement rather than background.** I have taught IGCSE and A-Level Mathematics and Physics for three years, over 1,000 hours. Shamo's accuracy depends on a human checking extracted questions against the official papers: reviewing 22 IGCSE papers, I found genuine mathematical errors in 7 of the 11 that had passed every automated check. No software catches those, and nor does an engineer who has not taught the syllabus. Teaching weekly also means the product answers problems I watch students and teachers have, not ones inferred from research.

**Commercial.** I have run a tuition business for four years — over 50 paying students, 150+ including workshops — hiring and managing five teachers and technical staff, running paid advertising and webinar funnels drawing 100+ signups, and negotiating with vendors while holding my price with customers. I also studied at a Malaysian international school, our first target market, where I know teachers and students; a demo with one of those teachers is booked this month.

**The gap:** I have never sold through a school's procurement process. Knowing teachers is not the same as knowing how a department buys, which is what the free three-month pilot exists to teach me.

### If it needs to be shorter

Cut "and internal Android apps that automate company processes" (8 words) first —
it is the weakest item in the strongest paragraph. Then the final clause of the
subject-knowledge paragraph (19 words). That reaches 305. Do **not** cut the
7-of-11 sentence or the Malaysian school sentence; they are the two doing the
most work.

### Decisions embedded in this answer — do not undo them accidentally

| Wording | Why it is that way |
| --- | --- |
| Opens "I am the sole founder" | The form says "team". Owning a solo structure and immediately reframing it as three skill sets in one person reads far better than letting a reviewer discover it |
| Teaching framed as "a technical requirement rather than background" | The strong version of domain expertise. Every edtech founder claims market insight; almost none can show their domain knowledge is what makes the *technology* correct |
| "7 of the 11 that had passed every automated check" | Specific and checkable (`CLAUDE.md`, 20 Aug source review). It also pre-answers why the budget has no paid content-review line — only a subject teacher can do that work |
| Chatbot described as "I lead development of" | It is **not live** as of 17 Sep 2026. Never write it in a tense implying deployment |
| "over 50 paying students, 150+ including workshops" | The tuition business is a separate entity from Shamo, so `FUNDING.md` section 8 does not restrict these figures. Shamo itself still has no revenue or paying users |
| "a demo with one of those teachers is booked this month" | One teacher, one booked meeting. **Never** upgrade this to a pilot, a partnership or a school (`FUNDING.md` section 8) |
| Malaysian school placed in the commercial paragraph | It is the only evidence in the application that the months 4–6 pilot has a route in. It answers market access, not sentiment |
| The gap is institutional procurement | True, adjacent to a strength (so it reads as precision, not weakness), and already mitigated by the pilot structure. Do not swap it for "I am a solo founder" — that is a gap with no stated mitigation |

### Facts this answer commits us to

- Third-year Computer Engineering, NUS. Still teaching weekly as of 17 Sep 2026.
- Shamo was built entirely by the founder — pipeline, backend, database, frontend.
- Tuition business: 4 years, 50+ paying students, 150+ including workshops,
  5 teachers plus technical staff hired and managed.
- Founder is an alumnus of a Malaysian international school and holds a teacher
  and student network there. This is the stated route into the months 4–6 pilot.

---

## Q20 — Have you or members of this team done similar project(s) previously?

**Yes.**

## Q21 — Please describe the purpose, scope and current status of previous project(s)

**As printed on the form:** *Highlight similarities and differences of the previous
project(s) to this current project.*

### Answer — 272 words

An AI customer-support chatbot at the F&B startup where I intern, on an architecture I designed and am now implementing. **Purpose:** resolve customer questions and complaints at scale. **Scope:** a Python/FastAPI agent using LangChain and AWS Strands that answers general questions from a vector database through a RAG pipeline, and customer-specific ones — order status, delivery problems — through MCP servers in PHP/Laravel reaching the company's internal software, inventory system and ERP. **Status:** architecture settled, core build underway, deploying on AWS AgentCore.

The similarity to Shamo is architectural, and it is a decision I made in both. Each system separates two kinds of retrieval because they have different truth conditions: semantic search over a vector database, where an approximate match is useful, and an exact authoritative lookup, where it is not. In Shamo, similar-question suggestions come from embeddings; a question's official mark scheme comes from a structured lookup that returns nothing rather than a guess. Both also need scoped access to private records — a customer's order there, a student's work here.

A tuition business, run for four years and still operating: 50 paying students and five teachers hired. Same subject, same syllabuses and the same customers Shamo is built for.

Two differences are worth stating. The chatbot reads a database the company already had, whereas Shamo had to build its corpus from official PDFs, which is the harder half of the problem. And the chatbot is agentic by design, while Shamo's tutor deliberately cannot act or fetch — a narrower architecture chosen because a support bot can escalate to a human, and a wrong mark scheme teaches a student something false.

### Decisions embedded in this answer — do not undo them accidentally

| Wording | Why it is that way |
| --- | --- |
| Leads with "an architecture I designed" | Designing the RAG/MCP split is a far stronger claim than implementing it, and the founder confirmed he designed it. Without this phrase the paragraph reads as assigned work |
| The similarity is stated as architectural, not "both use RAG" | Every applicant this cycle claims RAG experience. The transferable claim is the **two-truth-conditions split** — semantic search where approximation helps, exact lookup where it does not — and that the same person made that call in both systems |
| A quarter of the words go to differences | The sub-prompt asks for them, and they pre-empt the obvious reviewer thought: *if you already built this, why do you need the money?* The answer — the chatbot inherited its database, Shamo had to manufacture one — is exactly what the corpus budget funds |
| "deliberately cannot act or fetch" | Converts a restriction into evidence of judgement: a narrower architecture chosen for the risk profile, by someone simultaneously building an agentic system elsewhere |
| Company unnamed, sector given ("F&B startup") | Founder's choice, 17 Sep 2026. Enough to anchor "inventory system and ERP" without naming an employer or describing an unreleased internal system |
| Tuition business included, briefly | It is arguably the most similar previous project — same subject, syllabuses and customers — and it costs only three lines. 50 paying students; keep consistent with Q2 |

### Open before submission

- **Check the product name.** AWS's service is **Amazon Bedrock AgentCore**. If that is
  the deployment target, use the full name; a reviewer who works with AWS will notice.
- Not yet used anywhere, and available if a later question needs it: query volume at the
  F&B company ("at scale" is currently unquantified), whether other engineers are being
  led on the chatbot, and which vector database it uses.
