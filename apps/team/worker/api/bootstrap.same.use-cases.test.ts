// Opening the app sends the club exactly as it did before its CPU was cut (#175): byte for byte, as each kind of
// member sees it, in a club of 120 with three years of Kumites behind it (bootstrap.testing.ts). Each reply's SHA-256, as
// it was before the cut, on team/review at 88c25be (usage alerts and hardening changed it from d97a7a4). A change to what the bootstrap sends, on purpose, changes these: check it's the change
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
    "ada4ae82052ba7a93c6e00ee89e2241fa46409aecba9e9eaf525ad3060b7f9a0",
  );
});

it("a session lead (sees the register) is sent the club as before", async () => {
  expect(await opened("m2@example.com")).toBe("52b9068bae5cb25d519f6b9ef81f0ac6fb07fa25c438d07fd7f309ff17df6e2d");
});

it("a member is sent the club as before", async () => {
  expect(await opened("m30@example.com")).toBe("0257e6f42267df21c21868be76d2fed6e70720d6c184e719549d911afa90aa13");
});

it("a Kumite captain (every draft's Team 1) is sent the club as before", async () => {
  expect(await opened(emailOf(club.ids[0]))).toBe("3589c9f7cf7da9cd41d416cca3b1a9014a831fb75e2fa050fc769f760c1e1aab");
});

it("an admin viewing as a member is sent the club as that member is", async () => {
  expect((await club.dana.call("PUT", "/api/me/view-as", { memberId: club.ids[5] })).status).toBe(200);
  const viewing = digest(await (await club.dana.open("GET", "/api/bootstrap")).text());
  expect((await club.dana.call("DELETE", "/api/me/view-as")).status).toBe(200);
  expect(viewing).toBe("df5f2b37c4429ec26cdb73443c0cd4c53ecf11153797104734cf544a95719b3c");
});
