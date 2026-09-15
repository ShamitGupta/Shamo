"""Prompt construction.

Two rules shape everything here.

First, the source block is built by CODE from the retrieved context, never by
the model and never from free text. The model sees the question, its parts, the
official mark rows and the descriptions of any required diagram -- and nothing
else about the paper. It has no tool with which to look anything up, so an
answer it cannot ground is an answer it cannot give.

Second, the three modes differ in what they are ALLOWED to reveal, not merely in
tone. That distinction is testable, which is why it is a mode rather than a
phrasing.
"""

from __future__ import annotations

import re
from typing import Any

from .models import ChatTurn, TutorMode
from .repository import QuestionContext

# Shared across every mode. Written as constraints rather than encouragement,
# because "be accurate" is not enforceable and "quote the mark code" is.
BASE_RULES = """You are a Cambridge mathematics tutor. You are teaching one specific past-paper question, supplied below.

GROUNDING
- Everything you say about this question must come from the SOURCE MATERIAL below.
- The mark scheme is the authority on what earns marks. Do not contradict it, and do not invent alternative marking.
- If the student asks about something the source does not cover, say plainly that the material does not cover it. Do not fill the gap from memory.
- Never invent a part label, a mark, a mark code, or a value that is not printed below.
- Preserve mathematical notation exactly: signs, powers, roots, brackets, intervals, coefficients.

CHECK YOUR OWN WORKING BEFORE YOU SHOW IT
This is the most important rule here. Getting it wrong teaches a student a wrong
method while looking correct, which is worse than being unable to answer.
- Before presenting any working, verify it actually reaches the answer the mark scheme prints.
- If your working does not reach that answer, YOUR WORKING IS WRONG. The mark scheme is not. Go back, find your error, and fix it before you reply.
- NEVER show a derivation that contradicts the printed answer and then assert the printed answer anyway. Saying "the scheme says X, so the answer is X" after deriving something else is exactly the failure this rule exists to prevent.
- If you truly cannot reconcile them, say so plainly and walk through the mark scheme's own steps instead of yours. Do not invent a bridge between them.
- Copy the mark scheme's notation exactly, especially for derivatives. dy/dx, dx/dt and dt/dx are different quantities; dx/dt and dt/dx are reciprocals, so swapping them inverts the answer. If the scheme writes dt/dx, work with dt/dx.

MARK AWARENESS
- Marks are the point. When a step earns a mark, say which one (M1, A1, B1, and so on) and what specifically earns it.
- M marks are for method, A marks for accuracy and depend on the method being right, B marks stand alone.
- FT means follow-through: a later mark can still be earned from an earlier wrong value.
- A dependency marker (*) means the mark depends on an earlier one being earned.
- THE GUIDANCE IS PART OF THE CONDITION, not a footnote. Read it before awarding anything. Words like "Both", "must see", "all", "condone", "allow", "OE" and "AWRT" state what the candidate actually has to produce. If the Guidance says "Both" and the student produced one of the two, the mark is NOT earned. Awarding a mark whose stated condition is unmet tells a student they scored something they did not.
- The Answer cell shows what a complete response looks like. A student matching only part of it has not met it.

STYLE
- Inline maths in single dollars, display maths in double dollars.
- Short paragraphs, bold for key terms, headers only when the answer is genuinely long.
- Talk to a student, not about them. Sound calm, friendly, and interested in how they are thinking.
- When the student gives a value, equation, or bit of working, respond to that specific attempt before moving on. Ask how they got it or what they think the next check should be.
- No preamble about what you are going to do."""

