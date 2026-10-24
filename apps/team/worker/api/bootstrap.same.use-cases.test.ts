// Opening the app sends the club exactly as it did before its CPU was cut (#175): byte for byte, as each kind of
// member sees it, in a club of 120 with three years of Kumites behind it (bootstrap.testing.ts). Each reply's SHA-256, as
// it was on main at d97a7a4. A change to what the bootstrap sends, on purpose, changes these: check it's the change
// you meant (the app reads it, ADR 0053), then put the new ones here.
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

it("an admin opening the app is sent the club as before", async () => {
  expect(digest(await (await club.dana.open("GET", "/api/bootstrap")).text())).toBe(
    "4a00cfebff8a873d8411ab2775db147fe75da5cbec11a81f92ca2bd0ad96bb86",
  );
});

it("a session lead (sees the register) is sent the club as before", async () => {
  expect(await opened("m2@example.com")).toBe("a3f21f303a74e2a041e125540731052888dbc0d22d2563ca2c6fe9ca72a0c88b");
});

it("a member is sent the club as before", async () => {
  expect(await opened("m30@example.com")).toBe("350347f0a772179576412c486b1ae74623b7a4d1a93fec41a6605f0ab448044f");
});

it("a Kumite captain (every draft's Team 1) is sent the club as before", async () => {
  expect(await opened(emailOf(club.ids[0]))).toBe("de2cc2df24fc0332402b1228439cb8c2f7130fdb5d433ef0f693f2e61fd1dc2d");
});

it("an admin viewing as a member is sent the club as that member is", async () => {
  expect((await club.dana.call("PUT", "/api/me/view-as", { memberId: club.ids[5] })).status).toBe(200);
  const viewing = digest(await (await club.dana.open("GET", "/api/bootstrap")).text());
  expect((await club.dana.call("DELETE", "/api/me/view-as")).status).toBe(200);
  expect(viewing).toBe("9d0f21b286862fa9b39e4cac32dfa84a4bd4a56757112246bf4b6117c4da4178");
});
