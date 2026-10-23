// A tournament's format and rules, in words, for its one Rules sheet (ADR 0074), a topic a page, each rule its fact
// first: sign-up (places, when it opens and closes, the fee), the draft (what the draft enforces), the format
// (playoffs, the order's breaks, game length, periods and breaks, the gap between matches, the first match), points
// and how the table's ranked, penalties, then the series' own house rules as an admin wrote them. Only what it stores
// or the code enforces: nothing invented.
import type { Tournament } from "../demo/model";
import { BREAK_MINUTES } from "./fixtures";
import { clock, formatDayDate, londonISO } from "./dates";
import { gameLength } from "./periods";
import { PENALTY_KINDS, PENALTY_RULES } from "./penalties";

/** A topic's id: which one a Rules sheet opens on for the status it's at (lib/TournamentHead). */
export type RulesTopic = "signup" | "draft" | "format" | "points" | "penalties" | "house";

/** A rule, the fact first (bold, "24 places"), then the rest of the sentence (", then a waiting list…"). */
export interface RulesLine {
  key: string;
  rest: string;
}

export interface RulesSection {
  id: RulesTopic;
  title: string;
  lines: RulesLine[];
}

/** A rule as one sentence. */
export const lineText = (l: RulesLine) => l.key + l.rest;

const line = (key: string, rest = ""): RulesLine => ({ key, rest });

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
      ? line("Members sign up", ", and the captains draft them into teams.")
      : line("Teams enter", " with their captain and players."),
    ...(t.capacity ? [line(`${t.capacity} places`, ", then a waiting list in the order people said they're in.")] : []),
    ...(t.signupOpensOn ? [line(`Opens ${day(t.signupOpensOn)}`, ".")] : []),
    ...(t.signupClosesOn
      ? [line(`Closes at the end of ${day(t.signupClosesOn)}`, ", or sooner if an admin closes it.")]
      : [line("Open up to the day", ", unless an admin closes it sooner.")]),
    ...(t.feePence ? [line(`£${(t.feePence / 100).toFixed(t.feePence % 100 ? 2 : 0)}`, " to play.")] : []),
  ];
  // The draft's own rules, as lib/draft.ts and the Worker enforce them (ADR 0060)
  const draft =
    t.kind === "draft"
      ? [
          line("The order's drawn at random", " before it opens, not the order the captains were named in."),
          line("Snake order", ": the captains pick one at a time, and each round the order flips."),
          line("Captains are on their teams already", ": nobody can pick a captain."),
          line("One goalie a team", ": once a team has one, the rest are off the menu."),
          line("A captain gone quiet", ": whoever runs the draft can pick for them, and undo the last pick."),
          line("Not picked when it closes", ": you stay signed up, and an admin can put you on a team."),
        ]
      : [];
  const format = [
    line(
      "A round robin",
      `: every team plays every other once${playoffs.length ? `, then ${playoffs.map((p) => `the ${p.name} (${p.home}${ordinal(p.home)} v ${p.away}${ordinal(p.away)})`).join(" and ")}` : ""}.`,
    ),
    // The order makeFixtures plays them in (lib/fixtures.ts fairOrder)
    line("The longest break it can", ": nobody plays twice running unless it can't be helped."),
    line(capital(gameLength(t)), `, ${BREAK_MINUTES} minutes between matches.`),
    ...(t.season ? [] : [line(`First match at ${clock(t.startTime)}`, ".")]),
  ];
  const points = [
    line(
      `${plural(t.pointsWin, "point")} a win`,
      `, ${plural(t.pointsDraw, "point")} a draw, ${plural(t.pointsLoss, "point")} a loss.`,
    ),
    line("Level on points", ": goal difference, then goals scored."),
  ];
  const rule = PENALTY_RULES.find((r) => r.value === (t.penaltyRule ?? "power_play"));
  const usual = PENALTY_KINDS.find((k) => k.minutes === (t.defaultPenaltyMinutes ?? 2));
  const penalties = [
    ...(rule ? [line(rule.label, `: ${rule.hint[0].toLowerCase()}${rule.hint.slice(1)}`)] : []),
    ...(usual ? [line(`Usually a ${usual.name.toLowerCase()}`, ` (${usual.length}).`)] : []),
  ];
  const house = houseRules
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => line("", l));
  return [
    { id: "signup", title: "Sign-up", lines: signup },
    ...(draft.length ? [{ id: "draft" as const, title: "The draft", lines: draft }] : []),
    { id: "format", title: "Format", lines: format },
    { id: "points", title: "Points", lines: points },
    { id: "penalties", title: "Penalties", lines: penalties },
    ...(house.length ? [{ id: "house" as const, title: "House rules", lines: house }] : []),
  ];
}

const ordinal = (n: number) =>
  n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th";

/** House rules, at most this long (a screen of them on a phone). */
export const HOUSE_RULES_MAX = 2000;
