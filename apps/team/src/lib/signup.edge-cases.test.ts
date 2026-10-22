// When a tournament takes sign-ups (ADR 0074), at its edges: its opening and closing days themselves, a deadline with
// no opening day, a tournament that's live or finished, and an admin's Open past its deadline. Days are London's
// (lib/signup.ts takes London's today).
import { describe, expect, it } from "vitest";
import { nightOpen, nightOpensOn, opensWords, signupOpen, signupOver } from "./signup";
import { londonToday } from "./dates";

const planned = { status: "planned", signupOpensOn: "2026-10-10", signupClosesOn: "2026-10-20" };

describe("a tournament's sign-up window", () => {
  it("opens on its opening day itself, not the day before", () => {
    expect(signupOpen(planned, "2026-10-09")).toBe(false);
    expect(signupOpen(planned, "2026-10-10")).toBe(true);
  });

  it("is still open on its closing day, and closed the day after", () => {
    expect(signupOpen(planned, "2026-10-20")).toBe(true);
    expect(signupOver(planned, "2026-10-20")).toBe(false);
    expect(signupOpen(planned, "2026-10-21")).toBe(false);
    expect(signupOver(planned, "2026-10-21")).toBe(true);
  });

  it("opening and closing the same day: open that day only", () => {
    const oneDay = { ...planned, signupOpensOn: "2026-10-10", signupClosesOn: "2026-10-10" };
    expect(["2026-10-09", "2026-10-10", "2026-10-11"].map((d) => signupOpen(oneDay, d))).toEqual([false, true, false]);
  });

  it("planned with no opening day waits for an admin, however near the deadline", () => {
    expect(signupOpen({ ...planned, signupOpensOn: null }, "2026-10-15")).toBe(false);
  });

  it("opened by an admin: open now, and with no deadline open until it's live", () => {
    expect(signupOpen({ ...planned, status: "open" }, "2026-10-01")).toBe(true);
    expect(signupOpen({ status: "open", signupOpensOn: null, signupClosesOn: null }, "2030-01-01")).toBe(true);
  });

  it("an admin's Open doesn't reopen it past the deadline", () => {
    expect(signupOpen({ ...planned, status: "open" }, "2026-10-21")).toBe(false);
  });

  it("live or finished: closed, whatever the dates say", () => {
    for (const status of ["live", "finished"]) expect(signupOpen({ ...planned, status }, "2026-10-15")).toBe(false);
  });

  it("the deadline's last minute is London's: 23:59 on the closing day in summer time is still that day", () => {
    // 22:59 UTC on 20 October is 23:59 in London (BST); a minute past is the 21st
    expect(signupOpen(planned, londonToday(new Date("2026-10-20T22:59:00Z")))).toBe(true);
    expect(signupOpen(planned, londonToday(new Date("2026-10-20T23:01:00Z")))).toBe(false);
    // After the clocks go back (25 October) London is UTC
    const late = { ...planned, signupClosesOn: "2026-10-30" };
    expect(signupOpen(late, londonToday(new Date("2026-10-30T23:59:00Z")))).toBe(true);
    expect(signupOpen(late, londonToday(new Date("2026-10-31T00:00:00Z")))).toBe(false);
  });
});

describe("a training night's sign-up (ADR 0030)", () => {
  // Friday 16 October 2026, opening 4 days before: Monday the 12th
  it("opens at the start of its day, London's, and says when as the app shows it", () => {
    expect(nightOpensOn("2026-10-16", 4)).toBe("2026-10-12");
    expect(nightOpen("2026-10-16", 4, "2026-10-11")).toBe(false);
    expect(nightOpen("2026-10-16", 4, "2026-10-12")).toBe(true);
    expect(opensWords("2026-10-12", "2026-10-06", true)).toBe("Mon");
    expect(opensWords("2026-10-19", "2026-10-06", true)).toBe("Mon 19 Oct");
  });

  it("left empty, always open", () => {
    expect(nightOpensOn("2026-10-16", null)).toBeNull();
    expect(nightOpen("2026-10-16", undefined, "2026-01-01")).toBe(true);
  });
});
