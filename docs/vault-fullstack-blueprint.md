# Vault: Mobile-First AI Budgeting App Blueprint

## 1) Product Positioning

Vault is a personal finance app designed for **retention + virality**:
- Auto-tracks and categorizes spending
- Enforces budgets with instant corrective feedback
- Predicts short-term cash flow risk
- Turns savings into a social, streak-driven game loop

Core loop:
1. Connect account and auto-sync transactions
2. Receive immediate budget and forecasting insight
3. Take one corrective action (cap, transfer, pause)
4. Earn streak/milestone/shareable card
5. Invite friends for reward unlocks

---

## 2) Full-Stack Architecture

## Client (Expo React Native)
- **Auth:** Supabase Auth (email magic link/OTP, optional OAuth)
- **State:** Zustand (session, dashboard snapshot, transactions, goals, viral stats)
- **Realtime:** Supabase Realtime subscriptions for budget status, alerts, and goals
- **Offline-first cache:** transaction pages and dashboard snapshot
- **Feature flags:** staged rollout for AI and referrals

## Backend Platform (Supabase + Edge Workers)
- **Postgres + RLS:** source of truth for user financial data
- **Supabase Auth:** secure identity
- **Edge Functions / Workers:** webhook ingestion, categorization, forecast generation, summary generation, referral processing
- **Queues/outbox:** event-driven processing for heavy tasks
- **Storage:** share card images and celebration assets

## AI/Categorization Layer
- Rule engine -> merchant model -> fallback LLM classification
- Human correction feedback loop improves confidence
- Weekly summary and variance recommendations generated as structured JSON + human-readable narrative

## Bank Sync Adapter Layer (Provider-Agnostic)
- Internal adapter interface:
  - `create_link_token(userId)`
  - `exchange_public_token(userId, publicToken)`
  - `sync_transactions(connectionId, cursor)`
  - `refresh_balances(connectionId)`
- Provider-specific implementations:
  - Plaid/Teller/TrueLayer implement adapter contract
- Keeps schema stable even if provider changes

## Observability + Growth Analytics
- Event table for activation, D1 retention, streak progression, card share, referral conversion
- KPI dashboard:
  - Activation rate (connected account + first budget set)
  - Week-1 retention
  - Share-card creation rate
  - Referral conversion rate

---

## 3) Data Flow (Critical Paths)

## A) Transaction Sync and Categorization
1. Bank webhook or scheduled pull triggers sync worker
2. Raw transactions upserted
3. Categorization pipeline assigns category + confidence
4. Budget summaries and variance insights recomputed
5. Overspending/cash-risk alerts created and pushed in realtime

## B) Instant Budget Feedback
1. User opens dashboard
2. App loads `dashboard_snapshot` view + live alerts
3. If projected over budget, app shows:
   - expected overrun amount
   - top 1-3 causes
   - one-tap corrective recommendations

## C) Viral Loop
1. Weekly close -> savings card generated
2. User shares card externally
3. Shared card includes referral deep link
4. New user signs up with code
5. Both get reward progression

---

## 4) Frontend Page Map (Mobile-First)

## Onboarding + Activation
1. **Welcome / Value prop**
2. **Auth**
3. **Connect Bank** (adapter-backed)
4. **Budget Setup** (income, fixed costs, custom caps)
5. **Goal Setup** (first savings goal)
6. **Notification Opt-in** (alerts + streak reminders)

## Core App Tabs
1. **Dashboard**
   - Budget rings/bars
   - Remaining safe-to-spend
   - Cash flow risk indicator
   - Active alerts and one-tap fixes
2. **Transactions**
   - Stream with auto-categories + confidence badges
   - Swipe-to-correct category
   - Merchant drill-down
3. **Goals**
   - Savings goal progress
   - Auto-transfer recommendations
   - Milestones and streak status
4. **Social**
   - Weekly savings card generator
   - Spending benchmarks
   - Referral status and rewards
5. **AI Coach**
   - Weekly summary
   - Variance analysis
   - Personalized corrective plan

## Support Screens
- Alerts center
- Budget editor
- Referral details
- Security and connected accounts
- Subscription/paywall (post-MVP)

---

## 5) Backend Logic (Services + Jobs)

## Service Boundaries
1. **AuthService**
   - register/login/refresh/logout
   - enforce secure session policies
2. **BankSyncService**
   - link/unlink accounts
   - import and normalize transactions
3. **BudgetService**
   - compute bucket utilization
   - detect overrun risk
