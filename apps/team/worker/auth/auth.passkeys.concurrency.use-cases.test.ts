// A passkey's sign-in sent twice at once (a double tap, a retry on a bad signal): its challenge is spent in the
// statement that claims it, so one challenge makes one session, however the two requests' statements interleave on D1
// (ADR 0121). The same for a counter that two sign-ins move on together. Driven through the real handlers in the fake
// world, its D1 interleaving under several seeds, with a fake authenticator signing real responses.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seeds } from "@cougars/shared/testing/d1-sqlite";
import { testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
];
const ORIGIN = "https://team.test";
const SEEDS = seeds(10);

let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

const passkeySessions = () =>
  (w.db.raw.prepare("SELECT count(*) n FROM auth_sessions WHERE method = 'passkey'").get() as { n: number }).n;

async function withPasskey(synced = true) {
  const reg = await w.signedIn("reg@example.com");
  const device = w.authenticator({ synced });
  const { options } = (await reg.call("POST", "/api/auth/passkeys/register-options")).body;
  expect(
    (await reg.call("POST", "/api/auth/passkeys/register", { response: device.create(options, ORIGIN) })).status,
  ).toBe(200);
  return device;
}

describe("two sign-ins with one passkey challenge, at once", () => {
  it.each(SEEDS)("make one session (seed %i)", async (seed) => {
    const device = await withPasskey();
    const b = w.browser();
    const { options } = (await b.call("POST", "/api/auth/passkeys/sign-in-options")).body;
    const response = device.get(options, ORIGIN);
    w.db.interleave(seed);
    const replies = await Promise.all([
      b.call("POST", "/api/auth/passkeys/sign-in", { response }),
      b.call("POST", "/api/auth/passkeys/sign-in", { response }),
    ]);
    w.db.interleave(null);
    expect(replies.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(passkeySessions()).toBe(1);
  });

  it.each(SEEDS)("a security key's two sign-ins with the same count: one gets in (seed %i)", async (seed) => {
    const device = await withPasskey(false);
    const [a, b] = [w.browser(), w.browser()];
    const [oa, ob] = await Promise.all(
      [a, b].map(async (x) => (await x.call("POST", "/api/auth/passkeys/sign-in-options")).body.options),
    );
    // Both signed with count 1 (a copy of the key, used at the same moment as the real one)
    const [copied] = device.copy();
    const ra = device.get(oa, ORIGIN);
    const rb = device.get(ob, ORIGIN, { passkey: { ...copied, counter: 0 } });
    w.db.interleave(seed);
    const replies = await Promise.all([
      a.call("POST", "/api/auth/passkeys/sign-in", { response: ra }),
      b.call("POST", "/api/auth/passkeys/sign-in", { response: rb }),
    ]);
    w.db.interleave(null);
    expect(replies.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(passkeySessions()).toBe(1);
  });
});
