// An admin closes a tournament's sign-up now (ADR 0074), from its page while sign-up's open, without waiting for its
// closing day: members can't say they're in any more, and a captains' draft moves on to Draft open, where the order's
// drawn. It's one guarded statement, so two taps at once close it once (ADR 0121); it's on the record; and Back to
// Sign-up open (lib/step-back.ts) opens it again. Driven through the real Worker handlers in the fake world, each
// person signed in as themselves (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seeds } from "@cougars/shared/testing/d1-sqlite";
import { testWorld } from "../testing";
import { statusOf } from "../../src/lib/tournament-front";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Cara Captain", position: "F", rating: 70, email: "cara@example.com" },
  { name: "Cole Captain", position: "D", rating: 68, email: "cole@example.com" },
  { name: "Reg Player", position: "F", rating: 55, email: "reg@example.com" },
  { name: "Mo Player", position: "D", rating: 55, email: "mo@example.com" },
];
/** A Tuesday three weeks before the day, sign-up open, no closing day. */
const NOW = new Date("2026-11-24T19:30:00Z");
const at = { now: NOW };

let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

/** A captains' draft (or one teams enter) with sign-up open and Reg in. */
async function kumite(o: { kind?: "draft" | "teams"; status?: string; signupOpensOn?: string } = {}) {
  const dana = await w.signedIn("dana@example.com");
  const boot = (await dana.call("GET", "/api/bootstrap")).body as Json;
  const idOf = (name: string) => boot.members.find((m: Json) => m.name === name).id as number;
  const made = await dana.call("POST", "/api/tournaments", {
    name: "Kumite Winter 2026",
    heldOn: "2026-12-12",
    startTime: "11:00",
    endTime: "16:00",
    status: o.status ?? "open",
    feePence: 0,
    kind: o.kind ?? "draft",
    signupOpensOn: o.signupOpensOn ?? null,
    draftOn: "2026-12-08",
    teams:
      (o.kind ?? "draft") === "draft"
        ? ["Cara Captain", "Cole Captain"].map((n) => ({ name: "", captainMemberId: idOf(n) }))
        : [],
  });
  expect(made.status).toBe(201);
  const id = made.body.id as number;
  const reg = await w.signedIn("reg@example.com");
  const mo = await w.signedIn("mo@example.com");
  if ((o.status ?? "open") === "open")
    expect((await reg.call("POST", `/api/tournaments/${id}/answer`, { answer: "in" }, at)).status).toBe(200);
  const close = (as = dana) => as.call("POST", `/api/tournaments/${id}/signup/close`, {}, at);
  const tournament = async () =>
    ((await dana.call("GET", "/api/bootstrap", undefined, at)).body as Json).tournaments.find((x: Json) => x.id === id);
  return { id, dana, reg, mo, close, tournament };
}

describe("an admin closes sign-up now", () => {
  it("sign-up's over from today: nobody else can say they're in, and the draft is where it's at", async () => {
    const k = await kumite();
    expect((await k.close()).status).toBe(200);
    const t = await k.tournament();
    // Its closing day is yesterday, so today's past it: the same as a closing day that's gone by
    expect(t.signupClosesOn).toBe("2026-11-23");
    expect(statusOf(t, "2026-11-24")).toBe("draft");
    const late = await k.mo.call("POST", `/api/tournaments/${k.id}/answer`, { answer: "in" }, at);
    expect(late.status).toBe(409);
    expect((await k.tournament()).going).toEqual(t.going);
  });

  it("teams that enter: sign-up's closed, and it waits at sign-up for the teams", async () => {
    const k = await kumite({ kind: "teams" });
    expect((await k.close()).status).toBe(200);
    const late = await k.mo.call("POST", `/api/tournaments/${k.id}/answer`, { answer: "in" }, at);
    expect(late.status).toBe(409);
  });

  it("is an admin's: a member is refused, and sign-up stays open", async () => {
    const k = await kumite();
    expect((await k.close(k.reg)).status).toBe(403);
    expect((await k.tournament()).signupClosesOn).toBe(null);
  });

  it("only while it's open: closed already, or not open yet, is refused and changes nothing", async () => {
    const k = await kumite();
    expect((await k.close()).status).toBe(200);
    const again = await k.close();
    expect([again.status, again.body.error]).toEqual([409, "Sign-up isn't open."]);
    expect((await k.tournament()).signupClosesOn).toBe("2026-11-23");
    const planned = await kumite({ status: "planned", signupOpensOn: "2026-11-30" });
    expect((await planned.close()).status).toBe(409);
    expect((await planned.tournament()).signupClosesOn).toBe(null);
  });

  it("Back to Sign-up open opens it again, and a member can say they're in", async () => {
    const k = await kumite();
    expect((await k.close()).status).toBe(200);
    const back = await k.dana.call("POST", `/api/tournaments/${k.id}/step-back`, { from: "signup" }, at);
    expect(back.status).toBe(200);
    const t = await k.tournament();
    expect([t.status, t.signupClosesOn]).toEqual(["open", null]);
    expect(statusOf(t, "2026-11-24")).toBe("signup");
    expect((await k.mo.call("POST", `/api/tournaments/${k.id}/answer`, { answer: "in" }, at)).status).toBe(200);
  });

  it.each(seeds(5))("two taps at once close it once (seed %i)", async (seed) => {
    const k = await kumite();
    w.db.interleave(seed);
    const replies = await Promise.all([k.close(), k.close()]);
    w.db.interleave(null);
    expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
    const n = w.db.raw.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'tournament.signup_closed'").get() as {
      n: number;
    };
    expect(n.n).toBe(1);
  });

  it("it's on the record, with the closing day before and after", async () => {
    const k = await kumite();
    expect((await k.close()).status).toBe(200);
    const entry = w.db.raw
      .prepare("SELECT detail FROM audit_log WHERE action = 'tournament.signup_closed' ORDER BY id DESC LIMIT 1")
      .get() as { detail: string };
    const { from, to } = JSON.parse(entry.detail);
    expect(from).toMatchObject({ signupClosesOn: null });
    expect(to).toMatchObject({ signupClosesOn: "2026-11-23" });
  });
});
