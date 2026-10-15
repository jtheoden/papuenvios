// TEMPORARY edge function: moves base64 image_url values to the product-images bucket.
// NOT DEPLOYED by this change. Runbook: .claude/docs/plan_images_to_storage.md
//
// Safety model
//   - Kill switch: the function answers 410 unless system_config has the key
//     'image_migration_token_sha256'. Deleting that row turns it off.
//   - Auth: header x-migration-token; sha256(token) must equal the stored hash.
//   - dry_run defaults to true; only an explicit dry_run=false writes anything.
//   - Idempotent: rows already migrated no longer match 'data:image/%'; an existing
//     object with the same sha256 is reused; a different one is a conflict (never overwritten).
//   - image_url is only changed by public._migrate_image_row (atomic with the backup row),
//     after the uploaded object was verified by size.
//   - No secrets in code: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY come from the environment.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import {
  ALLOWED_TABLES,
  BUCKET,
  buildMigratedPath,
  buildPublicUrl,
  decideAction,
  isImageDataUri,
  newCounters,
  parseDataUri,
  sha256Hex,
  tokenMatches,
} from "./logic.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TOKEN_CONFIG_KEY = "image_migration_token_sha256";
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const isNotFound = (error: { message?: string; status?: number; statusCode?: string | number } | null) => {
  if (!error) return false;
  const message = String(error.message || "").toLowerCase();
  const status = Number(error.status ?? error.statusCode);
  return message.includes("not found") || status === 404 || status === 400;
};

serve(async (req: Request) => {
  if (req.method !== "POST") return json({ message: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json({ message: "Missing configuration" }, 500);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Kill switch first: no stored hash means the function is off, whatever the caller sends
  const { data: config, error: configError } = await supabase
    .from("system_config")
    .select("value_text")
    .eq("key", TOKEN_CONFIG_KEY)
    .maybeSingle();
  if (configError) return json({ message: "Configuration lookup failed" }, 500);
  if (!config?.value_text) return json({ message: "Migration disabled" }, 410);

  if (!(await tokenMatches(req.headers.get("x-migration-token"), config.value_text))) {
    return json({ message: "Unauthorized" }, 401);
  }

  let params: { dry_run?: unknown; limit?: unknown; tables?: unknown } = {};
  try {
    params = await req.json();
  } catch {
    params = {};
  }

  const dryRun = params.dry_run !== false; // default: dry run
  const limit = Math.min(Math.max(Number(params.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const requested = Array.isArray(params.tables) ? params.tables : ALLOWED_TABLES;
  const tables = ALLOWED_TABLES.filter((t: string) => requested.includes(t));

  const counters = newCounters();
  const results: Array<Record<string, unknown>> = [];
  let wouldMigrate = 0;
  let remainingBudget = limit;

  for (const table of tables) {
    if (remainingBudget <= 0) break;

    const { data: rows, error: selectError } = await supabase
      .from(table)
      .select("id, image_url")
      .like("image_url", "data:image/%")
      .order("id")
      .limit(remainingBudget);

    if (selectError) {
      counters.failed += 1;
      results.push({ table, status: "failed", reason: "select_failed" });
      continue;
    }

    for (const row of rows || []) {
      remainingBudget -= 1;
      counters.found += 1;
      const id = String(row.id);
      const uri: string = row.image_url;

      try {
        if (!isImageDataUri(uri)) {
          counters.skipped += 1;
          results.push({ table, id, status: "skipped", reason: "not_a_data_uri" });
          continue;
        }

        const parsed = parseDataUri(uri);
        if (!parsed) {
          counters.failed += 1;
          results.push({ table, id, status: "failed", reason: "invalid_base64" });
          continue;
        }
        if (parsed.mime !== "image/jpeg" && parsed.mime !== "image/jpg") {
          counters.skipped += 1;
          results.push({ table, id, status: "skipped", reason: "unsupported_mime", mime: parsed.mime });
          continue;
        }

        const bytes = parsed.bytes as Uint8Array;
        counters.bytes_before += uri.length;
        const sha256 = await sha256Hex(bytes);
        const path = buildMigratedPath(table, id);
        const publicUrl = buildPublicUrl(SUPABASE_URL, path);

        // Does the object already exist (a previous run)?
        const download = await supabase.storage.from(BUCKET).download(path);
        if (download.error && !isNotFound(download.error)) throw download.error;
        const existing = download.data
          ? { sha256: await sha256Hex(new Uint8Array(await download.data.arrayBuffer())) }
          : null;

        const action = decideAction({ dryRun, existing, sha256 });

        if (action === "dry_run") {
          wouldMigrate += 1;
          results.push({ table, id, status: "dry_run", path, bytes: bytes.length, sha256 });
          continue;
        }
        if (action === "conflict") {
          counters.failed += 1;
          results.push({ table, id, status: "failed", reason: "object_exists_with_different_content", path });
          continue;
        }
        if (action === "upload") {
          const { error: uploadError } = await supabase.storage
            .from(BUCKET)
            .upload(path, bytes, { contentType: "image/jpeg", upsert: false });
          if (uploadError) throw uploadError;
        }

        // Verify what is publicly served before touching the row
        const head = await fetch(publicUrl, { method: "HEAD" });
        const servedBytes = Number(head.headers.get("content-length"));
        if (!head.ok || servedBytes !== bytes.length) {
          counters.failed += 1;
          results.push({ table, id, status: "failed", reason: "verification_failed", path });
          continue;
        }

        const uriSha256 = await sha256Hex(new TextEncoder().encode(uri));
        const { data: changed, error: rpcError } = await supabase.rpc("_migrate_image_row", {
          p_table: table,
          p_id: id,
          p_expected_uri_sha256: uriSha256,
          p_storage_path: path,
          p_object_sha256: sha256,
          p_original_bytes: bytes.length,
          p_public_url: publicUrl,
        });
        if (rpcError) throw rpcError;

        if (changed === true) {
          counters.migrated += 1;
          counters.bytes_after += bytes.length;
          results.push({ table, id, status: "migrated", action, path, bytes: bytes.length, sha256 });
        } else {
          counters.skipped += 1;
          results.push({ table, id, status: "skipped", reason: "changed_concurrently", path });
        }
      } catch (error) {
        counters.failed += 1;
        results.push({ table, id, status: "failed", reason: "exception", detail: String((error as Error)?.message || error) });
      }
    }
  }

  return json({ dry_run: dryRun, limit, would_migrate: wouldMigrate, ...counters, results });
});
