import { describe, expect, it } from "vitest";

// Svelte runs whatever an $effect returns as its teardown, before the effect runs again and when it goes. So
// `$effect(() => onmanage?.(opener))` runs what the parent's handler returns, and `(open) => (draftJobs = open)`
// returns the opener: every change to the draft (a pick, a step back) opened Manage the draft by itself. Handing
// something up to a parent is a block that returns nothing.
const sources = import.meta.glob<string>("../**/*.svelte", { query: "?raw", import: "default", eager: true });

/** `$effect(() => onX?.(…))` or `$effect(() => onX(…))`: an expression body that returns a callback prop's answer. */
const HANDS_UP_ITS_ANSWER = /\$effect(?:\.pre)?\(\s*\(\)\s*=>\s*on[A-Za-z]*\s*(?:\?\.)?\s*\(/;

describe("effects that hand something up to a parent", () => {
  it("never return the parent's answer, which Svelte would run as their teardown", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    const offenders = Object.entries(sources).filter(([, code]) => HANDS_UP_ITS_ANSWER.test(code));
    expect(offenders.map(([file]) => file)).toEqual([]);
  });

  it("catches the way the draft's Manage opened by itself", () => {
    expect(HANDS_UP_ITS_ANSWER.test("$effect(() => onmanage?.(tools.length ? open : null));")).toBe(true);
    expect(HANDS_UP_ITS_ANSWER.test("$effect(() => {\n  onmanage?.(open);\n});")).toBe(false);
  });
});
