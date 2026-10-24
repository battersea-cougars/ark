// What a live page reads when the hub says something changed (ADR 0072, #112): D1's rows read are the free day's
// limit a busy evening passes, so a burst of changes is one read on each phone, and a read is only the parts the
// changes named, not the whole club. Phones here hold the app's own copy of the club (src/app/catch-up.ts), reading
// through the real Worker, their streams from the real hub.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, testWorld } from "../testing";
import { phoneOn as livePhone } from "./live.testing";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  ...Array.from({ length: 12 }, (_, i) => ({
    name: `Skater ${i + 1}`,
    position: i % 3 ? "F" : "D",
    rating: 50,
    email: `s${i + 1}@example.com`,
  })),
];
const skaters = Array.from({ length: 12 }, (_, i) => `s${i + 1}@example.com`);

let w: ReturnType<typeof testWorld>;
const open: { stop(): Promise<void> }[] = [];
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});
afterEach(async () => {
  await Promise.all(open.splice(0).map((p) => p.stop()));
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Long enough for the hub's second and every phone's wait before its read, and the read itself. */
const settled = () => wait(1500);

/** A member's phone with a live page open that follows `parts` (live.testing.ts). */
async function phoneOn(email: string, parts: readonly string[]) {
  const phone = await livePhone(w, email, parts);
  open.push(phone);
  return phone;
}

/** Next Friday's session, and the admin. */
async function friday() {
  const dana = await w.signedIn("dana@example.com");
  const boot = (await dana.call("GET", "/api/bootstrap")).body as Json;
  const session = boot.sessions.find((s: Json) => s.heldOn >= "2026-10-06");
  const night = async () =>
    ((await dana.call("GET", "/api/bootstrap")).body as Json).sessions.find((s: Json) => s.id === session.id);
  return { dana, session, night };
}

describe("Friday sign-up opens with everyone on Home, following the sign-ups live", () => {
  it("a burst of taps In is one or two reads on each phone, not one a tap, and every phone ends up with the night as it is", async () => {
    const f = await friday();
    const phones = [];
    for (const email of skaters) phones.push(await phoneOn(email, ["sessions", "tournaments"]));
    // Everyone taps In within a moment of each other
    await Promise.all(phones.map((p) => p.change("POST", `/api/sessions/${f.session.id}/answer`, { answer: "in" })));
    await settled();
    const going = (await f.night()).going.map((m: Json) => m.memberId ?? m.id ?? m);
    for (const p of phones) {
      const reads = p.asked.slice(1);
      expect(reads.length, `${p.email}: ${reads.join(" | ")}`).toBeLessThanOrEqual(3);
      // Only the parts the taps changed: never the whole club
      expect(reads.filter((r) => r.startsWith("whole"))).toEqual([]);
      const mine = p.club().sessions.find((s: Json) => s.id === f.session.id);
      expect(mine.going.map((m: Json) => m.memberId ?? m.id ?? m)).toEqual(going);
    }
  });

  it("a tap reads just what it changed on the other phones (the sign-ups, what's owed), not the agenda or the whole club", async () => {
    const f = await friday();
    const reg = await phoneOn("s1@example.com", ["sessions"]);
    const mo = await phoneOn("s2@example.com", ["sessions"]);
    expect((await mo.change("POST", `/api/sessions/${f.session.id}/answer`, { answer: "in" })).status).toBe(200);
    await settled();
    // An answer moves nothing on the calendar, so the agenda isn't read again (api.route.ts `calendar`)
    expect(reg.asked.slice(1)).toEqual(["parts: sessions, charges, dues"]);
    expect(reg.club().sessions.find((s: Json) => s.id === f.session.id).going).toHaveLength(1);
  });

  it("the phone that tapped reads nothing more: its own reply brought what changed", async () => {
    const f = await friday();
    const mo = await phoneOn("s2@example.com", ["sessions"]);
    expect((await mo.change("POST", `/api/sessions/${f.session.id}/answer`, { answer: "in" })).status).toBe(200);
    await settled();
    expect(mo.asked.slice(1)).toEqual([]);
  });

  it("once caught up in parts, the page's check of the whole club on its beat is a 304", async () => {
    const f = await friday();
    const reg = await phoneOn("s1@example.com", ["sessions"]);
    const mo = await w.signedIn("s2@example.com");
    for (const answer of ["in", "out", "in"] as const)
      expect((await mo.call("POST", `/api/sessions/${f.session.id}/answer`, { answer })).status).toBe(200);
    await settled();
    await reg.whole();
    expect(reg.asked.at(-1)).toBe("whole: unchanged");
    expect(reg.club().sessions.find((s: Json) => s.id === f.session.id).going).toHaveLength(1);
  });

  it("a change nobody was told of (a cron's charges) leaves the copy short, and the check on its beat reads the whole club", async () => {
    const f = await friday();
    const reg = await phoneOn("s1@example.com", ["sessions"]);
    w.db.raw.exec("UPDATE data_version SET version = version + 1");
    const mo = await w.signedIn("s2@example.com");
    expect((await mo.call("POST", `/api/sessions/${f.session.id}/answer`, { answer: "in" })).status).toBe(200);
    await settled();
    // The tap's parts came in at once...
    expect(reg.asked.slice(1)).toEqual([expect.stringMatching(/^parts: sessions/)]);
    // ...but the change before it is unaccounted for, so the next check reads it all
    await reg.whole();
    expect(reg.asked.at(-1)).toBe("whole");
    await reg.whole();
    expect(reg.asked.at(-1)).toBe("whole: unchanged");
  });

  it("a page out of view reads nothing while it's away", async () => {
    const f = await friday();
    const reg = await phoneOn("s1@example.com", ["sessions"]);
    reg.hide();
    const mo = await w.signedIn("s2@example.com");
    expect((await mo.call("POST", `/api/sessions/${f.session.id}/answer`, { answer: "in" })).status).toBe(200);
    await settled();
    expect(reg.asked.slice(1)).toEqual([]);
  });

  it("a change to who can do what (roles) reads the whole club, actions and all", async () => {
    await friday();
    const reg = await phoneOn("s1@example.com", ["members"]);
    const dana = await w.signedIn("dana@example.com");
    const boot = (await dana.call("GET", "/api/bootstrap")).body as Json;
    const role = boot.roles.find((r: Json) => !r.isSystem && !r.is_system) ?? boot.roles.at(-1);
    expect((await dana.call("PUT", `/api/roles/${role.id}`, { ...role })).status).toBe(200);
    await settled();
    expect(reg.asked.slice(1)).toEqual(["whole"]);
  });
});

describe("the hub, in a burst", () => {
  it("sends at most one event a second, naming every part and every version in it", async () => {
    const f = await friday();
    const reg = await w.listening("s1@example.com");
    const taps = [];
    for (const email of skaters.slice(1, 7)) {
      const b = await w.signedIn(email);
      taps.push(b.call("POST", `/api/sessions/${f.session.id}/answer`, { answer: "in" }));
    }
    await Promise.all(taps);
    const first = await reg.next();
    const second = await reg.next();
    const versions = [...first.data.versions, ...second.data.versions];
    expect(versions).toHaveLength(6);
    expect(new Set(versions).size).toBe(6);
    expect(second.data.changed).toContain("sessions");
    expect(first.data.versions.length + second.data.versions.length).toBe(6);
    await reg.close();
  });

  it("the first change after a quiet spell goes out at once", async () => {
    const f = await friday();
    const reg = await w.listening("s1@example.com");
    const mo = await w.signedIn("s2@example.com");
    // Held back, it would wait on a timer: with the clock stopped, it goes out all the same (not timed by the wall
    // clock, which a busy machine slows)
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      expect((await mo.call("POST", `/api/sessions/${f.session.id}/answer`, { answer: "in" })).status).toBe(200);
      expect(vi.getTimerCount()).toBe(0);
      const e = await reg.next();
      expect(e.data.changed).toContain("sessions");
    } finally {
      vi.useRealTimers();
    }
    await reg.close();
  });
});

describe("reading parts", () => {
  it("only the parts asked for, as this member may see them, with the version they were read at", async () => {
    const reg = await w.signedIn("s1@example.com");
    const r = await reg.call("GET", "/api/slices?names=sessions,agenda");
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.slices).sort()).toEqual(["agenda", "sessions"]);
    expect(r.body.version).toEqual(expect.any(Number));
    expect(r.body.slices.members).toBeUndefined();
  });

  it("a part that isn't one is refused", async () => {
    const reg = await w.signedIn("s1@example.com");
    expect((await reg.call("GET", "/api/slices?names=sessions,passwords")).status).toBe(400);
    expect((await reg.call("GET", "/api/slices")).status).toBe(400);
  });

  it("nobody signed in reads nothing", async () => {
    expect((await w.browser().call("GET", "/api/slices?names=sessions", undefined, { now: NOW })).status).toBe(401);
  });
});
