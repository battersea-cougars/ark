// The Kumite's Manage menu at each stage, for each of who looks (ADR 0074): only what makes sense where it stands.
import { describe, expect, it } from "vitest";
import type { Tournament } from "../demo/model";
import { manageItemsOf, manageStageOf, type Manager } from "./manage";
import { game, kumite as draftKumite } from "./kumite.testing";

const TODAY = "2026-11-01";
const CARA = 2;
const COLE = 4;
const kumite = { shortName: "Kumite" };

const ADMIN: Manager = { admin: true, runsDraft: true, adds: true, me: 1 };
const RUNNER: Manager = { admin: false, runsDraft: true, adds: false, me: 3 };
const CAPTAIN: Manager = { admin: false, runsDraft: false, adds: false, me: CARA };
const MEMBER: Manager = { admin: false, runsDraft: false, adds: false, me: 20 };

const team = (id: number, captain: number, pick: number, players: number[] = []) => ({
  id,
  name: "",
  logo: null,
  captainMemberId: captain,
  captainName: "",
  contact: "",
  pick,
  players: players.map((memberId, i) => ({ memberId, name: "", pick: i * 2 + id })),
});
const build = (o: Partial<Tournament> = {}) =>
  draftKumite({
    signupClosedAt: null,
    going: [CARA, COLE, 10, 11, 12, 13],
    awards: [{ name: "Champions", about: "" }],
    awardsRevealed: 0,
    awardsConfirmedAt: null,
    ...o,
  } as Partial<Tournament>);

const drawn = {
  signupClosedAt: "2026-10-30T20:00:00Z",
  teams: [team(1, CARA, 1), team(2, COLE, 2)],
} as unknown as Partial<Tournament>;
const picked = { ...drawn, teams: [team(1, CARA, 1, [10]), team(2, COLE, 2, [11])] } as Partial<Tournament>;
const allPlayed = [game(1, "done"), game(2, "done")];

/** A Kumite at each stage it goes through, in order. */
const STAGES = {
  "sign-up": build(),
  "order drawn": build(drawn),
  "draft open": build({ ...picked, draftState: "open" }),
  "teams set": build({ ...picked, draftState: "closed" }),
  "fixtures out": build({ ...picked, draftState: "closed", games: [game(1), game(2)] as never }),
  "live, a result in": build({ ...picked, draftState: "closed", games: [game(1, "done"), game(2)] as never }),
  "all played": build({ ...picked, draftState: "closed", games: allPlayed as never }),
  "awards confirmed": build({
    ...picked,
    draftState: "closed",
    games: allPlayed as never,
    awardsConfirmedAt: "2026-11-14T21:00:00Z",
  }),
  "awards revealed": build({
    ...picked,
    draftState: "closed",
    games: allPlayed as never,
    awardsConfirmedAt: "2026-11-14T21:00:00Z",
    awardsRevealed: 1,
  }),
};
type StageName = keyof typeof STAGES;

const labels = (t: Tournament, who: Manager) => manageItemsOf(t, kumite, who, TODAY).map((x) => x.label);

const DRAFTING = ["Undo the last pick", "Add a player", "Close it now", "Reset the draft"];
const MENUS: Record<StageName, Record<"admin" | "runner" | "captain" | "member", string[]>> = {
  "sign-up": {
    admin: ["Add a player", "Move to…", "Kumite settings"],
    runner: [],
    captain: [],
    member: [],
  },
  "order drawn": {
    admin: ["Add a player", "Back to before the draw", "Move to…", "Kumite settings"],
    runner: ["Back to before the draw"],
    captain: ["Your team"],
    member: [],
  },
  "draft open": {
    admin: [...DRAFTING, "Back to the drawn order", "Move to…", "Pick log", "Kumite settings"],
    runner: ["Undo the last pick", "Close it now", "Reset the draft", "Back to the drawn order", "Pick log"],
    captain: ["Your team", "Pick log"],
    member: [],
  },
  "teams set": {
    admin: ["Back to Draft open", "Move to…", "Pick log", "Kumite settings"],
    runner: ["Back to Draft open", "Pick log"],
    captain: ["Your team", "Pick log"],
    member: [],
  },
  "fixtures out": {
    admin: ["Make the fixtures again", "Back to Teams set", "Move to…", "Pick log", "Kumite settings"],
    runner: ["Pick log"],
    captain: ["Your team", "Pick log"],
    member: [],
  },
  "live, a result in": {
    admin: ["Back to Fixtures set, unplayed", "Move to…", "Kumite settings"],
    runner: [],
    captain: [],
    member: [],
  },
  "all played": {
    admin: ["Confirm the awards", "Back to Fixtures set, unplayed", "Move to…", "Kumite settings"],
    runner: [],
    captain: [],
    member: [],
  },
  "awards confirmed": {
    admin: ["Change the awards", "Back to Fixtures set, unplayed", "Move to…", "Kumite settings"],
    runner: [],
    captain: [],
    member: [],
  },
  "awards revealed": {
    admin: ["Back to before the awards", "Move to…", "Kumite settings"],
    runner: [],
    captain: [],
    member: [],
  },
};
const WHO = { admin: ADMIN, runner: RUNNER, captain: CAPTAIN, member: MEMBER };

