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

type ExchangeTokenBody = {
  provider?: SupportedProvider;
  publicToken?: string;
  institutionName?: string;
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
    const body = (await req.json().catch(() => ({}))) as ExchangeTokenBody;
    const provider = resolveProvider(body.provider);
    const publicToken = body.publicToken?.trim();

    if (!publicToken) {
      return errorResponse("Missing required field: publicToken", 400);
    }

    const adapter = getBankAdapter(provider);
    const supabase = createServiceClient();

    const exchange = await adapter.exchangePublicToken({ publicToken });

    const { data: existingConnection, error: existingConnectionError } = await supabase
      .from("vault_bank_connections")
      .select("id, user_id")
      .eq("provider", provider)
      .eq("provider_item_id", exchange.providerItemId)
      .maybeSingle();

    if (existingConnectionError) {
      return errorResponse("Failed to inspect existing connection.", 500, existingConnectionError.message);
    }
    if (existingConnection && existingConnection.user_id !== userId) {
      return errorResponse(
        "This bank connection is already associated with another user.",
        409,
      );
    }

    const { data: connectionRows, error: connectionUpsertError } = await supabase
      .from("vault_bank_connections")
      .upsert({
        user_id: userId,
        provider,
        provider_item_id: exchange.providerItemId,
        access_token_ref: exchange.accessTokenRef,
        institution_name: body.institutionName ?? exchange.institutionName ?? null,
        status: "active",
        last_synced_at: null,
      }, { onConflict: "provider,provider_item_id" })
      .select("id")
      .limit(1);

    if (connectionUpsertError || !connectionRows?.[0]?.id) {
      return errorResponse("Failed to save bank connection.", 500, connectionUpsertError?.message);
    }
    const connectionId = String(connectionRows[0].id);

    if (exchange.accounts.length > 0) {
      const accountRows = exchange.accounts.map((account) => ({
        connection_id: connectionId,
        user_id: userId,
        provider_account_id: account.providerAccountId,
        account_name: account.accountName,
        account_mask: account.accountMask ?? null,
        account_type: account.accountType,
        subtype: account.subtype ?? null,
        iso_currency_code: account.isoCurrencyCode ?? "USD",
        current_balance: account.currentBalance ?? null,
        available_balance: account.availableBalance ?? null,
        credit_limit: account.creditLimit ?? null,
        is_active: true,
      }));

      const { error: accountsUpsertError } = await supabase
        .from("vault_bank_accounts")
        .upsert(accountRows, { onConflict: "connection_id,provider_account_id" });

      if (accountsUpsertError) {
        return errorResponse("Failed to upsert bank accounts.", 500, accountsUpsertError.message);
      }
    }

    await supabase.from("vault_event_outbox").insert({
      user_id: userId,
      event_type: "bank_connection_linked",
      payload: {
        provider,
        connectionId,
        accountCount: exchange.accounts.length,
        requestId: exchange.requestId ?? null,
      },
    });

    await supabase.from("vault_event_outbox").insert({
      user_id: userId,
      event_type: "bank_sync_requested",
      payload: {
        provider,
        connectionId,
        reason: "post_link_initial_sync",
      },
    });

    return jsonResponse({
      status: "ok",
      provider,
      connectionId,
      accountsLinked: exchange.accounts.length,
      institutionName: body.institutionName ?? exchange.institutionName ?? null,
    });
  } catch (error) {
    return errorResponse(
      "Unhandled bank token-exchange error.",
      500,
      error instanceof Error ? error.message : String(error),
    );
  }
});
