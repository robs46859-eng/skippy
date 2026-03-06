import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  errorResponse,
  handlePreflight,
  jsonResponse,
  requireMethod,
} from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";

type WorkerBody = {
  batchSize?: number;
  maxAttempts?: number;
};

type OutboxEventRow = {
  id: string;
  user_id: string | null;
  event_type: string;
  payload: Record<string, unknown> | null;
  attempts: number;
};

function getServiceRoleKey(): string {
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_KEY") ??
    "";
}

function getSupabaseUrl(): string {
  const url = Deno.env.get("SUPABASE_URL");
  if (!url) {
    throw new Error("Missing SUPABASE_URL.");
  }
  return url;
}

function validateInternalSecret(req: Request): string | null {
  const configuredSecret = Deno.env.get("VAULT_INTERNAL_WORKER_SECRET");
  if (!configuredSecret) {
    return "Missing VAULT_INTERNAL_WORKER_SECRET.";
  }
  const presentedSecret = req.headers.get("x-vault-internal-secret");
  if (!presentedSecret || presentedSecret !== configuredSecret) {
    return "Invalid internal worker secret.";
  }
  return null;
}

function nextRetryIso(attempts: number): string {
  const backoffSeconds = Math.min(30 * Math.max(1, 2 ** (attempts - 1)), 1800);
  return new Date(Date.now() + backoffSeconds * 1000).toISOString();
}

async function invokeBankSync(
  serviceRoleKey: string,
  internalSecret: string,
  userId: string,
  connectionId: string,
): Promise<{ ok: boolean; details?: string }> {
  const supabaseUrl = getSupabaseUrl();
  const response = await fetch(`${supabaseUrl}/functions/v1/vault-bank-sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "Content-Type": "application/json",
      "x-vault-internal-secret": internalSecret,
    },
    body: JSON.stringify({
      userId,
      connectionId,
    }),
  });

  if (response.ok) {
    return { ok: true };
  }

  const payload = await response.json().catch(() => ({}));
  const details = typeof payload?.error === "string"
    ? payload.error
    : `vault-bank-sync failed with status ${response.status}`;
  return { ok: false, details };
}

serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const methodError = requireMethod(req, "POST");
  if (methodError) return methodError;

  const authError = validateInternalSecret(req);
  if (authError) {
    return errorResponse(authError, 401);
  }

  try {
    const body = (await req.json().catch(() => ({}))) as WorkerBody;
    const batchSize = Math.max(1, Math.min(body.batchSize ?? 20, 100));
    const maxAttempts = Math.max(1, Math.min(body.maxAttempts ?? 6, 20));
    const internalSecret = Deno.env.get("VAULT_INTERNAL_WORKER_SECRET") as string;
    const serviceRoleKey = getServiceRoleKey();

    if (!serviceRoleKey) {
      return errorResponse("Missing SUPABASE_SERVICE_ROLE_KEY.", 500);
    }

    const supabase = createServiceClient();
    const nowIso = new Date().toISOString();
    const { data: candidateEvents, error: loadError } = await supabase
      .from("vault_event_outbox")
      .select("id, user_id, event_type, payload, attempts")
      .eq("status", "pending")
      .eq("event_type", "bank_sync_requested")
      .lte("available_at", nowIso)
      .order("created_at", { ascending: true })
      .limit(batchSize);

    if (loadError) {
      return errorResponse("Failed to load pending outbox events.", 500, loadError.message);
    }

    const events = (candidateEvents ?? []) as OutboxEventRow[];
    let claimed = 0;
    let processed = 0;
    let retried = 0;
    let failed = 0;
    const skippedIds: string[] = [];

    for (const event of events) {
      const { data: claimedRows, error: claimError } = await supabase
        .from("vault_event_outbox")
        .update({
          status: "processing",
          attempts: event.attempts + 1,
          last_error: null,
        })
        .eq("id", event.id)
        .eq("status", "pending")
        .select("id, user_id, event_type, payload, attempts")
        .limit(1);

      if (claimError) {
        skippedIds.push(event.id);
        continue;
      }
      if (!claimedRows?.length) {
        skippedIds.push(event.id);
        continue;
      }

      claimed += 1;
      const current = claimedRows[0] as OutboxEventRow;
      const connectionId = String(current.payload?.connectionId ?? "");
      const userId = String(current.user_id ?? "");

      if (!connectionId || !userId) {
        failed += 1;
        await supabase.from("vault_event_outbox")
          .update({
            status: "failed",
            processed_at: new Date().toISOString(),
            last_error: "Outbox event missing user_id or connectionId.",
          })
          .eq("id", current.id);
        continue;
      }

      const result = await invokeBankSync(
        serviceRoleKey,
        internalSecret,
        userId,
        connectionId,
      );

      if (result.ok) {
        processed += 1;
        await supabase.from("vault_event_outbox")
          .update({
            status: "processed",
            processed_at: new Date().toISOString(),
            last_error: null,
          })
          .eq("id", current.id);
      } else if (current.attempts >= maxAttempts) {
        failed += 1;
        await supabase.from("vault_event_outbox")
          .update({
            status: "failed",
            processed_at: new Date().toISOString(),
            last_error: result.details ?? "Unknown worker error.",
          })
          .eq("id", current.id);
      } else {
        retried += 1;
        await supabase.from("vault_event_outbox")
          .update({
            status: "pending",
            available_at: nextRetryIso(current.attempts),
            last_error: result.details ?? "Sync retry scheduled.",
          })
          .eq("id", current.id);
      }
    }

    return jsonResponse({
      status: "ok",
      scanned: events.length,
      claimed,
      processed,
      retried,
      failed,
      skipped: skippedIds.length,
      skippedIds,
    });
  } catch (error) {
    return errorResponse(
      "Unhandled outbox worker error.",
      500,
      error instanceof Error ? error.message : String(error),
    );
  }
});
