// Announcements at the edges: the last day by London's clock, not the server's; a day that isn't on the calendar;
// the longest note and one in emoji; a tap on "Got it" twice. Driven through the real Worker handlers in the fake
// world (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

type Browser = Awaited<ReturnType<typeof w.signedIn>>;
const HALL = { title: "No training on the 24th", body: "The hall's booked.", link: "", endsOn: "2026-10-24" };
const seen = async (b: Browser, now?: Date) =>
  ((await b.call("GET", "/api/bootstrap", undefined, now ? { now } : {})).body.announcements as Json[]).map(
    (a) => a.title,
  );

describe("an announcement's last day is London's", () => {
  it("shows until midnight in London on its last day, in summer time (BST)", async () => {
    const dana = await w.signedIn("dana@example.com");
    expect((await dana.call("POST", "/api/announcements", HALL)).status).toBe(201);
    // 23:59 on the 24th in London is 22:59 UTC; 00:00 on the 25th is 23:00 UTC
    expect(await seen(dana, new Date("2026-10-24T22:59:00Z"))).toEqual([HALL.title]);
    expect(await seen(dana, new Date("2026-10-24T23:00:00Z"))).toEqual([]);
  });

  it("shows until midnight in London in winter (GMT), the week the clocks go back", async () => {
    const dana = await w.signedIn("dana@example.com");
    expect((await dana.call("POST", "/api/announcements", { ...HALL, endsOn: "2026-10-26" })).status).toBe(201);
    expect(await seen(dana, new Date("2026-10-26T23:59:00Z"))).toEqual([HALL.title]);
    expect(await seen(dana, new Date("2026-10-27T00:00:00Z"))).toEqual([]);
  });

  it("an admin posting just after midnight in London can't end it on what is, in London, yesterday", async () => {
    const dana = await w.signedIn("dana@example.com");
    // 23:30 UTC on the 24th is 00:30 on the 25th in London
    const r = await dana.call("POST", "/api/announcements", HALL, { now: new Date("2026-10-24T23:30:00Z") });
    expect(r.status).toBe(400);
  });

  it("ending today is fine", async () => {
    const dana = await w.signedIn("dana@example.com");
    const r = await dana.call("POST", "/api/announcements", { ...HALL, endsOn: "2026-10-06" });
    expect(r.status).toBe(201);
  });
});

describe("what an announcement can say", () => {
  it("the longest title (80) and note (280) go up whole, in emoji and accents too", async () => {
    const dana = await w.signedIn("dana@example.com");
    const title = "🏒".repeat(40); // 80 UTF-16 units
    const body = "é".repeat(280);
    expect((await dana.call("POST", "/api/announcements", { ...HALL, title, body })).status).toBe(201);
    const reg = await w.signedIn("reg@example.com");
    const shown = (await reg.call("GET", "/api/bootstrap")).body.announcements[0];
    expect(shown).toMatchObject({ title, body });
  });

  it("a title or note one character too long is refused", async () => {
    const dana = await w.signedIn("dana@example.com");
    expect((await dana.call("POST", "/api/announcements", { ...HALL, title: "x".repeat(81) })).status).toBe(400);
    expect((await dana.call("POST", "/api/announcements", { ...HALL, body: "x".repeat(281) })).status).toBe(400);
  });

  it.each([
    ["no day", undefined],
    ["a day written another way", "24/10/2026"],
    ["a number", 20261024],
  ])("an end of %s is refused", async (_, endsOn) => {
    const dana = await w.signedIn("dana@example.com");
    expect((await dana.call("POST", "/api/announcements", { ...HALL, endsOn })).status).toBe(400);
  });

  // https://github.com/battersea-cougars/ark/issues/133
  // #133: the end day was checked only for its shape (dddd-dd-dd), so a day that isn't on the calendar went up,
  // and showed until whenever that string sorted
  it.each(["2027-02-30", "2026-13-01", "2026-10-99"])(
    "an end day that isn't on the calendar (%s) is refused (#133)",
    async (endsOn) => {
      const dana = await w.signedIn("dana@example.com");
      expect((await dana.call("POST", "/api/announcements", { ...HALL, endsOn })).status).toBe(400);
    },
  );

  it.each(["http://example.com", "https://", "https://exa mple.com", "data:text/html,hi", "//example.com"])(
    "a link that isn't a plain https address (%s) is refused",
    async (link) => {
      const dana = await w.signedIn("dana@example.com");
      expect((await dana.call("POST", "/api/announcements", { ...HALL, link })).status).toBe(400);
    },
  );
});

