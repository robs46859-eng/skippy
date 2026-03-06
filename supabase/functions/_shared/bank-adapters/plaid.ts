import type {
  AdapterAccount,
  AdapterCreateLinkTokenInput,
  AdapterCreateLinkTokenResult,
  AdapterExchangeTokenInput,
  AdapterExchangeTokenResult,
  AdapterSyncInput,
  AdapterSyncResult,
  AdapterSyncTransaction,
  BankAdapter,
} from "./types.ts";

type PlaidTransactionsSyncResponse = {
  added: Array<{
    transaction_id: string;
    account_id: string;
    amount: number;
    iso_currency_code?: string;
    date: string;
    name: string;
    merchant_name?: string;
    pending?: boolean;
  }>;
  modified: Array<{
    transaction_id: string;
    account_id: string;
    amount: number;
    iso_currency_code?: string;
    date: string;
    name: string;
    merchant_name?: string;
    pending?: boolean;
  }>;
  removed: Array<{ transaction_id: string }>;
  next_cursor?: string;
  has_more?: boolean;
  request_id?: string;
};

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function getPlaidBaseUrl(): string {
  const env = (Deno.env.get("PLAID_ENV") ?? "sandbox").toLowerCase();
  if (env === "production") return "https://production.plaid.com";
  if (env === "development") return "https://development.plaid.com";
  return "https://sandbox.plaid.com";
}

function unwrapAccessTokenRef(accessTokenRef: string): string {
  if (accessTokenRef.startsWith("plaid:")) {
    return accessTokenRef.slice("plaid:".length);
  }
  return accessTokenRef;
}

async function plaidRequest<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const clientId = getRequiredEnv("PLAID_CLIENT_ID");
  const secret = getRequiredEnv("PLAID_SECRET");
  const url = `${getPlaidBaseUrl()}${path}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      secret,
      ...payload,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Plaid ${path} failed (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
}

function normalizeAccountType(type?: string, subtype?: string): string {
  const normalized = (subtype ?? type ?? "checking").toLowerCase();
  if (normalized.includes("credit")) return "credit";
  if (normalized.includes("savings")) return "savings";
  if (normalized.includes("loan")) return "loan";
  if (normalized.includes("investment")) return "investment";
  return "checking";
}

function mapPlaidAccounts(accounts: Array<Record<string, unknown>>): AdapterAccount[] {
  return accounts.map((account) => {
    const balances = (account.balances ?? {}) as Record<string, unknown>;
    const subtype = String(account.subtype ?? "");
    const type = String(account.type ?? "");
    return {
      providerAccountId: String(account.account_id),
      accountName: String(account.name ?? "Linked Account"),
      accountMask: account.mask ? String(account.mask) : undefined,
      accountType: normalizeAccountType(type, subtype),
      subtype: subtype || undefined,
      isoCurrencyCode: balances.iso_currency_code
        ? String(balances.iso_currency_code)
        : "USD",
      currentBalance: balances.current == null ? undefined : Number(balances.current),
      availableBalance: balances.available == null
        ? undefined
        : Number(balances.available),
      creditLimit: balances.limit == null ? undefined : Number(balances.limit),
    };
  });
}

function mapPlaidTransaction(
  txn: PlaidTransactionsSyncResponse["added"][number],
): AdapterSyncTransaction {
  const merchant = txn.merchant_name ?? txn.name;
  return {
    providerTransactionId: String(txn.transaction_id),
    providerAccountId: String(txn.account_id),
    merchantName: merchant,
    description: String(txn.name ?? merchant ?? "Transaction"),
    amount: Number(txn.amount ?? 0) * -1,
    isoCurrencyCode: txn.iso_currency_code ?? "USD",
    postedAt: String(txn.date),
    pending: Boolean(txn.pending),
    normalizedMerchant: merchant?.toLowerCase(),
  };
}

export const plaidAdapter: BankAdapter = {
  provider: "plaid",

  async createLinkToken(
    input: AdapterCreateLinkTokenInput,
  ): Promise<AdapterCreateLinkTokenResult> {
    const products = ["transactions"];
    const countryCodes = (Deno.env.get("PLAID_COUNTRY_CODES") ?? "US")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    const payload: Record<string, unknown> = {
      client_name: input.clientName ?? "Vault",
      language: "en",
      user: {
        client_user_id: input.userId,
      },
      country_codes: countryCodes.length ? countryCodes : ["US"],
      products,
    };

    if (input.redirectUri) payload.redirect_uri = input.redirectUri;
    if (input.webhookUrl) payload.webhook = input.webhookUrl;

    const response = await plaidRequest<{
      link_token: string;
      expiration?: string;
      request_id?: string;
    }>("/link/token/create", payload);

    return {
      linkToken: response.link_token,
      expiration: response.expiration,
      requestId: response.request_id,
    };
  },

  async exchangePublicToken(
    input: AdapterExchangeTokenInput,
  ): Promise<AdapterExchangeTokenResult> {
    const exchange = await plaidRequest<{
      access_token: string;
      item_id: string;
      request_id?: string;
    }>("/item/public_token/exchange", {
      public_token: input.publicToken,
    });

    const accountsResponse = await plaidRequest<{
      accounts: Array<Record<string, unknown>>;
      item?: { institution_id?: string };
    }>("/accounts/get", {
      access_token: exchange.access_token,
    });

    let institutionName: string | undefined;
    const institutionId = accountsResponse.item?.institution_id;
    if (institutionId) {
      try {
        const institutionResponse = await plaidRequest<{
          institution?: { name?: string };
        }>("/institutions/get_by_id", {
          institution_id: institutionId,
          country_codes: ["US"],
        });
        institutionName = institutionResponse.institution?.name;
      } catch {
        institutionName = undefined;
      }
    }

    return {
      providerItemId: exchange.item_id,
      accessTokenRef: `plaid:${exchange.access_token}`,
      institutionName,
      accounts: mapPlaidAccounts(accountsResponse.accounts ?? []),
      requestId: exchange.request_id,
    };
  },

  async syncTransactions(input: AdapterSyncInput): Promise<AdapterSyncResult> {
    const accessToken = unwrapAccessTokenRef(input.accessTokenRef);
    let cursor = input.cursor ?? null;
    let hasMore = true;

    const upserts: AdapterSyncTransaction[] = [];
    const removedProviderTransactionIds: string[] = [];
    let requestId: string | undefined;

    while (hasMore) {
      const response = await plaidRequest<PlaidTransactionsSyncResponse>(
        "/transactions/sync",
        {
          access_token: accessToken,
          cursor,
          count: 100,
        },
      );

      for (const txn of response.added ?? []) {
        upserts.push(mapPlaidTransaction(txn));
      }
      for (const txn of response.modified ?? []) {
        upserts.push(mapPlaidTransaction(txn));
      }
      for (const removed of response.removed ?? []) {
        removedProviderTransactionIds.push(String(removed.transaction_id));
      }

      cursor = response.next_cursor ?? cursor;
      hasMore = Boolean(response.has_more);
      requestId = response.request_id ?? requestId;
    }

    return {
      upserts,
      removedProviderTransactionIds,
      nextCursor: cursor ?? undefined,
      requestId,
    };
  },
};
