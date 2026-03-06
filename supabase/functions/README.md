# Vault Edge Functions

These functions implement core backend workflows for the Vault MVP:

- `vault-bank-link-token`  
  Creates a provider link token (Plaid or sandbox).

- `vault-bank-exchange-token`  
  Exchanges provider public token, persists connection/accounts, and queues initial sync.

- `vault-bank-sync`  
  Synces transactions for a connection.  
  - `sandbox` provider: seeds/updates transactions and categorization.
  - `plaid` provider: performs `transactions/sync`, persists updates/removals.
  - other providers: queues sync request in `vault_event_outbox`.

- `vault-bank-webhook`  
  Receives provider webhook events and queues sync work when updates are available.

- `vault-insights-generate`  
  Generates forecasts, variance entries, recommendations, and AI/fallback summaries.

- `vault-cards-weekly-generate`  
  Generates weekly savings card payloads + share links and ensures referral code exists.

## Required Secrets

Set in Supabase function secrets:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PLAID_CLIENT_ID` (for Plaid)
- `PLAID_SECRET` (for Plaid)
- `PLAID_ENV` (`sandbox` | `development` | `production`)
- `PLAID_ANDROID_PACKAGE_NAME` (must match Android app id)
- `PLAID_REDIRECT_URI` (used for OAuth institutions)
- Optional `PLAID_WEBHOOK_SECRET` (compared against `x-vault-webhook-secret` header)
- Optional: `OPENAI_API_KEY`, `OPENAI_MODEL`, `EXPO_PUBLIC_SHARE_BASE_URL`

Note: webhook verification in this MVP uses a shared secret header. For production Plaid deployments, add full Plaid webhook signature verification.

## Local Invocation Examples

```bash
supabase functions serve --env-file .env.local
```

### 0) Create link token
```bash
curl -X POST http://127.0.0.1:54321/functions/v1/vault-bank-link-token \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"provider":"plaid"}'
```

### 0.5) Exchange public token
```bash
curl -X POST http://127.0.0.1:54321/functions/v1/vault-bank-exchange-token \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"provider":"plaid","publicToken":"<public_token>"}'
```

### 1) Bank sync
```bash
curl -X POST http://127.0.0.1:54321/functions/v1/vault-bank-sync \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"connectionId":"<vault_bank_connections.id>","maxTransactions":8}'
```

### 2) Insights generation
```bash
curl -X POST http://127.0.0.1:54321/functions/v1/vault-insights-generate \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"horizonDays":14}'
```

### 3) Weekly savings card
```bash
curl -X POST http://127.0.0.1:54321/functions/v1/vault-cards-weekly-generate \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### 4) Bank webhook
```bash
curl -X POST http://127.0.0.1:54321/functions/v1/vault-bank-webhook \
  -H "Content-Type: application/json" \
  -H "x-vault-webhook-secret: <PLAID_WEBHOOK_SECRET>" \
  -d '{"webhook_type":"TRANSACTIONS","webhook_code":"SYNC_UPDATES_AVAILABLE","item_id":"<item_id>"}'
```
