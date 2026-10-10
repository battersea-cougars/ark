// Announcements (#85): an admin tells everyone something ("No training on the 24th, the hall's booked") where they'll
// see it, the top of Home. It shows until its last day or until each member dismisses it; one or two at a time,
// newest first, not a feed. Posting and taking one down are on the record. Driven through the real Worker handlers in
// the fake world (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Mo Player", position: "D", rating: 58, email: "mo@example.com" },
];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

type Browser = Awaited<ReturnType<typeof w.signedIn>>;
const on = (day: string) => new Date(`${day}T11:00:00Z`);
const seen = async (b: Browser, now?: Date) =>
  ((await b.call("GET", "/api/bootstrap", undefined, now ? { now } : {})).body.announcements as Json[]).map(
    (a) => a.title,
  );
const HALL = { title: "No training on the 24th", body: "The hall's booked.", link: "", endsOn: "2026-10-24" };

describe("announcements", () => {
  it("an admin posts one and every member sees it at the top of Home", async () => {
    const dana = await w.signedIn("dana@example.com");
    const r = await dana.call("POST", "/api/announcements", HALL);
    expect(r.status).toBe(201);
    const reg = await w.signedIn("reg@example.com");
    expect((await reg.call("GET", "/api/bootstrap")).body.announcements).toEqual([
      expect.objectContaining({ id: r.body.id, title: HALL.title, body: HALL.body, link: null, endsOn: "2026-10-24" }),
    ]);
  });

  it("a member dismisses it: gone for them, still there for everyone else", async () => {
    const dana = await w.signedIn("dana@example.com");
    const { id } = (await dana.call("POST", "/api/announcements", HALL)).body;
    const reg = await w.signedIn("reg@example.com");
    expect((await reg.call("POST", `/api/announcements/${id}/dismiss`)).status).toBe(200);
    expect(await seen(reg)).toEqual([]);
    expect(await seen(await w.signedIn("mo@example.com"))).toEqual([HALL.title]);
  });

  it("it ends on its last day", async () => {
    const dana = await w.signedIn("dana@example.com");
    await dana.call("POST", "/api/announcements", HALL);
    const reg = await w.signedIn("reg@example.com");
    expect(await seen(reg, on("2026-10-24"))).toEqual([HALL.title]);
    expect(await seen(reg, on("2026-10-25"))).toEqual([]);
  });

  it("two at a time, newest first: a third pushes the oldest off", async () => {
    const dana = await w.signedIn("dana@example.com");
    for (const title of ["First", "Second", "Third"])
      await dana.call("POST", "/api/announcements", { ...HALL, title }, { now: new Date() });
    expect(await seen(dana)).toEqual(["Third", "Second"]);
  });

  it("an admin takes one down early, and both changes are on the record", async () => {
    const dana = await w.signedIn("dana@example.com");
    const { id } = (await dana.call("POST", "/api/announcements", HALL)).body;
    expect((await dana.call("DELETE", `/api/announcements/${id}`)).status).toBe(200);
    expect(await seen(dana)).toEqual([]);
    const audit = (await dana.call("GET", "/api/audit")).body.entries.map((e: Json) => e.action);
    expect(audit).toEqual(expect.arrayContaining(["announcement.posted", "announcement.removed"]));
  });

  it("only someone allowed to post can post or take one down; it needs a title and a day in the future", async () => {
    const reg = await w.signedIn("reg@example.com");
    expect((await reg.call("POST", "/api/announcements", HALL)).status).toBe(403);
    const dana = await w.signedIn("dana@example.com");
    expect((await dana.call("POST", "/api/announcements", { ...HALL, title: " " })).status).toBe(400);
    expect((await dana.call("POST", "/api/announcements", { ...HALL, endsOn: "2026-10-01" })).status).toBe(400);
    expect((await dana.call("POST", "/api/announcements", { ...HALL, link: "javascript:alert(1)" })).status).toBe(400);
  });
});
