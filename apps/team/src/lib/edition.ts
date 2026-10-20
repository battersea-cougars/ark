// One edition of a tournament series, as its pages head it: where it stands, worked out from its games (scoring the
// first starts it, the last one played ends it, whatever the settings say), and when, with its season.
import type { Tournament } from "../demo/model";
import { isDone } from "@cougars/shared/results";
import { seasonLabel, seasonOf } from "@cougars/shared/seasons";
import { champion } from "./fixtures";
import { formatDayDate, londonISO, londonToday } from "./dates";
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

export const EDITION_LABEL: Record<EditionState, string> = {
  live: "On now",
  done: "Done",
  open: "Sign-up open",
  planned: "Coming up",
};

/** When: the day and hours once there's a day (null while it's just a season), and the season always. */
export function editionWhen(t: Tournament) {
  const season = seasonLabel(t.season ?? seasonOf(t.heldOn).season, t.heldOn);
  const dated = !t.season;
  return {
    day: dated ? formatDayDate(londonISO(t.heldOn, t.startTime)) : null,
    season,
    hours: dated ? `${t.startTime}–${t.endTime}` : null,
  };
}

/**
 * Which edition of a series to open on, by what's happened rather than the dates: the one under way, else the next one
 * that isn't done (just a season is enough; one whose fixed day passed unplayed isn't), else the
 * last one played.
 */
export function latestOf(editions: Tournament[], today: string): Tournament | undefined {
  const mine = [...editions].sort((a, b) => a.heldOn.localeCompare(b.heldOn));
  const ahead = (t: Tournament) => editionState(t) !== "done" && (!!t.season || t.heldOn >= today);
  return (
    mine.find((t) => editionState(t) === "live") ??
    mine.find(ahead) ??
    mine.findLast((t) => editionState(t) === "done") ??
    mine.at(-1)
  );
}

/**
 * The one on or coming up, which a series' running pages show (its fight card, board, teams, draft): its latest, unless
 * that's been played. Then there's nothing on, and every one played is history, on the series' front page.
 */
export function currentOf(editions: Tournament[], today: string): Tournament | undefined {
  const latest = latestOf(editions, today);
  return latest && editionState(latest) !== "done" ? latest : undefined;
}

/** The last one played, other than this: "last time", on the next one's page. */
export const previousOf = (editions: Tournament[], t: Tournament) =>
  editions
    .filter((x) => x.id !== t.id && editionState(x) === "done")
    .sort((a, b) => b.heldOn.localeCompare(a.heldOn))[0];