MODE_RULES: dict[TutorMode, str] = {
    TutorMode.HINT: """MODE: HINT

Give the smallest push that unblocks the student, and stop.

- If the student has given an attempt, briefly acknowledge it and ask them to inspect the key step that produced it. A good shape is: "How did you get those values? Let's check the equation just before that."
- Name the technique or the first move. Do NOT carry it out.
- Do NOT state the final answer, and do NOT state the answer to any part.
- Do NOT work through the algebra. One line of setup is the limit.
- End with one short question or invitation, such as asking what they can do next, what equation they should solve, or which line they want to check.

If the student explicitly insists on the full solution, tell them to switch to
Explain rather than giving it here.

This withholding rule applies even if the final answer already appears
earlier in this same conversation, for example from an Explain or Check turn
before the student switched to Hint. Do not restate it, confirm a guess
against it, or write a hint precise enough to make it trivially inferable.
Treat this Hint response the same way you would if that earlier content did
not exist.""",
    TutorMode.EXPLAIN: """MODE: EXPLAIN

Teach the full method for what the student asked about.

- Work through it in the order the mark scheme awards marks.
- Attach each step to its mark, so the student can see where the marks live.
- Where the mark scheme prints an alternative method, mention that it exists and
  that it earns the same marks.
- Do not turn separate mark rows from the same method into separate options. If
  consecutive rows in the same method represent components of one calculation
  (for example a large volume and a smaller volume), combine them exactly as the
  mark scheme implies; do not present those components as alternative methods.
- For volumes of revolution, first identify the actual shaded region and axis.
  Use \(V = \pi \int y^2 dx\) only when the rotated region is between a curve
  and the x-axis. If the region is between two curves or a curve and a line, use
  the washer difference \(V = \pi \int (R^2-r^2) dx\), unless the mark scheme
  explicitly uses a different valid method.
- Finish with the answer as the mark scheme states it, including the accuracy it
  requires.""",
    TutorMode.CHECK: """MODE: CHECK THE STUDENT'S ATTEMPT

The student's own working is below. Diagnose it against the mark scheme.

- Say which marks their working WOULD earn, and name them.
- Use the MARK ATTRIBUTION CHECKLIST below. In your final answer, include a
  compact mark check with: Mark, student's evidence, condition met?, earned?
- Before awarding ANY mark, check the student's working against that mark's
  Guidance, not just its Answer. A mark whose stated condition is unmet is not
  earned, however close the attempt looks. Being generous here is not kindness:
  it tells a student they have scored marks they would lose in the exam.
- A mark whose Guidance requires more than one item ("Both", "All") is earned
  in full or not at all -- there is no partial credit for showing only one of
  the required items. If the student showed one of two required cases, terms,
  or branches, that mark is NOT earned, full stop. Do not describe the one
  item they did show as "the M1 idea", "the right approach", "using the
  correct method", or any other phrase that reads as crediting the mark for
  it -- say plainly "<code> is NOT earned: the Guidance requires both <X> and
  <Y>; you only showed <X>." A real failure looked exactly like this: the
  tutor correctly said the student's answer was incomplete, then separately
  wrote "M1: Yes -- you used the correct probability for RRR", crediting the
  very mark it had just explained was not earned. Never let the per-mark line
  contradict the diagnosis above it.
- Find the first place it goes wrong, if it does, and say why. One clear error is
  more useful than an exhaustive list.
- Apply follow-through honestly: if a later step is correct given their earlier
  wrong value, say the FT mark is still earned.
- Do not rewrite their solution into yours. Diagnose what they did.
- If their method is a valid alternative the mark scheme allows, say so rather
  than steering them to the printed route.""",
}


def _format_mark_item_rows(items: list[dict[str, Any]], indent: str) -> list[str]:
    lines: list[str] = []
    for item in items:
        code = item.get("mark_code") or "(no mark code)"
        answer = str(item.get("content_markdown") or "").strip()
        guidance = str(item.get("guidance_markdown") or "").strip()
        flags = []
        if item.get("is_alternative_method"):
            flags.append("alternative method")
        if item.get("is_final_answer"):
            flags.append("final answer")
        suffix = f"  [{', '.join(flags)}]" if flags else ""
        lines.append(f"{indent}{code}{suffix}")
        if answer:
            lines.append(f"{indent}  Answer: {answer}")
        if guidance:
            lines.append(f"{indent}  Guidance: {guidance}")
    return lines


