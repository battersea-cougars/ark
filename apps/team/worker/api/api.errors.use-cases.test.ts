// When the app breaks for a member, the developer hears of it (ADR 0110, #75): a request that fails is reported with
// what was asked (method, path, the route it matched) and who asked, by their number only, never their name or email.
import { beforeEach, describe, expect, it } from "vitest";
import type { Entry } from "@cougars/shared/scribe";
import { captureLogs } from "@cougars/shared/testing/scribe";
import { testWorld } from "../testing";

const ROSTER = [{ name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" }];

let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  w = testWorld(ROSTER);
});

describe("a member's request fails on the server", () => {
  it("they're told something went wrong, and the report says the route and which member, but nothing about them", async () => {
    const reported: Entry[] = [];
    captureLogs({ report: (_e, entry) => void reported.push(entry) });
    const reg = await w.signedIn("reg@example.com");
    const { id } = w.db.raw.prepare("SELECT id FROM members WHERE email = 'reg@example.com'").get() as { id: number };
    // The database loses a table the club's data reads: a broken deploy
    w.db.raw.exec("DROP TABLE announcements");

    const res = await reg.call("GET", "/api/bootstrap");
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Something went wrong.");
    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatchObject({
      msg: "request.failed",
      fields: { method: "GET", path: "/api/bootstrap", route: expect.stringContaining("bootstrap"), member: id },
    });
    expect(JSON.stringify(reported[0])).not.toMatch(/reg@example\.com|Reg Player/);
  });
});
