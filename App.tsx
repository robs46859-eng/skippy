import { StatusBar } from 'expo-status-bar';
import { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { supabase } from './src/lib/supabase';
import {
  createBankLinkToken,
  exchangeBankPublicToken,
  generateInsights,
  generateWeeklyCard,
  syncBankConnection,
  WeeklyCardGenerateResponse,
} from './src/lib/vaultApi';

type TabKey = 'dashboard' | 'activity' | 'goals' | 'social' | 'insights';
type BankProvider = 'plaid' | 'sandbox';

type DashboardSnapshot = {
  periodStart: string;
  periodEnd: string;
  totalSpent: number;
  totalBudgetLimit: number;
  totalRemaining: number;
  projectedPeriodSpend: number;
  avgUtilizationPct: number;
};

type AlertCounts = {
  unreadTotal: number;
  unreadCritical: number;
  unreadOverspend: number;
};

type GoalRow = {
  id: string;
  title: string;
  currentAmount: number;
  targetAmount: number;
  status: string;
};

type TransactionRow = {
  id: string;
  merchantName: string;
  description: string;
  amount: number;
  postedAt: string;
};

type ForecastRow = {
  horizonDays: number;
  predictedEndBalance: number;
  predictedMinBalance: number;
  riskLevel: string;
};

const tabLabels: Record<TabKey, string> = {
  dashboard: 'Dashboard',
  activity: 'Activity',
  goals: 'Goals',
  social: 'Social',
  insights: 'AI',
};

function currency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function ProgressBar({ progress }: { progress: number }) {
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(progress, 1)) * 100}%` }]} />
    </View>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authBooting, setAuthBooting] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const [authMode, setAuthMode] = useState<'sign_in' | 'sign_up'>('sign_in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [provider, setProvider] = useState<BankProvider>('sandbox');
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [publicToken, setPublicToken] = useState('');
  const [connectedConnectionId, setConnectedConnectionId] = useState<string | null>(null);
  const [bankMessage, setBankMessage] = useState<string | null>(null);
  const [bankLoading, setBankLoading] = useState(false);

  const [dashboardSnapshot, setDashboardSnapshot] = useState<DashboardSnapshot | null>(null);
  const [alertCounts, setAlertCounts] = useState<AlertCounts>({
    unreadTotal: 0,
    unreadCritical: 0,
    unreadOverspend: 0,
  });
  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [forecast, setForecast] = useState<ForecastRow | null>(null);
  const [latestSummary, setLatestSummary] = useState<string | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsMessage, setInsightsMessage] = useState<string | null>(null);
  const [weeklyCard, setWeeklyCard] = useState<WeeklyCardGenerateResponse['card'] | null>(null);
  const [weeklyCardReferralCode, setWeeklyCardReferralCode] = useState<string | null>(null);
  const [weeklyCardLoading, setWeeklyCardLoading] = useState(false);

  useEffect(() => {
    const bootstrapSession = async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session ?? null);
      setAuthBooting(false);
    };

    bootstrapSession();
    const authSub = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
    });

    return () => {
      authSub.data.subscription.unsubscribe();
    };
  }, []);

  const loadDashboard = useCallback(async () => {
    const userId = session?.user.id;
    if (!userId) {
      setDashboardSnapshot(null);
      setAlertCounts({ unreadTotal: 0, unreadCritical: 0, unreadOverspend: 0 });
      setGoals([]);
      setTransactions([]);
      setForecast(null);
      setLatestSummary(null);
      return;
    }

    setDashboardLoading(true);
    setDashboardError(null);

    try {
      const [
        snapshotsRes,
        alertCountsRes,
        goalsRes,
        txRes,
        forecastRes,
        summaryRes,
      ] = await Promise.all([
        supabase
          .from('vault_dashboard_snapshots')
          .select(
            'period_start, period_end, total_spent, total_budget_limit, total_remaining, projected_period_spend, avg_utilization_pct',
          )
          .eq('user_id', userId)
          .order('period_start', { ascending: false })
          .limit(1),
        supabase
          .from('vault_dashboard_alert_counts')
          .select('unread_total, unread_critical, unread_overspend')
          .eq('user_id', userId)
          .maybeSingle(),
        supabase
          .from('vault_savings_goals')
          .select('id, title, current_amount, target_amount, status')
          .eq('user_id', userId)
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(3),
        supabase
          .from('vault_transactions')
          .select('id, merchant_name, description, amount, posted_at')
          .eq('user_id', userId)
          .order('posted_at', { ascending: false })
          .limit(6),
        supabase
          .from('vault_cashflow_forecasts')
          .select('horizon_days, predicted_end_balance, predicted_min_balance, risk_level')
          .eq('user_id', userId)
          .order('generated_at', { ascending: false })
          .limit(1),
        supabase
          .from('vault_ai_summaries')
          .select('summary_markdown')
          .eq('user_id', userId)
          .order('generated_at', { ascending: false })
          .limit(1),
      ]);

      if (snapshotsRes.error) throw snapshotsRes.error;
      if (alertCountsRes.error) throw alertCountsRes.error;
      if (goalsRes.error) throw goalsRes.error;
      if (txRes.error) throw txRes.error;
      if (forecastRes.error) throw forecastRes.error;
      if (summaryRes.error) throw summaryRes.error;

      const snapshotRow = snapshotsRes.data?.[0] as
        | {
            period_start: string;
            period_end: string;
            total_spent: number;
            total_budget_limit: number;
            total_remaining: number;
            projected_period_spend: number;
            avg_utilization_pct: number;
          }
        | undefined;

      if (snapshotRow) {
        setDashboardSnapshot({
          periodStart: snapshotRow.period_start,
          periodEnd: snapshotRow.period_end,
          totalSpent: Number(snapshotRow.total_spent ?? 0),
          totalBudgetLimit: Number(snapshotRow.total_budget_limit ?? 0),
          totalRemaining: Number(snapshotRow.total_remaining ?? 0),
          projectedPeriodSpend: Number(snapshotRow.projected_period_spend ?? 0),
          avgUtilizationPct: Number(snapshotRow.avg_utilization_pct ?? 0),
        });
      } else {
        setDashboardSnapshot(null);
      }

      const alertRow = alertCountsRes.data as
        | {
            unread_total: number;
            unread_critical: number;
            unread_overspend: number;
          }
        | null;

      setAlertCounts({
        unreadTotal: Number(alertRow?.unread_total ?? 0),
        unreadCritical: Number(alertRow?.unread_critical ?? 0),
        unreadOverspend: Number(alertRow?.unread_overspend ?? 0),
      });

      const nextGoals: GoalRow[] = (goalsRes.data ?? []).map((row) => ({
        id: String(row.id),
        title: String(row.title),
        currentAmount: Number(row.current_amount ?? 0),
        targetAmount: Number(row.target_amount ?? 0),
        status: String(row.status ?? 'active'),
      }));
      setGoals(nextGoals);

      const nextTx: TransactionRow[] = (txRes.data ?? []).map((row) => ({
        id: String(row.id),
        merchantName: String(row.merchant_name ?? ''),
        description: String(row.description ?? ''),
        amount: Number(row.amount ?? 0),
        postedAt: String(row.posted_at ?? ''),
      }));
      setTransactions(nextTx);

      const forecastRow = forecastRes.data?.[0] as
        | {
            horizon_days: number;
            predicted_end_balance: number;
            predicted_min_balance: number;
            risk_level: string;
          }
        | undefined;
      setForecast(
        forecastRow
          ? {
              horizonDays: Number(forecastRow.horizon_days ?? 14),
              predictedEndBalance: Number(forecastRow.predicted_end_balance ?? 0),
              predictedMinBalance: Number(forecastRow.predicted_min_balance ?? 0),
              riskLevel: String(forecastRow.risk_level ?? 'low'),
            }
          : null,
      );

      const summaryRow = summaryRes.data?.[0] as
        | { summary_markdown: string }
        | undefined;
      setLatestSummary(summaryRow?.summary_markdown ?? null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to refresh dashboard data.';
      setDashboardError(message);
    } finally {
      setDashboardLoading(false);
    }
  }, [session?.user.id]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    const userId = session?.user.id;
    if (!userId) return;

    const channel = supabase
      .channel(`vault-live-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'vault_budget_snapshots',
          filter: `user_id=eq.${userId}`,
        },
        loadDashboard,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'vault_alerts',
          filter: `user_id=eq.${userId}`,
        },
        loadDashboard,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'vault_savings_goals',
          filter: `user_id=eq.${userId}`,
        },
        loadDashboard,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadDashboard, session?.user.id]);

  const totals = useMemo(() => {
    if (dashboardSnapshot) {
      return {
        spent: dashboardSnapshot.totalSpent,
        limit: dashboardSnapshot.totalBudgetLimit,
        remaining: dashboardSnapshot.totalRemaining,
        projected: dashboardSnapshot.projectedPeriodSpend,
      };
    }

    return {
      spent: 0,
      limit: 0,
      remaining: 0,
      projected: 0,
    };
  }, [dashboardSnapshot]);

  const handleAuth = useCallback(async () => {
    if (!email.trim() || !password.trim()) {
      setAuthError('Email and password are required.');
      return;
    }

    setAuthLoading(true);
    setAuthError(null);
    try {
      if (authMode === 'sign_in') {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        Alert.alert('Account created', 'Check your inbox if your project requires email confirmation.');
        setAuthMode('sign_in');
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Auth failed.');
    } finally {
      setAuthLoading(false);
    }
  }, [authMode, email, password]);

  const handleSignOut = useCallback(async () => {
    await supabase.auth.signOut();
    setConnectedConnectionId(null);
    setLinkToken(null);
    setPublicToken('');
    setBankMessage(null);
    setWeeklyCard(null);
    setWeeklyCardReferralCode(null);
  }, []);

  const exchangeAndSync = useCallback(
    async (providerToUse: BankProvider, publicTokenToUse: string) => {
      if (!session?.access_token) return;
      if (!publicTokenToUse.trim()) {
        setBankMessage('Public token is required.');
        return;
      }

      setBankLoading(true);
      setBankMessage(null);
      try {
        const exchange = await exchangeBankPublicToken(
          session.access_token,
          providerToUse,
          publicTokenToUse.trim(),
        );
        setConnectedConnectionId(exchange.connectionId);

        const sync = await syncBankConnection(session.access_token, exchange.connectionId);
        setBankMessage(
          `Connected ${exchange.accountsLinked} account(s). Synced ${sync.transactionsProcessed} transactions.`,
        );

        await loadDashboard();
        setPublicToken('');
      } catch (error) {
        setBankMessage(error instanceof Error ? error.message : 'Connection sync failed.');
      } finally {
        setBankLoading(false);
      }
    },
    [loadDashboard, session?.access_token],
  );

  const launchPlaidLink = useCallback(
    async (token: string) => {
      if (Platform.OS === 'web') {
        setBankMessage(
          'Plaid native Link is not supported on web. Use iOS/Android dev build, or manual public token fallback.',
        );
        return;
      }

      const plaid = await import('react-native-plaid-link-sdk');
      try {
        await plaid.destroy();
      } catch {
        // Safe to ignore; destroy can fail when no prior instance exists.
      }

      plaid.create({
        token,
        noLoadingState: false,
        onLoad: () => {
          setBankMessage('Plaid Link loaded. Complete bank auth to continue.');
        },
      });

      plaid.open({
        onSuccess: async (success) => {
          await exchangeAndSync('plaid', success.publicToken);
        },
        onExit: (exit) => {
          if (exit?.error) {
            const details = exit.error.displayMessage ?? exit.error.errorMessage;
            setBankMessage(details || 'Plaid Link exited with an error.');
            return;
          }
          setBankMessage('Plaid Link closed before completion.');
        },
      });
    },
    [exchangeAndSync],
  );

  const handleCreateLinkToken = useCallback(async () => {
    if (!session?.access_token) return;
    setBankLoading(true);
    setBankMessage(null);
    try {
      const plaidRedirectUri = process.env.EXPO_PUBLIC_PLAID_REDIRECT_URI || undefined;
      const response = await createBankLinkToken(
        session.access_token,
        provider,
        provider === 'plaid' ? plaidRedirectUri : undefined,
      );
      setLinkToken(response.linkToken);
      if (provider === 'sandbox') {
        await exchangeAndSync('sandbox', `sandbox-public-${Date.now()}`);
        return;
      }

      await launchPlaidLink(response.linkToken);
    } catch (error) {
      setBankMessage(error instanceof Error ? error.message : 'Failed to create link token.');
    } finally {
      setBankLoading(false);
    }
  }, [exchangeAndSync, launchPlaidLink, provider, session?.access_token]);

  const handleExchangeAndSync = useCallback(async () => {
    if (!publicToken.trim()) {
      setBankMessage('Public token is required.');
      return;
    }
    await exchangeAndSync(provider, publicToken);
  }, [exchangeAndSync, provider, publicToken]);

  const handleRunInsights = useCallback(async () => {
    if (!session?.access_token) return;
    setInsightsLoading(true);
    setInsightsMessage(null);
    try {
      const response = await generateInsights(session.access_token);
      setInsightsMessage(
        `Insights refreshed • risk ${response.riskLevel.toUpperCase()} • ${response.recommendationsCreated} recommendations.`,
      );
      await loadDashboard();
    } catch (error) {
      setInsightsMessage(error instanceof Error ? error.message : 'Failed to generate insights.');
    } finally {
      setInsightsLoading(false);
    }
  }, [loadDashboard, session?.access_token]);

  const handleGenerateCard = useCallback(async () => {
    if (!session?.access_token) return;
    setWeeklyCardLoading(true);
    try {
      const response = await generateWeeklyCard(session.access_token);
      setWeeklyCard(response.card);
      setWeeklyCardReferralCode(response.referralCode);
    } catch (error) {
      Alert.alert('Card generation failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setWeeklyCardLoading(false);
    }
  }, [session?.access_token]);

  if (authBooting) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        <View style={styles.center}>
          <ActivityIndicator color="#5BC4FF" />
          <Text style={styles.centerText}>Initializing secure session...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        <KeyboardAvoidingView
          style={styles.authRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.authCard}>
            <Text style={styles.eyebrow}>VAULT</Text>
            <Text style={styles.title}>Secure sign-in</Text>
            <Text style={styles.cardBody}>
              Authenticate to connect bank accounts, run budget intelligence, and sync real-time insights.
            </Text>

            <TextInput
              style={styles.input}
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              placeholderTextColor="#778DB6"
            />
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="Password"
              placeholderTextColor="#778DB6"
            />

            {!!authError && <Text style={styles.errorText}>{authError}</Text>}

            <Pressable onPress={handleAuth} style={styles.primaryButton} disabled={authLoading}>
              <Text style={styles.primaryButtonText}>
                {authLoading
                  ? 'Working...'
                  : authMode === 'sign_in'
                  ? 'Sign in'
                  : 'Create account'}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setAuthMode((prev) => (prev === 'sign_in' ? 'sign_up' : 'sign_in'))}
              style={styles.ghostButton}
            >
              <Text style={styles.ghostButtonText}>
                {authMode === 'sign_in'
                  ? "Need an account? Sign up"
                  : 'Already have an account? Sign in'}
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={styles.root}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>VAULT</Text>
            <Text style={styles.title}>Your money, on autopilot.</Text>
            <Text style={styles.smallText}>{session.user.email}</Text>
          </View>
          <Pressable style={styles.streakPill} onPress={handleSignOut}>
            <Text style={styles.streakText}>Sign out</Text>
          </Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {activeTab === 'dashboard' && (
            <>
              <Text style={styles.sectionTitle}>Bank Connect</Text>
              <View style={styles.card}>
                <View style={styles.rowSpace}>
                  <Text style={styles.cardTitle}>Provider</Text>
                  <View style={styles.inlineRow}>
                    <Pressable
                      style={[styles.providerChip, provider === 'sandbox' && styles.providerChipActive]}
                      onPress={() => setProvider('sandbox')}
                    >
                      <Text
                        style={[
                          styles.providerChipText,
                          provider === 'sandbox' && styles.providerChipTextActive,
                        ]}
                      >
                        Sandbox
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[styles.providerChip, provider === 'plaid' && styles.providerChipActive]}
                      onPress={() => setProvider('plaid')}
                    >
                      <Text
                        style={[
                          styles.providerChipText,
                          provider === 'plaid' && styles.providerChipTextActive,
                        ]}
                      >
                        Plaid
                      </Text>
                    </Pressable>
                  </View>
                </View>
                <Pressable style={styles.secondaryButton} onPress={handleCreateLinkToken} disabled={bankLoading}>
                  <Text style={styles.secondaryButtonText}>
                    {bankLoading
                      ? 'Preparing...'
                      : provider === 'plaid'
                      ? 'Connect with Plaid Link'
                      : 'Connect sandbox account'}
                  </Text>
                </Pressable>

                {linkToken && (
                  <Text style={styles.smallText}>
                    Link token ready: {linkToken.slice(0, 16)}...{linkToken.slice(-6)}
                  </Text>
                )}
                {provider === 'plaid' && (
                  <>
                    <TextInput
                      style={styles.input}
                      value={publicToken}
                      onChangeText={setPublicToken}
                      autoCapitalize="none"
                      placeholder="Manual fallback: paste Plaid public token"
                      placeholderTextColor="#778DB6"
                    />
                    <Pressable
                      style={styles.primaryButton}
                      onPress={handleExchangeAndSync}
                      disabled={bankLoading || !publicToken.trim()}
                    >
                      <Text style={styles.primaryButtonText}>
                        {bankLoading ? 'Connecting...' : 'Manual exchange + sync'}
                      </Text>
                    </Pressable>
                  </>
                )}
                {!!connectedConnectionId && (
                  <Text style={styles.smallText}>Connected ID: {connectedConnectionId}</Text>
                )}
                {!!bankMessage && <Text style={styles.cardBody}>{bankMessage}</Text>}
              </View>

              <View style={[styles.card, styles.heroCard]}>
                <Text style={styles.cardLabel}>Monthly Budget</Text>
                <Text style={styles.heroNumber}>
                  {currency(totals.spent)} <Text style={styles.heroSub}>/ {currency(totals.limit)}</Text>
                </Text>
                <ProgressBar progress={totals.limit > 0 ? totals.spent / totals.limit : 0} />
                <View style={styles.kpiRow}>
                  <View>
                    <Text style={styles.kpiLabel}>Remaining</Text>
                    <Text style={styles.kpiValue}>{currency(totals.remaining)}</Text>
                  </View>
                  <View>
                    <Text style={styles.kpiLabel}>Forecasted End</Text>
                    <Text style={styles.kpiValue}>{currency(totals.projected)}</Text>
                  </View>
                </View>
                <View style={styles.alertBadge}>
                  <Text style={styles.alertText}>
                    Alerts: {alertCounts.unreadTotal} unread • {alertCounts.unreadCritical} critical •{' '}
                    {alertCounts.unreadOverspend} overspend
                  </Text>
                </View>
              </View>

              <Text style={styles.sectionTitle}>Cash-Flow Snapshot</Text>
              <View style={styles.card}>
                <Text style={styles.cardBody}>
                  Forecast: {forecast ? currency(forecast.predictedEndBalance) : '--'} • Minimum balance:{' '}
                  {forecast ? currency(forecast.predictedMinBalance) : '--'} • Risk:{' '}
                  {forecast ? forecast.riskLevel.toUpperCase() : 'N/A'}
                </Text>
                <Pressable style={styles.secondaryButton} onPress={loadDashboard}>
                  <Text style={styles.secondaryButtonText}>
                    {dashboardLoading ? 'Refreshing...' : 'Refresh dashboard'}
                  </Text>
                </Pressable>
                {!!dashboardError && <Text style={styles.errorText}>{dashboardError}</Text>}
              </View>
            </>
          )}

          {activeTab === 'activity' && (
            <>
              <Text style={styles.sectionTitle}>Auto-Categorized Transactions</Text>
              {transactions.map((txn) => (
                <View style={styles.card} key={txn.id}>
                  <View style={styles.rowSpace}>
                    <View>
                      <Text style={styles.cardTitle}>{txn.merchantName || txn.description}</Text>
                      <Text style={styles.cardLabel}>{txn.postedAt}</Text>
                    </View>
                    <Text style={[styles.amount, txn.amount > 0 ? styles.positive : styles.negative]}>
                      {txn.amount > 0 ? '+' : ''}
                      {currency(txn.amount)}
                    </Text>
                  </View>
                  <Text style={styles.smallText}>{txn.description}</Text>
                </View>
              ))}
              {transactions.length === 0 && (
                <View style={styles.card}>
                  <Text style={styles.cardBody}>No transactions yet. Connect a bank and run sync to populate activity.</Text>
                </View>
              )}
            </>
          )}

          {activeTab === 'goals' && (
            <>
              <Text style={styles.sectionTitle}>Savings Goals</Text>
              {goals.map((goal) => (
                <View style={styles.card} key={goal.id}>
                  <View style={styles.rowSpace}>
                    <Text style={styles.cardTitle}>{goal.title}</Text>
                    <Text style={styles.cardLabel}>{goal.status}</Text>
                  </View>
                  <Text style={styles.cardLabel}>
                    {currency(goal.currentAmount)} of {currency(goal.targetAmount)}
                  </Text>
                  <ProgressBar progress={goal.targetAmount > 0 ? goal.currentAmount / goal.targetAmount : 0} />
                </View>
              ))}
              {goals.length === 0 && (
                <View style={styles.card}>
                  <Text style={styles.cardBody}>No active goals yet. Create a goal after your first sync to track streaks.</Text>
                </View>
              )}
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Milestone Celebration</Text>
                <Text style={styles.cardBody}>Milestones and streak updates unlock automatically from goal progress events.</Text>
              </View>
            </>
          )}

          {activeTab === 'social' && (
            <>
              <Text style={styles.sectionTitle}>Weekly Share Card</Text>
              <View style={[styles.card, styles.shareCard]}>
                <Text style={styles.shareTitle}>
                  {weeklyCard
                    ? weeklyCard.headline
                    : 'Generate your weekly savings card with one tap.'}
                </Text>
                {weeklyCard && (
                  <Text style={styles.cardBody}>
                    This week spend: {currency(weeklyCard.thisWeekSpend)} • Previous week:{' '}
                    {currency(weeklyCard.previousWeekSpend)} • Saved {currency(weeklyCard.amountSaved)}
                  </Text>
                )}
                <Pressable style={styles.primaryButton} onPress={handleGenerateCard} disabled={weeklyCardLoading}>
                  <Text style={styles.primaryButtonText}>
                    {weeklyCardLoading ? 'Generating...' : 'Generate share card'}
                  </Text>
                </Pressable>
                {weeklyCard && (
                  <Text style={styles.smallText}>
                    Share URL: {weeklyCard.shareUrl}{'\n'}Referral: {weeklyCardReferralCode}
                  </Text>
                )}
              </View>

              <Text style={styles.sectionTitle}>Social Benchmarks</Text>
              <View style={styles.card}>
                <Text style={styles.cardBody}>
                  People in your city/income bracket spend 12% less on subscriptions. Potential reclaim: {currency(44)}
                  /month.
                </Text>
              </View>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Referral Rewards</Text>
                <Text style={styles.cardBody}>Invite 3 friends to unlock Vault Pro for 30 days.</Text>
              </View>
            </>
          )}

          {activeTab === 'insights' && (
            <>
              <Text style={styles.sectionTitle}>AI Financial Summary</Text>
              <View style={styles.card}>
                <Text style={styles.cardBody}>{latestSummary ?? 'Generate insights to produce your latest AI summary.'}</Text>
                <Pressable style={styles.primaryButton} onPress={handleRunInsights} disabled={insightsLoading}>
                  <Text style={styles.primaryButtonText}>
                    {insightsLoading ? 'Running...' : 'Run insight generation'}
                  </Text>
                </Pressable>
                {!!insightsMessage && <Text style={styles.smallText}>{insightsMessage}</Text>}
              </View>
              <Text style={styles.sectionTitle}>Variance & Recommendations</Text>
              <View style={styles.card}>
                <Text style={styles.cardBody}>
                  Recommendations are generated by `vault-insights-generate` from active variances and available cash
                  flow. Accepting them can be wired to one-tap actions in the next sprint.
                </Text>
              </View>
            </>
          )}
        </ScrollView>

        <View style={styles.navBar}>
          {(Object.keys(tabLabels) as TabKey[]).map((tab) => (
            <Pressable key={tab} style={styles.navItem} onPress={() => setActiveTab(tab)}>
              <Text style={[styles.navText, activeTab === tab && styles.navTextActive]}>{tabLabels[tab]}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#070B18',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  centerText: {
    color: '#C0D2F0',
  },
  authRoot: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  authCard: {
    backgroundColor: '#111A2D',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#202D4A',
    padding: 16,
  },
  root: {
    flex: 1,
    paddingHorizontal: 18,
  },
  header: {
    marginTop: 12,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  eyebrow: {
    color: '#7C8FB5',
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: '600',
  },
  title: {
    color: '#F3F7FF',
    fontSize: 22,
    fontWeight: '700',
    marginTop: 4,
  },
  streakPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#16213B',
    borderWidth: 1,
    borderColor: '#243455',
  },
  streakText: {
    color: '#F4C76B',
    fontWeight: '600',
    fontSize: 12,
  },
  content: {
    paddingBottom: 120,
  },
  sectionTitle: {
    color: '#C2D0EC',
    marginTop: 16,
    marginBottom: 8,
    fontSize: 15,
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#111A2D',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#202D4A',
    padding: 14,
    marginBottom: 10,
  },
  heroCard: {
    marginTop: 12,
    padding: 16,
  },
  cardLabel: {
    color: '#8FA3C8',
    fontSize: 13,
  },
  cardTitle: {
    color: '#F1F5FF',
    fontSize: 16,
    fontWeight: '600',
  },
  cardBody: {
    color: '#D3DDF0',
    lineHeight: 20,
    marginTop: 6,
  },
  heroNumber: {
    color: '#FFFFFF',
    fontSize: 29,
    fontWeight: '700',
    marginTop: 8,
    marginBottom: 10,
  },
  heroSub: {
    color: '#89A0CC',
    fontSize: 16,
    fontWeight: '500',
  },
  progressTrack: {
    width: '100%',
    height: 9,
    borderRadius: 999,
    backgroundColor: '#263655',
    overflow: 'hidden',
    marginTop: 8,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#5BC4FF',
  },
  kpiRow: {
    marginTop: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  kpiLabel: {
    color: '#7E95BB',
    fontSize: 12,
  },
  kpiValue: {
    color: '#F7FBFF',
    fontSize: 17,
    fontWeight: '700',
    marginTop: 2,
  },
  alertBadge: {
    marginTop: 12,
    backgroundColor: '#2D2445',
    borderWidth: 1,
    borderColor: '#4A3A78',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  alertText: {
    color: '#D8C8FF',
    fontSize: 12,
    lineHeight: 17,
  },
  rowSpace: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  inlineRow: {
    flexDirection: 'row',
    gap: 8,
  },
  providerChip: {
    borderWidth: 1,
    borderColor: '#314870',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  providerChipActive: {
    backgroundColor: '#5BC4FF',
    borderColor: '#5BC4FF',
  },
  providerChipText: {
    color: '#97ADD3',
    fontSize: 12,
    fontWeight: '600',
  },
  providerChipTextActive: {
    color: '#0A142C',
  },
  input: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#2A3A5D',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: '#F2F7FF',
    backgroundColor: '#0D1528',
  },
  errorText: {
    marginTop: 8,
    color: '#FF9AB0',
    fontSize: 13,
  },
  secondaryButton: {
    marginTop: 12,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#31507E',
    backgroundColor: '#162744',
    alignSelf: 'flex-start',
  },
  secondaryButtonText: {
    color: '#C8DCFF',
    fontWeight: '600',
    fontSize: 13,
  },
  amount: {
    fontSize: 16,
    fontWeight: '700',
  },
  negative: {
    color: '#FF8EA6',
  },
  positive: {
    color: '#7FE0B0',
  },
  smallText: {
    marginTop: 8,
    color: '#8DA2C7',
    fontSize: 12,
  },
  shareCard: {
    backgroundColor: '#1A2240',
  },
  shareTitle: {
    color: '#F3F8FF',
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '700',
  },
  primaryButton: {
    marginTop: 12,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: '#5BC4FF',
    alignSelf: 'flex-start',
  },
  primaryButtonText: {
    color: '#0A142C',
    fontWeight: '700',
    fontSize: 14,
  },
  ghostButton: {
    marginTop: 10,
  },
  ghostButtonText: {
    color: '#97ADD3',
    fontWeight: '600',
  },
  navBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: '#0C1324',
    borderTopWidth: 1,
    borderTopColor: '#1B2844',
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  navItem: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  navText: {
    color: '#6E83AB',
    fontWeight: '600',
    fontSize: 12,
  },
  navTextActive: {
    color: '#D7E8FF',
  },
});
