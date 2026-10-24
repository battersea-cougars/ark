// An admin views the app as a member (ADR 0024, #40): the server answers as that member would see the club, and
// refuses every change until they go back to themselves. Starting and ending are on the record (ADR 0095). Driven
// through the real handlers in the fake world (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Sam Player", position: "F", rating: 60, email: "sam@example.com", phone: "07700 900123" },
  { name: "Reg Player", position: "G", rating: 55, email: "reg@example.com" },
];
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

type Browser = Awaited<ReturnType<ReturnType<typeof testWorld>["signedIn"]>>;
const bootstrap = async (b: Browser) => (await b.club()).body;
const idOf = async (b: Browser) => (await bootstrap(b)).me as number;
/**
 * The club as it shows, less who's asking: who you are, who you're viewing as, and among Home's people who's really
 * signed in (their name only, so the app can say who's viewing, #178).
 */
const club = ({ me, viewingAs, people, ...rest }: Record<string, unknown>) => ({
  ...rest,
  people: (people as { id: number }[]).filter((p) => p.id !== me || !viewingAs),
});
const RINK = { name: "Lee Valley", address: "Lea Bridge Road" };

async function danaViewingAsSam() {
  const dana = await w.signedIn("dana@example.com");
  const sam = await w.signedIn("sam@example.com");
  const samId = await idOf(sam);
  const started = await dana.call("PUT", "/api/me/view-as", { memberId: samId });
  expect(started.status).toBe(200);
  return { dana, sam, samId, danaId: (await bootstrap(dana)).me as number };
}

const auditOf = async (b: Browser) =>
  (
    (await b.call("GET", "/api/audit")).body.entries as {
      action: string;
      by: { name: string } | null;
      about: string | null;
      detail: Record<string, unknown>;
    }[]
  ).filter((e) => e.action.startsWith("view_as"));

describe("an admin views the app as a member", () => {
  it("the club comes back as the member sees it: their actions, their data, nobody else's", async () => {
    const { dana, sam, samId, danaId } = await danaViewingAsSam();
    const asSam = await bootstrap(dana);
    expect(asSam.me).toBe(danaId);
    expect(asSam.viewingAs).toBe(samId);
    const samsOwn = await bootstrap(sam);
    expect(samsOwn.viewingAs).toBeNull();
    expect(club(asSam)).toEqual(club(samsOwn));
    expect(asSam.actions).not.toContain("manage:all");
    // Only Sam's own email and phone, as Sam sees them
    const emails = (asSam.members as { id: number; email: string | null }[]).filter((m) => m.email);
    expect(emails.map((m) => m.id)).toEqual([samId]);
  });

  it("an admin page Sam can't open is refused, as it would be for Sam", async () => {
    const { dana } = await danaViewingAsSam();
    expect((await dana.call("GET", "/api/audit")).status).toBe(403);
  });

  it("a change is refused, in words, and nothing changes: neither the admin's nor the member's own", async () => {
    const { dana, sam } = await danaViewingAsSam();
    const before = await bootstrap(sam);
    const admins = await dana.call("POST", "/api/venues", RINK);
    expect(admins.status).toBe(403);
    expect(admins.body.error).toBe("You're viewing as Sam: go back to yourself to change anything.");
    const own = await dana.call("PUT", "/api/me", { position: "G", phone: "", bio: "Hacked" });
    expect(own.status).toBe(403);
    expect(club(await bootstrap(sam))).toEqual(club(before));
  });

  it("starting someone else while viewing is refused too: back to yourself first", async () => {
    const { dana } = await danaViewingAsSam();
    const reg = await w.signedIn("reg@example.com");
    expect((await dana.call("PUT", "/api/me/view-as", { memberId: await idOf(reg) })).status).toBe(403);
  });

  it("going back to yourself restores your own club and your changes", async () => {
    const { dana, danaId } = await danaViewingAsSam();
    expect((await dana.call("DELETE", "/api/me/view-as")).status).toBe(200);
    const mine = await bootstrap(dana);
    expect(mine.me).toBe(danaId);
    expect(mine.viewingAs).toBeNull();
    expect(mine.actions).toContain("manage:all");
    expect((await dana.call("POST", "/api/venues", RINK)).status).toBe(201);
  });

  it("it lasts through a reload: it's the sign-in's, not the browser's", async () => {
    const { dana, samId } = await danaViewingAsSam();
    expect((await bootstrap(dana)).viewingAs).toBe(samId);
    expect((await bootstrap(dana)).viewingAs).toBe(samId);
    // The admin's other phone is still them
    const other = await w.signedIn("dana@example.com");
    expect((await bootstrap(other)).viewingAs).toBeNull();
  });

  it("the member being viewed carries on as normal", async () => {
    const { sam, samId } = await danaViewingAsSam();
    const own = await bootstrap(sam);
    expect(own.me).toBe(samId);
    expect(own.viewingAs).toBeNull();
    expect((await sam.call("PUT", "/api/me", { position: "D", phone: "07700 900123", bio: "Still me" })).status).toBe(
      200,
    );
  });

  it("starting and ending are on the audit log, with who and whom", async () => {
    const { dana } = await danaViewingAsSam();
    await dana.call("DELETE", "/api/me/view-as");
    const entries = await auditOf(dana);
    expect(entries.map((e) => e.action)).toEqual(["view_as.ended", "view_as.started"]);
    for (const e of entries) expect(e).toMatchObject({ by: { name: "Dana Admin" }, about: "Sam Player" });
  });

  it("signing out ends it, on the record", async () => {
    const { dana } = await danaViewingAsSam();
    expect((await dana.call("POST", "/api/auth/sign-out")).status).toBe(200);
    const again = await w.signedIn("dana@example.com");
    expect((await bootstrap(again)).viewingAs).toBeNull();
    expect((await auditOf(again)).map((e) => e.action)).toEqual(["view_as.ended", "view_as.started"]);
  });

  it("a phone viewing as someone never registers for notifications", async () => {
    const { dana } = await danaViewingAsSam();
    expect((await dana.call("PUT", "/api/auth/device", { token: "fcm-token-1", platform: "ios" })).status).toBe(403);
    expect(w.db.raw.prepare("SELECT count(*) n FROM push_devices").get()).toEqual({ n: 0 });
  });

  it("a member who's gone ends it cleanly: the admin is themselves again", async () => {
    const { dana, samId, danaId } = await danaViewingAsSam();
    w.db.raw.prepare("UPDATE members SET status = 'inactive' WHERE id = ?").run(samId);
    const back = await bootstrap(dana);
    expect(back.me).toBe(danaId);
    expect(back.viewingAs).toBeNull();
    expect((await dana.call("POST", "/api/venues", RINK)).status).toBe(201);
  });
});

describe("who can view as someone", () => {
  it("a member without View as a member can't start it", async () => {
    const reg = await w.signedIn("reg@example.com");
    const sam = await w.signedIn("sam@example.com");
    const r = await reg.call("PUT", "/api/me/view-as", { memberId: await idOf(sam) });
    expect(r.status).toBe(403);
    expect((await bootstrap(reg)).viewingAs).toBeNull();
  });

  it("not yourself, and not someone who isn't in the club", async () => {
    const dana = await w.signedIn("dana@example.com");
    expect((await dana.call("PUT", "/api/me/view-as", { memberId: await idOf(dana) })).status).toBe(400);
    expect((await dana.call("PUT", "/api/me/view-as", { memberId: 9999 })).status).toBe(404);
  });
});
