# Vault 💸

Mobile-first AI budgeting app optimized for retention and virality.

Vault automatically tracks spending, categorizes transactions, enforces budgets, predicts cash flow, and drives savings habits with instant feedback plus social growth mechanics.

## Core Product Pillars
- Secure auth and user-scoped data access (Supabase Auth + RLS)
- Bank sync-ready architecture (provider adapter pattern)
- Real-time budget dashboard and overspending alerts
- Auto expense categorization with correction feedback loop
- Savings goals, streaks, and milestone celebrations
- Predictive cash-flow risk insights
- AI financial summaries + budget variance recommendations
- Viral loop: share cards, referrals, social-proof benchmarks

## Repository Highlights
- `App.tsx`  
  Mobile-first premium fintech UI prototype with key product tabs:
  Dashboard, Activity, Goals, Social, AI Insights.

- `docs/vault-fullstack-blueprint.md`  
  Full-stack architecture, backend logic, API surface, frontend page map, security model, viral mechanics, and MVP build order.

- `supabase/migrations/01_vault_budgeting_schema.sql`  
  Production-oriented Vault schema with:
  - banking integration primitives
  - transactions and categorization
  - budgets, snapshots, variances, recommendations
  - alerts, forecasts, AI summaries
  - savings goals, streaks, milestones
  - weekly share cards, referral system, benchmarks
  - RLS policies + realtime table publication

## Tech Stack
- **Frontend**: React Native (Expo)
- **State**: Zustand
- **Backend**: Supabase (Postgres, Auth, Realtime, Storage)
- **AI/Integrations (planned)**: OpenAI + bank provider adapter (Plaid/Teller/TrueLayer)

## Quick Start
1. Install deps:
```bash
npm install
```

2. Configure environment:
```bash
cp .env.example .env
```

3. Apply migrations in `supabase/migrations` to your Supabase project.

4. Run app:
```bash
npx expo start
```

## Suggested MVP Sequence
1. Activation core (auth + bank connect + budget setup)
2. Habit loop (alerts + goals + streaks + forecast)
3. AI layer (summaries + variance + recommendations)
4. Viral loop (share cards + referrals + benchmarks)

Detailed sequencing and success gates are in:
`docs/vault-fullstack-blueprint.md`.
