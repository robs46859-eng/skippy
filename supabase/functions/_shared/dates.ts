export function toIsoDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getCurrentMonthPeriod(reference = new Date()) {
  const start = new Date(Date.UTC(
    reference.getUTCFullYear(),
    reference.getUTCMonth(),
    1,
  ));
  const end = new Date(Date.UTC(
    reference.getUTCFullYear(),
    reference.getUTCMonth() + 1,
    0,
  ));
  return {
    periodStart: toIsoDate(start),
    periodEnd: toIsoDate(end),
  };
}

export function getCurrentWeekPeriod(reference = new Date()) {
  const utc = new Date(Date.UTC(
    reference.getUTCFullYear(),
    reference.getUTCMonth(),
    reference.getUTCDate(),
  ));

  const day = utc.getUTCDay(); // 0 = Sun
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(utc);
  monday.setUTCDate(utc.getUTCDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  return {
    periodStart: toIsoDate(monday),
    periodEnd: toIsoDate(sunday),
  };
}

export function getPreviousWeekPeriod(reference = new Date()) {
  const current = getCurrentWeekPeriod(reference);
  const currentStart = new Date(`${current.periodStart}T00:00:00.000Z`);
  const prevStart = new Date(currentStart);
  prevStart.setUTCDate(currentStart.getUTCDate() - 7);
  const prevEnd = new Date(currentStart);
  prevEnd.setUTCDate(currentStart.getUTCDate() - 1);

  return {
    periodStart: toIsoDate(prevStart),
    periodEnd: toIsoDate(prevEnd),
  };
}

export function getDaysElapsedInCurrentPeriod(
  periodStartIso: string,
  periodEndIso: string,
  reference = new Date(),
): { elapsed: number; total: number } {
  const start = new Date(`${periodStartIso}T00:00:00.000Z`);
  const end = new Date(`${periodEndIso}T00:00:00.000Z`);
  const today = new Date(Date.UTC(
    reference.getUTCFullYear(),
    reference.getUTCMonth(),
    reference.getUTCDate(),
  ));

  const clampedToday = today < start ? start : today > end ? end : today;
  const elapsed = Math.max(
    1,
    Math.floor((clampedToday.getTime() - start.getTime()) / 86400000) + 1,
  );
  const total = Math.max(
    1,
    Math.floor((end.getTime() - start.getTime()) / 86400000) + 1,
  );

  return { elapsed, total };
}
