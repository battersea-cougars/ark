// An admin adds someone to the club (ADR 0069): their name, email and position, and the app emails them a link to
// itself. They sign in with that email as anyone does. Driven through the real handlers in the fake world (ADR 0031);
// with no Gmail in tests, the email is logged.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
];
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

/** The last email the app wrote. */
function lastEmail() {
  return w.mails.at(-1) ?? null;
}

const NEWBIE = { name: "Nina New", email: "Nina@Example.com ", position: "G" };

describe("an admin adds a member", () => {
  it("they're in the club straight away, and get an email with a link to the app", async () => {
    const dana = await w.signedIn("dana@example.com");
    const r = await dana.call("POST", "/api/members", NEWBIE);
    expect(r.status).toBe(201);
    expect(r.body.emailed).toBe(true);

    const nina = (await dana.call("GET", "/api/bootstrap")).body.members.find(
      (m: { name: string }) => m.name === "Nina New",
    );
    expect(nina).toMatchObject({ id: r.body.id, status: "active", position: "G" });

    const mail = lastEmail()!;
    expect(mail.subject).toMatch(/Cougars/);
    expect(mail.text).toContain("https://team.test/?email=nina%40example.com");
  });

  it("they sign in with that email, as anyone does", async () => {
    const dana = await w.signedIn("dana@example.com");
    await dana.call("POST", "/api/members", NEWBIE);
    const phone = w.browser();
    const { devCode } = await w.ask(phone, "nina@example.com");
    expect((await phone.call("POST", "/api/auth/verify", { code: devCode })).status).toBe(200);
  });

  it("an email already in the club is refused, so nobody ends up twice", async () => {
    const dana = await w.signedIn("dana@example.com");
    const r = await dana.call("POST", "/api/members", { ...NEWBIE, email: "REG@example.com" });
    expect(r.status).toBe(409);
    expect(lastEmail()).toBeNull();
  });
});

describe("an admin adds a member without emailing them (#164)", () => {
  const audit = async (dana: Awaited<ReturnType<typeof w.signedIn>>, action: string) =>
    ((await dana.call("GET", "/api/audit")).body.entries as { action: string; detail: Record<string, unknown> }[]).find(
      (e) => e.action === action,
    );

  it("with the email off nothing is sent, and they're in and sign in with their address as anyone does", async () => {
    const dana = await w.signedIn("dana@example.com");
    const r = await dana.call("POST", "/api/members", { ...NEWBIE, emailThem: false });
    expect(r.status).toBe(201);
    expect(r.body.emailed).toBe(false);
    expect(w.mails).toEqual([]);

    const nina = (await dana.call("GET", "/api/bootstrap")).body.members.find(
      (m: { name: string }) => m.name === "Nina New",
    );
    expect(nina).toMatchObject({ id: r.body.id, status: "active" });
    const phone = w.browser();
    const { devCode } = await w.ask(phone, "nina@example.com");
    expect((await phone.call("POST", "/api/auth/verify", { code: devCode })).status).toBe(200);
  });

  it("with it on (as the sheet starts), one email as before", async () => {
    const dana = await w.signedIn("dana@example.com");
    const r = await dana.call("POST", "/api/members", { ...NEWBIE, emailThem: true });
    expect(r.body.emailed).toBe(true);
    expect(w.mails).toHaveLength(1);
    expect(w.mails[0].text).toContain("https://team.test/?email=nina%40example.com");
  });

  it("the record says whether the add emailed them", async () => {
    const dana = await w.signedIn("dana@example.com");
    await dana.call("POST", "/api/members", { ...NEWBIE, emailThem: false });
    expect((await audit(dana, "member.added"))?.detail.to).toMatchObject({ name: "Nina New", emailed: false });
    await dana.call("POST", "/api/members", { ...NEWBIE, name: "Ola Other", email: "ola@example.com" });
    expect((await audit(dana, "member.added"))?.detail.to).toMatchObject({ name: "Ola Other", emailed: true });
  });

  it("later, Send them the app link from their card sends one email, and it's on the record", async () => {
    const dana = await w.signedIn("dana@example.com");
    const { id } = (await dana.call("POST", "/api/members", { ...NEWBIE, emailThem: false })).body;
    const r = await dana.call("POST", `/api/members/${id}/app-link`);
    expect(r).toMatchObject({ status: 200, body: { emailed: true } });
    expect(w.mails).toHaveLength(1);
    expect(w.mails[0].text).toContain("https://team.test/?email=nina%40example.com");
    expect(await audit(dana, "member.app_link")).toMatchObject({
      detail: { memberId: id, from: null, to: { emailed: true } },
    });
  });

  it("the link is for an admin to send, to someone in the club with an email", async () => {
    const dana = await w.signedIn("dana@example.com");
    const { id } = (await dana.call("POST", "/api/members", { ...NEWBIE, emailThem: false })).body;
    const reg = await w.signedIn("reg@example.com");
    expect((await reg.call("POST", `/api/members/${id}/app-link`)).status).toBe(403);
    expect((await dana.call("POST", "/api/members/9999/app-link")).status).toBe(404);
    const nina = (await dana.call("GET", "/api/bootstrap")).body.members.find((m: { id: number }) => m.id === id);
    await dana.call("PUT", `/api/members/${id}/contact`, { email: "", phone: "" });
    expect((await dana.call("POST", `/api/members/${id}/app-link`)).status).toBe(400);
    await dana.call("PUT", `/api/members/${id}/contact`, { email: "nina@example.com", phone: "" });
    await dana.call("PUT", `/api/members/${id}`, { ...nina, status: "inactive" });
    expect((await dana.call("POST", `/api/members/${id}/app-link`)).status).toBe(409);
    expect(w.mails).toEqual([]);
  });
});

