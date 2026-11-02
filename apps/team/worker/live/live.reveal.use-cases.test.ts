// The after-party's reveals reach every phone in the room with nothing read (ADR 0053; the tournament notes): the drum
// travels with the hub's event, and a winner still sealed never does. Through the real Worker and the real hub, phones
// holding the app's own copy of the club (src/app/catch-up.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testWorld } from "../testing";
import { EVENING, ROSTER, kumiteNight } from "../tournaments/awards.testing";
import { phoneOn as livePhone, type LivePhone } from "./live.testing";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

let w: ReturnType<typeof testWorld>;
const open: LivePhone[] = [];
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});
afterEach(async () => {
  await Promise.all(open.splice(0).map((p) => p.stop()));
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Long enough for the hub's second and every phone's wait before a read, and the read itself. */
const settled = () => wait(1500);

/** A phone in the room, on the after-party page, on the evening's clock. */
async function inTheRoom(email: string) {
  const phone = await livePhone(w, email, ["tournaments"], EVENING);
  open.push(phone);
  return phone;
}

/** What a phone shows of the drum: how many are out, whether it's rolled on, and the winners it holds. */
const drum = (p: LivePhone, id: number) => {
  const t = p.club().tournaments.find((x: Json) => x.id === id);
  return { revealed: t.awardsRevealed, next: t.awardsNext, winners: t.winners.map((x: Json) => x.award) };
};

describe("the reveal at The Anchor, every phone in the room following", () => {
  it("each card turned over and each roll of the drum reach every phone with nothing read", async () => {
    const k = await kumiteNight(w);
    expect((await k.confirm()).status).toBe(200);
    const room = [await inTheRoom("mo@example.com"), await inTheRoom("sam@example.com")];
    const admin = await inTheRoom("dana@example.com");
    for (const p of [...room, admin]) expect(p.asked).toEqual(["whole"]);

    expect((await k.reveal(0)).status).toBe(200);
    await settled();
    for (const p of room) expect(drum(p, k.id)).toEqual({ revealed: 1, next: false, winners: ["The Judges' Call"] });
    expect((await k.roll(1)).status).toBe(200);
    await settled();
    for (const p of room) expect(drum(p, k.id)).toEqual({ revealed: 1, next: true, winners: ["The Judges' Call"] });
    expect((await k.reveal(1)).status).toBe(200);
    await settled();
    for (const p of room)
      expect(drum(p, k.id)).toEqual({ revealed: 2, next: false, winners: ["The Judges' Call", "Top scorer"] });
    // Nothing read on any phone: each event brought it
    for (const p of [...room, admin]) expect(p.asked.slice(1), p.email).toEqual([]);
    // Whoever runs it still holds every winner, sealed ones too
    expect(drum(admin, k.id).winners).toHaveLength(4);
    // ...and each phone is as the Worker has it: the next whole check is a 304
    for (const p of room) {
      await p.whole();
      expect(p.asked.at(-1)).toBe("whole: unchanged");
    }
  });

  it("a winner still sealed is never in the event, for anyone", async () => {
    const k = await kumiteNight(w);
    expect((await k.confirm()).status).toBe(200);
    const mo = await inTheRoom("mo@example.com");
    expect((await k.reveal(0)).status).toBe(200);
    await settled();
    const sent = mo.events.flatMap((e: Json) => e.parts ?? []).map((p: Json) => p.awards);
    expect(sent).toHaveLength(1);
    expect(sent[0].winners.map((x: Json) => x.award)).toEqual(["The Judges' Call"]);
  });

  it("a phone that missed a change reads the drum, as before", async () => {
    const k = await kumiteNight(w);
    expect((await k.confirm()).status).toBe(200);
    const mo = await inTheRoom("mo@example.com");
    // A change nobody was told of: the copy no longer holds the version just before the reveal's
    w.db.raw.exec("UPDATE data_version SET version = version + 1");
    expect((await k.reveal(0)).status).toBe(200);
    await settled();
    expect(mo.asked.slice(1)).toEqual([expect.stringMatching(/^parts: tournaments/)]);
    expect(drum(mo, k.id)).toEqual({ revealed: 1, next: false, winners: ["The Judges' Call"] });
  });
});
