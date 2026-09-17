// Campaign configuration shared by build_budget_batch_workflows.mjs (the v1
// generator) and build_budget_v2_workflows.mjs (the v2.1 patcher that reads
// v1's output and produces the workflows actually run).
//
// WHY THIS EXISTS
// ----------------
// Both generator scripts used to hardcode the 9709/"Test 2" pilot's Google
// Sheet, qualification, syllabus code, subject, campaign key and Grade-column
// literal directly inside template strings. Adding IGCSE 0606 (2024-2025
// sittings only) as a second campaign without duplicating either generator
// script means those values have to come from somewhere both scripts share --
// this module is that somewhere, so the two generators can never drift apart
// on what a "campaign" even is.
//
// THE DEFAULT CAMPAIGN MUST STAY THE DEFAULT
// -------------------------------------------
// `a-level-9709-test2` carries the exact literal values that used to be
// hardcoded inline. Running either generator with no campaign argument selects
// it, so existing A-level tooling, docs and habits ("just run the generator")
// keep working unchanged. Every other field on a campaign is data threaded
// into the generated Code-node text at generation time (never a runtime
// branch keyed on which campaign built the workflow), so the 9709 output
// changes only where a fix genuinely needed to touch shared logic (see the
// generator scripts for exactly which lines those are and why).

