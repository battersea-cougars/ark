// One edition of a tournament series, as its pages head it: where it stands, worked out from its games (scoring the
// first starts it, the last one played ends it, whatever the settings say), and when, with its season.
import type { Tournament } from "../demo/model";
import type { Stage } from "../app/nav-routes";
import { isDone } from "@cougars/shared/results";
import { seasonLabel, seasonOf } from "@cougars/shared/seasons";
import { champion } from "./fixtures";
import { clockRange, formatDayDate, londonEvening, londonISO, londonToday } from "./dates";
import { signupOpen } from "./signup";

export type EditionState = "live" | "done" | "open" | "planned";

/** The champions, once it's decided. */
export const championOf = (t: Tournament) =>
  champion(
    t.teams.flatMap((x) => (x.id ? [x.id] : [])),
    t.games ?? [],
    { win: t.pointsWin, draw: t.pointsDraw, loss: t.pointsLoss },
  );

/**
 * Where it stands, by its games more than its settings: under way once a game's being scored or has a result, done
 * once every game's played (or an admin marked it finished). Before then, sign-up open or coming up.
 */
export function editionState(t: Tournament): EditionState {
  const games = t.games ?? [];
  if (isDone(t.status, games)) return "done";
  if (t.status === "live" || games.some((g) => g.status !== "next")) return "live";
  return signupOpen(t, londonToday()) ? "open" : "planned";
}

/**
 * Started: under way or done (editionState). From then who's in is an admin's to change, not a member's own In or Out
 * (ADR 0074; the server keeps to it, worker/tournaments/started.ts): it's what the fees follow.
 */
export function hasStarted(t: Tournament) {
  const state = editionState(t);
  return state === "live" || state === "done";
}

/**
 * Where the next one has got to (ADR 0074), for which of its pages are tabs: its fixtures out once it has games; a
 * draft's on while it's open; the teams set once a draft closes, or once teams have entered; else it's sign-up.
 */
export function stageOf(t: Tournament): Stage {
  if (t.games?.length) return "fixtures";
  if (t.kind === "draft") return t.draftState === "open" ? "draft" : t.draftState === "closed" ? "teams" : "signup";
  return t.teams.length ? "teams" : "signup";
}

export const EDITION_LABEL: Record<EditionState, string> = {
  live: "On now",
  done: "Done",
  open: "Sign-up open",
  planned: "Coming up",
};

/** When: the day and hours once there's a day (null while it's just a season), and the season always. */
export function editionWhen(t: Pick<Tournament, "season" | "heldOn" | "startTime" | "endTime">) {
  const season = seasonLabel(t.season ?? seasonOf(t.heldOn).season, t.heldOn);
  const dated = !t.season;
  return {
    day: dated ? formatDayDate(londonISO(t.heldOn, t.startTime)) : null,
    season,
    hours: dated ? clockRange(t.startTime, t.endTime) : null,
  };
}

/**
 * Which edition of a series to open on, by what's happened rather than the dates: the one under way, else the first
 * that isn't done (just a season is enough; one whose fixed day passed unplayed still is, until an admin plays it,
 * moves it or deletes it, #169), else the last one played.
 */
export function latestOf(editions: Tournament[]): Tournament | undefined {
  const mine = [...editions].sort((a, b) => a.heldOn.localeCompare(b.heldOn));
  return (
    mine.find((t) => editionState(t) === "live") ??
    mine.find((t) => editionState(t) !== "done") ??
    mine.findLast((t) => editionState(t) === "done") ??
    mine.at(-1)
  );
}

/**
 * The evening it was played: its last match's kick-off's (till 06:00 the next morning, lib/dates.ts londonEvening),
 * whatever its date says, as a match starts on any day (ADR 0074). None kicked off (results typed in): its own day, if
 * it has one; just a season, none.
 */
export function playedOn(t: Tournament): string | null {
  const last = (t.games ?? [])
    .flatMap((g) => (g.startedAt ? [g.startedAt] : []))
    .sort()
    .at(-1);
  if (last) return londonEvening(new Date(last));
  return t.season ? null : t.heldOn;
}

/**
 * At its after-party (ADR 0074): its last match played (or an admin marked it finished), on the evening it was played
 * (`evening`, lib/dates.ts londonEvening), the awards revealed or not: once they are, its page is its results, Done.
 * Results typed in on another day, or one with only a season, go straight to history.
 */
export const atAfters = (t: Tournament, evening: string) => editionState(t) === "done" && playedOn(t) === evening;

/**
 * The one on or coming up, which a series' running pages show (its fight card, board, teams, draft): its latest, unless
 * that's been played. Then there's nothing on, and every one played is history, on the series' front page. The
 * evening one's played, it's still on, at its after-party, till the morning (`evening`: London's evening now), even
 * with the next one scheduled.
 */
export function currentOf(editions: Tournament[], evening?: string): Tournament | undefined {
  const tonight = evening ? editions.find((t) => atAfters(t, evening)) : undefined;
  if (tonight) return tonight;
  const latest = latestOf(editions);
  return latest && editionState(latest) !== "done" ? latest : undefined;
}

/** The last one played, other than this: "last time", on the next one's page. */
export const previousOf = (editions: Tournament[], t: Tournament) =>
  editions
    .filter((x) => x.id !== t.id && editionState(x) === "done")
    .sort((a, b) => b.heldOn.localeCompare(a.heldOn))[0];

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * How far off its day is, for the header (ADR 0074): within a week it leads the line, big ("Today", "Tomorrow", "This
 * Friday", "In 7 days"), so nobody misses that it's tomorrow; further off it's a quiet "in 24 days" after the date.
 * Both London dates (YYYY-MM-DD); a day gone by says nothing.
 */
export function countdownOf(day: string, today: string): { lead: string } | { quiet: string } | null {
  const days = Math.round((Date.parse(day) - Date.parse(today)) / 86_400_000);
  if (days < 0) return null;
  if (days === 0) return { lead: "Today" };
  if (days === 1) return { lead: "Tomorrow" };
  if (days < 7) return { lead: `This ${WEEKDAYS[new Date(`${day}T12:00:00Z`).getUTCDay()]}` };
  if (days === 7) return { lead: "In 7 days" };
  return { quiet: `in ${days} days` };
}
