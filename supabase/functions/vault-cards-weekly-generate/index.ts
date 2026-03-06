import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  buildWeeklyCardHeadline,
  sumSpendFromAmounts,
} from "../_shared/budgeting.ts";
import {
  getCurrentWeekPeriod,
  getPreviousWeekPeriod,
} from "../_shared/dates.ts";
import {
  errorResponse,
  handlePreflight,
  jsonResponse,
  requireMethod,
} from "../_shared/http.ts";
import { createServiceClient, requireUserFromRequest } from "../_shared/supabase.ts";

type WeeklyCardBody = {
  weekStart?: string;
  weekEnd?: string;
};

function generateReferralCode(userId: string): string {
  const seed = userId.replace(/-/g, "").slice(0, 6).toUpperCase();
  const random = crypto.getRandomValues(new Uint8Array(4));
  const suffix = Array.from(random)
    .map((value) => (value % 36).toString(36).toUpperCase())
    .join("");
  return `${seed}${suffix}`;
}

function createShareSlug(userId: string, weekStart: string): string {
  const compactWeek = weekStart.replaceAll("-", "");
  const random = crypto.getRandomValues(new Uint8Array(3));
  const short = Array.from(random)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `wk-${compactWeek}-${userId.slice(0, 6)}-${short}`;
}

serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const methodError = requireMethod(req, "POST");
  if (methodError) return methodError;

  try {
    const { userId } = await requireUserFromRequest(req);
    const body = (await req.json().catch(() => ({}))) as WeeklyCardBody;

    const defaultCurrent = getCurrentWeekPeriod();
    const weekStart = body.weekStart ?? defaultCurrent.periodStart;
    const weekEnd = body.weekEnd ?? defaultCurrent.periodEnd;
    const previousWeek = getPreviousWeekPeriod(new Date(`${weekStart}T00:00:00.000Z`));

    const supabase = createServiceClient();

    const { data: thisWeekRows, error: thisWeekError } = await supabase
      .from("vault_transactions")
      .select("amount")
      .eq("user_id", userId)
      .gte("posted_at", weekStart)
      .lte("posted_at", weekEnd);

    if (thisWeekError) {
      return errorResponse("Failed to load current week spend.", 500, thisWeekError.message);
    }

    const { data: prevWeekRows, error: prevWeekError } = await supabase
      .from("vault_transactions")
      .select("amount")
      .eq("user_id", userId)
      .gte("posted_at", previousWeek.periodStart)
      .lte("posted_at", previousWeek.periodEnd);

    if (prevWeekError) {
      return errorResponse("Failed to load previous week spend.", 500, prevWeekError.message);
    }

    const thisWeekSpend = sumSpendFromAmounts(
      (thisWeekRows ?? []).map((row) => Number(row.amount ?? 0)),
    );
    const prevWeekSpend = sumSpendFromAmounts(
      (prevWeekRows ?? []).map((row) => Number(row.amount ?? 0)),
    );
    const amountSaved = Math.max(prevWeekSpend - thisWeekSpend, 0);
    const headline = buildWeeklyCardHeadline(amountSaved);

    const { data: existingReferral, error: referralError } = await supabase
      .from("vault_referral_codes")
      .select("referral_code")
      .eq("user_id", userId)
      .maybeSingle();

    if (referralError) {
      return errorResponse("Failed to read referral code.", 500, referralError.message);
    }

    let referralCode = existingReferral?.referral_code as string | undefined;
    if (!referralCode) {
      referralCode = generateReferralCode(userId);
      const { error: insertReferralError } = await supabase
        .from("vault_referral_codes")
        .upsert({
          user_id: userId,
          referral_code: referralCode,
          is_active: true,
        });

      if (insertReferralError) {
        return errorResponse("Failed to create referral code.", 500, insertReferralError.message);
      }
    }

    const { data: existingCard, error: existingCardError } = await supabase
      .from("vault_weekly_savings_cards")
      .select("id, amount_saved, headline, image_url, share_slug")
      .eq("user_id", userId)
      .eq("week_start", weekStart)
      .eq("week_end", weekEnd)
      .maybeSingle();

    if (existingCardError) {
      return errorResponse("Failed to load weekly card.", 500, existingCardError.message);
    }

    let cardId: string;
    let shareSlug: string;
    if (existingCard?.id) {
      shareSlug = existingCard.share_slug
        ? String(existingCard.share_slug)
        : createShareSlug(userId, weekStart);
      cardId = String(existingCard.id);
      const { error: updateCardError } = await supabase
        .from("vault_weekly_savings_cards")
        .update({
          amount_saved: Number(amountSaved.toFixed(2)),
          headline,
          share_slug: shareSlug,
        })
        .eq("id", cardId);

      if (updateCardError) {
        return errorResponse("Failed to update weekly card.", 500, updateCardError.message);
      }
    } else {
      shareSlug = createShareSlug(userId, weekStart);
      const { data: insertedCardRows, error: insertCardError } = await supabase
        .from("vault_weekly_savings_cards")
        .insert({
          user_id: userId,
          week_start: weekStart,
          week_end: weekEnd,
          amount_saved: Number(amountSaved.toFixed(2)),
          headline,
          image_url: null,
          share_slug: shareSlug,
        })
        .select("id")
        .limit(1);

      if (insertCardError || !insertedCardRows?.[0]?.id) {
        return errorResponse("Failed to create weekly card.", 500, insertCardError?.message);
      }
      cardId = String(insertedCardRows[0].id);
    }

    const shareBaseUrl = Deno.env.get("EXPO_PUBLIC_SHARE_BASE_URL") ?? "https://vault.app";
    const shareUrl = `${shareBaseUrl}/c/${shareSlug}?r=${referralCode}`;

    await supabase.from("vault_event_outbox").insert({
      user_id: userId,
      event_type: "weekly_card_generated",
      payload: {
        cardId,
        weekStart,
        weekEnd,
        amountSaved: Number(amountSaved.toFixed(2)),
      },
    });

    return jsonResponse({
      status: "ok",
      card: {
        id: cardId,
        weekStart,
        weekEnd,
        amountSaved: Number(amountSaved.toFixed(2)),
        thisWeekSpend: Number(thisWeekSpend.toFixed(2)),
        previousWeekSpend: Number(prevWeekSpend.toFixed(2)),
        headline,
        shareSlug,
        shareUrl,
      },
      referralCode,
    });
  } catch (error) {
    return errorResponse(
      "Unhandled weekly-card generation error.",
      500,
      error instanceof Error ? error.message : String(error),
    );
  }
});
