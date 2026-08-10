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

from typing import Any

from .models import TutorMode
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
- Talk to a student, not about them. No preamble about what you are going to do."""

MODE_RULES: dict[TutorMode, str] = {
    TutorMode.HINT: """MODE: HINT

Give the smallest push that unblocks the student, and stop.

- Name the technique or the first move. Do NOT carry it out.
- Do NOT state the final answer, and do NOT state the answer to any part.
- Do NOT work through the algebra. One line of setup is the limit.
- End by asking them to try that step.

If the student explicitly insists on the full solution, tell them to switch to
Explain rather than giving it here.""",
    TutorMode.EXPLAIN: """MODE: EXPLAIN

Teach the full method for what the student asked about.

- Work through it in the order the mark scheme awards marks.
- Attach each step to its mark, so the student can see where the marks live.
- Where the mark scheme prints an alternative method, mention that it exists and
  that it earns the same marks.
- Finish with the answer as the mark scheme states it, including the accuracy it
  requires.""",
    TutorMode.CHECK: """MODE: CHECK THE STUDENT'S ATTEMPT

The student's own working is below. Diagnose it against the mark scheme.

- Say which marks their working WOULD earn, and name them.
- Before awarding ANY mark, check the student's working against that mark's
  Guidance, not just its Answer. A mark whose stated condition is unmet is not
  earned, however close the attempt looks. Being generous here is not kindness:
  it tells a student they have scored marks they would lose in the exam.
- Find the first place it goes wrong, if it does, and say why. One clear error is
  more useful than an exhaustive list.
- Apply follow-through honestly: if a later step is correct given their earlier
  wrong value, say the FT mark is still earned.
- Do not rewrite their solution into yours. Diagnose what they did.
- If their method is a valid alternative the mark scheme allows, say so rather
  than steering them to the printed route.""",
}


def _format_mark_items(items: list[dict[str, Any]], indent: str = "  ") -> list[str]:
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
    context: QuestionContext, mode: TutorMode, asset_urls_available: bool
) -> str:
    return "\n\n".join(
        [
            BASE_RULES,
            MODE_RULES[mode],
            build_source_block(context, asset_urls_available),
        ]
    )


def build_user_message(message: str, attempt: str | None, mode: TutorMode) -> str:
    if mode is TutorMode.CHECK and attempt:
        return (
            f"{message}\n\n"
            "MY WORKING (diagnose this against the mark scheme):\n"
            f"{attempt}"
        )
    return message
