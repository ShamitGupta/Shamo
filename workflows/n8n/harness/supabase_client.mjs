// Minimal PostgREST client for the harness.
//
// Every shamo_* table has RLS enabled with no anon/authenticated policies, so a
// service-role key is required. Credentials come from workflows/n8n/harness/.env
// (gitignored). See .env.example.
//
// Read-only by design: `select` and `rpc` are the only verbs exposed. If a
// harness script needs to write, it must go through a reviewed n8n workflow or
// a versioned database/ SQL file -- not through this module.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HARNESS_DIR, "..", "..", "..");

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

export function loadConfig() {
  const harnessEnv = parseEnvFile(path.join(HARNESS_DIR, ".env"));
  const backendEnv = parseEnvFile(path.join(REPO_ROOT, "backend", ".env"));

  const url =
    process.env.SUPABASE_URL || harnessEnv.SUPABASE_URL || backendEnv.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || harnessEnv.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("SUPABASE_URL is not set. Copy harness/.env.example to harness/.env.");
  }
  if (!key) {
    throw new Error(
      [
        "SUPABASE_SERVICE_ROLE_KEY is not set.",
        "",
        "  1. Copy workflows/n8n/harness/.env.example to workflows/n8n/harness/.env",
        "  2. Paste the service_role key from Supabase dashboard ->",
        "     Project Settings -> API -> service_role (secret)",
        "",
        "The anon key in backend/.env cannot read shamo_ingestion_pages (401,",
        "permission denied) because RLS is enabled with no anon policies.",
        "harness/.gitignore excludes .env, so the key stays out of git.",
      ].join("\n"),
    );
  }
  return { url: url.replace(/\/+$/, ""), key };
}

/** Assert the key really is service_role before doing anything else. */
export function describeKey(key) {
  try {
    const payload = JSON.parse(Buffer.from(key.split(".")[1], "base64").toString("utf8"));
    return { role: payload.role, expiresAt: new Date(payload.exp * 1000).toISOString() };
  } catch {
    return { role: "unknown", expiresAt: null };
  }
}

/**
 * Paginated PostgREST select. Returns all rows, following Range headers so a
 * table larger than the server's max-rows setting is still fetched completely.
 */
export async function select(table, { columns = "*", filter = "", order = "", pageSize = 500 } = {}) {
  const { url, key } = loadConfig();
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const query = [`select=${encodeURIComponent(columns)}`];
    if (filter) query.push(filter);
    if (order) query.push(`order=${encodeURIComponent(order)}`);
    const endpoint = `${url}/rest/v1/${table}?${query.join("&")}`;

    const response = await fetch(endpoint, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Range: `${offset}-${offset + pageSize - 1}`,
        "Range-Unit": "items",
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(`${table} -> HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    const page = await response.json();
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

/** Call a Postgres function. Used for read-only reporting RPCs only. */
export async function rpc(fn, body = {}) {
  const { url, key } = loadConfig();
  const response = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`rpc ${fn} -> HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  return response.json();
}

/** Stable key for a paper: 9709_2024_may_june_62 */
export function paperKey(paper) {
  return [paper.syllabus_code, paper.year, paper.exam_session, paper.paper_variant].join("_");
}
