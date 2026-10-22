// A tournament's format and rules, in words, for its one Rules sheet (ADR 0074), a topic each: sign-up (places,
// when it opens and closes, the fee), the draft (what the draft enforces), the format (playoffs, the order's breaks,
// game length, periods and breaks, the gap between matches, the first match), points and how the table's ranked,
// penalties, then the series' own house rules as an admin wrote them. Only what it stores or the code enforces:
// nothing invented.
import type { Tournament } from "../demo/model";
import { BREAK_MINUTES } from "./fixtures";
import { clock, formatDayDate, londonISO } from "./dates";
import { gameLength } from "./periods";
import { PENALTY_KINDS, PENALTY_RULES } from "./penalties";

export interface RulesSection {
  title: string;
  lines: string[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const capital = (s: string) => s[0].toUpperCase() + s.slice(1);

/** The day, as a line says it: "Mon 9 Nov". */
const day = (d: string) => formatDayDate(londonISO(d, "12:00"));

/**
 * The topics, in order: Sign-up, The draft (a draft only), Format, Points, Penalties, then House rules when the series
 * has some.
 */
export function formatAndRules(
  t: Pick<
    Tournament,
    | "kind"
    | "playoffs"
    | "gameMinutes"
    | "periods"
    | "breakMinutes"
    | "startTime"
    | "season"
    | "pointsWin"
    | "pointsDraw"
    | "pointsLoss"
    | "penaltyRule"
    | "defaultPenaltyMinutes"
  > &
    Partial<Pick<Tournament, "capacity" | "feePence" | "signupOpensOn" | "signupClosesOn" | "heldOn">>,
  houseRules = "",
): RulesSection[] {
  const playoffs = t.playoffs ?? [];
  const signup = [
    t.kind === "draft"
      ? "Members say they're in; the captains draft them into teams."
      : "Teams enter with their captain and players.",
    ...(t.capacity ? [`${t.capacity} places; after that, a waiting list in the order people said they're in.`] : []),
    ...(t.signupOpensOn ? [`Sign-up opens ${day(t.signupOpensOn)}.`] : []),
    ...(t.signupClosesOn ? [`It closes at the end of ${day(t.signupClosesOn)}.`] : ["It stays open up to the day."]),
    ...(t.feePence ? [`£${(t.feePence / 100).toFixed(t.feePence % 100 ? 2 : 0)} to play.`] : []),
  ];
  // The draft's own rules, as lib/draft.ts and the Worker enforce them (ADR 0060)
  const draft =
    t.kind === "draft"
      ? [
          "The pick order's drawn at random before it opens, not the order the captains were named in.",
          "Snake order: the captains pick one at a time, and each round the order flips.",
          "The captains are already on their teams: nobody can pick a captain.",
          "One goalie a team: once a team has one, the rest are off the menu.",
          "Whoever runs the draft can pick for a captain who's gone quiet, and undo the last pick.",
          "Anyone not picked when the draft closes stays signed up, and an admin can put them on a team.",
        ]
      : [];
  const format = [
    `A round robin: every team plays every other once${playoffs.length ? `, then ${playoffs.map((p) => `the ${p.name} (${p.home}${ordinal(p.home)} v ${p.away}${ordinal(p.away)})`).join(" and ")}` : ""}.`,
    // The order makeFixtures plays them in (lib/fixtures.ts fairOrder)
    "The order gives everyone the longest break it can: nobody plays twice running unless it can't be helped.",
    `${capital(gameLength(t))}, ${BREAK_MINUTES} minutes between matches.`,
    ...(t.season ? [] : [`The first match at ${clock(t.startTime)}.`]),
  ];
  const points = [
    `${plural(t.pointsWin, "point")} for a win, ${plural(t.pointsDraw, "point")} for a draw, ${plural(t.pointsLoss, "point")} for a loss.`,
    "Level on points: goal difference, then goals scored.",
  ];
  const rule = PENALTY_RULES.find((r) => r.value === (t.penaltyRule ?? "power_play"));
  const usual = PENALTY_KINDS.find((k) => k.minutes === (t.defaultPenaltyMinutes ?? 2));
  const penalties = [
    ...(rule ? [`${rule.label}: ${rule.hint[0].toLowerCase()}${rule.hint.slice(1)}`] : []),
    ...(usual ? [`Usually a ${usual.name.toLowerCase()} (${usual.length}).`] : []),
  ];
  const house = houseRules
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return [
    { title: "Sign-up", lines: signup },
    ...(draft.length ? [{ title: "The draft", lines: draft }] : []),
    { title: "Format", lines: format },
    { title: "Points", lines: points },
    { title: "Penalties", lines: penalties },
    ...(house.length ? [{ title: "House rules", lines: house }] : []),
  ];
}

const ordinal = (n: number) =>
  n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th";

/** House rules, at most this long (a screen of them on a phone). */
export const HOUSE_RULES_MAX = 2000;
