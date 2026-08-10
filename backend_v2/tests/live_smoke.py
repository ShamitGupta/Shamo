"""Check the repository against the REAL database.

The unit tests use a fake repository, so they prove the API's shape and its
refusal behaviour but say nothing about whether the queries work. A view column
renamed, an RPC argument reordered, a bucket path wrong -- none of that would
fail the suite. This closes that gap.

Not part of the default test run: it needs credentials and a network. Run it
after any schema change, and before deploying.

    python backend_v2/tests/live_smoke.py

Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from backend_v2/.env, falling
back to workflows/n8n/harness/.env, which already holds both. No OpenAI key is
needed: this exercises retrieval only.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE.parent))


def _load_env() -> None:
    from dotenv import load_dotenv

    load_dotenv(HERE.parent / ".env")
    if not os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
        load_dotenv(ROOT / "workflows" / "n8n" / "harness" / ".env")
    os.environ.setdefault("OPENAI_API_KEY", "not-needed-for-retrieval")


_load_env()

from app.config import get_settings  # noqa: E402
from app.repository import Repository  # noqa: E402

failures: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    print(f"  {'PASS' if condition else 'FAIL'}  {name}" + (f"  {detail}" if detail else ""))
    if not condition:
        failures.append(name)


def main() -> int:
    repository = Repository(get_settings())

    print("\n=== Catalogue ===")
    papers = repository.list_papers()
    check("papers returned", len(papers) > 0, f"{len(papers)} papers")
    if papers:
        first = papers[0]
        check(
            "catalogue rows are well formed",
            all(k in first for k in ("year", "exam_session", "paper_variant", "question_numbers")),
            str({k: first[k] for k in ("year", "exam_session", "paper_variant")}),
        )
        check(
            "question numbers are contiguous from 1",
            first["question_numbers"] == list(range(1, len(first["question_numbers"]) + 1)),
            str(first["question_numbers"]),
        )
        check(
            "component derived from the variant",
            first["paper_component"] == first["paper_variant"][0],
        )

    print("\n=== Exact retrieval ===")
    target = papers[0] if papers else None
    if target:
        context = repository.get_question_context(
            target["year"], target["exam_session"], target["paper_variant"],
            target["question_numbers"][0],
        )
        check("context retrieved", context is not None)
        if context:
            check("paper identity present", bool(context.paper.get("year")))
            has_text = bool(str(context.question.get("stem_markdown") or "").strip()) or bool(
                context.parts
            )
            check("question carries text", has_text)
            mark_rows = sum(len(p.get("mark_scheme_items") or []) for p in context.parts)
            mark_rows += len(context.question.get("root_mark_scheme") or [])
            check("mark rows present", mark_rows > 0, f"{mark_rows} rows")

    print("\n=== Refusal path ===")
    missing = repository.get_question_context(1999, "may_june", "99", 42)
    check("an unpublished question returns None", missing is None)

    print("\n=== Private assets ===")
    signed_any = False
    for paper in papers:
        for number in paper["question_numbers"]:
            context = repository.get_question_context(
                paper["year"], paper["exam_session"], paper["paper_variant"], number
            )
            if context and context.required_assets():
                asset = context.required_assets()[0]
                url = repository.sign_asset(asset["storage_bucket"], asset["storage_path"])
                check(
                    "required diagram signs to a URL",
                    bool(url),
                    f"{paper['paper_variant']} {paper['year']} Q{number}",
                )
                signed_any = True
                break
        if signed_any:
            break
    if not signed_any:
        check("a required diagram was found to sign", False, "none located")

    print()
    if failures:
        print(f"FAIL -- {len(failures)} check(s): {', '.join(failures)}\n")
        return 1
    print("PASS -- the repository works against the live database.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
