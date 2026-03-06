-- Vault AI Budgeting Schema
-- Bank sync-ready, AI insight-ready, and growth-loop-ready schema.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Shared helper for updated_at timestamps.
CREATE OR REPLACE FUNCTION vault_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Identity + profile
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vault_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  handle TEXT UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  locale TEXT NOT NULL DEFAULT 'en-US',
  currency_code TEXT NOT NULL DEFAULT 'USD',
  onboarding_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_vault_profiles_updated_at ON vault_profiles;
CREATE TRIGGER trg_vault_profiles_updated_at
BEFORE UPDATE ON vault_profiles
FOR EACH ROW
EXECUTE FUNCTION vault_set_updated_at();

-- ---------------------------------------------------------------------------
-- Bank sync integration
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vault_bank_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('plaid', 'teller', 'truelayer', 'sandbox')),
  provider_item_id TEXT NOT NULL,
  access_token_ref TEXT NOT NULL, -- reference to secret manager entry
  institution_name TEXT,
  sync_cursor TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'error', 'revoked')),
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_item_id)
);

CREATE INDEX IF NOT EXISTS idx_vault_bank_connections_user_id
  ON vault_bank_connections(user_id);

DROP TRIGGER IF EXISTS trg_vault_bank_connections_updated_at ON vault_bank_connections;
CREATE TRIGGER trg_vault_bank_connections_updated_at
BEFORE UPDATE ON vault_bank_connections
FOR EACH ROW
EXECUTE FUNCTION vault_set_updated_at();

CREATE TABLE IF NOT EXISTS vault_bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES vault_bank_connections(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_account_id TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_mask TEXT,
  account_type TEXT NOT NULL, -- checking, savings, credit, loan, investment
  subtype TEXT,
  iso_currency_code TEXT NOT NULL DEFAULT 'USD',
  current_balance NUMERIC(14,2),
  available_balance NUMERIC(14,2),
  credit_limit NUMERIC(14,2),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (connection_id, provider_account_id)
);

CREATE INDEX IF NOT EXISTS idx_vault_bank_accounts_user_id
  ON vault_bank_accounts(user_id);

DROP TRIGGER IF EXISTS trg_vault_bank_accounts_updated_at ON vault_bank_accounts;
CREATE TRIGGER trg_vault_bank_accounts_updated_at
BEFORE UPDATE ON vault_bank_accounts
FOR EACH ROW
EXECUTE FUNCTION vault_set_updated_at();