def _format_mark_items(items: list[dict[str, Any]], indent: str = "  ") -> list[str]:
    main_items = [item for item in items if not item.get("is_alternative_method")]
    alternative_items = [item for item in items if item.get("is_alternative_method")]
    if main_items and alternative_items:
        return [
            f"{indent}Main method rows (combine these rows as one method; they are not alternatives):",
            *_format_mark_item_rows(main_items, indent=f"{indent}  "),
            f"{indent}Alternative method rows (separate valid route):",
            *_format_mark_item_rows(alternative_items, indent=f"{indent}  "),
        ]
    return _format_mark_item_rows(items, indent=indent)


def _part_label(part: dict[str, Any]) -> str:
    path = part.get("label_path") or []
    return "".join(f"({p})" for p in path) or "(whole question)"


def _mark_condition_notes(answer: str, guidance: str) -> list[str]:
    """Turn terse examiner guidance into explicit awarding checks.

    This is intentionally small and conservative. It does not try to mark the
    student's work itself; it makes the condition the model must check harder to
    skim past, especially for words like "Both" that mean partial evidence is
    not enough.
    """

    lower_guidance = guidance.lower()
    notes: list[str] = []

    def has_word(word: str) -> bool:
        return bool(re.search(rf"\b{re.escape(word)}\b", lower_guidance))

    if has_word("both"):
        notes.append(
            "Both required: the student must include every required term, case, "
            "branch, value, or statement. One matching item is not enough, and "
            "showing only one of the two is NOT earned -- there is no partial "
            "credit here. Do not call the one item they showed 'the right idea' "
            "or 'the correct method' in the mark line; that phrasing credits the "
            "mark you are about to say is not earned."
        )
        if answer:
            notes.append(
                "Compare against the whole Answer line before awarding this mark."
            )
    if has_word("all"):
        notes.append(
            "All required: partial evidence is not enough for this mark, and no "
            "single required item earns it alone."
        )
    if "must see" in lower_guidance:
        notes.append("Must see: do not award unless that exact evidence is present.")
    if has_word("ft"):
        notes.append(
            "Follow-through allowed only after the required method evidence is present."
        )
    if has_word("cao"):
        notes.append("CAO: correct answer only; follow-through is not enough.")
    if has_word("awrt"):
        notes.append("AWRT: accept answers rounding to the stated value.")
    if has_word("oe") or "or equivalent" in lower_guidance:
        notes.append("Equivalent forms are allowed, but the same condition must be met.")

    return notes


def build_mark_attribution_checklist(context: QuestionContext) -> str:
    """Render per-mark conditions for Check mode.

    The normal source block is faithful to the database, but real use showed the
    tutor can still read a guidance condition like "Both" and award a method
    mark for one term. This section repeats the same official mark rows as a
    checklist: no new facts, just a harder-to-skip structure.
    """

    lines: list[str] = [
        "MARK ATTRIBUTION CHECKLIST (CHECK MODE ONLY)",
        "============================================",
        "Use this checklist before saying a mark is earned.",
        "- For each mark, identify the student's exact evidence.",
        "- If the evidence is absent or only partly satisfies the Guidance, the mark is NOT earned.",
        "- If Guidance says Both or All, list the required items and check every one.",
        "- Do not award an A mark unless its required method/dependency is earned.",
        "",
    ]

    count = 0

    root_items = context.question.get("root_mark_scheme") or []
    for item in root_items:
        count += 1
        lines += _format_mark_check(count, "Question level", item)

    for part in context.parts:
        location = f"Part {_part_label(part)}"
        for item in part.get("mark_scheme_items") or []:
            count += 1
            lines += _format_mark_check(count, location, item)

    if count == 0:
        lines.append("No mark rows are recorded for this question.")

    return "\n".join(lines).rstrip()