describe("Got it, and looking back", () => {
  it("tapping Got it twice is fine, and it's still got once", async () => {
    const dana = await w.signedIn("dana@example.com");
    const { id } = (await dana.call("POST", "/api/announcements", HALL)).body;
    const reg = await w.signedIn("reg@example.com");
    expect((await reg.call("POST", `/api/announcements/${id}/dismiss`)).status).toBe(200);
    expect((await reg.call("POST", `/api/announcements/${id}/dismiss`)).status).toBe(200);
    const n = w.db.raw.prepare("SELECT count(*) n FROM announcement_dismissals").get() as { n: number };
    expect(n.n).toBe(1);
  });

  it("Got it on one that's been taken down, or never was, is a 404", async () => {
    const dana = await w.signedIn("dana@example.com");
    const { id } = (await dana.call("POST", "/api/announcements", HALL)).body;
    expect((await dana.call("DELETE", `/api/announcements/${id}`)).status).toBe(200);
    const reg = await w.signedIn("reg@example.com");
    expect((await reg.call("POST", `/api/announcements/${id}/dismiss`)).status).toBe(404);
    expect((await reg.call("POST", "/api/announcements/9999/dismiss")).status).toBe(404);
    expect((await dana.call("DELETE", `/api/announcements/${id}`)).status).toBe(404);
  });

  it("looking back with a page size of 0 still gets one; over 100 gets 100; not a number is refused", async () => {
    const dana = await w.signedIn("dana@example.com");
    for (let i = 0; i < 3; i++)
      expect((await dana.call("POST", "/api/announcements", { ...HALL, title: `Note ${i}` })).status).toBe(201);
    const reg = await w.signedIn("reg@example.com");
    const page = async (q: string) => (await reg.call("GET", `/api/announcements${q}`)).body;
    expect((await page("?limit=0")).announcements).toHaveLength(1);
    expect((await page("?limit=1000")).announcements).toHaveLength(3);
    expect((await reg.call("GET", "/api/announcements?limit=ten")).status).toBe(400);
    expect((await reg.call("GET", "/api/announcements?before=-1")).status).toBe(400);
    // Before the oldest there's nothing, and no more
    const oldest = (await page("")).announcements.at(-1).id;
    expect(await page(`?before=${oldest}`)).toEqual({ announcements: [], more: false });
  });

  it("one posted by an admin who has since deleted their account says nobody's name", async () => {
    const dana = await w.signedIn("dana@example.com");
    expect((await dana.call("POST", "/api/announcements", HALL)).status).toBe(201);
    // Another admin first, so Dana may go
    const reg = (await dana.call("GET", "/api/bootstrap")).body.members.find((m: Json) => m.name === "Reg Player");
    expect((await dana.call("PUT", `/api/members/${reg.id}`, { ...reg, roles: ["Admin"] })).status).toBe(200);
    expect((await dana.call("DELETE", "/api/me")).status).toBe(200);
    const regPhone = await w.signedIn("reg@example.com");
    const [past] = (await regPhone.call("GET", "/api/announcements")).body.announcements;
    expect(past.by).not.toBe("Dana Admin");
  });
});

describe("how often live pages check, at its edges", () => {
  it("5 seconds and 2 minutes are both allowed; a fraction or text is refused", async () => {
    const dana = await w.signedIn("dana@example.com");
    expect((await dana.call("PUT", "/api/settings", { liveRefreshSeconds: 5 })).status).toBe(200);
    expect((await dana.call("PUT", "/api/settings", { liveRefreshSeconds: 120 })).status).toBe(200);
    expect((await dana.call("PUT", "/api/settings", { liveRefreshSeconds: 121 })).status).toBe(400);
    expect((await dana.call("PUT", "/api/settings", { liveRefreshSeconds: 4 })).status).toBe(400);
    expect((await dana.call("PUT", "/api/settings", { liveRefreshSeconds: 7.5 })).status).toBe(400);
    expect((await dana.call("PUT", "/api/settings", { liveRefreshSeconds: "10" })).status).toBe(400);
  });
});
