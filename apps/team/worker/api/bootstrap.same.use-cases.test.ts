// Opening the app sends the club as each kind of member sees it, byte for byte, in a club of 120 with three years of
// Kumites behind it (bootstrap.testing.ts): each reply's SHA-256. A change to what the bootstrap sends, on purpose,
// changes these: check it's the change you meant (the app reads it, ADR 0053), then put the new ones here, saying why.
// Re-pinned 2026-10-24 (#175): the bootstrap sends each series' next one and its last one played, not every one there
// has been, and a team's logo as its address (/api/tournament-teams/:id/logo?v=…), not the image; the past ones are
// read when they're opened (tournaments/editions.ts). Before: team/review at 88c25be, the cut that sent the same bytes.
// Re-pinned 2026-10-24 (#177): the bootstrap sends your own unpaid charges (not every charge, and everyone's for an
// admin) and `dues`, a line per member of what they owe by age and their credit, in place of `credits` and `payments`;
// a ledger is read a page at a time (dues/dues.ledger.ts). Everything else is byte for byte as before: the members'
// played counts (now stored as registers close, members.played.ts) and the 12 KB logos (still addresses) included.
import { createHash } from "node:crypto";
import { beforeAll, expect, it } from "vitest";
import { clubWithHistory } from "./bootstrap.testing";

let club: Awaited<ReturnType<typeof clubWithHistory>>;
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

/** The bootstrap's body as this member's phone is sent it, digested. */
async function opened(email: string) {
  const b = await club.w.signedIn(email);
  return digest(await (await b.open("GET", "/api/bootstrap")).text());
}
const emailOf = (id: number) =>
  (club.w.db.raw.prepare("SELECT email FROM members WHERE id = ?").get(id) as { email: string }).email;

beforeAll(async () => {
  club = await clubWithHistory();
});

it("an admin opening the app is sent the club as pinned", async () => {
  expect(digest(await (await club.dana.open("GET", "/api/bootstrap")).text())).toBe(
    "43630c668d309e20d3bd7fc49bd00eb19b652e28e487478b8b5130e286aa19fb",
  );
});

it("a session lead (sees the register) is sent the club as pinned", async () => {
  expect(await opened("m2@example.com")).toBe("a2fcf41c91b8977b3e2117d65b8417bddac54fcfb9ae5110d7eb3067bf9174aa");
});

it("a member is sent the club as pinned", async () => {
  expect(await opened("m30@example.com")).toBe("ac717a43dfdabaae51cf201df536aa0d0763658cf0bac96ef08429a3a353a80d");
});

it("a Kumite captain (every draft's Team 1) is sent the club as pinned", async () => {
  expect(await opened(emailOf(club.ids[0]))).toBe("4a67178f5b6299388112724d8470efada138a384ec4f5d487506dd62f2740094");
});

it("an admin viewing as a member is sent the club as that member is", async () => {
  expect((await club.dana.call("PUT", "/api/me/view-as", { memberId: club.ids[5] })).status).toBe(200);
  const viewing = digest(await (await club.dana.open("GET", "/api/bootstrap")).text());
  expect((await club.dana.call("DELETE", "/api/me/view-as")).status).toBe(200);
  expect(viewing).toBe("97a83fa1cdff92dca8501e4dac41a8761c43a3bbb41693a2a8ee657eb67acd96");
});