export const CAMPAIGNS = {
  "a-level-9709-test2": {
    id: "a-level-9709-test2",

    // Google Sheet manifest.
    googleDocumentId: "14QHYH5T22qyGQJH-6SLW00q9yTuDhGwe1mEM7liaEbY",
    googleDocumentCachedName: "Past paper data - Alevel Maths (final)",
    googleSheetName: "Test 2",
    // Used only in generated error-message text (e.g. "Test 2 row 5 is not
    // A-levels."), so it can read differently from googleSheetName if a
    // campaign ever wants a friendlier label there. Identical today.
    sheetLabel: "Test 2",

    // Paper identity stamped onto every ingested row.
    qualification: "a_level",
    syllabusCode: "9709",
    subject: "Mathematics",

    // The literal the Grade column must equal for a row to be accepted.
    gradeLabel: "A-levels",

    // Restrict the manifest to specific Year column values, or null for no
    // restriction (the 9709 pilot considers every row in its sheet).
    includedYears: null,

    // Stamped into extracted question metadata as `taxonomy_version`, so
    // published rows can always be traced back to which topic vocabulary
    // revision classified them. Matches lib/validation_rules.mjs's
    // TAXONOMY_VERSION lineage for this syllabus (see that file for the
    // full versioned history of the 9709 vocabulary itself).
    taxonomyVersion: "cambridge-maths-v1",

    // How much room the targeted-repair OpenAI call is given to write its
    // answer. Unchanged from the value this campaign has always used --
    // see the IGCSE entry below for why a second campaign needed a
    // different number here.
    repairMaxOutputTokens: 22000,

    // Only used to derive workflow-level versionId seeds (see idFor calls in
    // the generators) so two campaigns' generated workflows never collide if
    // both are ever imported into the same n8n instance. Empty for the
    // original campaign so its versionId seeds -- and therefore its output --
    // stay exactly what they have always been.
    versionSeedSuffix: "",

    campaignKey: "a-level-9709-test2-pilot-v1",

    // Which batch the v2.1 controller starts at. This is genuinely live
    // operational state (it advances every time a batch actually runs), not
    // campaign identity -- it happens to live here because the two generator
    // scripts have no other shared place to read it from before a workflow
    // is first created. 9709's batch 1 was already staged before v2.1 was
    // built, so v2.1 has always started at 2 for this campaign specifically.
    // Do NOT copy this value for a new campaign -- see the IGCSE entry below.
    nextBatchNumber: 2,

    // Workflow display names (the n8n "name" field, shown in the UI list).
    childWorkflowName: "Shamo Budget v1 - Stage One Maths Paper",
    controllerWorkflowName: "Shamo Budget v1 - Test 2 Six Paper Controller",
    publishWorkflowName: "Shamo Budget v1 - Approve Reviewed Paper and Metadata",
    v2ChildWorkflowName: "Shamo Budget v2.1 - Structured Maths Paper Staging",
    v2ControllerWorkflowName: "Shamo Budget v2.1 - Test 2 Six Paper Calibration",
    // Fixed literal UUIDs, exactly as they were before this file existed --
    // not derived from a hash of the campaign id, so the original campaign's
    // v2.1 output keeps its historical versionId unchanged.
    v2ChildVersionId: "85b559c4-3a0e-448c-82f1-bc54bca7d059",
    v2ControllerVersionId: "037475a2-20e9-460f-872d-9df4e8447926",

    // Output filenames. Never overwritten by another campaign.
    outputChildFilename: "shamo_budget_stage_one_math_paper.json",
    outputControllerFilename: "shamo_budget_test2_six_paper_controller.json",
    outputPublishFilename: "shamo_budget_approve_reviewed_paper.json",
    outputV2ChildFilename: "shamo_budget_v2_1_stage_one_math_paper.json",
    outputV2ControllerFilename: "shamo_budget_v2_1_test2_six_paper_controller.json",
  },

  "igcse-0606-2024-2025": {
    id: "igcse-0606-2024-2025",

    // Google Sheet manifest -- the consolidated "Master File" tab, which
    // holds every year/session in one flat table with the same column
    // headers as the 9709 sheet (Paper Link, Document type, Grade, Subject,
    // Year, Exam session, Paper Variant).
    googleDocumentId: "1uRp5aaxQLqwfGsnP3IbMvlkFxgj237lH6ygyheBQWd0",
    googleDocumentCachedName: "Cambridge IGCSE 0606 Additional Mathematics past papers",
    googleSheetName: "Master File",
    sheetLabel: "Master File",

    qualification: "igcse",
    syllabusCode: "0606",
    subject: "Additional Mathematics",

    // The user's manifest carries the literal string "IGCSE" in the Grade
    // column, not "IGCSE Add Maths" or any other variant.
    gradeLabel: "IGCSE",

    // 2020-2023 sittings exist in the same tab and are deliberately out of
    // scope for this campaign; a future campaign can widen this list to
    // extend the year range without touching the 9709 campaign at all.
    includedYears: [2024, 2025],

    // Distinct from the 9709 lineage on purpose -- see
    // lib/validation_rules.mjs's IGCSE_TAXONOMY_VERSION -- so a stored row's
    // taxonomy_version always identifies which syllabus's vocabulary review
    // history produced it.
    taxonomyVersion: "cambridge-igcse-0606-v1",

    // Raised from the 9709 campaign's 22000 after a live run (18 August)
    // found the repair call genuinely truncating -- OpenAI returned
    // status:"incomplete" (reason: max_output_tokens) partway through
    // writing corrected questions, which "Parse Targeted Repair" correctly
    // refuses to accept rather than parse a cut-off answer, but that refusal
    // surfaces as an uncaught error that stops the whole run rather than a
    // graceful per-paper skip. Doubling the budget is the fix that doesn't
    // require touching that error-handling behavior itself.
    //
    // Raised again, 40000 -> 80000, on 19 August: a real repair call for
    // 2025 feb_march:22 ran a full 19 minutes on gpt-5.4-mini and STILL hit
    // status:"incomplete" at 40000. Reasoning tokens (effort: medium) count
    // against this same ceiling, so a paper with several blocking questions
    // to repair can exceed even a doubled budget. Patched live first, then
    // mirrored here -- see the generator's own note about propagating this
    // into the checked-in generated JSON.
    repairMaxOutputTokens: 80000,

    versionSeedSuffix: "-igcse-0606-2024-2025",

    campaignKey: "igcse-0606-2024-2025-v1",

    // No IGCSE batch has ever run. Unlike the 9709 campaign above, this one
    // starts at 1 -- copying the 9709 campaign's "2" here would silently skip
    // the first max_papers_per_run papers of the manifest on the very first
    // run, since batch_number indexes directly into the ordered pair list
    // (see "Pair and Select Test 2 Papers" in the controller).
    nextBatchNumber: 1,

    childWorkflowName: "Shamo Budget v1 - IGCSE 0606 Stage One Paper",
    controllerWorkflowName: "Shamo Budget v1 - IGCSE 0606 2024-2025 Controller",
    // The publish workflow takes only a Supabase URL and a pasted
    // ingestion_run_id -- nothing about it is qualification-specific, so both
    // campaigns share the one already-generated publish workflow rather than
    // minting a byte-identical duplicate under a second name.
    publishWorkflowName: "Shamo Budget v1 - Approve Reviewed Paper and Metadata",
    v2ChildWorkflowName: "Shamo Budget v2.1 - IGCSE 0606 2024-2025 Paper Staging",
    v2ControllerWorkflowName: "Shamo Budget v2.1 - IGCSE 0606 2024-2025 Controller",
    // Distinct from the 9709 campaign's versionIds so both workflows can be
    // imported into the same n8n instance without colliding.
    v2ChildVersionId: "6a1f0d3e-6c2b-4b8a-9d7e-3f2c1a9b4e6d",
    v2ControllerVersionId: "b4e2c8a1-7d5f-4c3b-8a6e-2f1d9c7b5a3e",

    outputChildFilename: "shamo_budget_igcse_0606_2024_2025_stage_one_paper.json",
    outputControllerFilename: "shamo_budget_igcse_0606_2024_2025_controller.json",
    outputPublishFilename: "shamo_budget_approve_reviewed_paper.json",
    outputV2ChildFilename: "shamo_budget_igcse_0606_2024_2025_v2_1_stage_one_paper.json",
    outputV2ControllerFilename: "shamo_budget_igcse_0606_2024_2025_v2_1_controller.json",
  },
};

export const DEFAULT_CAMPAIGN_ID = "a-level-9709-test2";

/**
 * Pick a campaign from CLI arguments, defaulting to the original 9709
 * campaign when none is given so `node build_budget_*_workflows.mjs` with no
 * arguments keeps behaving exactly as it always has.
 */
export function resolveCampaign(argv) {
  const requested = (argv || []).find((arg) => !arg.startsWith("--"));
  const campaignId = requested || DEFAULT_CAMPAIGN_ID;
  const campaign = CAMPAIGNS[campaignId];
  if (!campaign) {
    throw new Error(
      `Unknown campaign "${campaignId}". Known campaigns: ${Object.keys(CAMPAIGNS).join(", ")}.`,
    );
  }
  return campaign;
}