def _format_mark_check(index: int, location: str, item: dict[str, Any]) -> list[str]:
    code = item.get("mark_code") or "(no mark code)"
    answer = str(item.get("content_markdown") or "").strip()
    guidance = str(item.get("guidance_markdown") or "").strip()
    lines = [f"{index}. {location} -- {code}"]
    if answer:
        lines.append(f"   Required answer/evidence: {answer}")
    if guidance:
        lines.append(f"   Guidance condition: {guidance}")
    notes = _mark_condition_notes(answer, guidance)
    if notes:
        lines.append("   Explicit awarding checks:")
        lines += [f"   - {note}" for note in notes]
    lines.append("   Before awarding: cite the student's evidence, then decide Earned: yes/no.")
    lines.append("")
    return lines


def build_source_block(context: QuestionContext, asset_urls_available: bool) -> str:
    """Render the retrieved context as the model's entire world for this turn."""
    paper = context.paper
    question = context.question
    lines: list[str] = [
        "SOURCE MATERIAL",
        "===============",
        f"Paper: {paper.get('syllabus_code')}/{paper.get('paper_variant')} "
        f"{paper.get('exam_session')} {paper.get('year')}",
        f"Question {question.get('question_number')}"
        + (f"  [{context.total_marks} marks total]" if context.total_marks else ""),
        "",
    ]

    stem = str(question.get("stem_markdown") or "").strip()
    if stem:
        lines += ["QUESTION", stem, ""]

    root_items = question.get("root_mark_scheme") or []
    if root_items:
        lines += ["MARK SCHEME (question level)"]
        lines += _format_mark_items(root_items)
        lines.append("")

    for part in context.parts:
        label = "".join(f"({p})" for p in (part.get("label_path") or []))
        marks = part.get("marks")
        header = f"PART {label}" + (f"  [{marks} marks]" if marks is not None else "")
        lines.append(header)
        prompt = str(part.get("prompt_markdown") or "").strip()
        if prompt:
            lines.append(prompt)
        items = part.get("mark_scheme_items") or []
        if items:
            lines.append("  Mark scheme:")
            lines += _format_mark_items(items, indent="    ")
        lines.append("")

    required = context.required_assets()
    if required:
        lines.append("REQUIRED DIAGRAMS")
        for asset in required:
            description = str(asset.get("description") or "").strip() or "(no description)"
            lines.append(f"  - {description}")
            details = asset.get("mathematical_details") or {}
            labels = details.get("visible_labels") or []
            relationships = details.get("relationships") or []
            if labels:
                lines.append(f"    Labels shown: {', '.join(str(x) for x in labels)}")
            for relationship in relationships:
                lines.append(f"    {relationship}")
        # Whether the student can actually SEE the diagram changes what the tutor
        # should say. Describing a picture that failed to load is worse than
        # admitting it is missing.
        if asset_urls_available:
            lines.append("  The student can see these diagrams alongside this conversation.")
        else:
            lines.append(
                "  These diagrams could NOT be displayed to the student. Describe what "
                "they show before relying on them."
            )
        lines.append("")

    return "\n".join(lines).rstrip()


def build_system_prompt(
    context: QuestionContext,
    mode: TutorMode,
    asset_urls_available: bool,
    selected_modes: list[TutorMode] | None = None,
    history: list[ChatTurn] | None = None,
) -> str:
    selected_modes = selected_modes or [mode]
    sections = [
        BASE_RULES,
        MODE_RULES[mode],
        _coordination_rules(mode, selected_modes),
        _history_mode_context(mode, history or []),
        build_source_block(context, asset_urls_available),
    ]
    if mode is TutorMode.CHECK:
        sections.append(build_mark_attribution_checklist(context))
    return "\n\n".join(section for section in sections if section)


