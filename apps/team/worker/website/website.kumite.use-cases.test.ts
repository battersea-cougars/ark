// The Kumite's awards on the website (ADR 0044, 0030): each Kumite keeps its own, so the website shows a Kumite's own
// awards, not the series'. The series' are the defaults a new Kumite copies. Driven through the real Worker handlers
// (ADR 0031), then read the way the website's build reads it: the snapshot (scripts/lib/kumite-sql.mjs).
//
// The user (2026-10-23): "Awards per Kumite, and the website follows."
import { beforeEach, describe, expect, it, vi } from "vitest";
import { kumiteFrom, kumiteSql } from "../../../../scripts/lib/kumite-sql.mjs";
import { testWorld } from "../testing";

const ROSTER = [{ name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] }];
/** The Kumite, as the club seed has it. */
const KUMITE = 1;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
  // The world's first Kumite (Summer 2027, testing/kumite.ts) left out: each story schedules its own
  w.db.raw.prepare("DELETE FROM tournaments WHERE id = 1").run();
});

/** The awards' names the website shows after a build on `today`. */
const onTheWebsite = (today: string) =>
  kumiteFrom(w.db.raw.prepare(kumiteSql(today)).all())!.awards.map((a: { name: string }) => a.name);

async function admin() {
  const dana = await w.signedIn("dana@example.com");
  const series = async () =>
    ((await dana.call("GET", "/api/bootstrap")).body as Json).tournamentTypes.find((t: Json) => t.id === KUMITE);
  return {
    series,
    /** A Kumite on `heldOn`, its awards the series' (copied in, as the editor does) or its own. */
    async schedule(
      heldOn: string,
      { awards, isPublic = true }: { awards?: { name: string }[]; isPublic?: boolean } = {},
    ) {
      const res = await dana.call("POST", "/api/tournaments", {
        typeId: KUMITE,
        name: `Kumite ${heldOn}`,
        heldOn,
        public: isPublic,
        awards: awards ?? (await series()).awards,
      });
      expect(res.status).toBe(201);
      return res.body.id as number;
    },
  };
}
const SERIES = ["The Judges' Call", "Top scorer", "Best keeper", "Champions"];

describe("the website shows a Kumite's own awards", () => {
  it("before there's been any Kumite, the series' awards", async () => {
    expect(onTheWebsite("2026-10-23")).toEqual(SERIES);
  });

  it("the next Kumite's own awards, changed in its editor: not the series'", async () => {
    const dana = await admin();
    await dana.schedule("2026-12-12", { awards: [{ name: "Champions" }, { name: "Best Mullet" }] });
    expect(onTheWebsite("2026-10-23")).toEqual(["Champions", "Best Mullet"]);
    // The series keeps its own: the next one scheduled copies those
    expect((await dana.series()).awards.map((a: Json) => a.name)).toEqual(SERIES);
  });

  it("once it's been held and no other's coming up, the last one held's, not the series'", async () => {
    const dana = await admin();
    await dana.schedule("2026-06-06", { awards: [{ name: "Summer Champs" }] });
    await dana.schedule("2026-09-12", { awards: [{ name: "Autumn Champs" }] });
    expect(onTheWebsite("2026-10-23")).toEqual(["Autumn Champs"]);
  });

  it("a members-only Kumite coming up isn't on the website: the last public one's awards show", async () => {
    const dana = await admin();
    await dana.schedule("2026-09-12", { awards: [{ name: "Autumn Champs" }] });
    await dana.schedule("2026-12-12", { awards: [{ name: "Secret Champs" }], isPublic: false });
    expect(onTheWebsite("2026-10-23")).toEqual(["Autumn Champs"]);
  });
});
