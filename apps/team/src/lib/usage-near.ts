// The admins' one line about the club's free limits (ADR 0059, #148): when the hourly check found any at 70% or more
// (they come with the club, the bootstrap's forAdmins), Home's For admins says the nearest, opening the Usage page;
// 90% and over is hot (its icon in red, colour as an accent). All fine, nothing.
import { formatDayDate, formatTime } from "./dates";
import type { FeedItem } from "./home-feed";

/** A free limit at 70% or more, nearest first, as the worker says it (worker/settings/usage.levels.ts). */
export interface UsageLevel {
  id: string;
  label: string;
  percent: number;
  /** Cloudflare's limits are today's (UTC), Sanity's this month's. */
  period: "day" | "month";
  resetsAt: string;
}

/** From here a limit is nearly spent: said louder. */
const NEARLY_SPENT_AT = 90;

/** The nearest limit as a line, "Database rows read at 74% of today's free limit", or none when all's fine. */
export function usageRow(levels: UsageLevel[] | undefined): FeedItem | null {
  const [nearest, ...others] = levels ?? [];
  if (!nearest) return null;
  const spent = nearest.percent >= NEARLY_SPENT_AT;
  const more = others.length ? `${others.length} more past 70%` : "";
  return {
    key: "admin:usage",
    href: "/settings/usage",
    text: lineOf(nearest),
    sub: sentence([spent ? "nearly spent" : "", resets(nearest), more].filter(Boolean).join(" · ")),
    hot: spent,
    icon: "alert",
  };
}

const sentence = (words: string) => words.charAt(0).toUpperCase() + words.slice(1);

function lineOf(level: UsageLevel) {
  // A request stopped for its CPU time has no share of a day: it went over the free plan's 10 ms
  if (level.id === "cpu") return `${level.label} today`;
  return `${level.label} at ${level.percent}% of ${level.period === "day" ? "today's" : "this month's"} free limit`;
}

/** When it starts again, in London: "resets at 1am", "resets at midnight", "resets Sun 1 Nov". */
function resets(level: UsageLevel) {
  if (level.period === "month") return `resets ${formatDayDate(level.resetsAt)}`;
  const time = formatTime(level.resetsAt);
  return `resets at ${time === "12am" ? "midnight" : time}`;
}
