// Why a training night is off (#186, ADR 0122): called off by hand from its own page, or off for a Kumite on its day
// (the clash sheet's Cancel, or a training skipping its night). The two reasons are kept apart, so lifting one never
// loses the other: a night off for a Kumite comes back when that Kumite is deleted or moved off its day, unless
// another Kumite that day or a hand cancellation still keeps it off; It's back on, on the night's own page, puts it
// on whatever kept it off (the admin's Keep both). The user, on dev: several Kumites, nights cancelled, more Kumites,
// and Fridays left Cancelled that wouldn't come back. Each combination is a story below, driven through the real
// Worker handlers as the app sends them: the Kumite saved first, then each night chosen cancelled by its own cancel,
// naming the Kumite it's off for.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { londonISO } from "@cougars/shared/london";
import { testWorld } from "../testing";
import { trainingNights } from "../../src/lib/night-off";
import { offWhy } from "../../src/lib/off-why";
import { currentOf } from "../../src/lib/edition";
import { tournamentPhase } from "../../src/lib/phase";
import type { Tournament } from "../../src/demo/model";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
];
// NOW is Tuesday 6 October 2026; Friday Training (the seed's, series 1) is every Friday, 19:30 to 21:30
const TODAY = "2026-10-06";
const F1 = "2026-10-09";
const F2 = "2026-10-16";
const F3 = "2026-10-23";
const SATURDAY = "2026-10-17";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

type Browser = Awaited<ReturnType<typeof w.signedIn>>;

/** The admin's club, with what she does to it as the app does it. */
async function club() {
  const dana = await w.signedIn("dana@example.com");
  const boot = async () => (await dana.club()).body as Json;
  const nightOn = async (day: string) =>
    ((await boot()).sessions as Json[]).find((s) => s.seriesId === 1 && s.heldOn === day);
  /** The Fridays from F1 to F3 that are off, in date order. */
  const off = async () =>
    ((await boot()).sessions as Json[])
      .filter((s) => s.seriesId === 1 && s.heldOn <= F3 && s.cancelledAt)
      .map((s) => s.heldOn as string);
  /** The clash sheet's answer for each night over a tournament's day: Cancel it, off for that tournament. */
  const cancelOver = async (tournamentId: number, day: string) => {
    const q = new URLSearchParams({
      startsAt: londonISO(day, "18:00"),
      endsAt: londonISO(day, "23:00"),
      except: `tournament:${tournamentId}`,
    });
    const clashes = (await dana.call("GET", `/api/calendar/clashes?${q}`)).body.clashes as Json[];
    for (const c of clashes.filter((x) => x.source === "session")) {
      // A night not made yet is made first (lib/clashes.ts cancelNight), then off by its own cancel
      const night = c.id ?? (await dana.call("POST", `/api/series/${c.seriesId}/sessions`, { heldOn: c.day })).body.id;
      const res = await dana.call("POST", `/api/sessions/${night}/cancelled`, { cancelled: true, tournamentId });
      expect(res.status).toBe(200);
    }
  };
  const body = (name: string, day: string, extra: object = {}) => ({
    typeId: 1,
    name,
    heldOn: day,
    startTime: "18:00",
    endTime: "23:00",
    location: "The Rink",
    feePence: 0,
    kind: "teams",
    teams: [],
    ...extra,
  });
  return {
    dana,
    boot,
    nightOn,
    off,
    /** A Kumite on a day: Cancel (the night off for it) or Keep both. */
    async kumite(name: string, day: string, answer: "cancel" | "keep" = "cancel") {
      const made = await dana.call("POST", "/api/tournaments", body(name, day));
      expect(made.status).toBe(201);
      if (answer === "cancel") await cancelOver(made.body.id, day);
      return made.body.id as number;
    },
    /** Its date moved (its editor's save), asked about its new day: Cancel. */
    async move(id: number, name: string, day: string, extra: object = {}) {
      const res = await dana.call("PUT", `/api/tournaments/${id}`, body(name, day, extra));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      if (!("season" in extra)) await cancelOver(id, day);
    },
    async remove(id: number) {
      expect((await dana.call("DELETE", `/api/tournaments/${id}`)).status).toBe(200);
    },
    /** Manage → Cancel this night, on the night's own page. */
    async byHand(day: string) {
      const night = await nightOn(day);
      expect((await dana.call("POST", `/api/sessions/${night.id}/cancelled`, { cancelled: true })).status).toBe(200);
    },
    /** Manage → It's back on, on the night's own page. */
    async backOn(day: string) {
      const night = await nightOn(day);
      expect((await dana.call("POST", `/api/sessions/${night.id}/cancelled`, { cancelled: false })).status).toBe(200);
    },
  };
}

