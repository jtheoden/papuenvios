// purge-refund-proofs: deletes refund proofs one year after the refund, through the Storage API.   NOT DEPLOYED.
//
// Why an Edge Function: removing storage.objects rows by SQL leaves the blob behind. The database only decides WHAT is due
// (_refund_proofs_due) and records the outcome (_mark_refund_proof_purged, which re-checks expiry and disputes under a row lock);
// this function deletes the files.
//
// POST { "mode": "preview" }                              -> { due: number }                (nothing is deleted)
// POST { "mode": "execute", "confirm_count": <number> }   -> { purged, skipped, failed }    (refused unless confirm_count equals the
//                                                            current preview count: the admin saw the number he confirms)
// Caller: an enabled admin (JWT). Paths come ONLY from the database, never from the request. Idempotent: a missing file (404) counts
// as deleted, the mark step is a no-op the second time. Order: delete the file first, then mark; a failed mark is retried next run.
// Logs: counts only. Never a path, a reference or a signed URL.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const BUCKET = "refund-proofs";
const BATCH = 100;

serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req, "POST, OPTIONS");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders, status: 200 });
  if (req.method !== "POST") return json({ message: "Method not allowed" }, 405, corsHeaders);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ message: "Missing configuration" }, 500, corsHeaders);
  }

  const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData?.user) return json({ message: "Invalid session" }, 401, corsHeaders);

  const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: profile } = await service.from("user_profiles").select("role, is_enabled").eq("id", userData.user.id).maybeSingle();
  const isAdmin = profile && ["admin", "super_admin"].includes(profile.role) && profile.is_enabled !== false;
  if (!isAdmin) return json({ message: "Only administrators can purge refund proofs" }, 403, corsHeaders);

  const body = await req.json().catch(() => null);
  const mode = body?.mode;
  if (mode !== "preview" && mode !== "execute") return json({ message: "mode must be preview or execute" }, 400, corsHeaders);

  try {
    const due = await listDue(service);
    if (mode === "preview") return json({ due: due.length, capped: due.length >= BATCH }, 200, corsHeaders);

    if (!Number.isInteger(body?.confirm_count) || body.confirm_count !== due.length) {
      return json({ message: "confirm_count does not match the current preview; run the preview again", due: due.length }, 409, corsHeaders);
    }

    let purged = 0;
    let skipped = 0;
    let failed = 0;
    for (const item of due) {
      // Re-check for a dispute right before deleting (the list may be minutes old). Residual race: a dispute opened between
      // this check and the remove below still loses the file; the row then stays for review (see _mark_refund_proof_purged).
      const { data: disputed, error: disputeError } = await service.rpc("_refund_dispute_open", { p_refund_id: item.refund_id });
      if (disputeError) {
        failed += 1;
        continue;
      }
      if (disputed === true) {
        skipped += 1;
        continue;
      }
      const { error: removeError } = await service.storage.from(BUCKET).remove([item.proof_path]);
      // A file that is already gone is fine (idempotent); any other storage error leaves the row untouched for the next run.
      if (removeError && !/not.?found|404/i.test(String(removeError.message ?? ""))) {
        failed += 1;
        continue;
      }
      const { data: marked, error: markError } = await service.rpc("_mark_refund_proof_purged", {
        p_refund_id: item.refund_id,
        p_actor: userData.user.id,
      });
      if (markError) failed += 1;
      else if (marked === true) purged += 1;
      else skipped += 1; // no longer due (a dispute was opened meanwhile): the file is already gone, the row stays for review
    }
    console.info(`[purge-refund-proofs] purged=${purged} skipped=${skipped} failed=${failed}`);
    return json({ purged, skipped, failed }, 200, corsHeaders);
  } catch (_err) {
    console.error("[purge-refund-proofs] unexpected error");
    return json({ message: "Unexpected error" }, 500, corsHeaders);
  }
});

async function listDue(service: ReturnType<typeof createClient>): Promise<{ refund_id: string; proof_path: string }[]> {
  const { data, error } = await service.rpc("_refund_proofs_due", { p_limit: BATCH });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

function json(payload: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(payload), { status, headers: { ...headers, "Content-Type": "application/json" } });
}