-- ---------------------------------------------------------------------------
-- Transactions + categorization
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vault_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  parent_slug TEXT,
  is_system BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vault_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES vault_bank_accounts(id) ON DELETE CASCADE,
  provider_transaction_id TEXT,
  merchant_name TEXT,
  description TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL, -- positive=inflow, negative=outflow
  iso_currency_code TEXT NOT NULL DEFAULT 'USD',
  posted_at DATE NOT NULL,
  pending BOOLEAN NOT NULL DEFAULT FALSE,
  normalized_merchant TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, provider_transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_vault_transactions_user_posted_at
  ON vault_transactions(user_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_vault_transactions_user_pending
  ON vault_transactions(user_id, pending);
CREATE INDEX IF NOT EXISTS idx_vault_transactions_account_posted_at
  ON vault_transactions(account_id, posted_at DESC);

DROP TRIGGER IF EXISTS trg_vault_transactions_updated_at ON vault_transactions;
CREATE TRIGGER trg_vault_transactions_updated_at
BEFORE UPDATE ON vault_transactions
FOR EACH ROW
EXECUTE FUNCTION vault_set_updated_at();

CREATE TABLE IF NOT EXISTS vault_transaction_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES vault_transactions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES vault_categories(id),
  source TEXT NOT NULL CHECK (source IN ('rule', 'ml', 'llm', 'user')),
  confidence NUMERIC(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vault_transaction_categories_transaction
  ON vault_transaction_categories(transaction_id, is_active);
CREATE INDEX IF NOT EXISTS idx_vault_transaction_categories_user_source
  ON vault_transaction_categories(user_id, source);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vault_transaction_categories_single_active
  ON vault_transaction_categories(transaction_id)
  WHERE is_active = TRUE;

-- ---------------------------------------------------------------------------
-- Budgets + variance + alerts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vault_budget_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, period_start, period_end),
  CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_vault_budget_periods_user_dates
  ON vault_budget_periods(user_id, period_start DESC);

CREATE TABLE IF NOT EXISTS vault_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id UUID REFERENCES vault_categories(id),
  name TEXT NOT NULL,
  amount_limit NUMERIC(14,2) NOT NULL CHECK (amount_limit > 0),
  alert_threshold_pct NUMERIC(5,2) NOT NULL DEFAULT 80 CHECK (alert_threshold_pct BETWEEN 1 AND 200),
  rollover_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vault_budgets_user_id
  ON vault_budgets(user_id);

DROP TRIGGER IF EXISTS trg_vault_budgets_updated_at ON vault_budgets;
CREATE TRIGGER trg_vault_budgets_updated_at
BEFORE UPDATE ON vault_budgets
FOR EACH ROW
EXECUTE FUNCTION vault_set_updated_at();

CREATE TABLE IF NOT EXISTS vault_budget_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  budget_id UUID NOT NULL REFERENCES vault_budgets(id) ON DELETE CASCADE,
  period_id UUID NOT NULL REFERENCES vault_budget_periods(id) ON DELETE CASCADE,
  spent_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  remaining_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  utilization_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
  projected_end_amount NUMERIC(14,2),
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (budget_id, period_id)
);

CREATE INDEX IF NOT EXISTS idx_vault_budget_snapshots_user_period
  ON vault_budget_snapshots(user_id, period_id);

