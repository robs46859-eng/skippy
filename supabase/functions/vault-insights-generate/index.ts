import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  buildFallbackSummary,
} from "../_shared/budgeting.ts";
import { getCurrentMonthPeriod } from "../_shared/dates.ts";
import {
  errorResponse,
  handlePreflight,
  jsonResponse,
  requireMethod,
} from "../_shared/http.ts";
import { createServiceClient, requireUserFromRequest } from "../_shared/supabase.ts";

type InsightsBody = {
  periodStart?: string;
  periodEnd?: string;
  horizonDays?: number;
  forceNewSummary?: boolean;
};

function severityFromVariancePct(variancePct: number): "low" | "medium" | "high" | "critical" {
  if (variancePct >= 30) return "critical";
  if (variancePct >= 20) return "high";
  if (variancePct >= 10) return "medium";
  return "low";
}

function riskFromPredictedMinBalance(predictedMinBalance: number): "low" | "medium" | "high" {
  if (predictedMinBalance < 200) return "high";
  if (predictedMinBalance < 500) return "medium";
  return "low";
}

async function tryOpenAiSummary(prompt: string): Promise<string | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return null;

  const model = Deno.env.get("OPENAI_MODEL") ?? "gpt-4.1-mini";

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are Vault, an AI budgeting coach. Keep summaries concise, practical, and action-oriented.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) return null;
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  return typeof content === "string" && content.trim().length > 0
    ? content.trim()
    : null;
}

serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const methodError = requireMethod(req, "POST");
  if (methodError) return methodError;

  try {
    const { userId } = await requireUserFromRequest(req);
    const body = (await req.json().catch(() => ({}))) as InsightsBody;
    const defaultPeriod = getCurrentMonthPeriod();
    const periodStart = body.periodStart ?? defaultPeriod.periodStart;
    const periodEnd = body.periodEnd ?? defaultPeriod.periodEnd;
    const horizonDays = Math.max(7, Math.min(body.horizonDays ?? 14, 30));
    const forceNewSummary = body.forceNewSummary ?? false;

    const supabase = createServiceClient();

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
      return errorResponse("Failed to prepare budget period.", 500, periodError?.message);
    }
    const periodId = String(periodRow.id);

    const { data: snapshots, error: snapshotsError } = await supabase
      .from("vault_budget_snapshots")
      .select(
        "id, budget_id, spent_amount, projected_end_amount, utilization_pct, vault_budgets!inner(id, name, amount_limit)",
      )
      .eq("user_id", userId)
      .eq("period_id", periodId);

    if (snapshotsError) {
      return errorResponse("Failed to load budget snapshots.", 500, snapshotsError.message);
    }

    const snapshotRows = snapshots ?? [];
    if (snapshotRows.length === 0) {
      return errorResponse(
        "No budget snapshots found for this period. Run vault-bank-sync first.",
        409,
      );
    }

    let totalSpent = 0;
    let totalBudget = 0;
    let topCategoryName = "";
    let topCategorySpend = 0;
    const createdVarianceIds: string[] = [];
    let recommendationsCreated = 0;

    for (const snapshot of snapshotRows) {
      const budget = (snapshot as {
        vault_budgets: { id: string; name: string; amount_limit: number };
      }).vault_budgets;
      const spent = Number(snapshot.spent_amount ?? 0);
      const projected = Number(snapshot.projected_end_amount ?? spent);
      const limit = Number(budget.amount_limit ?? 0);

      totalSpent += spent;
      totalBudget += limit;
      if (spent > topCategorySpend) {
        topCategorySpend = spent;
        topCategoryName = budget.name;
      }

      const varianceAmount = Math.max(spent - limit, projected - limit, 0);
      if (varianceAmount <= 0) continue;

      const variancePct = limit > 0 ? (varianceAmount / limit) * 100 : 0;
      const severity = severityFromVariancePct(variancePct);
      const driverSummary = `${budget.name} is trending $${varianceAmount.toFixed(2)} over budget.`;

      const { data: existingVarianceRows, error: existingVarianceError } = await supabase
        .from("vault_budget_variances")
        .select("id")
        .eq("user_id", userId)
        .eq("budget_id", budget.id)
        .eq("period_id", periodId)
        .limit(1);

      if (existingVarianceError) {
        return errorResponse("Failed to check existing variance.", 500, existingVarianceError.message);
      }

      const existingVarianceId = existingVarianceRows?.[0]?.id as string | undefined;
      if (existingVarianceId) {
        const { error: updateVarianceError } = await supabase
          .from("vault_budget_variances")
          .update({
            variance_amount: Number(varianceAmount.toFixed(2)),
            variance_pct: Number(variancePct.toFixed(2)),
            severity,
            driver_summary: driverSummary,
          })
          .eq("id", existingVarianceId);

        if (updateVarianceError) {
          return errorResponse("Failed to update variance.", 500, updateVarianceError.message);
        }
        createdVarianceIds.push(existingVarianceId);
      } else {
        const { data: insertedVarianceRows, error: insertVarianceError } = await supabase
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

        if (insertVarianceError) {
          return errorResponse("Failed to create variance.", 500, insertVarianceError.message);
        }
        const varianceId = insertedVarianceRows?.[0]?.id as string | undefined;
        if (varianceId) createdVarianceIds.push(varianceId);
      }
    }

    for (const varianceId of createdVarianceIds) {
      const { data: recommendationRows, error: recommendationRowsError } = await supabase
        .from("vault_recommendations")
        .select("id")
        .eq("user_id", userId)
        .eq("variance_id", varianceId)
        .eq("status", "active")
        .limit(1);

      if (recommendationRowsError) {
        return errorResponse(
          "Failed to inspect recommendations.",
          500,
          recommendationRowsError.message,
        );
      }

      if (!recommendationRows?.length) {
        recommendationsCreated += 1;
        const { error: insertRecommendationError } = await supabase
          .from("vault_recommendations")
          .insert({
            user_id: userId,
            variance_id: varianceId,
            recommendation_type: "transfer_plan",
            title: "Protect budget with weekly auto-transfer",
            details:
              "Move a fixed amount to savings after payday and tighten the highest-variance category for two weeks.",
            expected_monthly_impact: 75,
            confidence: 0.74,
            status: "active",
          });

        if (insertRecommendationError) {
          return errorResponse(
            "Failed to create recommendation.",
            500,
            insertRecommendationError.message,
          );
        }
      }
    }

    const { data: accountBalances, error: accountBalancesError } = await supabase
      .from("vault_bank_accounts")
      .select("current_balance")
      .eq("user_id", userId)
      .eq("is_active", true);

    if (accountBalancesError) {
      return errorResponse("Failed to load account balances.", 500, accountBalancesError.message);
    }

    const currentTotalBalance = (accountBalances ?? []).reduce(
      (sum, row) => sum + Number(row.current_balance ?? 0),
      0,
    );

    const { data: recentTransactions, error: recentTransactionsError } = await supabase
      .from("vault_transactions")
      .select("amount, posted_at")
      .eq("user_id", userId)
      .gte("posted_at", periodStart)
      .lte("posted_at", periodEnd);

    if (recentTransactionsError) {
      return errorResponse("Failed to load transaction trend.", 500, recentTransactionsError.message);
    }

    const netPeriodFlow = (recentTransactions ?? []).reduce(
      (sum, row) => sum + Number(row.amount ?? 0),
      0,
    );
    const periodDayCount = Math.max(
      1,
      Math.floor(
        (new Date(`${periodEnd}T00:00:00.000Z`).getTime() -
          new Date(`${periodStart}T00:00:00.000Z`).getTime()) / 86400000,
      ) + 1,
    );
    const avgDailyNet = netPeriodFlow / periodDayCount;

    const predictedEndBalance = currentTotalBalance + avgDailyNet * horizonDays;
    const predictedMinBalance = Math.min(currentTotalBalance, predictedEndBalance);
    const riskLevel = riskFromPredictedMinBalance(predictedMinBalance);

    const { error: forecastError } = await supabase
      .from("vault_cashflow_forecasts")
      .insert({
        user_id: userId,
        horizon_days: horizonDays,
        predicted_min_balance: Number(predictedMinBalance.toFixed(2)),
        predicted_end_balance: Number(predictedEndBalance.toFixed(2)),
        risk_level: riskLevel,
        model_version: "heuristic-v1",
        confidence_band: {
          lower: Number((predictedEndBalance * 0.9).toFixed(2)),
          upper: Number((predictedEndBalance * 1.1).toFixed(2)),
        },
      });

    if (forecastError) {
      return errorResponse("Failed to write forecast.", 500, forecastError.message);
    }

    if (riskLevel === "high") {
      await supabase.from("vault_alerts").insert({
        user_id: userId,
        alert_type: "cashflow_risk",
        title: "Cash-flow risk detected",
        body:
          "Forecasted minimum balance is low. Use the top recommendation to reduce downside this week.",
        severity: "critical",
        metadata: {
          predicted_min_balance: Number(predictedMinBalance.toFixed(2)),
          horizon_days: horizonDays,
        },
      });
    }

    const fallbackSummary = buildFallbackSummary({
      spentThisMonth: totalSpent,
      budgetLimit: totalBudget,
      forecastEndBalance: predictedEndBalance,
      topCategory: topCategoryName || undefined,
      topCategorySpend,
    });

    const aiPrompt =
      `Period ${periodStart} to ${periodEnd}. Total spent: $${totalSpent.toFixed(2)}. Budget: $${totalBudget.toFixed(2)}. ` +
      `Top category: ${topCategoryName || "n/a"} ($${topCategorySpend.toFixed(2)}). ` +
      `Forecasted end balance in ${horizonDays} days: $${predictedEndBalance.toFixed(2)}. ` +
      `Risk level: ${riskLevel}. Give a concise summary and 3 corrective recommendations.`;
    const summaryText = await tryOpenAiSummary(aiPrompt) ?? fallbackSummary;

    if (forceNewSummary) {
      await supabase
        .from("vault_ai_summaries")
        .delete()
        .eq("user_id", userId)
        .eq("period_start", periodStart)
        .eq("period_end", periodEnd);
    }

    const { data: summaryRows, error: summaryUpsertError } = await supabase
      .from("vault_ai_summaries")
      .upsert({
        user_id: userId,
        period_start: periodStart,
        period_end: periodEnd,
        summary_markdown: summaryText,
        structured_payload: {
          totals: {
            spent: Number(totalSpent.toFixed(2)),
            budget: Number(totalBudget.toFixed(2)),
          },
          top_category: {
            name: topCategoryName,
            spend: Number(topCategorySpend.toFixed(2)),
          },
          forecast: {
            horizon_days: horizonDays,
            predicted_end_balance: Number(predictedEndBalance.toFixed(2)),
            predicted_min_balance: Number(predictedMinBalance.toFixed(2)),
            risk_level: riskLevel,
          },
          generated_by: Deno.env.get("OPENAI_API_KEY") ? "openai_or_fallback" : "fallback",
        },
        model_provider: Deno.env.get("OPENAI_API_KEY") ? "openai" : "vault",
        model_name: Deno.env.get("OPENAI_MODEL") ?? "heuristic-v1",
      }, { onConflict: "user_id,period_start,period_end" })
      .select("id")
      .limit(1);

    if (summaryUpsertError) {
      return errorResponse("Failed to upsert AI summary.", 500, summaryUpsertError.message);
    }

    await supabase.from("vault_event_outbox").insert({
      user_id: userId,
      event_type: "insights_generated",
      payload: {
        periodStart,
        periodEnd,
        horizonDays,
        riskLevel,
        recommendationCount: recommendationsCreated,
      },
    });

    return jsonResponse({
      status: "ok",
      period: { start: periodStart, end: periodEnd },
      summaryId: summaryRows?.[0]?.id ?? null,
      riskLevel,
      forecast: {
        horizonDays,
        predictedEndBalance: Number(predictedEndBalance.toFixed(2)),
        predictedMinBalance: Number(predictedMinBalance.toFixed(2)),
      },
      recommendationsCreated,
      variancesTracked: createdVarianceIds.length,
      summary: summaryText,
    });
  } catch (error) {
    return errorResponse(
      "Unhandled insights generation error.",
      500,
      error instanceof Error ? error.message : String(error),
    );
  }
});