describe("a night off for a Kumite comes back when nothing keeps it off any more", () => {
  it("the Kumite deleted: its Friday is back on, the night's own page showing it on", async () => {
    const c = await club();
    const k = await c.kumite("Kumite", F1);
    expect(await c.off()).toEqual([F1]);

    await c.remove(k);

    expect(await c.off()).toEqual([]);
    const page = trainingNights((await c.boot()).sessions, 1, TODAY, F1);
    expect(page).toMatchObject({ shown: { heldOn: F1, cancelledAt: null }, off: [] });
  });

  it("the Kumite moved to another Friday: the old one's back on, the new one off; moved to a Saturday, both on", async () => {
    const c = await club();
    const k = await c.kumite("Kumite", F1);

    await c.move(k, "Kumite", F2);
    expect(await c.off()).toEqual([F2]);

    await c.move(k, "Kumite", SATURDAY);
    expect(await c.off()).toEqual([]);
  });

  it("the Kumite's hours moved on its own day: still off", async () => {
    const c = await club();
    const k = await c.kumite("Kumite", F1);
    await c.move(k, "Kumite", F1, { startTime: "12:00", endTime: "17:00" });
    expect(await c.off()).toEqual([F1]);
  });

  it("the Kumite's day made a season only (day to be confirmed): its Friday's back on", async () => {
    const c = await club();
    const k = await c.kumite("Kumite", F1);
    await c.move(k, "Kumite", "2026-11-30", { season: "autumn" });
    expect(await c.off()).toEqual([]);
  });

  it("two Kumites the same Friday: deleting one leaves it off for the other; deleting both brings it back", async () => {
    const c = await club();
    const a = await c.kumite("Kumite A", F1);
    // The night's off already, so the second isn't asked about it: it's off for both
    const b = await c.kumite("Kumite B", F1);

    await c.remove(a);
    expect(await c.off()).toEqual([F1]);
    await c.remove(b);
    expect(await c.off()).toEqual([]);
  });

  it("two Kumites the same Friday, deleted the other way round", async () => {
    const c = await club();
    const a = await c.kumite("Kumite A", F1);
    const b = await c.kumite("Kumite B", F1);

    await c.remove(b);
    expect(await c.off()).toEqual([F1]);
    await c.move(a, "Kumite A", F3);
    expect(await c.off()).toEqual([F3]);
  });

  it("Keep both: the night stays on, and deleting the Kumite changes nothing", async () => {
    const c = await club();
    const k = await c.kumite("Kumite", F1, "keep");
    expect(await c.off()).toEqual([]);
    await c.remove(k);
    expect(await c.off()).toEqual([]);
  });

  it("whoever was in is in again when it comes back, and nobody hears that it's back on", async () => {
    const c = await club();
    const reg = await w.signedIn("reg@example.com");
    await reg.call("PUT", "/api/auth/device", { token: "reg-phone", platform: "ios" });
    const night = await c.nightOn(F1);
    // Sign-up opens two days before: the Wednesday
    const wednesday = { now: new Date(londonISO("2026-10-07", "12:00")) };
    expect((await reg.call("POST", `/api/sessions/${night.id}/answer`, { answer: "in" }, wednesday)).status).toBe(200);
    const k = await c.kumite("Kumite", F1);
    expect(w.pushes.map((p) => p.title)).toEqual(["Fri 9 Oct is off"]);

    await c.remove(k);

    expect(await c.nightOn(F1)).toMatchObject({ cancelledAt: null, going: [expect.any(Number)] });
    expect(w.pushes).toHaveLength(1);
  });
});