CREATE TABLE IF NOT EXISTS vault_budget_variances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  budget_id UUID NOT NULL REFERENCES vault_budgets(id) ON DELETE CASCADE,
  period_id UUID NOT NULL REFERENCES vault_budget_periods(id) ON DELETE CASCADE,
  variance_amount NUMERIC(14,2) NOT NULL,
  variance_pct NUMERIC(6,2) NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  driver_summary TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vault_budget_variances_user_created_at
  ON vault_budget_variances(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS vault_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  variance_id UUID REFERENCES vault_budget_variances(id) ON DELETE CASCADE,
  recommendation_type TEXT NOT NULL CHECK (
    recommendation_type IN (
      'cap_adjustment',
      'subscription_pause',
      'merchant_switch',
      'transfer_plan',
      'goal_contribution'
    )
  ),
  title TEXT NOT NULL,
  details TEXT NOT NULL,
  expected_monthly_impact NUMERIC(14,2),
  confidence NUMERIC(5,4) NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'accepted', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vault_recommendations_user_status
  ON vault_recommendations(user_id, status);

DROP TRIGGER IF EXISTS trg_vault_recommendations_updated_at ON vault_recommendations;
CREATE TRIGGER trg_vault_recommendations_updated_at
BEFORE UPDATE ON vault_recommendations
FOR EACH ROW
EXECUTE FUNCTION vault_set_updated_at();

CREATE TABLE IF NOT EXISTS vault_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('overspend', 'cashflow_risk', 'goal_slip', 'milestone', 'security')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warn', 'critical')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vault_alerts_user_created_at
  ON vault_alerts(user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Savings goals + streaks + milestones
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vault_savings_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  target_amount NUMERIC(14,2) NOT NULL CHECK (target_amount > 0),
  current_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  target_date DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vault_savings_goals_user_status
  ON vault_savings_goals(user_id, status);

DROP TRIGGER IF EXISTS trg_vault_savings_goals_updated_at ON vault_savings_goals;
CREATE TRIGGER trg_vault_savings_goals_updated_at
BEFORE UPDATE ON vault_savings_goals
FOR EACH ROW
EXECUTE FUNCTION vault_set_updated_at();

CREATE TABLE IF NOT EXISTS vault_goal_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID NOT NULL REFERENCES vault_savings_goals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contribution_amount NUMERIC(14,2) NOT NULL CHECK (contribution_amount > 0),
  source TEXT NOT NULL CHECK (source IN ('manual', 'rule', 'roundup', 'auto_transfer')),
  contributed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vault_goal_contributions_goal
  ON vault_goal_contributions(goal_id, contributed_at DESC);

CREATE TABLE IF NOT EXISTS vault_streaks (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  current_streak_days INT NOT NULL DEFAULT 0,
  best_streak_days INT NOT NULL DEFAULT 0,
  streak_status TEXT NOT NULL DEFAULT 'active' CHECK (streak_status IN ('active', 'frozen', 'broken')),
  last_qualified_at DATE,
  freeze_tokens INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_vault_streaks_updated_at ON vault_streaks;
CREATE TRIGGER trg_vault_streaks_updated_at
BEFORE UPDATE ON vault_streaks
FOR EACH ROW
EXECUTE FUNCTION vault_set_updated_at();

CREATE TABLE IF NOT EXISTS vault_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('goal_amount', 'streak', 'savings_delta', 'referrals')),
  trigger_value NUMERIC(14,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS vault_user_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  milestone_id UUID NOT NULL REFERENCES vault_milestones(id) ON DELETE CASCADE,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, milestone_id)
);

CREATE INDEX IF NOT EXISTS idx_vault_user_milestones_user
  ON vault_user_milestones(user_id, unlocked_at DESC);

-- ---------------------------------------------------------------------------
-- Forecasts + AI summaries
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vault_cashflow_forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  horizon_days INT NOT NULL CHECK (horizon_days BETWEEN 1 AND 90),
  predicted_min_balance NUMERIC(14,2) NOT NULL,
  predicted_end_balance NUMERIC(14,2) NOT NULL,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  model_version TEXT NOT NULL,
  confidence_band JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vault_cashflow_forecasts_user_generated
  ON vault_cashflow_forecasts(user_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS vault_ai_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  summary_markdown TEXT NOT NULL,
  structured_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  model_provider TEXT NOT NULL,
  model_name TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_vault_ai_summaries_user_generated
  ON vault_ai_summaries(user_id, generated_at DESC);

-- ---------------------------------------------------------------------------
-- Viral mechanics
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vault_weekly_savings_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  amount_saved NUMERIC(14,2) NOT NULL,
  headline TEXT NOT NULL,
  image_url TEXT,
  share_slug TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, week_start, week_end)
);

CREATE INDEX IF NOT EXISTS idx_vault_weekly_savings_cards_user_week
  ON vault_weekly_savings_cards(user_id, week_start DESC);

CREATE TABLE IF NOT EXISTS vault_share_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id UUID REFERENCES vault_weekly_savings_cards(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('instagram', 'x', 'tiktok', 'sms', 'link', 'other')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vault_share_events_user_created
  ON vault_share_events(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS vault_referral_codes (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  referral_code TEXT UNIQUE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vault_referral_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referee_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referral_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'qualified', 'rewarded', 'rejected')),
  reward_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (referrer_user_id, referee_user_id)
);

CREATE INDEX IF NOT EXISTS idx_vault_referral_events_referrer
  ON vault_referral_events(referrer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vault_referral_events_referee
  ON vault_referral_events(referee_user_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_vault_referral_events_updated_at ON vault_referral_events;
CREATE TRIGGER trg_vault_referral_events_updated_at
BEFORE UPDATE ON vault_referral_events
FOR EACH ROW
EXECUTE FUNCTION vault_set_updated_at();

CREATE TABLE IF NOT EXISTS vault_spending_benchmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_key TEXT NOT NULL, -- e.g. "us|urban|income_60_90k"
  category_slug TEXT NOT NULL,
  median_monthly_spend NUMERIC(14,2) NOT NULL,
  p25_monthly_spend NUMERIC(14,2) NOT NULL,
  p75_monthly_spend NUMERIC(14,2) NOT NULL,
  sample_size INT NOT NULL CHECK (sample_size >= 20),
  computed_for_month DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cohort_key, category_slug, computed_for_month)
);

