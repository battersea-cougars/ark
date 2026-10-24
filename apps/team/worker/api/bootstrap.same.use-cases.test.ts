// Opening the app sends the club as each kind of member sees it, byte for byte, in a club of 120 with three years of
// Kumites behind it (bootstrap.testing.ts): each reply's SHA-256. A change to what the bootstrap sends, on purpose,
// changes these: check it's the change you meant (the app reads it, ADR 0053), then put the new ones here, saying why.
// Re-pinned 2026-10-24 (#175): the bootstrap sends each series' next one and its last one played, not every one there
// has been, and a team's logo as its address (/api/tournament-teams/:id/logo?v=…), not the image; the past ones are
// read when they're opened (tournaments/editions.ts). Before: team/review at 88c25be, the cut that sent the same bytes.
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
    "2555132b77a49706fc7857d2cbe7974403c8bc1bd04eb9d2aca41d919a1282ca",
  );
});

it("a session lead (sees the register) is sent the club as pinned", async () => {
  expect(await opened("m2@example.com")).toBe("abe2c5fe5a9ab5a96d78e22fb821f23b8581aebdbb0d21ee28205103c15788e9");
});

it("a member is sent the club as pinned", async () => {
  expect(await opened("m30@example.com")).toBe("f5d07e994030939d6b6fd2f930dcaa43c56867ec8150d049dd944ef0f3738607");
});

it("a Kumite captain (every draft's Team 1) is sent the club as pinned", async () => {
  expect(await opened(emailOf(club.ids[0]))).toBe("75ddbf2ccbb9c19aa906f4fc5d0f1d33802bc17210d727eecd3cfab0022a5ed6");
});

it("an admin viewing as a member is sent the club as that member is", async () => {
  expect((await club.dana.call("PUT", "/api/me/view-as", { memberId: club.ids[5] })).status).toBe(200);
  const viewing = digest(await (await club.dana.open("GET", "/api/bootstrap")).text());
  expect((await club.dana.call("DELETE", "/api/me/view-as")).status).toBe(200);
  expect(viewing).toBe("6b0c8632de24bc5516e32b410738955ba9178a51ec05e19e5cff18a5ca11bb20");
});
