-- Bank adapter wiring support tables.

CREATE TABLE IF NOT EXISTS vault_bank_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider IN ('plaid', 'teller', 'truelayer', 'sandbox')),
  provider_item_id TEXT,
  webhook_type TEXT,
  webhook_code TEXT,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_vault_bank_webhook_events_provider_item_received
  ON vault_bank_webhook_events(provider, provider_item_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_vault_bank_webhook_events_status_received
  ON vault_bank_webhook_events(status, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_vault_bank_webhook_events_user_received
  ON vault_bank_webhook_events(user_id, received_at DESC);

ALTER TABLE vault_bank_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vault_bank_webhook_events_read_own" ON vault_bank_webhook_events;
CREATE POLICY "vault_bank_webhook_events_read_own"
ON vault_bank_webhook_events FOR SELECT
TO authenticated
USING (auth.uid() = user_id);
