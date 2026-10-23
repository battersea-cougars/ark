// A series' house rules (ADR 0074), driven through the real Worker handlers in the fake world (testing.ts).
//
// The story: an admin writes the Kumite's house rules in its settings, a rule a line. Every member sees them under
// Format & rules on the Kumite's page. A wall of text is refused.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatAndRules, lineText } from "../../src/lib/format-rules";
import { testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
];
/** The Kumite series, as the club's seed has it. */
const KUMITE = 1;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

async function as(email: string) {
  const b = await w.signedIn(email);
  const sees = async () => (await b.call("GET", "/api/bootstrap")).body as Json;
  const kumite = async () => (await sees()).tournamentTypes.find((x: Json) => x.id === KUMITE);
  return { call: b.call, kumite };
}

describe("house rules", () => {
  it("an admin writes the Kumite's house rules; a member reads them under Format & rules, a rule a line", async () => {
    const dana = await as("dana@example.com");
    const series = await dana.kumite();
    const res = await dana.call("PUT", `/api/tournament-types/${KUMITE}`, {
      ...series,
      houseRules: "No slapshots.\n\nHelmets on, always.\n",
    });
    expect(res.status).toBe(200);

    const reg = await as("reg@example.com");
    const kumite = await reg.kumite();
    expect(kumite.houseRules).toBe("No slapshots.\n\nHelmets on, always.");
    const sections = formatAndRules(
      {
        kind: "draft",
        playoffs: [],
        gameMinutes: 12,
        periods: 1,
        breakMinutes: 0,
        startTime: "19:30",
        season: null,
        pointsWin: 3,
        pointsDraw: 1,
        pointsLoss: 0,
      },
      kumite.houseRules,
    );
    expect(sections.at(-1)?.title).toBe("House rules");
    expect(sections.at(-1)?.lines.map(lineText)).toEqual(["No slapshots.", "Helmets on, always."]);
  });

  it("a series with none has none to show, and a wall of text is refused", async () => {
    const dana = await as("dana@example.com");
    const series = await dana.kumite();
    expect(series.houseRules).toBe("");
    const res = await dana.call("PUT", `/api/tournament-types/${KUMITE}`, { ...series, houseRules: "x".repeat(2001) });
    expect(res.status).toBe(400);
    expect((await dana.kumite()).houseRules).toBe("");
  });
});
