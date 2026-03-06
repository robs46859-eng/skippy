import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { getBankAdapter } from "../_shared/bank-adapters/index.ts";
import type { SupportedProvider } from "../_shared/bank-adapters/index.ts";
import {
  errorResponse,
  handlePreflight,
  jsonResponse,
  requireMethod,
} from "../_shared/http.ts";
import { createServiceClient, requireUserFromRequest } from "../_shared/supabase.ts";

type LinkTokenBody = {
  provider?: SupportedProvider;
  redirectUri?: string;
};

function resolveProvider(provider?: string): SupportedProvider {
  if (provider === "sandbox") return "sandbox";
  if (provider === "plaid") return "plaid";
  const fromEnv = (Deno.env.get("BANK_PROVIDER_DEFAULT") ?? "plaid").toLowerCase();
  return fromEnv === "sandbox" ? "sandbox" : "plaid";
}

serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const methodError = requireMethod(req, "POST");
  if (methodError) return methodError;

  try {
    const { userId } = await requireUserFromRequest(req);
    const body = (await req.json().catch(() => ({}))) as LinkTokenBody;
    const provider = resolveProvider(body.provider);
    const adapter = getBankAdapter(provider);
    const supabase = createServiceClient();

    const webhookUrl = Deno.env.get("PLAID_WEBHOOK_URL") ?? undefined;

    const link = await adapter.createLinkToken({
      userId,
      clientName: "Vault",
      redirectUri: body.redirectUri,
      webhookUrl,
    });

    await supabase.from("vault_event_outbox").insert({
      user_id: userId,
      event_type: "bank_link_token_created",
      payload: {
        provider,
        request_id: link.requestId ?? null,
      },
    });

    return jsonResponse({
      status: "ok",
      provider,
      linkToken: link.linkToken,
      expiration: link.expiration ?? null,
    });
  } catch (error) {
    return errorResponse(
      "Unhandled bank link-token error.",
      500,
      error instanceof Error ? error.message : String(error),
    );
  }
});
