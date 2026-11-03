// What opening the app sends, and the club once its pages are read, for each kind of member in a club of 120
// (bootstrap.testing.ts), pinned as SHA-256s. A change to what's sent changes these on purpose only: check it's the
// change you meant (ADR 0053), then pin the new ones.
import { createHash } from "node:crypto";
import { beforeAll, expect, it } from "vitest";
import { clubWithHistory } from "./bootstrap.testing";
import { PAGE_PARTS } from "../../src/app/club-parts";
import { wholeClub } from "../testing";

let club: Awaited<ReturnType<typeof clubWithHistory>>;
type Browser = Awaited<ReturnType<typeof club.w.signedIn>>;
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

/** The bootstrap's parts in their first order: the club put together is laid out the same, to compare. */
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
  // For admins as it was: what the club is owed in all and who's asking are new on it
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
    core: "6f6749bcab472c0142b8b3d4b802f1e8c541169055440e17ded36387a4251ecc",
    whole: "c03a4e6c330b5774994fe69090e86eb9f97e03fd8cb9432bb17485c19c79190e",
  });
});

it("a session lead (sees the register) is sent the core and the club as pinned", async () => {
  expect(await as("m2@example.com")).toEqual({
    core: "b90dee68a8b6f6c1521ce21407a90ce4ce182ebcdb87446e71b323138ccaf5ab",
    whole: "80f5f6707e25db43f6a4ed3b1b5626f5c3efb3c9c76be3f47443d891931d5228",
  });
});

it("a member is sent the core and the club as pinned", async () => {
  expect(await as("m30@example.com")).toEqual({
    core: "127a8f7290c54bdfd7ae3966fbbc64b70a7d1dd477acddf496e0b150f22021c0",
    whole: "4f0a9f4217767925c420b5127ff30f4307c7a6d16ad2d83c1bfc0bfe305047ae",
  });
});

it("a Kumite captain (every draft's Team 1) is sent the core and the club as pinned", async () => {
  expect(await as(emailOf(club.ids[0]))).toEqual({
    core: "14d542526d1f784ee333c45069162ccb41537cba8750488e6041eb3e7372b824",
    whole: "4bcf33270487ad589f618066750c2630dc47e53fc29cf9cf12cb307a79b3f313",
  });
});

it("an admin viewing as a member is sent the club as that member is", async () => {
  expect((await club.dana.call("PUT", "/api/me/view-as", { memberId: club.ids[5] })).status).toBe(200);
  const viewing = await seen(club.dana);
  expect((await club.dana.call("DELETE", "/api/me/view-as")).status).toBe(200);
  expect(viewing).toEqual({
    core: "2ef956ece1cf193b6a55567d8554267246f4c7c520d682e7646ba8199d6f6196",
    whole: "a6c8d87bea300303b837a6ef08583fa1721fbd6953678a4a4bea3819bae2cb62",
  });
});