describe("Manage: what the Kumite's menu offers at each stage, to each of who looks", () => {
  for (const [stage, menus] of Object.entries(MENUS) as [StageName, (typeof MENUS)[StageName]][])
    for (const [role, expected] of Object.entries(menus) as [keyof typeof WHO, string[]][])
      it(`${stage}: the ${role} sees ${expected.length ? expected.join(", ") : "no gear"}`, () => {
        expect(labels(STAGES[stage], WHO[role])).toEqual(expected);
      });
});

describe("Manage: where it stands", () => {
  it("names each stage, the day split at the first match started", () => {
    expect(Object.values(STAGES).map((t) => manageStageOf(t, TODAY))).toEqual([
      "signup",
      "draft",
      "draft",
      "teams",
      "fixtures",
      "live",
      "afters",
      "afters",
      "afters",
    ]);
  });

  it("on its day, the fixtures out and none started: still the fixtures, made again if need be", () => {
    const t = build({ ...picked, draftState: "closed", heldOn: TODAY, games: [game(1), game(2)] as never });
    expect(manageStageOf(t, TODAY)).toBe("fixtures");
    expect(labels(t, ADMIN)).toContain("Make the fixtures again");
    expect(labels(t, CAPTAIN)).toEqual(["Your team", "Pick log"]);
  });

  it("a match under way, none finished, is live: no awards, no draft's jobs", () => {
    const t = build({ ...picked, draftState: "closed", games: [game(1, "live"), game(2)] as never });
    expect(labels(t, ADMIN)).toEqual(["Back to Fixtures set, unplayed", "Move to…", "Kumite settings"]);
    expect(labels(t, CAPTAIN)).toEqual([]);
  });
});

describe("Manage: the rest", () => {
  it("no awards listed: nothing to confirm", () => {
    const t = build({ ...picked, draftState: "closed", games: allPlayed as never, awards: [] });
    expect(labels(t, ADMIN)).not.toContain("Confirm the awards");
  });

  it("dev's simulator: from sign-up till the last match, never at the after-party", () => {
    const sim = { ...ADMIN, simulator: true };
    expect(labels(STAGES["sign-up"], sim)).toContain("Play out the Kumite");
    expect(labels(STAGES["live, a result in"], sim)).toContain("Play out the Kumite");
    expect(labels(STAGES["all played"], sim)).not.toContain("Play out the Kumite");
    expect(labels(STAGES["live, a result in"], { ...RUNNER, simulator: true })).toEqual([]);
  });

  it("teams that enter: no Move to…, no pick log; a captain's own team till the matches start", () => {
    const entered = { kind: "teams", draftState: undefined, teams: [team(1, CARA, 1), team(2, COLE, 2)] } as never;
    expect(labels(build(entered), ADMIN)).toEqual(["Kumite settings"]);
    expect(labels(build(entered), CAPTAIN)).toEqual(["Your team"]);
  });

  it("each item says what to do with it, a draft's job which", () => {
    const items = manageItemsOf(STAGES["draft open"], kumite, ADMIN, TODAY);
    expect(items.map((x) => x.key)).toEqual([
      "draftJob",
      "draftJob",
      "draftJob",
      "draftJob",
      "back",
      "move",
      "log",
      "settings",
    ]);
    expect(items.filter((x) => x.key === "draftJob").map((x) => x.job)).toEqual(["undo", "add", "leaveOut", "reset"]);
  });
});
