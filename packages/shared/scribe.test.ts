import { afterEach, describe, expect, it, vi } from "vitest";
import { scribe, jsonAdapter, type Entry } from "./scribe";
import { captureLogs } from "./testing/scribe";

afterEach(() => scribe.configure({}));

describe("a line in the log", () => {
  it("is one JSON object: the level, who wrote it, what happened, and its fields", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((l) => void lines.push(l));
    scribe.configure({ adapter: jsonAdapter });
    scribe.logger("join").info("enquiry.created", { id: 7, source: "/join/" });
    expect(JSON.parse(lines[0])).toEqual({
      level: "info",
      name: "join",
      msg: "enquiry.created",
      id: 7,
      source: "/join/",
    });
    vi.restoreAllMocks();
  });

  it("goes to the console method of its level, so Workers Logs shows errors as errors", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    scribe.configure({ adapter: jsonAdapter });
    const log = scribe.logger("cache");
    log.warn("cache.stale");
    log.error("cache.broken");
    expect(warn).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });

  it("keeps an error's stack and cause, not just its message", () => {
    const logs = captureLogs();
    const cause = new Error("socket closed");
    scribe.logger("gmail").error("mail.failed", new Error("send failed", { cause }));
    const err = logs.entries[0].fields.err as { message: string; stack: string; cause: { message: string } };
    expect(err.message).toBe("send failed");
    expect(err.stack).toContain("scribe.test.ts");
    expect(err.cause.message).toBe("socket closed");
  });

  it("takes an error on its own: its message is the line's message", () => {
    const logs = captureLogs();
    scribe.logger("api").error(new TypeError("x is undefined"));
    expect(logs.entries[0]).toMatchObject({
      level: "error",
      msg: "x is undefined",
      fields: { err: { name: "TypeError" } },
    });
  });

  it("puts a plain value under data", () => {
    const logs = captureLogs();
    scribe.logger("push").info("push.logged", 3);
    expect(logs.entries[0].fields).toEqual({ data: 3 });
  });

  it("carries a logger's bound fields on every line", () => {
    const logs = captureLogs();
    const log = scribe.logger("api").with({ route: "/api/me" });
    log.info("request.done", { status: 200 });
    expect(logs.entries[0].fields).toEqual({ route: "/api/me", status: 200 });
  });

  it("skips what's under its level", () => {
    const logs = captureLogs({ level: "info" });
    const log = scribe.logger("x");
    log.debug("noise");
    log.info("kept");
    expect(logs.entries.map((e) => e.msg)).toEqual(["kept"]);
    expect(log.isLevelEnabled("debug")).toBe(false);
  });

  it("follows the adapter set after the logger was made (a module-level logger still works)", () => {
    const log = scribe.logger("early");
    const logs = captureLogs();
    log.info("late");
    expect(logs.entries).toHaveLength(1);
  });
});

describe("nothing private in the log", () => {
  it("hides secrets by their key, at the top and one level down", () => {
    const logs = captureLogs();
    scribe.logger("auth").info("sign_in", { token: "abc", user: { password: "pw" }, code: "123456" });
    expect(logs.entries[0].fields).toEqual({
      token: "[redacted]",
      user: { password: "[redacted]" },
      code: "[redacted]",
    });
  });

  it("masks an email address wherever it appears, keeping its domain", () => {
    const logs = captureLogs();
    scribe.logger("mail").info("mail.redirected", { to: ["player.one@example.com"], note: "for ada@club.org" });
    expect(logs.entries[0].fields).toEqual({ to: ["p…@example.com"], note: "for a…@club.org" });
  });

  it("masks addresses in an error's message too", () => {
    const logs = captureLogs();
    scribe.logger("mail").error("mail.failed", new Error("Rejected: ada@club.org"));
    expect((logs.entries[0].fields.err as { message: string }).message).toBe("Rejected: a…@club.org");
  });

  it("hides a phone number by its key", () => {
    const logs = captureLogs();
    scribe.logger("join").info("enquiry", { phone: "07700 900123" });
    expect(logs.entries[0].fields).toEqual({ phone: "[redacted]" });
  });
});

describe("errors are reported, not only logged", () => {
  it("every error or fatal line goes to the reporter, with its Error and fields; a warning doesn't", () => {
    const reported: [unknown, Entry][] = [];
    captureLogs({ report: (error, entry) => void reported.push([error, entry]) });
    const boom = new Error("boom");
    const log = scribe.logger("cron");
    log.error("cron.failed", boom, { task: "dues" });
    log.warn("cron.slow", new Error("not reported"));
    log.error("cron.no_error_object");
    expect(reported.map(([, e]) => e.msg)).toEqual(["cron.failed", "cron.no_error_object"]);
    expect(reported[0][0]).toBe(boom);
    expect(reported[0][1]).toMatchObject({ name: "cron", fields: { task: "dues" } });
    expect(reported[1][0]).toBeUndefined();
  });

  it("a reporter that throws never breaks the code that logged", () => {
    captureLogs({
      report: () => {
        throw new Error("sentry down");
      },
    });
    expect(() => scribe.logger("x").error("bad", new Error("e"))).not.toThrow();
  });
});
