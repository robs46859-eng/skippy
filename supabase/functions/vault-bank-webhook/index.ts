import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  errorResponse,
  handlePreflight,
  jsonResponse,
  requireMethod,
} from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";

type PlaidWebhookPayload = {
  webhook_type?: string;
  webhook_code?: string;
  item_id?: string;
};

function shouldTriggerSync(payload: PlaidWebhookPayload): boolean {
  const type = (payload.webhook_type ?? "").toUpperCase();
  const code = (payload.webhook_code ?? "").toUpperCase();

  if (type === "TRANSACTIONS") return true;
  if (code === "SYNC_UPDATES_AVAILABLE") return true;
  if (type === "ITEM" && code === "WEBHOOK_UPDATE_ACKNOWLEDGED") return false;
  return false;
}

function verifyWebhookSecret(req: Request): boolean {
  const expected = Deno.env.get("PLAID_WEBHOOK_SECRET");
  if (!expected) return true;

  const candidate = req.headers.get("x-vault-webhook-secret") ??
    req.headers.get("plaid-webhook-secret") ??
    req.headers.get("x-plaid-webhook-secret");
  return Boolean(candidate && candidate === expected);
}

serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const methodError = requireMethod(req, "POST");
  if (methodError) return methodError;

  if (!verifyWebhookSecret(req)) {
    return errorResponse("Invalid webhook secret.", 401);
  }

  try {
    const rawBody = await req.text();
    const payload = (JSON.parse(rawBody) ?? {}) as PlaidWebhookPayload;
    const webhookType = payload.webhook_type ?? null;
    const webhookCode = payload.webhook_code ?? null;
    const itemId = payload.item_id ?? null;

    const supabase = createServiceClient();
    const { data: eventRows, error: eventInsertError } = await supabase
      .from("vault_bank_webhook_events")
      .insert({
        user_id: null,
        provider: "plaid",
        provider_item_id: itemId,
        webhook_type: webhookType,
        webhook_code: webhookCode,
        status: "received",
        payload,
      })
      .select("id")
      .limit(1);

    if (eventInsertError || !eventRows?.[0]?.id) {
      return errorResponse("Failed to persist webhook event.", 500, eventInsertError?.message);
    }
    const webhookEventId = String(eventRows[0].id);

    if (!itemId) {
      await supabase.from("vault_bank_webhook_events")
        .update({
          status: "ignored",
          error_message: "Missing item_id",
          processed_at: new Date().toISOString(),
        })
        .eq("id", webhookEventId);

      return jsonResponse({
        status: "ignored",
        reason: "missing_item_id",
      });
    }

    const { data: connection, error: connectionError } = await supabase
      .from("vault_bank_connections")
      .select("id, user_id, provider")
      .eq("provider", "plaid")
      .eq("provider_item_id", itemId)
      .maybeSingle();

    if (connectionError) {
      await supabase.from("vault_bank_webhook_events")
        .update({
          status: "failed",
          error_message: connectionError.message,
          processed_at: new Date().toISOString(),
        })
        .eq("id", webhookEventId);

      return errorResponse("Failed to resolve bank connection for webhook.", 500, connectionError.message);
    }

    if (!connection) {
      await supabase.from("vault_bank_webhook_events")
        .update({
          status: "ignored",
          error_message: "No connection found for item_id",
          processed_at: new Date().toISOString(),
        })
        .eq("id", webhookEventId);

      return jsonResponse({
        status: "ignored",
        reason: "connection_not_found",
      });
    }

    let queuedSync = false;
    if (shouldTriggerSync(payload)) {
      queuedSync = true;
      const { error: queueError } = await supabase.from("vault_event_outbox").insert({
        user_id: connection.user_id,
        event_type: "bank_sync_requested",
        payload: {
          connectionId: connection.id,
          provider: connection.provider,
          reason: "provider_webhook",
          webhookType,
          webhookCode,
          providerItemId: itemId,
        },
      });

      if (queueError) {
        await supabase.from("vault_bank_webhook_events")
          .update({
            user_id: connection.user_id,
            status: "failed",
            error_message: queueError.message,
            processed_at: new Date().toISOString(),
          })
          .eq("id", webhookEventId);

        return errorResponse("Failed to enqueue sync from webhook.", 500, queueError.message);
      }
    }

    await supabase.from("vault_bank_webhook_events")
      .update({
        user_id: connection.user_id,
        status: queuedSync ? "processed" : "ignored",
        processed_at: new Date().toISOString(),
      })
      .eq("id", webhookEventId);

    return jsonResponse({
      status: "ok",
      queuedSync,
      connectionId: connection.id,
      provider: connection.provider,
      webhookEventId,
    });
  } catch (error) {
    return errorResponse(
      "Unhandled bank webhook error.",
      500,
      error instanceof Error ? error.message : String(error),
    );
  }
});