describe("an admin edits the name a member goes by", () => {
  const members = async (who: Awaited<ReturnType<typeof w.signedIn>>) =>
    (await who.call("GET", "/api/bootstrap")).body.members as { id: number; name: string; webName: string | null }[];

  it("sets it for them, and it shows everywhere in place of their full name", async () => {
    const dana = await w.signedIn("dana@example.com");
    const reg = (await members(dana)).find((m) => m.name === "Reg Player")!;
    expect((await dana.call("PUT", `/api/members/${reg.id}`, { ...reg, webName: "The Wall" })).status).toBe(200);

    const seen = (await members(await w.signedIn("reg@example.com"))).find((m) => m.id === reg.id);
    expect(seen).toMatchObject({ name: "Reg Player", webName: "The Wall" });
  });

  it("clears it, and they go by their full name again", async () => {
    const dana = await w.signedIn("dana@example.com");
    const reg = (await members(dana)).find((m) => m.name === "Reg Player")!;
    await dana.call("PUT", `/api/members/${reg.id}`, { ...reg, webName: "The Wall" });
    await dana.call("PUT", `/api/members/${reg.id}`, { ...reg, webName: "  " });
    expect((await members(dana)).find((m) => m.id === reg.id)?.webName).toBeNull();
  });

  it("leaves it alone when a change doesn't mention it", async () => {
    const dana = await w.signedIn("dana@example.com");
    const reg = (await members(dana)).find((m) => m.name === "Reg Player")!;
    await dana.call("PUT", `/api/members/${reg.id}`, { ...reg, webName: "The Wall" });
    const { webName: _, ...rest } = reg;
    await dana.call("PUT", `/api/members/${reg.id}`, { ...rest, rating: 61 });
    expect((await members(dana)).find((m) => m.id === reg.id)?.webName).toBe("The Wall");
  });
});

describe("an admin sets another admin's everyday role (ADR 0024)", () => {
  type Row = { id: number; name: string; everydayRoleId?: number | null };
  const boot = async (who: Awaited<ReturnType<typeof w.signedIn>>) => (await who.call("GET", "/api/bootstrap")).body;
  async function twoAdmins() {
    const dana = await w.signedIn("dana@example.com");
    const b = await boot(dana);
    const reg = (b.members as Row[]).find((m) => m.name === "Reg Player")!;
    await dana.call("PUT", `/api/members/${reg.id}`, { ...reg, roles: ["Admin", "Member"] });
    const role = (name: string) => (b.roles as { id: number; name: string }[]).find((r) => r.name === name)!.id;
    return { dana, reg: reg.id, member: role("Member"), admin: role("Admin") };
  }

  it("their app opens in it, and the admin sees what it is; cleared, it opens in their full role", async () => {
    const { dana, reg, member } = await twoAdmins();
    expect((await dana.call("PUT", `/api/members/${reg}/everyday-role`, { roleId: member })).status).toBe(200);
    expect((await boot(await w.signedIn("reg@example.com"))).everydayRole).toBe(member);
    expect(((await boot(dana)).members as Row[]).find((m) => m.id === reg)?.everydayRoleId).toBe(member);

    await dana.call("PUT", `/api/members/${reg}/everyday-role`, { roleId: null });
    expect((await boot(await w.signedIn("reg@example.com"))).everydayRole).toBeNull();
  });

  it("is never more than they can do: a plain member's can't be Admin", async () => {
    const dana = await w.signedIn("dana@example.com");
    const b = await boot(dana);
    const reg = (b.members as Row[]).find((m) => m.name === "Reg Player")!.id;
    const admin = (b.roles as { id: number; name: string }[]).find((r) => r.name === "Admin")!.id;
    expect(await dana.call("PUT", `/api/members/${reg}/everyday-role`, { roleId: admin })).toMatchObject({
      status: 403,
      body: { error: "Their everyday role has to be one that can do less than they can." },
    });
  });

  it("is for whoever manages members, and on the record", async () => {
    const { dana, member } = await twoAdmins();
    const danaId = (await boot(dana)).me;
    const plain = await w.signedIn("reg@example.com");
    // Reg is an admin now: take it back so Reg is a plain member asking
    await dana.call("PUT", `/api/members/${(await boot(plain)).me}`, {
      ...((await boot(dana)).members as Row[]).find((m) => m.name === "Reg Player"),
      roles: ["Member"],
    });
    expect((await plain.call("PUT", `/api/members/${danaId}/everyday-role`, { roleId: member })).status).toBe(403);
    const { entries } = (await dana.call("GET", "/api/audit")).body as { entries: { action: string }[] };
    expect(entries.map((e) => e.action)).toContain("member.updated");
    await dana.call("PUT", `/api/members/${danaId}/everyday-role`, { roleId: member });
    const after = (await dana.call("GET", "/api/audit")).body as { entries: { action: string }[] };
    expect(after.entries.map((e) => e.action)).toContain("member.everyday");
  });
});