4. **GoalService**
   - progress tracking
   - streak/milestone progression
5. **ForecastService**
   - short horizon cash flow prediction
6. **InsightService**
   - AI summary generation
   - variance detection + recommendations
7. **GrowthService**
   - share-card rendering
   - referral tracking/rewards
   - benchmark cohort calculations

## Recurring Jobs
- Hourly: transaction sync and recategorization updates
- Daily: budget variance and forecast recalculation
- Weekly: summary generation + share-card generation + benchmark refresh
- Real-time trigger: overspending threshold crossings

## Recommendation Engine (MVP heuristic)
Input:
- current spend trend
- remaining days in period
- category elasticity
- upcoming recurring charges

Output:
- ranked corrective actions with expected savings impact

Example actions:
- reduce dining cap by 15%
- pause underused subscriptions
- schedule auto-transfer on payday

---

## 6) API Surface (Representative)

Auth:
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/logout`

Banking:
- `POST /bank/link-token`
- `POST /bank/exchange-token`
- `POST /bank/sync`
- `POST /bank/webhook/plaid`
- `GET /bank/accounts`

Budget:
- `GET /dashboard`
- `GET /budgets`
- `POST /budgets`
- `PATCH /budgets/:id`
- `GET /alerts`

Transactions:
- `GET /transactions`
- `PATCH /transactions/:id/category`

Goals + Forecast:
- `GET /goals`
- `POST /goals`
- `GET /forecast?days=14`

AI:
- `GET /insights/latest`
- `GET /variance/latest`

Growth:
- `POST /cards/weekly/generate`
- `GET /cards/weekly/latest`
- `POST /referrals/redeem`
- `GET /benchmarks`

---

## 7) Security and Compliance Baseline

- RLS on all user-scoped tables
- Encrypt provider access tokens (KMS/secret manager pattern)
- Signed webhook verification and replay protection
- Least-privilege service roles
- Audit logs for security events
- Optional:
  - device binding
  - suspicious login checks
  - MFA for high-risk actions

---

## 8) Viral Features Spec

1. **Shareable Weekly Savings Cards**
   - auto-generated each week
   - personalized savings narrative
   - deep-link CTA and referral code

2. **Savings Streaks**
   - increments for days/weeks under adaptive spend cap
   - streak freeze tokens (earned via referrals or milestones)

3. **Milestone Celebrations**
   - triggered on goal progress and debt payoff thresholds
   - social-share ready assets

4. **Referral Rewards**
   - two-sided rewards with anti-fraud checks
   - tiered unlocks (1, 3, 5 referrals)

5. **Social-Proof Benchmarks**
   - anonymized cohort spend percentiles
   - “people like you save X in category Y” nudges

---

## 9) MVP Build Order (Retention + Virality Optimized)

## Phase 1: Activation Core (Week 1-2)
- Secure auth
- Bank link + transaction ingestion
- Basic auto-categorization
- Dashboard with budget setup and remaining-to-spend

Success gate:
- >55% onboarding completion
- >40% users connect at least one account

## Phase 2: Habit Loop (Week 3-4)
- Overspending alerts
- Savings goals + streaks
- Forecast (7-14 day horizon)
- Transaction category correction feedback loop

Success gate:
- D7 retention uplift from alerts/streak nudges
- >30% users create at least one goal

## Phase 3: AI + Corrective Guidance (Week 5)
- AI weekly summary
- Budget variance detection
- Corrective recommendation engine with one-tap actions

Success gate:
- >20% insight interaction rate
- measurable reduction in over-budget cohorts

## Phase 4: Viral Engine (Week 6)
- Shareable weekly savings cards
- Referral links + rewards
- Social-proof benchmark cards

Success gate:
- >10% weekly card share rate
- referral K-factor trend >0.2

## Phase 5: Optimization (Week 7+)
- A/B test push timing, card styles, reward ladders
- Improve categorization confidence and forecast accuracy
- Introduce paid tier (advanced forecasting, family mode)

---

## 10) North-Star and Guardrail Metrics

North-star:
- Weekly active savers (user makes at least one meaningful corrective action per week)

Retention metrics:
- D1/D7/D30 retention
- streak continuation rate
- weekly insight open rate

Virality metrics:
- weekly share-card generation rate
- share-to-signup conversion
- referral completion rate

Guardrails:
- alert fatigue (mute/dismiss rates)
- false-positive variance alerts
- cash forecast error band
