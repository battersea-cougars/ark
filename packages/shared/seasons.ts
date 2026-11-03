// A tournament date that's only a season so far, "Summer 2027" (apps/team/worker/tournaments/README.md). Its day is
// the season's last, so it sorts with the others and counts as coming up until the season is over; that day is never
// shown. Seasons are the UK's by month: winter 2027 runs December 2027 to February 2028.

export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type Season = (typeof SEASONS)[number];

const LAST_MONTH: Record<Season, number> = { spring: 5, summer: 8, autumn: 11, winter: 2 };

/** The day that stands in for a season: its last ("2027-08-31" for summer 2027). */
export function seasonEnd(season: Season, year: number): string {
  const y = season === "winter" ? year + 1 : year;
  const month = LAST_MONTH[season];
  const day = new Date(Date.UTC(y, month, 0)).getUTCDate();
  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The year a season belongs to, from the day that stands in for it (winter's ends the year after). */
export const seasonYear = (season: Season, heldOn: string) =>
  Number(heldOn.slice(0, 4)) - (season === "winter" ? 1 : 0);

/** "Summer 2027". */
export const seasonLabel = (season: Season, heldOn: string) =>
  `${season[0].toUpperCase()}${season.slice(1)} ${seasonYear(season, heldOn)}`;

export const isSeason = (v: unknown): v is Season => SEASONS.includes(v as Season);

/** The season a day is in, and the year that season belongs to (a January day is in the previous year's winter). */
export function seasonOf(day: string): { season: Season; year: number } {
  const month = Number(day.slice(5, 7));
  const year = Number(day.slice(0, 4));
  if (month <= 2) return { season: "winter", year: year - 1 };
  if (month === 12) return { season: "winter", year };
  return { season: SEASONS[Math.floor((month - 3) / 3)], year };
}

/** The season a day is in and the next ones, `count` in all: what a tournament's date can be picked from. */
export function seasonsFrom(day: string, count: number): { season: Season; year: number }[] {
  let { season, year } = seasonOf(day);
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({ season, year });
    if (season === "winter") year++;
    season = SEASONS[(SEASONS.indexOf(season) + 1) % 4];
  }
  return out;
}
