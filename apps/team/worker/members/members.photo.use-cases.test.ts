// A member puts up a profile photo from their phone (ADR 0123): the phone shrinks it, it's kept with them, and the app
// shows it to everyone in the club in place of their initials. Driven through the real handlers (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Pat Player", position: "G", rating: 55, email: "pat@example.com" },
];
// A 1×1 PNG, as a phone's canvas would hand it over
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

type Member = { id: number; name: string; photoAt: string | null };
const memberNamed = async (who: Awaited<ReturnType<typeof w.signedIn>>, name: string) =>
  ((await who.call("GET", "/api/bootstrap")).body.members as Member[]).find((m) => m.name === name)!;

describe("a member puts up a profile photo", () => {
  it("everyone in the club sees it, at an address that changes when it does", async () => {
    const reg = await w.signedIn("reg@example.com");
    const r = await reg.call("PUT", "/api/me/photo", { photo: PNG });
    expect(r.status).toBe(200);
    const mine = r.body.changed.members.find((m: Member) => m.name === "Reg Player");
    expect(mine.photoAt).toBeTruthy();

    const pat = await w.signedIn("pat@example.com");
    const seen = await memberNamed(pat, "Reg Player");
    expect(seen.photoAt).toBe(mine.photoAt);
    const img = await pat.open("GET", `/api/members/${seen.id}/photo?v=${seen.photoAt}`);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("cache-control")).toContain("immutable");
    expect(new Uint8Array(await img.arrayBuffer()).slice(1, 4)).toEqual(new TextEncoder().encode("PNG"));
  });

  it("taking it down puts their initials back", async () => {
    const reg = await w.signedIn("reg@example.com");
    await reg.call("PUT", "/api/me/photo", { photo: PNG });
    expect((await reg.call("PUT", "/api/me/photo", { photo: null })).status).toBe(200);
    const me = await memberNamed(reg, "Reg Player");
    expect(me.photoAt).toBeNull();
    expect((await reg.open("GET", `/api/members/${me.id}/photo`)).status).toBe(404);
  });

  it("anything but a small PNG, JPEG or WebP is refused", async () => {
    const reg = await w.signedIn("reg@example.com");
    for (const photo of ["data:image/svg+xml;base64,PHN2Zz4=", "https://example.com/me.jpg", 42])
      expect((await reg.call("PUT", "/api/me/photo", { photo })).status).toBe(400);
    const huge = `data:image/jpeg;base64,${"A".repeat(400 * 1024)}`;
    expect((await reg.call("PUT", "/api/me/photo", { photo: huge })).status).toBe(413);
    expect((await memberNamed(reg, "Reg Player")).photoAt).toBeNull();
  });

  it("it's only your own: the body can't name someone else", async () => {
    const reg = await w.signedIn("reg@example.com");
    const pat = await memberNamed(reg, "Pat Player");
    await reg.call("PUT", "/api/me/photo", { photo: PNG, id: pat.id, memberId: pat.id });
    expect((await memberNamed(reg, "Pat Player")).photoAt).toBeNull();
    expect((await memberNamed(reg, "Reg Player")).photoAt).toBeTruthy();
  });

  it("nobody signed out sees it", async () => {
    const reg = await w.signedIn("reg@example.com");
    await reg.call("PUT", "/api/me/photo", { photo: PNG });
    const { id } = await memberNamed(reg, "Reg Player");
    expect((await w.browser().open("GET", `/api/members/${id}/photo`)).status).toBe(401);
  });

  it("it goes with them when they delete their account", async () => {
    const reg = await w.signedIn("reg@example.com");
    await reg.call("PUT", "/api/me/photo", { photo: PNG });
    const { id } = await memberNamed(reg, "Reg Player");
    expect((await reg.call("DELETE", "/api/me")).status).toBe(200);
    const dana = await w.signedIn("dana@example.com");
    expect((await dana.open("GET", `/api/members/${id}/photo`)).status).toBe(404);
  });

  it("it's in the data they download", async () => {
    const reg = await w.signedIn("reg@example.com");
    await reg.call("PUT", "/api/me/photo", { photo: PNG });
    const data = (await reg.call("GET", "/api/me/data")).body;
    expect(JSON.stringify(data)).toContain(PNG);
  });
});
