# Cache the text layer of each source PDF as JSON, once, for offline checking.
#
# WHY
# ---
# Mistral OCR is the only step in the pipeline whose output nothing verifies.
# Every later stage faithfully copies whatever it produced, so an OCR error --
# `2!` read as `2^2`, `/` read as `+` -- reaches the database reporting success.
# Until now the only detector was a human with the printed paper open.
#
# Cambridge PDFs carry a real text layer. That gives a SECOND independent
# reading of the same page, free, which can be diffed against the OCR. It is not
# a perfect reading (stacked fractions lose their bar, superscripts drift), so
# the comparison in check_ocr_vs_pdf.mjs is deliberately restricted to tokens
# both representations render unambiguously.
#
# Run once per paper; the JSON is committed alongside the OCR fixtures so the
# check stays offline and free.
#
#   python workflows/n8n/harness/extract_pdf_text.py <pdf-dir>
#
# Filenames follow Cambridge's convention: 9709_s24_ms_62.pdf
#   s = May/June, w = Oct/Nov, m = Feb/March

import json
import re
import sys
from pathlib import Path

import pypdf

SESSION = {"s": "may_june", "w": "oct_nov", "m": "feb_march"}
DOC_TYPE = {"qp": "question_paper", "ms": "mark_scheme"}
NAME = re.compile(r"^(\d{4})_([swm])(\d{2})_(qp|ms)_(\d{2})$")

HERE = Path(__file__).resolve().parent
OUT = HERE / "fixtures" / "pdf_text"


def page_images(page, pdf, number):
    """Every embedded raster on the page, with its pixel dimensions.

    This is the PDF's OWN inventory, independent of both Mistral and the
    extraction model, and it is what makes an asset claim checkable. The
    pipeline currently trusts a model-guessed `page:index` triple; when that
    index misses, nothing can say whether a diagram was lost or was never
    printed. The two answers need opposite handling -- block versus drop --
    so guessing between them is not acceptable.

    Cambridge pages carry furniture that is also an image: the security
    barcode on every page of a 2025-series paper, and the name/number boxes
    on cover pages. Those are recorded here too; classifying them is the
    reader's job, because the raw inventory should stay a fact.
    """
    found = []
    try:
        for index, image in enumerate(page.images):
            entry = {"index": index, "name": image.name}
            try:  # a decode failure must not cost us the rest of the page
                entry["width"], entry["height"] = image.image.size
            except Exception:
                entry["width"] = entry["height"] = None
            found.append(entry)
    except Exception as error:
        print(f"  warn: {pdf.name} p{number} images: {error}")
    return found


def main() -> int:
    source = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    pdfs = sorted(source.glob("*.pdf"))
    if not pdfs:
        print(f"No PDFs in {source}")
        return 1

    OUT.mkdir(parents=True, exist_ok=True)
    papers: dict[str, dict] = {}

    for pdf in pdfs:
        match = NAME.match(pdf.stem)
        if not match:
            print(f"  skip (unrecognised name): {pdf.name}")
            continue
        syllabus, session_letter, year_suffix, doc, variant = match.groups()
        # Cambridge's 'w' session is printed as the Oct/Nov of that same year.
        key = f"{syllabus}_20{year_suffix}_{SESSION[session_letter]}_{variant}"

        reader = pypdf.PdfReader(str(pdf))
        pages = []
        for number, page in enumerate(reader.pages, start=1):
            try:
                text = page.extract_text() or ""
            except Exception as error:  # a damaged page must not lose the rest
                text = ""
                print(f"  warn: {pdf.name} p{number}: {error}")
            pages.append(
                {"page_number": number, "text": text, "images": page_images(page, pdf, number)}
            )

        papers.setdefault(key, {"paper_key": key, "documents": []})
        papers[key]["documents"].append(
            {"document_type": DOC_TYPE[doc], "source_file": pdf.name, "pages": pages}
        )
        print(f"  {pdf.name}: {len(pages)} pages -> {key}")

    for key, payload in papers.items():
        payload["documents"].sort(key=lambda d: d["document_type"])
        target = OUT / f"{key}.json"
        target.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        size = target.stat().st_size / 1024
        print(f"wrote {target.name}  ({size:.0f} kB)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