-- ---------------------------------------------------------------------------
-- Async/event processing
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vault_event_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'processed', 'failed')),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_vault_event_outbox_pending
  ON vault_event_outbox(status, available_at);

-- ---------------------------------------------------------------------------
-- Seed baseline categories for MVP.
-- ---------------------------------------------------------------------------
INSERT INTO vault_categories (slug, label, parent_slug, is_system)
VALUES
  ('income', 'Income', NULL, TRUE),
  ('housing', 'Housing', NULL, TRUE),
  ('groceries', 'Groceries', NULL, TRUE),
  ('dining', 'Dining', NULL, TRUE),
  ('transport', 'Transport', NULL, TRUE),
  ('utilities', 'Utilities', NULL, TRUE),
  ('insurance', 'Insurance', NULL, TRUE),
  ('healthcare', 'Healthcare', NULL, TRUE),
  ('subscriptions', 'Subscriptions', NULL, TRUE),
  ('shopping', 'Shopping', NULL, TRUE),
  ('travel', 'Travel', NULL, TRUE),
  ('savings_transfer', 'Savings Transfer', NULL, TRUE),
  ('debt_payment', 'Debt Payment', NULL, TRUE),
  ('other', 'Other', NULL, TRUE)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE vault_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_bank_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_transaction_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_budget_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_budget_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_budget_variances ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_savings_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_goal_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_streaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_user_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_cashflow_forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_ai_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_weekly_savings_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_share_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_referral_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_spending_benchmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_event_outbox ENABLE ROW LEVEL SECURITY;

-- Profiles
DROP POLICY IF EXISTS "vault_profiles_select_own" ON vault_profiles;
CREATE POLICY "vault_profiles_select_own"
ON vault_profiles FOR SELECT
USING (auth.uid() = id);

DROP POLICY IF EXISTS "vault_profiles_insert_own" ON vault_profiles;
CREATE POLICY "vault_profiles_insert_own"
ON vault_profiles FOR INSERT
WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "vault_profiles_update_own" ON vault_profiles;
CREATE POLICY "vault_profiles_update_own"
ON vault_profiles FOR UPDATE
USING (auth.uid() = id);

-- System categories are readable by all authenticated users.
DROP POLICY IF EXISTS "vault_categories_authenticated_read" ON vault_categories;
CREATE POLICY "vault_categories_authenticated_read"
ON vault_categories FOR SELECT
TO authenticated
USING (TRUE);