describe("a hand cancellation and a Kumite are kept apart", () => {
  it("called off by hand, then a Kumite that day, then the Kumite deleted: still off, by hand", async () => {
    const c = await club();
    await c.byHand(F1);
    const k = await c.kumite("Kumite", F1);

    await c.remove(k);
    expect(await c.off()).toEqual([F1]);

    // It's back on, from its page
    await c.backOn(F1);
    expect(await c.off()).toEqual([]);
  });

  it("off for a Kumite, then called off by hand too: the Kumite deleted, still off; back on from its page", async () => {
    const c = await club();
    const k = await c.kumite("Kumite", F1);
    await c.byHand(F1);

    await c.remove(k);
    expect(await c.off()).toEqual([F1]);
    await c.backOn(F1);
    expect(await c.off()).toEqual([]);
  });

  it("off for a Kumite, put back on from its page (Keep both after all): deleting the Kumite later doesn't take it off", async () => {
    const c = await club();
    const k = await c.kumite("Kumite", F1);
    await c.backOn(F1);
    expect(await c.off()).toEqual([]);

    await c.move(k, "Kumite", F1, { startTime: "12:00" });
    await c.remove(k);
    expect(await c.off()).toEqual([]);
  });

  it("the user's case: Kumites made, nights cancelled by hand, more Kumites; each Friday comes back on its own terms", async () => {
    const c = await club();
    const a = await c.kumite("Kumite A", F2);
    await c.byHand(F1);
    await c.byHand(F3);
    const b = await c.kumite("Kumite B", F3);
    const sat = await c.kumite("Kumite on a Saturday", SATURDAY);
    expect(await c.off()).toEqual([F1, F2, F3]);

    // Each night's own page has it on its own, struck through, with It's back on
    for (const day of [F1, F2, F3])
      expect(trainingNights((await c.boot()).sessions, 1, TODAY, day).off.map((n: Json) => n.heldOn)).toEqual([day]);

    await c.remove(a);
    await c.remove(b);
    await c.remove(sat);
    // F2 was off only for Kumite A; F1 and F3 were called off by hand
    expect(await c.off()).toEqual([F1, F3]);
    await c.backOn(F1);
    await c.backOn(F3);
    expect(await c.off()).toEqual([]);
  });
});

describe("what the app is told about why a night's off", () => {
  it("each night says whether it was called off by hand and which Kumites it's off for", async () => {
    const c = await club();
    const k = await c.kumite("Kumite", F1);
    await c.byHand(F2);
    expect(await c.nightOn(F1)).toMatchObject({ offByHand: false, offFor: [k] });
    expect(await c.nightOn(F2)).toMatchObject({ offByHand: true, offFor: [] });
    expect(await c.nightOn(F3)).toMatchObject({ offByHand: false, offFor: [] });

    // What Manage's It's back on says of each
    const names = async () => {
      const ts = (await c.boot()).tournaments as Json[];
      return (id: number) => ts.find((t) => t.id === id)?.name as string | undefined;
    };
    expect(offWhy(await c.nightOn(F1), await names())).toBe("off for Kumite");
    expect(offWhy(await c.nightOn(F2), await names())).toBe("called off");
    await c.byHand(F1);
    expect(offWhy(await c.nightOn(F1), await names())).toBe("called off, and off for Kumite");
  });

  it("a night can only be off for a tournament that exists, on its day", async () => {
    const c = await club();
    const k = await c.kumite("Kumite", F1, "keep");
    const night = await c.nightOn(F2);
    const cancel = (tournamentId: unknown) =>
      c.dana.call("POST", `/api/sessions/${night.id}/cancelled`, { cancelled: true, tournamentId });
    expect((await cancel(k)).status).toBe(400);
    expect((await cancel(9999)).status).toBe(400);
    expect((await cancel("five")).status).toBe(400);
    expect(await c.off()).toEqual([]);
  });

  it("a member can't take a night off, for a Kumite or not", async () => {
    const c = await club();
    const reg: Browser = await w.signedIn("reg@example.com");
    const night = await c.nightOn(F1);
    expect((await reg.call("POST", `/api/sessions/${night.id}/cancelled`, { cancelled: true })).status).toBe(403);
  });
});

describe("several Kumites, made in any order, are in order (#182: status, then the date)", () => {
  it("made last to first: the series is on the soonest; deleting it moves on; one played early is past", async () => {
    const c = await club();
    const late = await c.kumite("Kumite C", F3);
    const early = await c.kumite("Kumite A", F1);
    const middle = await c.kumite("Kumite B", F2);
    const ours = async () =>
      ((await c.boot()).tournaments as Tournament[]).filter((t) => [late, early, middle].includes(t.id));

    expect(currentOf(await ours())?.id).toBe(early);
    // The calendar's agenda has them by date, the nights off for them beside them
    const agenda = ((await c.boot()).agenda as Json[]).filter((r) => r.kind === "tournament" && r.day <= F3);
    expect(agenda.map((r) => r.title)).toEqual(["Kumite A", "Kumite B", "Kumite C"]);
    expect(await c.off()).toEqual([F1, F2, F3]);

    await c.remove(early);
    expect(currentOf(await ours())?.id).toBe(middle);
    expect(await c.off()).toEqual([F2, F3]);

    // Kumite C, set for the 23rd, finished early: past, and B (the 16th, not played) is still the one on
    await c.move(late, "Kumite C", F3, { status: "finished" });
    const now = await ours();
    expect(tournamentPhase(now.find((x) => x.id === late)!)).toBe("past");
    expect(currentOf(now)?.id).toBe(middle);
  });
});
