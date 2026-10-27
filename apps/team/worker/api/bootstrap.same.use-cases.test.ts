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
    core: "52f0540dc01104d5530260a179206b3199779358cc328fe903a8ca8d11a2fef1",
    whole: "0d0f4490202c2c852421fc038b900a5ddce34fe6e041b48771c9f5d156f19f46",
  });
});

it("a session lead (sees the register) is sent the core and the club as pinned", async () => {
  expect(await as("m2@example.com")).toEqual({
    core: "118d06cb0e6a99abf6a8d5f9310c0ceade083ec956da61367e807cc5f89f4526",
    whole: "4660c79f243b59dffb5062fc56fa6b2c5bdd57315ad3bc56d4e5a148624f549a",
  });
});

it("a member is sent the core and the club as pinned", async () => {
  expect(await as("m30@example.com")).toEqual({
    core: "f99a9ca9ca9eaa2a9c61be759cfbaef86a80e6952220cebd7b9c1973b488884f",
    whole: "c3a9c7e6ec4817595789318ac8e1681037ab4c212cfb1ca41601b4a920d4530e",
  });
});

it("a Kumite captain (every draft's Team 1) is sent the core and the club as pinned", async () => {
  expect(await as(emailOf(club.ids[0]))).toEqual({
    core: "338a6ef6e9b681a0b21099adc361155b3d7ef62aa09b14dad667f5b96b1dd895",
    whole: "b2ae3b82031b5aa56b970d11734bb323345fcfc8fbd4131540d4d27a7efd515a",
  });
});

it("an admin viewing as a member is sent the club as that member is", async () => {
  expect((await club.dana.call("PUT", "/api/me/view-as", { memberId: club.ids[5] })).status).toBe(200);
  const viewing = await seen(club.dana);
  expect((await club.dana.call("DELETE", "/api/me/view-as")).status).toBe(200);
  expect(viewing).toEqual({
    core: "d8475430ed20822b13d3069c1a3b9fea3652a5b8fe4c0f88cd54b5bd2f281380",
    whole: "473a5071c09a7198244183c3da5eec200b3d83ae920726992d8ef80a54ea12aa",
  });
});
