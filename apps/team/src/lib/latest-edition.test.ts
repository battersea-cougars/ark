// Which edition a series' pages open on, and the app's Home teases (lib/edition.ts latestOf): by
// what's happened, not the dates.
import { describe, expect, it } from "vitest";
import type { Tournament } from "../demo/model";
import { currentOf, latestOf, previousOf } from "./edition";

const TODAY = "2026-10-08";
const played = (position: number) => ({
  id: position,
  stage: "group",
  position,
  homeTeamId: 1,
  awayTeamId: 2,
  homeGoals: 2,
  awayGoals: 1,
  status: "done",
});
const edition = (id: number, heldOn: string, o: Partial<Tournament> = {}) =>
  ({
    id,
    typeId: 1,
    name: `Kumite ${id}`,
    heldOn,
    startTime: "11:00",
    endTime: "16:00",
    status: "planned",
    season: null,
    pointsWin: 3,
    pointsDraw: 1,
    pointsLoss: 0,
    teams: [
      { id: 1, players: [] },
      { id: 2, players: [] },
    ],
    games: [],
    going: [],
    waitlist: [],
    ...o,
  }) as unknown as Tournament;

describe("the edition a series opens on", () => {
  it("the next one, once it's announced, even as just a season, over one already played", () => {
    // Played, though its day's still ahead and nobody marked it finished
    const done = edition(1, "2027-06-12", { games: [played(1)] as never });
    const next = edition(2, "2027-11-30", { season: "autumn" });
    const all = [done, next];
    expect(latestOf(all, TODAY)?.id).toBe(2);
    expect(previousOf(all, next)?.id).toBe(1);
  });

  it("the one under way, over everything", () => {
    const all = [
      edition(1, "2026-10-08", { games: [{ ...played(1), status: "live" }] as never }),
      edition(2, "2027-09-01"),
    ];
    expect(latestOf(all, TODAY)?.id).toBe(1);
  });

  it("nothing announced: the last one played", () => {
    const all = [
      edition(1, "2026-06-01", { games: [played(1)] as never }),
      edition(2, "2026-09-01", { games: [played(1)] as never }),
    ];
    expect(latestOf(all, TODAY)?.id).toBe(2);
  });

  it("a fixed day that came and went unplayed isn't next", () => {
    const all = [edition(1, "2026-06-01", { games: [played(1)] as never }), edition(2, "2026-09-01")];
    expect(latestOf(all, TODAY)?.id).toBe(1);
  });
});

describe("the one on or coming up (a series' running pages: fight card, board, teams, draft)", () => {
  it("the next one, or the one under way", () => {
    const all = [edition(1, "2026-06-01", { games: [played(1)] as never }), edition(2, "2027-01-15")];
    expect(currentOf(all, TODAY)?.id).toBe(2);
  });

  it("none once the last one's been played: it's history, and so is every one before it", () => {
    const all = [
      edition(1, "2026-06-01", { games: [played(1)] as never }),
      edition(2, "2026-09-01", { games: [played(1)] as never }),
    ];
    expect(currentOf(all, TODAY)).toBeUndefined();
  });

  it("none when there's never been one", () => {
    expect(currentOf([], TODAY)).toBeUndefined();
  });
});