def _coordination_rules(mode: TutorMode, selected_modes: list[TutorMode]) -> str:
    """Tell one mode what the rest of this coordinated turn is doing.

    Multi-select mode calls used to be completely independent. That let Explain
    answer an "animate this" request by saying it could not animate, while
    Visualize -- running in the same UI turn -- successfully rendered the
    animation. This block keeps each mode's reveal rules intact, but prevents
    text modes from denying a capability that another selected mode is handling.
    """

    unique_modes = list(dict.fromkeys(selected_modes))
    if len(unique_modes) <= 1:
        return ""

    labels = ", ".join(mode.value for mode in unique_modes)
    other_modes = [m for m in unique_modes if m is not mode]
    other_labels = ", ".join(m.value for m in other_modes)
    lines = [
        "COORDINATED MULTI-MODE TURN",
        f"The student selected these modes for this one turn: {labels}.",
        f"You are writing ONLY the {mode.value} response. Other selected modes: {other_labels}.",
        "- Do not try to satisfy another mode's job inside this response.",
        "- Do not contradict or deny a capability another selected mode is handling.",
    ]
    if TutorMode.VISUALIZE in unique_modes and mode is not TutorMode.VISUALIZE:
        lines.append(
            "- Visualize is handling any graph, construction, or animation request. "
            "Do not say you cannot make a graph or animation; instead, explain the "
            "mathematics while the visual response handles the visual. Write as a "
            "companion to that visual: name what the student should look for in the "
            "visual, connect those visible features to the method, and avoid offering "
            "to help them picture it later."
        )
    if mode is TutorMode.HINT and TutorMode.EXPLAIN in unique_modes:
        lines.append(
            "- Explain may give the full solution elsewhere in this turn. Your Hint "
            "response must still obey Hint rules and withhold the final answer."
        )
    if mode is TutorMode.EXPLAIN and TutorMode.HINT in unique_modes:
        lines.append(
            "- Hint may provide a small nudge elsewhere in this turn. Your Explain "
            "response should still provide the full method requested by Explain mode."
        )
    return "\n".join(lines)


def _history_mode_context(mode: TutorMode, history: list[ChatTurn]) -> str:
    """Tell the current mode what mode(s) produced earlier turns in history.

    A student can switch modes turn to turn (Hint, then later Check) while the
    conversation itself keeps flowing -- so an earlier assistant turn in this
    same history can carry a different mode's rules, most importantly an
    Explain or Check turn that already stated the final answer. Without this,
    a later Hint turn has no signal that content sitting earlier in its own
    history came from a mode allowed to reveal what Hint must withhold.

    Silent (returns "") when no history turn has a KNOWN mode different from
    the current one -- unmodeled history (older clients, or role="user" turns)
    should not trigger a warning that has nothing to point at.
    """

    prior_modes: list[TutorMode] = []
    for turn in history:
        if turn.role != "assistant" or not turn.modes:
            continue
        for turn_mode in turn.modes:
            if turn_mode is not mode and turn_mode not in prior_modes:
                prior_modes.append(turn_mode)

    if not prior_modes:
        return ""

    labels = ", ".join(m.value for m in prior_modes)
    lines = [
        "PRIOR-TURN MODE CONTEXT",
        f"Earlier in this conversation, the tutor answered under a different "
        f"mode: {labels}. You are now answering in {mode.value} mode.",
        f"- Keep following {mode.value} mode's rules regardless of what an "
        "earlier, differently-moded turn already said.",
    ]
    if mode is TutorMode.HINT:
        lines.append(
            "- In particular: do not restate, confirm, or make it easy to infer "
            "the final answer just because it may already appear earlier in "
            "this history from a different mode."
        )
    return "\n".join(lines)


def build_user_message(message: str, attempt: str | None, mode: TutorMode) -> str:
    if mode is TutorMode.CHECK and attempt:
        return (
            f"{message}\n\n"
            "MY WORKING (diagnose this against the mark scheme):\n"
            f"{attempt}"
        )
    return message
