import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

type TabKey = 'dashboard' | 'transactions' | 'goals' | 'social' | 'insights';

type BudgetBucket = {
  name: string;
  spent: number;
  limit: number;
};

type SavingsGoal = {
  name: string;
  progress: number;
  target: number;
  dueLabel: string;
};

const budgetBuckets: BudgetBucket[] = [
  { name: 'Needs', spent: 1260, limit: 1800 },
  { name: 'Wants', spent: 840, limit: 900 },
  { name: 'Saving', spent: 640, limit: 1000 },
];

const goals: SavingsGoal[] = [
  { name: 'Emergency Fund', progress: 3200, target: 5000, dueLabel: 'On track' },
  { name: 'Summer Trip', progress: 920, target: 1800, dueLabel: '67 days left' },
];

const recentTransactions = [
  { merchant: 'Whole Foods', amount: -72.4, category: 'Groceries', confidence: 0.98 },
  { merchant: 'Uber', amount: -18.2, category: 'Transport', confidence: 0.94 },
  { merchant: 'Netflix', amount: -15.49, category: 'Subscriptions', confidence: 0.99 },
  { merchant: 'Payroll', amount: 2300, category: 'Income', confidence: 1 },
];

const tabLabels: Record<TabKey, string> = {
  dashboard: 'Dashboard',
  transactions: 'Activity',
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
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');

  const totals = useMemo(() => {
    const spent = budgetBuckets.reduce((sum, bucket) => sum + bucket.spent, 0);
    const limit = budgetBuckets.reduce((sum, bucket) => sum + bucket.limit, 0);
    const remaining = Math.max(limit - spent, 0);
    const projected = spent + 620;
    return { spent, limit, remaining, projected };
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={styles.root}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>VAULT</Text>
            <Text style={styles.title}>Your money, on autopilot.</Text>
          </View>
          <View style={styles.streakPill}>
            <Text style={styles.streakText}>🔥 11-day streak</Text>
          </View>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {activeTab === 'dashboard' && (
            <>
              <View style={[styles.card, styles.heroCard]}>
                <Text style={styles.cardLabel}>Monthly Budget</Text>
                <Text style={styles.heroNumber}>
                  {currency(totals.spent)} <Text style={styles.heroSub}>/ {currency(totals.limit)}</Text>
                </Text>
                <ProgressBar progress={totals.spent / totals.limit} />
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
                  <Text style={styles.alertText}>⚠ Wants bucket is 93% used. Shift $120 from Dining.</Text>
                </View>
              </View>

              <Text style={styles.sectionTitle}>Budget Buckets</Text>
              {budgetBuckets.map((bucket) => (
                <View style={styles.card} key={bucket.name}>
                  <View style={styles.rowSpace}>
                    <Text style={styles.cardTitle}>{bucket.name}</Text>
                    <Text style={styles.cardLabel}>
                      {currency(bucket.spent)} / {currency(bucket.limit)}
                    </Text>
                  </View>
                  <ProgressBar progress={bucket.spent / bucket.limit} />
                </View>
              ))}

              <Text style={styles.sectionTitle}>14-Day Cash Flow</Text>
              <View style={styles.card}>
                <Text style={styles.cardBody}>
                  You are likely to end the next 14 days with {currency(1460)} if spending trends stay stable.
                  Main risk: weekend dining. Suggested cap: {currency(120)}.
                </Text>
              </View>
            </>
          )}

          {activeTab === 'transactions' && (
            <>
              <Text style={styles.sectionTitle}>Auto-Categorized Transactions</Text>
              {recentTransactions.map((txn) => (
                <View style={styles.card} key={`${txn.merchant}-${txn.amount}`}>
                  <View style={styles.rowSpace}>
                    <View>
                      <Text style={styles.cardTitle}>{txn.merchant}</Text>
                      <Text style={styles.cardLabel}>{txn.category}</Text>
                    </View>
                    <Text style={[styles.amount, txn.amount > 0 ? styles.positive : styles.negative]}>
                      {txn.amount > 0 ? '+' : ''}
                      {currency(txn.amount)}
                    </Text>
                  </View>
                  <Text style={styles.smallText}>
                    Confidence {(txn.confidence * 100).toFixed(0)}% • tap to correct and train model
                  </Text>
                </View>
              ))}
            </>
          )}

          {activeTab === 'goals' && (
            <>
              <Text style={styles.sectionTitle}>Savings Goals</Text>
              {goals.map((goal) => (
                <View style={styles.card} key={goal.name}>
                  <View style={styles.rowSpace}>
                    <Text style={styles.cardTitle}>{goal.name}</Text>
                    <Text style={styles.cardLabel}>{goal.dueLabel}</Text>
                  </View>
                  <Text style={styles.cardLabel}>
                    {currency(goal.progress)} of {currency(goal.target)}
                  </Text>
                  <ProgressBar progress={goal.progress / goal.target} />
                </View>
              ))}
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Milestone Celebration</Text>
                <Text style={styles.cardBody}>You crossed $3,000 in emergency savings. Confetti moment unlocked.</Text>
              </View>
            </>
          )}

          {activeTab === 'social' && (
            <>
              <Text style={styles.sectionTitle}>Weekly Share Card</Text>
              <View style={[styles.card, styles.shareCard]}>
                <Text style={styles.shareTitle}>This week I saved {currency(182)} with Vault.</Text>
                <Text style={styles.cardBody}>
                  Top win: cut impulse food spend by 26% • #VaultStreak #MoneyMoves
                </Text>
                <Pressable style={styles.primaryButton}>
                  <Text style={styles.primaryButtonText}>Generate share card</Text>
                </Pressable>
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
                <Text style={styles.cardBody}>
                  You are saving faster than last month (+18%) but food delivery is trending up. If you cap delivery at
                  {currency(95)}/week, you can hit your trip goal 2 weeks earlier.
                </Text>
              </View>
              <Text style={styles.sectionTitle}>Variance & Recommendations</Text>
              <View style={styles.card}>
                <Text style={styles.cardBody}>
                  Budget variance detected in Wants (+9%). Corrective actions: pause two subscriptions, shift grocery
                  run to lower-cost store, and auto-transfer {currency(40)} every Friday.
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
