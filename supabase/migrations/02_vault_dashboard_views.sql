-- Vault dashboard convenience views and integrity constraints.

-- Keep one variance record per budget/period.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vault_budget_variances_unique_budget_period
  ON vault_budget_variances (budget_id, period_id);

-- Keep one active recommendation per variance.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vault_recommendations_unique_active_variance
  ON vault_recommendations (variance_id)
  WHERE status = 'active';

-- Real-time dashboard snapshot by user + period.
CREATE OR REPLACE VIEW vault_dashboard_snapshots
WITH (security_invoker = true) AS
SELECT
  s.user_id,
  p.id AS period_id,
  p.period_start,
  p.period_end,
  COALESCE(SUM(s.spent_amount), 0)::NUMERIC(14,2) AS total_spent,
  COALESCE(SUM(b.amount_limit), 0)::NUMERIC(14,2) AS total_budget_limit,
  COALESCE(SUM(s.remaining_amount), 0)::NUMERIC(14,2) AS total_remaining,
  COALESCE(AVG(s.utilization_pct), 0)::NUMERIC(6,2) AS avg_utilization_pct,
  COALESCE(SUM(s.projected_end_amount), 0)::NUMERIC(14,2) AS projected_period_spend,
  MAX(s.computed_at) AS computed_at
FROM vault_budget_snapshots s
JOIN vault_budget_periods p ON p.id = s.period_id
JOIN vault_budgets b ON b.id = s.budget_id
GROUP BY s.user_id, p.id, p.period_start, p.period_end;

GRANT SELECT ON vault_dashboard_snapshots TO authenticated;

-- Current unread alert counters by user.
CREATE OR REPLACE VIEW vault_dashboard_alert_counts
WITH (security_invoker = true) AS
SELECT
  user_id,
  COUNT(*) FILTER (WHERE read_at IS NULL) AS unread_total,
  COUNT(*) FILTER (WHERE read_at IS NULL AND severity = 'critical') AS unread_critical,
  COUNT(*) FILTER (WHERE read_at IS NULL AND alert_type = 'overspend') AS unread_overspend,
  MAX(created_at) AS last_alert_at
FROM vault_alerts
GROUP BY user_id;

GRANT SELECT ON vault_dashboard_alert_counts TO authenticated;
