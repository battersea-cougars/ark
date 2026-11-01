// Settings → Audit log (ADR 0095): an admin reads the record of who changed what, newest first, a page at a time, in
// enough detail to say it in plain words. Driven through the real handlers in the fake world (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
];
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

describe("an admin reads the audit log", () => {
  it("sees who did what, newest first, with the people and roles named", async () => {
    const dana = await w.signedIn("dana@example.com");
    const b = (await dana.club()).body;
    const reg = b.members.find((m: { name: string }) => m.name === "Reg Player");
    const { id: roleId } = (
      await dana.call("POST", "/api/roles", { name: "Helper", description: "", actions: ["manage:Member"] })
    ).body;
    await dana.call("PUT", `/api/members/${reg.id}`, { ...reg, roles: ["Helper", "Member"] });
    const regSignedIn = await w.signedIn("reg@example.com");
    expect((await regSignedIn.call("GET", "/api/audit")).status).toBe(403);

    const { entries, more } = (await dana.call("GET", "/api/audit")).body;
    expect(more).toBe(false);
    expect(entries.map((e: { action: string }) => e.action)).toEqual([
      "refused",
      "sign_in",
      "member.updated",
      "role.created",
      "sign_in",
    ]);
    // Reg's try at this page is on it
    expect(entries[0]).toMatchObject({
      by: { id: reg.id, name: "Reg Player" },
      detail: { method: "GET", path: "/api/audit", action: "read:Audit" },
    });
    expect(entries[1]).toMatchObject({ by: { id: reg.id, name: "Reg Player" }, detail: { method: "code" } });
    expect(entries[2]).toMatchObject({
      by: { id: b.me, name: "Dana Admin" },
      about: "Reg Player",
      detail: { memberId: reg.id, to: { roles: ["Helper", "Member"] } },
    });
    expect(entries[3]).toMatchObject({ by: { id: b.me, name: "Dana Admin" }, about: "Helper", detail: { roleId } });
    expect(entries.every((e: { at: string }) => !Number.isNaN(Date.parse(e.at)))).toBe(true);
  });

  it("reads it a page at a time, from the newest back", async () => {
    const dana = await w.signedIn("dana@example.com");
    for (let i = 0; i < 4; i++) await w.signedIn("reg@example.com");
    const first = (await dana.call("GET", "/api/audit?limit=2")).body;
    expect(first.entries).toHaveLength(2);
    expect(first.more).toBe(true);
    const second = (await dana.call("GET", `/api/audit?limit=2&before=${first.entries[1].id}`)).body;
    expect(second.entries[0].id).toBeLessThan(first.entries[1].id);
    const rest = (await dana.call("GET", `/api/audit?before=${second.entries[1].id}`)).body;
    expect(rest.more).toBe(false);
    expect((await dana.call("GET", "/api/audit?before=x")).status).toBe(400);
  });

  it("sees what was undone that can't be put back: a session reset, with what it took away", async () => {
    const dana = await w.signedIn("dana@example.com");
    const reg = await w.signedIn("reg@example.com");
    const session = (await reg.club()).body.sessions.find((s: { heldOn: string }) => s.heldOn >= "2026-10-06");
    expect((await reg.call("POST", `/api/sessions/${session.id}/answer`, { answer: "in" })).status).toBe(200);
    expect((await dana.call("POST", `/api/sessions/${session.id}/reset`)).status).toBe(200);
    const [latest] = (await dana.call("GET", "/api/audit?limit=1")).body.entries;
    expect(latest).toMatchObject({
      action: "session.reset",
      by: { name: "Dana Admin" },
      detail: { from: { heldOn: session.heldOn, signups: 1 }, to: { heldOn: session.heldOn, signups: 0 } },
    });
  });
});
