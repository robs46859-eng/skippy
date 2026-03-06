export type SupportedProvider = "plaid" | "sandbox";

export type AdapterCreateLinkTokenInput = {
  userId: string;
  clientName?: string;
  redirectUri?: string;
  webhookUrl?: string;
  androidPackageName?: string;
};

export type AdapterCreateLinkTokenResult = {
  linkToken: string;
  expiration?: string;
  requestId?: string;
};

export type AdapterExchangeTokenInput = {
  publicToken: string;
};

export type AdapterAccount = {
  providerAccountId: string;
  accountName: string;
  accountMask?: string;
  accountType: string;
  subtype?: string;
  isoCurrencyCode?: string;
  currentBalance?: number;
  availableBalance?: number;
  creditLimit?: number;
};

export type AdapterExchangeTokenResult = {
  providerItemId: string;
  accessTokenRef: string;
  institutionName?: string;
  accounts: AdapterAccount[];
  requestId?: string;
};

export type AdapterSyncInput = {
  accessTokenRef: string;
  cursor?: string | null;
};

export type AdapterSyncTransaction = {
  providerTransactionId: string;
  providerAccountId: string;
  merchantName?: string;
  description: string;
  amount: number;
  isoCurrencyCode?: string;
  postedAt: string;
  pending: boolean;
  normalizedMerchant?: string;
};

export type AdapterSyncResult = {
  upserts: AdapterSyncTransaction[];
  removedProviderTransactionIds: string[];
  nextCursor?: string;
  requestId?: string;
};

export interface BankAdapter {
  provider: SupportedProvider;
  createLinkToken(input: AdapterCreateLinkTokenInput): Promise<AdapterCreateLinkTokenResult>;
  exchangePublicToken(input: AdapterExchangeTokenInput): Promise<AdapterExchangeTokenResult>;
  syncTransactions(input: AdapterSyncInput): Promise<AdapterSyncResult>;
}
