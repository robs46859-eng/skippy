import type {
  AdapterCreateLinkTokenInput,
  AdapterCreateLinkTokenResult,
  AdapterExchangeTokenInput,
  AdapterExchangeTokenResult,
  AdapterSyncInput,
  AdapterSyncResult,
  BankAdapter,
} from "./types.ts";

function randomToken(prefix: string): string {
  const random = crypto.getRandomValues(new Uint8Array(8));
  const suffix = Array.from(random).map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${suffix}`;
}

export const sandboxAdapter: BankAdapter = {
  provider: "sandbox",

  async createLinkToken(
    _input: AdapterCreateLinkTokenInput,
  ): Promise<AdapterCreateLinkTokenResult> {
    return {
      linkToken: randomToken("sandbox_link"),
      expiration: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
      requestId: randomToken("req"),
    };
  },

  async exchangePublicToken(
    input: AdapterExchangeTokenInput,
  ): Promise<AdapterExchangeTokenResult> {
    const safePublicToken = input.publicToken.replaceAll(/[^a-zA-Z0-9_-]/g, "").slice(0, 24);
    const providerItemId = `sandbox_item_${safePublicToken || "default"}`;
    return {
      providerItemId,
      accessTokenRef: `sandbox:${providerItemId}`,
      institutionName: "Vault Sandbox Bank",
      accounts: [
        {
          providerAccountId: `${providerItemId}_checking`,
          accountName: "Sandbox Checking",
          accountMask: "0001",
          accountType: "checking",
          subtype: "checking",
          isoCurrencyCode: "USD",
          currentBalance: 4200,
          availableBalance: 4100,
        },
      ],
      requestId: randomToken("req"),
    };
  },

  async syncTransactions(_input: AdapterSyncInput): Promise<AdapterSyncResult> {
    return {
      upserts: [],
      removedProviderTransactionIds: [],
      nextCursor: `sandbox:${new Date().toISOString()}`,
      requestId: randomToken("req"),
    };
  },
};
