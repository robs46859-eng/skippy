# Vault Edge Functions

These functions implement core backend workflows for the Vault MVP:

- `vault-bank-sync`  
  Synces transactions for a connection.  
  - `sandbox` provider: seeds/updates transactions and categorization.
  - other providers: queues sync request in `vault_event_outbox`.

- `vault-insights-generate`  
  Generates forecasts, variance entries, recommendations, and AI/fallback summaries.

- `vault-cards-weekly-generate`  
  Generates weekly savings card payloads + share links and ensures referral code exists.

## Required Secrets

Set in Supabase function secrets:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- Optional: `OPENAI_API_KEY`, `OPENAI_MODEL`, `EXPO_PUBLIC_SHARE_BASE_URL`

## Local Invocation Examples

```bash
supabase functions serve --env-file .env.local
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
