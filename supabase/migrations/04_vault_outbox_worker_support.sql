-- Outbox worker operational support.

ALTER TABLE vault_event_outbox
ADD COLUMN IF NOT EXISTS last_error TEXT;

CREATE INDEX IF NOT EXISTS idx_vault_event_outbox_status_event_available
  ON vault_event_outbox(status, event_type, available_at, created_at);
