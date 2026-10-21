// The app's own brake (ADR 0055) at its edges: the last call of a tab's day, the wait's ceiling, a day's rest in
// winter as well as summer, and an answer that isn't a failure.
import { describe, expect, it } from "vitest";
import { Brake } from "./brake";

function clock(start: string) {
  let t = Date.parse(start);
  return { now: () => t, wait: (ms: number) => (t += ms) };
}

describe("the brake, at its edges", () => {
  it("lets the day's last call through and stops the one after; background checks stop with it", () => {
    const c = clock("2026-10-07T12:00:00Z");
    const brake = new Brake({ now: c.now, perDay: 3 });
    expect(brake.take()).toBeNull();
    expect(brake.take()).toBeNull();
    expect(brake.mayCheck()).toBe(true);
    expect(brake.take()).toBeNull();
    expect(brake.mayCheck()).toBe(false);
    expect(brake.take()).not.toBeNull();
  });

  it("starts a tab's count again at midnight UTC, not London's: 23:59 and 00:00 UTC are different days", () => {
    const c = clock("2026-07-01T23:59:00Z"); // 00:59 in London, already the 2nd there
    const brake = new Brake({ now: c.now, perDay: 1 });
    expect(brake.take()).toBeNull();
    expect(brake.take()).not.toBeNull();
    c.wait(60_000); // 00:00 UTC
    expect(brake.take()).toBeNull();
  });

  it("never waits more than five minutes, however many failures in a row", () => {
    const c = clock("2026-10-07T12:00:00Z");
    const brake = new Brake({ now: c.now });
    for (let i = 0; i < 20; i++) brake.failed();
    c.wait(5 * 60_000 - 1);
    expect(brake.mayCheck()).toBe(false);
    c.wait(1);
    expect(brake.mayCheck()).toBe(true);
  });

  it("a 500 is a failure like the network being down; a 404 is an answer", () => {
    const c = clock("2026-10-07T12:00:00Z");
    const brake = new Brake({ now: c.now });
    brake.answered(503, false);
    expect(brake.mayCheck()).toBe(false);
    c.wait(10_000);
    expect(brake.mayCheck()).toBe(true);
    brake.answered(404, true);
    expect(brake.mayCheck()).toBe(true);
  });

  it("in winter, a day's rest is back at midnight in London, which is UTC's", () => {
    const c = clock("2026-12-07T12:00:00Z");
    const brake = new Brake({ now: c.now });
    brake.answered(429, false, true);
    expect(brake.take()).toBe("The club's app has used today's free allowance. It's back at 00:00.");
  });

  it("a day's rest that starts a minute before midnight UTC is over a minute later", () => {
    const c = clock("2026-12-07T23:59:00Z");
    const brake = new Brake({ now: c.now });
    brake.answered(429, false, true);
    expect(brake.take()).not.toBeNull();
    c.wait(60_000);
    expect(brake.take()).toBeNull();
  });
});
