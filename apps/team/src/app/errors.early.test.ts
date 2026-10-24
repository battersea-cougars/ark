// What goes wrong before Sentry is up (errors.early.ts, ADR 0111): kept from the first moment and handed over once it
// starts, the start-up's own failure too. The browser-level check (Safari's engine, the real build) is in ADR 0111's
// History; this keeps the order and the hand-off right.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Early = typeof import("./errors.early");
let early: Early;
let page: EventTarget;
beforeEach(async () => {
  vi.resetModules();
  early = await import("./errors.early");
  page = new EventTarget();
  early.listenEarly(page as unknown as Window);
});

/** What the browser fires on window: an error nothing caught, or a promise nobody caught. */
const thrown = (error: unknown) => page.dispatchEvent(Object.assign(new Event("error"), { error, message: "boom" }));
const rejected = (reason: unknown) => page.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason }));

describe("errors before Sentry is up", () => {
  it("an error thrown and a promise rejected while the app opens wait, then reach Sentry in order", () => {
    const first = new Error("Home threw while it mounted");
    thrown(first);
    rejected("a promise nobody caught");
    const sent: unknown[][] = [];
    early.handOff((error, how) => void sent.push([error, how]));
    expect(sent).toEqual([
      [first, "onerror"],
      ["a promise nobody caught", "onunhandledrejection"],
    ]);
  });

  it("the start-up's failure is reported whether Sentry is up yet or not", () => {
    const sent: unknown[][] = [];
    const before = new TypeError("Load failed");
    early.reportEarly(before, "start");
    early.handOff((error, how) => void sent.push([error, how]));
    const after = new TypeError("Load failed again");
    early.reportEarly(after, "start");
    expect(sent).toEqual([
      [before, "start"],
      [after, "start"],
    ]);
  });

  it("once Sentry is up its own handlers take uncaught errors, so they aren't sent twice", () => {
    const sent: unknown[] = [];
    early.handOff((error) => void sent.push(error));
    thrown(new Error("later"));
    rejected(new Error("later too"));
    expect(sent).toEqual([]);
  });

  it("an error with no Error (another site's script) is kept by its message", () => {
    thrown(null);
    const sent: unknown[] = [];
    early.handOff((error) => void sent.push(error));
    expect(sent).toEqual(["boom"]);
  });

  it("a failure the app caught and carried on past (a clash question it couldn't ask) reaches Sentry, and the console on your machine", () => {
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    const sent: unknown[][] = [];
    early.handOff((error, how) => void sent.push([error, how]));
    const failed = new Error("GET /api/clashes → 500");
    early.reportCaught(failed, "Couldn't ask what's on then");
    expect(sent).toEqual([[failed, "caught"]]);
    // Vitest runs as dev: the console.error the dev strip shows (dev-errors.ts)
    expect(said).toHaveBeenCalledWith("Couldn't ask what's on then:", failed);
    said.mockRestore();
  });

  it("a loop that throws before Sentry is up keeps only the first 20", () => {
    for (let i = 0; i < 100; i++) thrown(new Error(`again ${i}`));
    const sent: unknown[] = [];
    early.handOff((error) => void sent.push(error));
    expect(sent).toHaveLength(20);
  });
});