-- Helper policy template: user-scoped tables.
DROP POLICY IF EXISTS "vault_bank_connections_user_all" ON vault_bank_connections;
CREATE POLICY "vault_bank_connections_user_all"
ON vault_bank_connections FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "vault_bank_accounts_user_all" ON vault_bank_accounts;
CREATE POLICY "vault_bank_accounts_user_all"
ON vault_bank_accounts FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "vault_transactions_user_all" ON vault_transactions;
CREATE POLICY "vault_transactions_user_all"
ON vault_transactions FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "vault_transaction_categories_user_all" ON vault_transaction_categories;
CREATE POLICY "vault_transaction_categories_user_all"
ON vault_transaction_categories FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "vault_budget_periods_user_all" ON vault_budget_periods;
CREATE POLICY "vault_budget_periods_user_all"
ON vault_budget_periods FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "vault_budgets_user_all" ON vault_budgets;
CREATE POLICY "vault_budgets_user_all"
ON vault_budgets FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "vault_budget_snapshots_user_all" ON vault_budget_snapshots;
CREATE POLICY "vault_budget_snapshots_user_all"
ON vault_budget_snapshots FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "vault_budget_variances_user_all" ON vault_budget_variances;
CREATE POLICY "vault_budget_variances_user_all"
ON vault_budget_variances FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "vault_recommendations_user_all" ON vault_recommendations;
CREATE POLICY "vault_recommendations_user_all"
ON vault_recommendations FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "vault_alerts_user_all" ON vault_alerts;
CREATE POLICY "vault_alerts_user_all"
ON vault_alerts FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "vault_savings_goals_user_all" ON vault_savings_goals;
CREATE POLICY "vault_savings_goals_user_all"
ON vault_savings_goals FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "vault_goal_contributions_user_all" ON vault_goal_contributions;
CREATE POLICY "vault_goal_contributions_user_all"
ON vault_goal_contributions FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "vault_streaks_user_all" ON vault_streaks;
CREATE POLICY "vault_streaks_user_all"
ON vault_streaks FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "vault_milestones_authenticated_read" ON vault_milestones;
CREATE POLICY "vault_milestones_authenticated_read"
ON vault_milestones FOR SELECT
TO authenticated
USING (TRUE);

DROP POLICY IF EXISTS "vault_user_milestones_user_all" ON vault_user_milestones;
CREATE POLICY "vault_user_milestones_user_all"
ON vault_user_milestones FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "vault_cashflow_forecasts_user_all" ON vault_cashflow_forecasts;
CREATE POLICY "vault_cashflow_forecasts_user_all"
ON vault_cashflow_forecasts FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "vault_ai_summaries_user_all" ON vault_ai_summaries;
CREATE POLICY "vault_ai_summaries_user_all"
ON vault_ai_summaries FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "vault_weekly_savings_cards_user_all" ON vault_weekly_savings_cards;
CREATE POLICY "vault_weekly_savings_cards_user_all"
ON vault_weekly_savings_cards FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "vault_share_events_user_all" ON vault_share_events;
CREATE POLICY "vault_share_events_user_all"
ON vault_share_events FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "vault_referral_codes_user_all" ON vault_referral_codes;
CREATE POLICY "vault_referral_codes_user_all"
ON vault_referral_codes FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "vault_referral_events_referrer_or_referee" ON vault_referral_events;
CREATE POLICY "vault_referral_events_referrer_or_referee"
ON vault_referral_events FOR SELECT
USING (auth.uid() = referrer_user_id OR auth.uid() = referee_user_id);

DROP POLICY IF EXISTS "vault_referral_events_referrer_insert" ON vault_referral_events;
CREATE POLICY "vault_referral_events_referrer_insert"
ON vault_referral_events FOR INSERT
WITH CHECK (auth.uid() = referrer_user_id);

DROP POLICY IF EXISTS "vault_referral_events_referrer_update" ON vault_referral_events;
CREATE POLICY "vault_referral_events_referrer_update"
ON vault_referral_events FOR UPDATE
USING (auth.uid() = referrer_user_id);

DROP POLICY IF EXISTS "vault_spending_benchmarks_authenticated_read" ON vault_spending_benchmarks;
CREATE POLICY "vault_spending_benchmarks_authenticated_read"
ON vault_spending_benchmarks FOR SELECT
TO authenticated
USING (TRUE);

DROP POLICY IF EXISTS "vault_event_outbox_user_select" ON vault_event_outbox;
CREATE POLICY "vault_event_outbox_user_select"
ON vault_event_outbox FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "vault_event_outbox_user_insert" ON vault_event_outbox;
CREATE POLICY "vault_event_outbox_user_insert"
ON vault_event_outbox FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Realtime support for key dashboard tables.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE vault_budget_snapshots;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE vault_alerts;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE vault_savings_goals;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END;
$$;
