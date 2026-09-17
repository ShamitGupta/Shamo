// Resolve an extracted asset's claim to a real OCR image.
//
// THE PROBLEM
// -----------
// The extraction model must name each required diagram as a triple
// `document_type:page:index`, where `index` is the zero-based position of the
// image in Mistral's per-page list. It cannot see the images -- only their
// coordinates in the compact document -- so it is picking an ordinal
// essentially blind. When it guesses wrong the pipeline stops dead:
//
//   9709/51 O/N 2025 Q3 claimed `question_paper:5:5` on a page holding one
//   image, which raised ASSET_SOURCE_NOT_FOUND, then ASSET_UPLOAD_COUNT_MISMATCH
//   because the uploader silently skipped it, then REPAIR_DID_NOT_CLEAR_BLOCKERS
//   because repair cannot recover an index it also has to guess.
//
// One wrong integer, three blocking issues, one paper needing a human.
//
// WHY THE INDEX IS HARD TO GUESS
// ------------------------------
// The index space is polluted by page furniture, and the pollution varies by
// paper series. Cambridge's 2025 papers carry a security barcode on every page
// which Mistral crops as an image, so a body diagram sits at index 1. The 2024
// February/March papers carry no barcode, so the same diagram sits at index 0.
// Measured across the corpus: every one of the 18 assets that resolved sits at
// index 0 or 1, split exactly along that line.
//
// THE FIX
// -------
// Stop relying on the model's integer. Classify each page's images
// deterministically, then resolve the claim against the content images only.
// The model's useful contribution is *which question needs a diagram and on
// what page*; the index is ours to derive.
//
// WHAT THIS DELIBERATELY DOES NOT DO
// ----------------------------------
// It never invents an image. If a page holds no content image the claim is
// reported as unsupported and the caller decides -- and that decision matters,
// because "the diagram was lost" and "there was never a diagram" need opposite
// handling. 9709/11 M/J Q11 was a real graph dropped by a pipeline bug and had
// to block; 9709/32 Q5 asks the candidate to draw an Argand diagram and 9709/51
// Q3's stem-and-leaf was captured perfectly as a markdown table. Those two must
// not block. `resolveAssetImage` reports the evidence; it does not adjudicate.

const IMAGE_REF = /!\[[^\]]*\]\([^)]*\)/;

/**
 * Split one page's images into furniture and content.
 *
 * Returns `{ furniture: number[], content: number[] }` of zero-based indices in
 * page order.
 *
 * THE DISCRIMINATOR
 * -----------------
 * Cambridge prints the page number as a bare integer at the top of the body
 * text. Everything above it is furniture: the security barcode, the `DFD`
 * series code, the `DO NOT WRITE IN THIS MARGIN` rail. Everything below it is
 * the question. So an image ABOVE the page-number line is furniture and an
 * image BELOW it is content -- a single positional test that needs no
 * knowledge of which series a paper belongs to.
 *
 * That independence matters, because the obvious alternative does not work.
 * Classifying per paper ("2025 papers carry a barcode, so index 0 is always
 * furniture") reproduces 16 of the 18 known assets and contradicts two:
 * 9709/11 O/N 2025 pages 8 and 10 carry the barcode TEXT but Mistral did not
 * crop it as an image, so the content diagram is at index 0 on those pages and
 * index 1 on their neighbours. Within one paper. The page number moves with the
 * furniture; the series does not.
 */
