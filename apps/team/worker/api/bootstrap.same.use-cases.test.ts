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
    core: "1117ccb19f83fb34a213c5c92c6430b4a19215c2d0072529a2ce8acbe47bd9ce",
    whole: "0b388100ff2e71b05e90c6ec9915c8b8da0a489cee81389865ab5a58ea6dcd92",
  });
});

it("a session lead (sees the register) is sent the core and the club as pinned", async () => {
  expect(await as("m2@example.com")).toEqual({
    core: "770c4f0f0dd9c32a3b61d6af91cecd58eefe530f6d975cf7552bd6264d1adcf3",
    whole: "a7b8c7879be0c116fef618075cc964163b9be4bb3493ece008cc73245c285cce",
  });
});

it("a member is sent the core and the club as pinned", async () => {
  expect(await as("m30@example.com")).toEqual({
    core: "aecfc0840d0999eae5c4e112be546a63e50ec9a73c6ba24f672a8f53ad8f7898",
    whole: "c4259bbf76b3455af3c5558456ecf2adfd9647998069c33b4188c1c8612aa22d",
  });
});

it("a Kumite captain (every draft's Team 1) is sent the core and the club as pinned", async () => {
  expect(await as(emailOf(club.ids[0]))).toEqual({
    core: "4d60f23ed11829c20024f8cbad8d737f5b1f4635a5bff299a3ca35fd7f3c03f9",
    whole: "3e163460db48166c2c63e9df73ed8e854334e8fd283bda546a813ab054ce0700",
  });
});

it("an admin viewing as a member is sent the club as that member is", async () => {
  expect((await club.dana.call("PUT", "/api/me/view-as", { memberId: club.ids[5] })).status).toBe(200);
  const viewing = await seen(club.dana);
  expect((await club.dana.call("DELETE", "/api/me/view-as")).status).toBe(200);
  expect(viewing).toEqual({
    core: "d7a4f277089007d695d8df934797cc609a1c67f711815ee8373fa16fdc88af29",
    whole: "e996afa11150c959f45a27651c6c9cf00b84b5994155ae1290a7bfb620f62ad6",
  });
});
