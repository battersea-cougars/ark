// What opening the app sends, and what the app holds once its pages are read, as each kind of member sees it, byte for
// byte, in a club of 120 with three years of Kumites behind it (bootstrap.testing.ts): each one's SHA-256. A change to
// what's sent, on purpose, changes these: check it's the change you meant (the app reads it, ADR 0053), then put the
// new ones here, saying why.
// Re-pinned 2026-10-24 (#175): the bootstrap sends each series' next one and its last one played, not every one there
// has been, and a team's logo as its address (/api/tournament-teams/:id/logo?v=…), not the image; the past ones are
// read when they're opened (tournaments/editions.ts). Before: team/review at 88c25be, the cut that sent the same bytes.
// Re-pinned 2026-10-24 (#177): the bootstrap sends your own unpaid charges (not every charge, and everyone's for an
// admin) and `dues`, a line per member of what they owe by age and their credit, in place of `credits` and `payments`;
// a ledger is read a page at a time (dues/dues.ledger.ts). Everything else is byte for byte as before: the members'
// played counts (now stored as registers close, members.played.ts) and the 12 KB logos (still addresses) included.
// 2026-10-24 (#178): opening the app sends the core (api.slices.ts CORE), pinned below as "opening the app"; the roster,
// the weeks just held, each series' last one played and everyone's dues are the pages' (/api/slices). The club put
// together from the core and every page (src/app/club-whole.ts), in the bootstrap's old order and without what's new in
// For admins, is still the #177 pins, unchanged: splitting the club lost and changed nothing.
// Re-pinned 2026-10-25 (#182), the club put together only: the history's matches kick off on their own day now (they
// were stamped with the moment the test wrote them), as seed:history writes them, since when a match was played says
// whether it was in the last fortnight. Opening the app (the core) is byte for byte as before.
// Re-pinned 2026-10-27 (#186): each training night says why it's off, `offByHand` and `offFor` (the tournaments it's
// off for). With those two left out, every pin is byte for byte as before (checked).
// Re-pinned 2026-10-28 (#187): the club's settings say how many days before a quarter its Quarterly Members are told
// its fee is due (`planReminderDays`, 5 unless set). Without it, every pin is byte for byte as before.
import { createHash } from "node:crypto";
import { beforeAll, expect, it } from "vitest";
import { clubWithHistory } from "./bootstrap.testing";
import { PAGE_PARTS } from "../../src/app/club-parts";
import { wholeClub } from "../testing";

let club: Awaited<ReturnType<typeof clubWithHistory>>;
type Browser = Awaited<ReturnType<typeof club.w.signedIn>>;
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

/** What the bootstrap sent before #178, in its order: the club put together is laid out the same, to compare. */
const BEFORE = [
  "me",
  "viewingAs",
  "actions",
  "devTools",
  "unfinished",
  "simulator",
  "everydayRole",
  "members",
  "roles",
  "venues",
  "series",
  "sessions",
  "tournamentTypes",
  "tournaments",
  "clubEvents",
  "charges",
  "dues",
  "reminders",
  "subscriptionFees",
  "quips",
  "announcements",
  "settings",
  "notifications",
  "forAdmins",
  "agenda",
];

/** Opening the app, and the club once every page is read, as this member's phone is sent them, digested. */
async function seen(b: Browser) {
  const core = await (await b.open("GET", "/api/bootstrap")).text();
  const pages = await (await b.open("GET", `/api/slices?names=${PAGE_PARTS.join(",")}`)).text();
  const whole = wholeClub(JSON.parse(core), JSON.parse(pages).slices);
  // For admins as it was: what the club is owed in all and who's asking are new on it (#178)
  const { usage, emailStopped } = whole.forAdmins;
  const before = Object.fromEntries(BEFORE.map((k) => [k, k === "forAdmins" ? { usage, emailStopped } : whole[k]]));
  return { core: digest(core), whole: digest(JSON.stringify(before)) };
}
const emailOf = (id: number) =>
  (club.w.db.raw.prepare("SELECT email FROM members WHERE id = ?").get(id) as { email: string }).email;
const as = async (email: string) => seen(await club.w.signedIn(email));

beforeAll(async () => {
  club = await clubWithHistory();
});

it("an admin opening the app is sent the core as pinned, and the whole club once its pages are read", async () => {
  expect(await seen(club.dana)).toEqual({
    core: "7daf3dda0c112d17e067be45972520a3e713f435325628b36e9b1dcafa63445b",
    whole: "2945b8b61c9039677bcd1bd5bf26e69183191f110fd9c1b2b54bf7f3ec521d68",
  });
});

it("a session lead (sees the register) is sent the core and the club as pinned", async () => {
  expect(await as("m2@example.com")).toEqual({
    core: "ad2f411d45908e5f8087845241412d94b34db7a1e39b669e703a672e4e473381",
    whole: "d4923854522ca260f7d2e677f7814bb161cee203f8ffd8af6f856fb4bf8fea15",
  });
});

it("a member is sent the core and the club as pinned", async () => {
  expect(await as("m30@example.com")).toEqual({
    core: "f22d238423d41a9c6a3458e5ce42ac0c3a1fa37f04041c3a976b54fa5fc21831",
    whole: "43cb0919e6010dc56e3fd67a0ae7aefade1f5d3f22fa9d97f6bc39051d0169c8",
  });
});

it("a Kumite captain (every draft's Team 1) is sent the core and the club as pinned", async () => {
  expect(await as(emailOf(club.ids[0]))).toEqual({
    core: "369ff6087f58ff18b7494a83c9e733e564ad2cc33806675b421e37369636f02b",
    whole: "997a0bbb7d5bf5877c4efeab2209e0dfead3e687468c831748c7a4e3e3e776d2",
  });
});

it("an admin viewing as a member is sent the club as that member is", async () => {
  expect((await club.dana.call("PUT", "/api/me/view-as", { memberId: club.ids[5] })).status).toBe(200);
  const viewing = await seen(club.dana);
  expect((await club.dana.call("DELETE", "/api/me/view-as")).status).toBe(200);
  expect(viewing).toEqual({
    core: "57ce7a610822e86ef6206e9c45a55f24714b9012cd93d03ea73f60160e44ebf4",
    whole: "b1a0ea410b6570baad2fef2b462a4f194d70e65a604f7fe43ca1f89a49aabbae",
  });
});
