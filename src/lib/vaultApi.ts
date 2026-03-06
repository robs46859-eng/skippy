const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

type SupportedProvider = 'plaid' | 'sandbox';

async function callVaultFunction<TResponse>(
  functionName: string,
  accessToken: string,
  body: Record<string, unknown>,
): Promise<TResponse> {
  if (!supabaseUrl) {
    throw new Error('EXPO_PUBLIC_SUPABASE_URL is not configured.');
  }
  if (!supabaseAnonKey) {
    throw new Error('EXPO_PUBLIC_SUPABASE_ANON_KEY is not configured.');
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.error === 'string'
      ? payload.error
      : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload as TResponse;
}

export type BankLinkTokenResponse = {
  status: 'ok';
  provider: SupportedProvider;
  linkToken: string;
  expiration?: string | null;
};

export type BankExchangeTokenResponse = {
  status: 'ok';
  provider: SupportedProvider;
  connectionId: string;
  accountsLinked: number;
  institutionName?: string | null;
};

export type BankSyncResponse = {
  status: 'ok';
  connectionId: string;
  provider: string;
  accountsSynced: number;
  transactionsSynced: number;
  transactionsProcessed: number;
  transactionsRemoved: number;
  budgetsEvaluated: number;
  overspendAlertsCreated: number;
};

export type InsightsGenerateResponse = {
  status: 'ok';
  riskLevel: 'low' | 'medium' | 'high';
  summary: string;
  recommendationsCreated: number;
};

export type WeeklyCardGenerateResponse = {
  status: 'ok';
  card: {
    id: string;
    amountSaved: number;
    headline: string;
    shareUrl: string;
    thisWeekSpend: number;
    previousWeekSpend: number;
  };
  referralCode: string;
};

export async function createBankLinkToken(
  accessToken: string,
  provider: SupportedProvider,
): Promise<BankLinkTokenResponse> {
  return callVaultFunction<BankLinkTokenResponse>('vault-bank-link-token', accessToken, {
    provider,
  });
}

export async function exchangeBankPublicToken(
  accessToken: string,
  provider: SupportedProvider,
  publicToken: string,
): Promise<BankExchangeTokenResponse> {
  return callVaultFunction<BankExchangeTokenResponse>(
    'vault-bank-exchange-token',
    accessToken,
    { provider, publicToken },
  );
}

export async function syncBankConnection(
  accessToken: string,
  connectionId: string,
): Promise<BankSyncResponse> {
  return callVaultFunction<BankSyncResponse>('vault-bank-sync', accessToken, { connectionId });
}

export async function generateInsights(
  accessToken: string,
): Promise<InsightsGenerateResponse> {
  return callVaultFunction<InsightsGenerateResponse>('vault-insights-generate', accessToken, {});
}

export async function generateWeeklyCard(
  accessToken: string,
): Promise<WeeklyCardGenerateResponse> {
  return callVaultFunction<WeeklyCardGenerateResponse>('vault-cards-weekly-generate', accessToken, {});
}