export function classifyPageImages(page) {
  const markdown = page.raw_markdown || page.markdown || "";
  const pageNumber = Number(page.page_number);

  // The cover carries the Cambridge logo and the candidate name/number boxes
  // and never carries an instructional diagram. Treating it as all furniture
  // removes 31 of the corpus's 55 multi-image pages without a false negative.
  const lines = markdown.split("\n");
  let seenPageNumber = false;
  const furniture = [];
  const content = [];
  let index = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!seenPageNumber && isPageNumberLine(trimmed, pageNumber)) {
      seenPageNumber = true;
      continue;
    }
    if (!IMAGE_REF.test(trimmed)) continue;
    // A line can hold more than one reference when OCR runs them together.
    const count = (trimmed.match(/!\[[^\]]*\]\([^)]*\)/g) || []).length;
    for (let i = 0; i < count; i += 1) {
      (seenPageNumber ? content : furniture).push(index);
      index += 1;
    }
  }

  if (pageNumber === 1) return { furniture: [...furniture, ...content], content: [] };

  // No page-number line was transcribed. Falling back to "everything is
  // content" is the safe direction: it can leave a furniture image in the
  // candidate list, which at worst keeps today's behaviour, whereas guessing
  // furniture could discard the only diagram on the page.
  if (!seenPageNumber) return { furniture: [], content: furniture };

  return { furniture, content };
}

function isPageNumberLine(line, pageNumber) {
  if (!/^\d{1,3}$/.test(line)) return false;
  return Number(line) === pageNumber;
}

/**
 * Build the per-document, per-page image classification for a whole paper.
 *
 * `documents` is the compact OCR shape: `[{ document_type, pages: [...] }]`.
 * Returns a Map keyed `document_type:page_number`.
 */
export function buildImageInventory(documents) {
  const inventory = new Map();
  for (const document of documents || []) {
    for (const page of document.pages || []) {
      const classified = classifyPageImages(page);
      inventory.set(`${document.document_type}:${Number(page.page_number)}`, {
        ...classified,
        document_type: document.document_type,
        page_number: Number(page.page_number),
        total: classified.furniture.length + classified.content.length,
      });
    }
  }
  return inventory;
}

/**
 * Resolve one asset claim.
 *
 * `status` is one of:
 *   exact              the claimed index is a content image; nothing to do
 *   resolved_only      the claim missed, the page holds exactly one content
 *                      image, so the intent is unambiguous
 *   resolved_ordinal   the claim missed, several content images; the claim's
 *                      ordinal is clamped into the content list
 *   claimed_furniture  the claimed index is real but is page furniture
 *   no_content_image   the page holds no content image at all
 *   page_not_found     the claimed page is outside the document
 *
 * `index` is the resolved zero-based image index, or null when unresolvable.
 */
export function resolveAssetImage(asset, inventory) {
  const key = `${asset.document_type}:${Number(asset.source_page_number)}`;
  const page = inventory.get(key);
  const claimed = Number(asset.source_image_index);

  if (!page) return { status: "page_not_found", index: null, key, claimed };

  const { content, furniture } = page;

  if (content.includes(claimed)) {
    return { status: "exact", index: claimed, key, claimed };
  }
  if (content.length === 0) {
    // Nothing on this page could be the diagram. Whether that is a loss or a
    // phantom claim is not decidable here -- report it and let the rule decide.
    return {
      status: furniture.includes(claimed) && furniture.length === page.total && page.total > 0
        ? "no_content_image"
        : "no_content_image",
      index: null,
      key,
      claimed,
    };
  }
  if (furniture.includes(claimed)) {
    // The model counted the barcode. Its intent is the content image; when
    // there is exactly one, that intent is unambiguous.
    return content.length === 1
      ? { status: "claimed_furniture", index: content[0], key, claimed }
      : { status: "claimed_furniture", index: null, key, claimed };
  }
  if (content.length === 1) {
    return { status: "resolved_only", index: content[0], key, claimed };
  }
  // Several candidates and an out-of-range claim. Preserve the model's relative
  // ordering rather than defaulting to the first: on a page with two diagrams a
  // high index means "the later one".
  const ordinal = Math.min(Math.max(claimed, 0), content.length - 1);
  return { status: "resolved_ordinal", index: content[ordinal], key, claimed };
}

export const RESOLVED_STATUSES = new Set([
  "exact",
  "resolved_only",
  "resolved_ordinal",
  "claimed_furniture",
]);
