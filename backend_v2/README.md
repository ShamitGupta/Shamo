# Shamo tutor API

Source-grounded tutoring over the reviewed past-paper corpus. Replaces
`backend/`, which is a prompt prototype against the old unnormalized tables.

## The one property that matters

**The tutor cannot answer without source content.**

The legacy service looks a question up, gets nothing when it misses, concatenates
two empty strings, and hands them to the model — which answers anyway, fluently
and from memory. A student asking about a paper we do not have gets a confident
invention.

Here, retrieval and generation are separate modules. `repository.py` is the only
code that reads the database and never calls a model; `tutor.py` only turns a
context into tokens and has no way to fetch anything. A miss returns an explicit
404 naming what was searched for. There is no code path from a failed lookup to
a model call, and `test_model_is_never_called_without_context` asserts it.

## Endpoints

| | |
|---|---|
| `GET /health` | liveness |
| `GET /papers` | every published paper and the question numbers it holds |
| `GET /papers/{year}/{session}/{variant}/questions/{n}` | full question context, or 404 |
| `POST /chat` | streamed tutoring |

The catalogue exists so the UI can only offer what is published. The legacy
frontend lists years to 2024 regardless of what is behind them, so a student can
pick a paper that does not exist — removed here by construction.

`/chat` re-retrieves the question server-side from the reference alone. The
client never supplies question content and so cannot put words in the source.

## Modes

Three modes, differing in what they may **reveal**, not in tone. That makes the
difference testable.

- **hint** — name the technique, one line of setup, then stop. Must not state the
  answer to any part.
- **explain** — full method, ordered by how the mark scheme awards marks, ending
  with the printed answer and its required accuracy.
- **check** — diagnose the student's own working: which marks it earns, where the
  first error is, and whether follow-through still applies.

All three see the same mark scheme. Withholding it from hint mode would make it
guess, which is worse than trusting it to stay quiet.

## Setup

```bash
cp backend_v2/.env.example backend_v2/.env    # then fill it in
pip install -r backend_v2/requirements.txt
```

`SUPABASE_SERVICE_ROLE_KEY` must be the **service role** key. The `shamo_*`
tables have RLS on with no anon policies, so the anon key returns nothing. That
key must never reach the browser, which is the reason this service exists rather
than the frontend querying Supabase directly.

```powershell
.\backend_v2\run.ps1
```

Or directly — note the directory, `backend_v2` and not `backend`:

```bash
cd backend_v2 && python -m uvicorn app.main:app --reload --port 8000
```

### Two Windows papercuts

**`WinError 10013: socket ... forbidden by its access permissions`** reads like a
permissions problem and almost never is. It means the port is already taken,
usually by a server you started earlier that did not shut down. Find it with:

```powershell
Get-NetTCPConnection -LocalPort 8000 -State Listen | Select-Object OwningProcess
```

`run.ps1` checks this first and names the process.

**`fastapi dev` crashes with `UnicodeEncodeError: '\U0001f680'`.** It prints a
rocket emoji and the default console encoding is cp1252. It works with:

```powershell
$env:PYTHONIOENCODING = "utf-8"; fastapi dev app/main.py --port 8000
```

`uvicorn` prints no emoji and needs no workaround, which is why `run.ps1` uses it.

## Tests

```bash
cd backend_v2 && python -m pytest tests/ -q
```

Twelve tests, offline and free — the repository and the model client are both
fakes. They cover refusal, grounding, mode permissions, and diagram signing.

```bash
python backend_v2/tests/live_smoke.py
```

Hits the real database. The unit tests use a fake repository, so they prove the
API's shape but not that the queries work — a renamed view column or reordered
RPC argument would pass them. Run this after any schema change.

## Evaluation

```bash
python backend_v2/tests/evaluate_tutor.py            # all cases
python backend_v2/tests/evaluate_tutor.py --case rate-of-change --show
```

Costs a few cents and calls the real model, so it is not part of `pytest`. Run it
after any change to `prompts.py`. Every case is a failure actually observed while
testing; none are invented.

### Why some checks use a judge instead of a regex

The lenient-M1 case was first asserted as `must_not_match = "earns the M1"`. The
tutor then wrote **"M1: Yes — you are using the correct idea"**, which awards the
same mark and passed cleanly. Two rounds of widening the pattern later it was
still possible to phrase the error a new way.

Regex is right for things with a fixed form — a value, a fraction, a mark code.
It is the wrong tool for *"did this response, however worded, tell the student
they earned a mark"*. That question is now put to a model directly, with a narrow
yes/no prompt that never sees the mark scheme and is never asked whether the
tutoring was **good** — only whether it says a specific thing. Asking a model to
grade quality would replace one unaccountable judgement with another.

## Known limitations

**The tutor awards marks the guidance does not allow, about half the time.**
Measured over 6 runs of `lenient-m1`: **3 correct, 3 wrongly awarding the M1**.
Given an attempt containing only `P(RRR)`, the printed guidance reads *"Both, FT
their tree diagram probabilities"* — both terms are required, so the mark is not
earned. Prompt rules about reading the Guidance reduced this but did not fix it.

Two things follow. Check mode should not be trusted for mark totals yet. And the
next fix is probably structural rather than more prompt text — for example
extracting the guidance condition per mark and having the model answer against
it explicitly, rather than hoping it reads carefully.

**A second bug, now fixed, is worth recording because of its shape.** On
9709/12 M/J Q10(a) the tutor copied the mark scheme's `-9 = ±5 × dt/dx` but wrote
`dx/dt` instead — reciprocals, so its working gave 9/5. It then noticed the clash
with the printed 5/9 and wrote *"we must follow the scheme's stated result
exactly"*, asserting the right answer on top of wrong working.

That was partly the prompt's fault: `BASE_RULES` said "do not contradict the mark
scheme" with no instruction for *"my working and the printed answer disagree"*.
It now says that a clash means the working is wrong and must be fixed before
answering. Stable across 4 runs since.

Both share a shape: **a correct-looking final line hiding wrong reasoning.**
That is why evaluation cannot be a read-through.

**Not built:** authentication, persisted conversations, attempt history,
similar-question retrieval, rate limiting. Similar-question search deliberately
stays out until each paper component has enough cross-paper content.

**Not yet built:** authentication, persisted conversations, attempt history,
similar-question retrieval, and rate limiting. Similar-question search
deliberately stays out until each paper component has enough cross-paper content
— the existing function returns nothing rather than something weak.
