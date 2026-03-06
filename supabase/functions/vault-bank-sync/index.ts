import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { getBankAdapter } from "../_shared/bank-adapters/index.ts";
import {
  categoryConfidence,
  classifyCategorySlug,
  sumSpendFromAmounts,
} from "../_shared/budgeting.ts";
import type { TransactionSeed } from "../_shared/budgeting.ts";
import {
  getCurrentMonthPeriod,
  getDaysElapsedInCurrentPeriod,
  toIsoDate,
} from "../_shared/dates.ts";
import {
  errorResponse,
  handlePreflight,
  jsonResponse,
  requireMethod,
} from "../_shared/http.ts";
import { createServiceClient, requireUserFromRequest } from "../_shared/supabase.ts";

type SyncBody = {
  connectionId?: string;
  maxTransactions?: number;
};

type VaultAccount = {
  id: string;
  provider_account_id: string;
  account_name: string;
  account_type: string;
};

function createSandboxTransactions(
  account: VaultAccount,
  maxTransactions: number,
): TransactionSeed[] {
  const merchants = [
    { name: "Whole Foods", amount: -74.82 },
    { name: "Uber", amount: -19.4 },
    { name: "Netflix", amount: -15.49 },
    { name: "DoorDash", amount: -28.11 },
    { name: "Shell", amount: -52.2 },
    { name: "Payroll", amount: 2300.0 },
    { name: "Trader Joe's", amount: -45.7 },
    { name: "Spotify", amount: -10.99 },
  ];

  const count = Math.max(1, Math.min(maxTransactions, merchants.length));
  const now = new Date();
  const result: TransactionSeed[] = [];

  for (let i = 0; i < count; i += 1) {
    const template = merchants[i];
    const postedDate = new Date(now);
    postedDate.setUTCDate(now.getUTCDate() - i);
    const postedAt = toIsoDate(postedDate);
    const providerTransactionId =
      `sandbox-${account.provider_account_id}-${postedAt}-${i + 1}`;

    result.push({
      providerTransactionId,
      merchantName: template.name,
      description: template.name,
      amount: template.amount,
      postedAt,
      pending: false,
    });
  }

  return result;
}

function severityFromVariancePct(variancePct: number): "low" | "medium" | "high" | "critical" {
  if (variancePct >= 30) return "critical";
  if (variancePct >= 20) return "high";
  if (variancePct >= 10) return "medium";
  return "low";
}

serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const methodError = requireMethod(req, "POST");
  if (methodError) return methodError;

  try {
    const { userId } = await requireUserFromRequest(req);
    const body = (await req.json().catch(() => ({}))) as SyncBody;
    const connectionId = body.connectionId;
    const maxTransactions = body.maxTransactions ?? 8;

    if (!connectionId) {
      return errorResponse("Missing required field: connectionId", 400);
    }

    const supabase = createServiceClient();

    const { data: connection, error: connectionError } = await supabase
      .from("vault_bank_connections")
      .select("id, user_id, provider, institution_name, sync_cursor, status, access_token_ref")
      .eq("id", connectionId)
      .eq("user_id", userId)
      .maybeSingle();

    if (connectionError) {
      return errorResponse("Failed to load bank connection.", 500, connectionError.message);
    }
    if (!connection) {
      return errorResponse("Bank connection not found.", 404);
    }

    const { data: currentAccounts, error: accountsError } = await supabase
      .from("vault_bank_accounts")
      .select("id, provider_account_id, account_name, account_type")
      .eq("connection_id", connectionId)
      .eq("user_id", userId)
      .eq("is_active", true);

    if (accountsError) {
      return errorResponse("Failed to load connected accounts.", 500, accountsError.message);
    }

    let accounts = (currentAccounts ?? []) as VaultAccount[];
    let removedProviderTransactionIds: string[] = [];
    let nextCursor: string | null = connection.sync_cursor;
    let transactionRowsForUpsert: Array<{
      user_id: string;
      account_id: string;
      provider_transaction_id: string;
      merchant_name: string;
      description: string;
      amount: number;
      iso_currency_code: string;
      posted_at: string;
      pending: boolean;
      normalized_merchant: string;
    }> = [];

    if (connection.provider === "sandbox") {
      if (accounts.length === 0) {
        const seedAccount = {
          connection_id: connectionId,
          user_id: userId,
          provider_account_id: "sandbox-checking-001",
          account_name: `${connection.institution_name ?? "Sandbox"} Checking`,
          account_type: "checking",
          subtype: "checking",
          iso_currency_code: "USD",
          current_balance: 4200,
          available_balance: 4100,
          is_active: true,
        };

        const { error: insertAccountError } = await supabase
          .from("vault_bank_accounts")
          .upsert(seedAccount, { onConflict: "connection_id,provider_account_id" });

        if (insertAccountError) {
          return errorResponse("Failed to initialize sandbox account.", 500, insertAccountError.message);
        }

        const { data: seededAccounts, error: seededAccountsError } = await supabase
          .from("vault_bank_accounts")
          .select("id, provider_account_id, account_name, account_type")
          .eq("connection_id", connectionId)
          .eq("user_id", userId)
          .eq("is_active", true);

        if (seededAccountsError) {
          return errorResponse("Failed to load seeded account.", 500, seededAccountsError.message);
        }
        accounts = (seededAccounts ?? []) as VaultAccount[];
      }

      transactionRowsForUpsert = accounts.flatMap((account) =>
        createSandboxTransactions(account, maxTransactions).map((txn) => ({
          user_id: userId,
          account_id: account.id,
          provider_transaction_id: txn.providerTransactionId,
          merchant_name: txn.merchantName,
          description: txn.description,
          amount: txn.amount,
          iso_currency_code: "USD",
          posted_at: txn.postedAt,
          pending: txn.pending ?? false,
          normalized_merchant: txn.merchantName.toLowerCase(),
        }))
      );
    } else if (connection.provider === "plaid") {
      if (accounts.length === 0) {
        return errorResponse(
          "No linked accounts for this Plaid connection. Exchange token first.",
          409,
        );
      }

      const adapter = getBankAdapter("plaid");
      const syncResult = await adapter.syncTransactions({
        accessTokenRef: String(connection.access_token_ref ?? ""),
        cursor: connection.sync_cursor,
      });
      removedProviderTransactionIds = syncResult.removedProviderTransactionIds;
      nextCursor = syncResult.nextCursor ?? connection.sync_cursor;

      const accountIdByProvider = new Map<string, string>();
      for (const account of accounts) {
        accountIdByProvider.set(account.provider_account_id, account.id);
      }

      const missingProviderAccountIds = Array.from(
        new Set(
          syncResult.upserts
            .map((txn) => txn.providerAccountId)
            .filter((providerAccountId) => !accountIdByProvider.has(providerAccountId)),
        ),
      );

      if (missingProviderAccountIds.length > 0) {
        const placeholderAccounts = missingProviderAccountIds.map((providerAccountId, index) => ({
          connection_id: connectionId,
          user_id: userId,
          provider_account_id: providerAccountId,
          account_name: `Linked Account ${index + 1}`,
          account_type: "checking",
          subtype: "unknown",
          iso_currency_code: "USD",
          is_active: true,
        }));

        const { error: placeholderInsertError } = await supabase
          .from("vault_bank_accounts")
          .upsert(placeholderAccounts, { onConflict: "connection_id,provider_account_id" });

        if (placeholderInsertError) {
          return errorResponse("Failed to create missing Plaid accounts.", 500, placeholderInsertError.message);
        }

        const { data: refreshedAccounts, error: refreshedAccountsError } = await supabase
          .from("vault_bank_accounts")
          .select("id, provider_account_id, account_name, account_type")
          .eq("connection_id", connectionId)
          .eq("user_id", userId)
          .eq("is_active", true);

        if (refreshedAccountsError) {
          return errorResponse("Failed to refresh account mapping.", 500, refreshedAccountsError.message);
        }

        accounts = (refreshedAccounts ?? []) as VaultAccount[];
        accountIdByProvider.clear();
        for (const account of accounts) {
          accountIdByProvider.set(account.provider_account_id, account.id);
        }
      }

      transactionRowsForUpsert = syncResult.upserts
        .map((txn) => {
          const accountId = accountIdByProvider.get(txn.providerAccountId);
          if (!accountId) return null;
          return {
            user_id: userId,
            account_id: accountId,
            provider_transaction_id: txn.providerTransactionId,
            merchant_name: txn.merchantName ?? txn.description,
            description: txn.description,
            amount: txn.amount,
            iso_currency_code: txn.isoCurrencyCode ?? "USD",
            posted_at: txn.postedAt,
            pending: txn.pending,
            normalized_merchant: (txn.normalizedMerchant ?? txn.merchantName ?? txn.description).toLowerCase(),
          };
        })
        .filter((row): row is NonNullable<typeof row> => Boolean(row));
    } else {
      const { error: queueError } = await supabase.from("vault_event_outbox").insert({
        user_id: userId,
        event_type: "bank_sync_requested",
        payload: {
          connectionId,
          provider: connection.provider,
          requestedAt: new Date().toISOString(),
        },
      });

      if (queueError) {
        return errorResponse("Failed to queue bank sync request.", 500, queueError.message);
      }

      await supabase.from("vault_bank_connections")
        .update({
          last_synced_at: new Date().toISOString(),
        })
        .eq("id", connectionId)
        .eq("user_id", userId);

      return jsonResponse({
        status: "queued",
        provider: connection.provider,
        message: "Provider sync has been queued for background processing.",
      });
    }

    let txRows: Array<{ id: string; amount: number; merchant_name: string | null; posted_at: string }> = [];
    if (transactionRowsForUpsert.length > 0) {
      const { data: upsertedTransactions, error: upsertTransactionsError } = await supabase
        .from("vault_transactions")
        .upsert(transactionRowsForUpsert, { onConflict: "account_id,provider_transaction_id" })
        .select("id, amount, merchant_name, posted_at");

      if (upsertTransactionsError) {
        return errorResponse("Failed to sync transactions.", 500, upsertTransactionsError.message);
      }
      txRows = upsertedTransactions ?? [];
    }

    if (removedProviderTransactionIds.length > 0) {
      const { error: removedDeleteError } = await supabase
        .from("vault_transactions")
        .delete()
        .eq("user_id", userId)
        .in("provider_transaction_id", removedProviderTransactionIds);

      if (removedDeleteError) {
        return errorResponse("Failed to remove stale provider transactions.", 500, removedDeleteError.message);
      }
    }

    const transactionIds = txRows.map((row) => row.id as string);

    const { data: categoryRows, error: categoriesError } = await supabase
      .from("vault_categories")
      .select("id, slug");

    if (categoriesError) {
      return errorResponse("Failed to load categories.", 500, categoriesError.message);
    }

    const categoryBySlug = new Map<string, string>();
    for (const row of categoryRows ?? []) {
      categoryBySlug.set(String(row.slug), String(row.id));
    }

    for (const tx of txRows) {
      const slug = classifyCategorySlug(String(tx.merchant_name ?? ""));
      const categoryId = categoryBySlug.get(slug) ?? categoryBySlug.get("other");
      if (!categoryId) continue;

      await supabase
        .from("vault_transaction_categories")
        .update({ is_active: false })
        .eq("transaction_id", tx.id)
        .eq("is_active", true);

      const { error: insertCategoryError } = await supabase
        .from("vault_transaction_categories")
        .insert({
          transaction_id: tx.id,
          user_id: userId,
          category_id: categoryId,
          source: "rule",
          confidence: categoryConfidence(slug),
          is_active: true,
        });

      if (insertCategoryError) {
        return errorResponse(
          "Failed to assign transaction categories.",
          500,
          insertCategoryError.message,
        );
      }
    }

    const { periodStart, periodEnd } = getCurrentMonthPeriod();
    const { data: periodRow, error: periodError } = await supabase
      .from("vault_budget_periods")
      .upsert({
        user_id: userId,
        period_start: periodStart,
        period_end: periodEnd,
      }, { onConflict: "user_id,period_start,period_end" })
      .select("id")
      .single();

    if (periodError || !periodRow?.id) {
      return errorResponse("Failed to create budget period.", 500, periodError?.message);
    }

    const periodId = String(periodRow.id);
    const { data: budgets, error: budgetsError } = await supabase
      .from("vault_budgets")
      .select("id, name, category_id, amount_limit, alert_threshold_pct")
      .eq("user_id", userId);

    if (budgetsError) {
      return errorResponse("Failed to load budgets.", 500, budgetsError.message);
    }

    const { data: previousSnapshots, error: previousSnapshotsError } = await supabase
      .from("vault_budget_snapshots")
      .select("id, budget_id, utilization_pct")
      .eq("user_id", userId)
      .eq("period_id", periodId);

    if (previousSnapshotsError) {
      return errorResponse("Failed to load prior snapshots.", 500, previousSnapshotsError.message);
    }

    const previousUtilizationByBudget = new Map<string, number>();
    for (const snap of previousSnapshots ?? []) {
      previousUtilizationByBudget.set(
        String(snap.budget_id),
        Number(snap.utilization_pct ?? 0),
      );
    }

    let budgetsEvaluated = 0;
    let overspendAlertsCreated = 0;
    const { elapsed, total } = getDaysElapsedInCurrentPeriod(periodStart, periodEnd);

    for (const budget of budgets ?? []) {
      budgetsEvaluated += 1;

      let query = supabase
        .from("vault_transaction_categories")
        .select(
          "transaction_id, category_id, vault_transactions!inner(amount, posted_at)",
        )
        .eq("user_id", userId)
        .eq("is_active", true)
        .gte("vault_transactions.posted_at", periodStart)
        .lte("vault_transactions.posted_at", periodEnd);

      if (budget.category_id) {
        query = query.eq("category_id", String(budget.category_id));
      }

      const { data: categorizedRows, error: categorizedRowsError } = await query;
      if (categorizedRowsError) {
        return errorResponse(
          `Failed to aggregate spending for budget ${budget.name}.`,
          500,
          categorizedRowsError.message,
        );
      }

      const amounts = (categorizedRows ?? []).map((row) =>
        Number(
          ((row as { vault_transactions: { amount: number } | null }).vault_transactions
            ?.amount ?? 0),
        )
      );
      const spentAmount = sumSpendFromAmounts(amounts);
      const limit = Number(budget.amount_limit ?? 0);
      const utilizationPct = limit > 0 ? (spentAmount / limit) * 100 : 0;
      const dailyRunRate = spentAmount / elapsed;
      const projectedEndAmount = dailyRunRate * total;
      const remainingAmount = Math.max(limit - spentAmount, 0);

      const { error: snapshotUpsertError } = await supabase
        .from("vault_budget_snapshots")
        .upsert({
          user_id: userId,
          budget_id: budget.id,
          period_id: periodId,
          spent_amount: Number(spentAmount.toFixed(2)),
          remaining_amount: Number(remainingAmount.toFixed(2)),
          utilization_pct: Number(utilizationPct.toFixed(2)),
          projected_end_amount: Number(projectedEndAmount.toFixed(2)),
          computed_at: new Date().toISOString(),
        }, {
          onConflict: "budget_id,period_id",
        });

      if (snapshotUpsertError) {
        return errorResponse(
          `Failed to upsert budget snapshot for ${budget.name}.`,
          500,
          snapshotUpsertError.message,
        );
      }

      const varianceAmount = Math.max(
        spentAmount - limit,
        projectedEndAmount - limit,
        0,
      );
      const variancePct = limit > 0 ? (varianceAmount / limit) * 100 : 0;
      if (varianceAmount > 0) {
        const severity = severityFromVariancePct(variancePct);
        const driverSummary =
          `Projected spend exceeds plan by $${varianceAmount.toFixed(2)} in ${budget.name}.`;

        const { data: existingVarianceRows } = await supabase
          .from("vault_budget_variances")
          .select("id")
          .eq("user_id", userId)
          .eq("budget_id", budget.id)
          .eq("period_id", periodId)
          .limit(1);

        const existingVarianceId = existingVarianceRows?.[0]?.id as string | undefined;
        if (existingVarianceId) {
          await supabase
            .from("vault_budget_variances")
            .update({
              variance_amount: Number(varianceAmount.toFixed(2)),
              variance_pct: Number(variancePct.toFixed(2)),
              severity,
              driver_summary: driverSummary,
            })
            .eq("id", existingVarianceId);
        } else {
          const { data: insertedVarianceRows } = await supabase
            .from("vault_budget_variances")
            .insert({
              user_id: userId,
              budget_id: budget.id,
              period_id: periodId,
              variance_amount: Number(varianceAmount.toFixed(2)),
              variance_pct: Number(variancePct.toFixed(2)),
              severity,
              driver_summary: driverSummary,
            })
            .select("id")
            .limit(1);

          const varianceId = insertedVarianceRows?.[0]?.id as string | undefined;
          if (varianceId) {
            const { data: existingRecommendationRows } = await supabase
              .from("vault_recommendations")
              .select("id")
              .eq("user_id", userId)
              .eq("variance_id", varianceId)
              .eq("status", "active")
              .limit(1);

            if (!existingRecommendationRows?.length) {
              await supabase.from("vault_recommendations").insert({
                user_id: userId,
                variance_id: varianceId,
                recommendation_type: "cap_adjustment",
                title: `Rebalance ${budget.name} cap`,
                details:
                  `Set a temporary cap reduction in ${budget.name} to prevent a month-end overrun.`,
                expected_monthly_impact: Number(varianceAmount.toFixed(2)),
                confidence: 0.78,
                status: "active",
              });
            }
          }
        }
      }

      const threshold = Number(budget.alert_threshold_pct ?? 80);
      const previousUtilization = previousUtilizationByBudget.get(String(budget.id)) ?? 0;
      if (utilizationPct >= threshold && previousUtilization < threshold) {
        overspendAlertsCreated += 1;
        await supabase.from("vault_alerts").insert({
          user_id: userId,
          alert_type: "overspend",
          title: `${budget.name} budget alert`,
          body:
            `${budget.name} reached ${utilizationPct.toFixed(1)}% of limit. Suggested action: reduce variable spend by 10% this week.`,
          severity: utilizationPct >= 100 ? "critical" : "warn",
          metadata: {
            budget_id: budget.id,
            utilization_pct: Number(utilizationPct.toFixed(2)),
            threshold_pct: threshold,
          },
        });

        await supabase.from("vault_event_outbox").insert({
          user_id: userId,
          event_type: "overspend_alert_created",
          payload: {
            budgetId: budget.id,
            budgetName: budget.name,
            utilizationPct: Number(utilizationPct.toFixed(2)),
            thresholdPct: threshold,
          },
        });
      }
    }

    await supabase.from("vault_bank_connections")
      .update({
        sync_cursor: nextCursor ?? `sync:${new Date().toISOString()}`,
        last_synced_at: new Date().toISOString(),
        status: "active",
      })
      .eq("id", connectionId)
      .eq("user_id", userId);

    return jsonResponse({
      status: "ok",
      connectionId,
      provider: connection.provider,
      accountsSynced: accounts.length,
      transactionsSynced: transactionRowsForUpsert.length,
      transactionsProcessed: transactionIds.length,
      transactionsRemoved: removedProviderTransactionIds.length,
      budgetsEvaluated,
      overspendAlertsCreated,
      monthPeriod: { start: periodStart, end: periodEnd },
    });
  } catch (error) {
    return errorResponse(
      "Unhandled bank sync error.",
      500,
      error instanceof Error ? error.message : String(error),
    );
  }
});
