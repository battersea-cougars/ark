// What one member, or a stolen session, can spend of the club's free allowance (#73, ADR 0055): live streams held at
// once, audit rows written by refusals, and how much a request may send. Driven through the real handlers in the fake
// world (testing.ts, ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureLogs } from "@cougars/shared/testing/scribe";
import { STREAMS_PER_MEMBER } from "../live/live";
import { minutes, testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Pat Plain", position: "D", rating: 40, email: "pat@example.com" },
];
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

const refusals = () =>
  (w.db.raw.prepare("SELECT detail FROM audit_log WHERE action = 'refused' ORDER BY id").all() as { detail: string }[])
    .length;

describe("live streams, a few per member", () => {
  it("another one opening closes that member's oldest, and nobody else's", async () => {
    const pat = await w.listening("pat@example.com");
    const reg = [];
    for (let i = 0; i <= STREAMS_PER_MEMBER; i++) reg.push(await w.listening("reg@example.com"));
    expect(w.live.listeners).toBe(STREAMS_PER_MEMBER + 1);
    await expect(reg[0].next()).rejects.toThrow("the stream ended");

    // A change reaches Reg's newest streams and Pat's
    const dana = await w.signedIn("dana@example.com");
    const session = (await dana.club()).body.sessions.find((s: { heldOn: string }) => s.heldOn >= "2026-10-06");
    await (await w.signedIn("pat@example.com")).call("POST", `/api/sessions/${session.id}/answer`, { answer: "in" });
    for (const phone of [pat, ...reg.slice(1)]) expect((await phone.next()).event).toBe("changed");
  });
});

describe("a member poking at an admin route", () => {
  it("is refused every time, on the record once a minute and in the log every time", async () => {
    const logs = captureLogs();
    const reg = await w.signedIn("reg@example.com");
    for (let i = 0; i < 20; i++) expect((await reg.call("GET", "/api/audit")).status).toBe(403);
    expect((await reg.call("GET", "/api/usage")).status).toBe(403);
    expect(refusals()).toBe(1);
    expect(logs.entries.filter((e) => e.msg === "refused")).toHaveLength(21);
    // A minute on, the next one is written again
    expect((await reg.call("GET", "/api/audit", undefined, { now: minutes(2) })).status).toBe(403);
    expect(refusals()).toBe(2);
    // Someone else's refusal is theirs to have on the record
    expect((await (await w.signedIn("pat@example.com")).call("GET", "/api/audit")).status).toBe(403);
    expect(refusals()).toBe(3);
  });
});

describe("how much a request may send", () => {
  const profile = (bio: string) => ({ position: "D", phone: "", bio });

  it("refuses a body over a megabyte before reading it, whatever it says its size is", async () => {
    const reg = await w.signedIn("reg@example.com");
    const big = await reg.call("PUT", "/api/me", profile("x".repeat(1_100_000)));
    expect(big.status).toBe(413);
    expect(big.body.error).toMatch(/too much/);
    // A body that says it's huge isn't read at all
    const says = await reg.call("PUT", "/api/me", profile(""), { headers: { "content-length": "50000000" } });
    expect(says.status).toBe(413);
    expect((await reg.call("PUT", "/api/me", profile("Left wing"))).status).toBe(200);
  });

  it("takes more for an import, and refuses it only when it's past that", async () => {
    const dana = await w.signedIn("dana@example.com");
    const file = `name,email,position\n${"Al,al@example.com,F\n".repeat(60_000)}`;
    // Past a megabyte, under two: read, and refused for what it says (too long a file), not for its size
    const read = await dana.call("POST", "/api/members/import", { file, apply: false });
    expect(read.status).toBe(400);
    expect(read.body.error).toMatch(/too big/);
    const huge = await dana.call("POST", "/api/members/import", { file: file + file, apply: false });
    expect(huge.status).toBe(413);
  });

  it("refuses a sign-in or a join form much bigger than one", async () => {
    const stranger = w.browser();
    expect(
      (await stranger.call("POST", "/api/auth/start", { email: "reg@example.com", pad: "x".repeat(20_000) })).status,
    ).toBe(413);
    expect(
      (await stranger.call("POST", "/api/auth/request", { name: "x".repeat(20_000), email: "a@b.co", position: "F" }))
        .status,
    ).toBe(413);
    expect((await stranger.call("POST", "/api/auth/start", { email: "reg@example.com" })).status).toBe(200);
  });
});
