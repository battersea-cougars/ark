// Keepers play training free (ADR 0007): the club needs them in net every Friday, so a keeper is on the Keeper plan,
// never charged for a training night or a quarter, and has no plan to choose. Tournaments they enter are charged as
// for anyone. Driven through the real Worker handlers in the fake world (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chargeDue } from "./dues";
import { onTheNight, testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Kim Keeper", position: "G", rating: 57, email: "kim@example.com" },
];
const LAST_FRIDAY = "2026-10-02";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

type Browser = Awaited<ReturnType<typeof w.signedIn>>;
const on = (day: string) => new Date(`${day}T11:00:00Z`);
const boot = async (b: Browser, now?: Date) =>
  (await b.call("GET", "/api/bootstrap", undefined, now ? { now } : {})).body as Json;
const ids = async (b: Browser) =>
  Object.fromEntries((await boot(b)).members.map((m: Json) => [m.name.split(" ")[0], m.id])) as Record<string, number>;
const chargesOf = async (b: Browser, id: number, now?: Date) =>
  ((await boot(b, now)).charges as Json[]).filter((c) => c.memberId === id);

describe("keepers play training free", () => {
  it("a keeper at Friday's session isn't charged; a skater beside them is", async () => {
    const dana = await w.signedIn("dana@example.com");
    const series = (await boot(dana)).series[0];
    expect(
      (await dana.call("PUT", `/api/series/${series.id}`, { ...series, fees: [{ pence: 800, from: "2026-01-01" }] }))
        .status,
    ).toBe(200);
    const id = await ids(dana);
    const session = (await boot(dana)).sessions.find((s: Json) => s.heldOn === LAST_FRIDAY).id;
    for (const m of [id.Reg, id.Kim])
      await dana.call(
        "POST",
        `/api/sessions/${session}/register`,
        { memberId: m, here: true },
        { now: onTheNight(LAST_FRIDAY) },
      );

    expect((await chargesOf(dana, id.Reg)).map((c) => c.kind)).toEqual(["session"]);
    expect(await chargesOf(dana, id.Kim)).toEqual([]);
  });

  it("a keeper with a quarterly membership isn't charged the quarter", async () => {
    const dana = await w.signedIn("dana@example.com");
    await dana.call("POST", "/api/subscription-fees", { pence: 9000, from: "2026-01-01" });
    const id = await ids(dana);
    // Made a keeper after they'd gone Quarterly: the membership stays, the keeper plan wins
    await dana.call("POST", `/api/members/${id.Reg}/quarterly`, { quarterly: true });
    await chargeDue(w.env, on("2026-10-06"));
    expect((await chargesOf(dana, id.Reg)).map((c) => c.kind)).toEqual(["quarter"]);
    const reg = (await boot(dana)).members.find((m: Json) => m.id === id.Reg);
    expect((await dana.call("PUT", `/api/members/${id.Reg}`, { ...reg, position: "G" })).status).toBe(200);
    await chargeDue(w.env, on("2026-10-06"));
    expect(await chargesOf(dana, id.Reg)).toEqual([]);
  });

  it("a keeper has no plan to choose, and an admin can't make them Quarterly", async () => {
    const dana = await w.signedIn("dana@example.com");
    const kim = await w.signedIn("kim@example.com");
    const id = await ids(dana);
    expect((await kim.call("PUT", "/api/me/plan", { quarter: "2027-Q1", quarterly: true })).status).toBe(409);
    expect((await dana.call("POST", `/api/members/${id.Kim}/quarterly`, { quarterly: true })).status).toBe(409);
  });

  it("a tournament a keeper enters is charged as for anyone", async () => {
    const dana = await w.signedIn("dana@example.com");
    const id = await ids(dana);
    const t = (await boot(dana)).tournaments[0];
    expect((await dana.call("PUT", `/api/tournaments/${t.id}`, { ...t, feePence: 1500 })).status).toBe(200);
    await dana.call("POST", `/api/tournaments/${t.id}/players`, { memberId: id.Kim, in: true });
    await chargeDue(w.env, on(t.heldOn));
    expect((await chargesOf(dana, id.Kim)).map((c) => c.kind)).toEqual(["tournament"]);
  });
});
