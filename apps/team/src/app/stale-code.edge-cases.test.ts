// Reloading for new code when the browser's storage is off or full: never a reload loop.
import { describe, expect, it } from "vitest";
import { isStaleCode, recoverOnce } from "./stale-code";

describe("reloading for new code without storage", () => {
  it("storage that can't be read but can be written: treated as never reloaded, so it reloads once", () => {
    const written: string[] = [];
    const store = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: (_k: string, v: string) => void written.push(v),
    };
    let reloads = 0;
    expect(
      recoverOnce(
        store,
        () => reloads++,
        () => 1_000_000,
      ),
    ).toBe(true);
    expect(reloads).toBe(1);
    expect(written).toEqual(["1000000"]);
  });

  it("storage that can't be written (private mode, full): no reload, since it couldn't remember it tried", () => {
    const store = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    let reloads = 0;
    expect(
      recoverOnce(
        store,
        () => reloads++,
        () => 1_000_000,
      ),
    ).toBe(false);
    expect(reloads).toBe(0);
  });

  it("a minute after the last reload is long enough to try again; a moment before isn't", () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    let now = 5_000_000;
    expect(
      recoverOnce(
        store,
        () => {},
        () => now,
      ),
    ).toBe(true);
    now += 59_999;
    expect(
      recoverOnce(
        store,
        () => {},
        () => now,
      ),
    ).toBe(false);
    now += 1;
    expect(
      recoverOnce(
        store,
        () => {},
        () => now,
      ),
    ).toBe(true);
  });

  it("a value in storage that isn't a time is treated as never reloaded", () => {
    const store = { getItem: () => "garbage", setItem: () => {} };
    expect(
      recoverOnce(
        store,
        () => {},
        () => 1_000_000,
      ),
    ).toBe(true);
  });

  it("the dev server's renamed libraries count as new code; other errors with no message don't", () => {
    expect(isStaleCode(new Error("Outdated Optimize Dep"))).toBe(true);
    expect(isStaleCode(new Error(""))).toBe(false);
    expect(isStaleCode(null)).toBe(false);
  });
});
