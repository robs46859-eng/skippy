export type TransactionSeed = {
  providerTransactionId: string;
  merchantName: string;
  description: string;
  amount: number;
  postedAt: string;
  pending?: boolean;
};

export function classifyCategorySlug(merchantName: string): string {
  const name = merchantName.toLowerCase();

  if (
    name.includes("whole foods") ||
    name.includes("kroger") ||
    name.includes("trader joe") ||
    name.includes("aldi")
  ) {
    return "groceries";
  }
  if (
    name.includes("uber") ||
    name.includes("lyft") ||
    name.includes("shell") ||
    name.includes("chevron")
  ) {
    return "transport";
  }
  if (
    name.includes("netflix") ||
    name.includes("spotify") ||
    name.includes("hulu") ||
    name.includes("apple")
  ) {
    return "subscriptions";
  }
  if (
    name.includes("doordash") ||
    name.includes("ubereats") ||
    name.includes("starbucks") ||
    name.includes("chipotle")
  ) {
    return "dining";
  }
  if (name.includes("payroll") || name.includes("salary")) {
    return "income";
  }
  return "other";
}

export function categoryConfidence(slug: string): number {
  if (slug === "other") {
    return 0.65;
  }
  if (slug === "income") {
    return 0.99;
  }
  return 0.92;
}

export function sumSpendFromAmounts(amounts: number[]): number {
  return amounts
    .filter((amount) => amount < 0)
    .reduce((sum, amount) => sum + Math.abs(amount), 0);
}

export function buildWeeklyCardHeadline(savedAmount: number): string {
  if (savedAmount <= 0) {
    return "Consistency week: spend held steady and within plan.";
  }
  if (savedAmount < 50) {
    return `Saved $${savedAmount.toFixed(0)} this week by tightening small habits.`;
  }
  if (savedAmount < 150) {
    return `Saved $${savedAmount.toFixed(0)} this week. Strong momentum.`;
  }
  return `Saved $${savedAmount.toFixed(0)} this week. Vault streak energy is real.`;
}

export function buildFallbackSummary(input: {
  spentThisMonth: number;
  budgetLimit: number;
  forecastEndBalance: number;
  topCategory?: string;
  topCategorySpend?: number;
}): string {
  const utilization = input.budgetLimit > 0
    ? (input.spentThisMonth / input.budgetLimit) * 100
    : 0;
  const topLine = input.topCategory
    ? `Top spending category is ${input.topCategory} at $${(input.topCategorySpend ?? 0).toFixed(0)}.`
    : "Spending is diversified across categories.";
  const riskLine = input.forecastEndBalance < 300
    ? "Cash-flow risk is elevated. Reduce variable spending this week."
    : "Cash-flow outlook is stable if current trends continue.";

  return `You have spent $${input.spentThisMonth.toFixed(0)} of your $${input.budgetLimit.toFixed(0)} monthly budget (${utilization.toFixed(1)}%). ${topLine} ${riskLine}`;
}
