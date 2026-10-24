// Signing in at the edges: the last minute of a code, a code typed with a space, a session on its last day, a cookie
// kept after signing out, someone who left and asks to come back. Driven through the real handler in the fake world
// (testing.ts, ADR 0031); the clock is the request's `now`, never the wall's.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleApi } from "../api/api";
import { NOW, minutes, testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
];
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  w = testWorld(ROSTER);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const DAY = 24 * 60;
const verify = (b: ReturnType<typeof w.browser>, code: string, now?: Date) =>
  b.call("POST", "/api/auth/verify", { code }, { now });
const boot = (b: ReturnType<typeof w.browser>, now?: Date) => b.call("GET", "/api/bootstrap", undefined, { now });
const count = (sql: string, ...p: unknown[]) => (w.db.raw.prepare(sql).get(...p) as { n: number }).n;

describe("typing the email and the code", () => {
  it("a member types their email in capitals with spaces round it, and still gets their code", async () => {
    const phone = w.browser();
    const { devCode } = await w.ask(phone, "  REG@EXAMPLE.COM\t");
    expect(devCode).toMatch(/^\d{6}$/);
    expect((await verify(phone, devCode)).status).toBe(200);
  });

  it("a member types the code with a space in the middle, as the email shows it, and is let in", async () => {
    const phone = w.browser();
    const { devCode } = await w.ask(phone, "reg@example.com");
    expect((await verify(phone, `${devCode.slice(0, 3)} ${devCode.slice(3)}`)).status).toBe(200);
  });

  it.each([
    ["no @", "reg.example.com"],
    ["no dot after the @", "reg@example"],
    ["two addresses", "reg@example.com, dana@example.com"],
    ["a name and an address", "Reg <reg@example.com>"],
    ["nothing", ""],
    ["longer than any address can be", `${"r".repeat(250)}@example.com`],
  ])("an email with %s is refused, saying it doesn't look like one", async (_, typed) => {
    const r = await w.browser().call("POST", "/api/auth/start", { email: typed });
    expect(r.status).toBe(400);
    expect(w.mails).toHaveLength(0);
  });

  it("an email that isn't text (a list, a number) is refused, not a server error", async () => {
    for (const email of [["reg@example.com"], 42, { email: "reg@example.com" }])
      expect((await w.browser().call("POST", "/api/auth/start", { email })).status).toBe(400);
  });

  it("typing a code before asking for one says to ask for one", async () => {
    const r = await verify(w.browser(), "123456");
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Ask for a new one/);
  });

  it("a code that isn't text is refused, not a server error", async () => {
    const phone = w.browser();
    await w.ask(phone, "reg@example.com");
    expect((await phone.call("POST", "/api/auth/verify", { code: 123456 })).status).toBe(400);
    expect((await phone.call("POST", "/api/auth/verify", {})).status).toBe(400);
  });

  it("a wrong code says how many tries are left, ending in one try, in words", async () => {
    const phone = w.browser();
    const { devCode } = await w.ask(phone, "reg@example.com");
    const wrong = devCode === "000000" ? "111111" : "000000";
    const said = [];
    for (let i = 0; i < 4; i++) said.push((await verify(phone, wrong)).body.error);
    expect(said).toEqual([
      "That's not the code. 4 tries left.",
      "That's not the code. 3 tries left.",
      "That's not the code. 2 tries left.",
      "That's not the code. 1 try left.",
    ]);
    // The last try can still be the right one
    expect((await verify(phone, devCode)).status).toBe(200);
  });
});

describe("a code's 15 minutes", () => {
  it("works with a second to spare", async () => {
    const phone = w.browser();
    const { devCode } = await w.ask(phone, "reg@example.com");
    expect((await verify(phone, devCode, new Date(minutes(15).getTime() - 1000))).status).toBe(200);
  });

  it("has run out on the stroke of the 15th minute", async () => {
    const phone = w.browser();
    const { devCode } = await w.ask(phone, "reg@example.com");
    expect((await verify(phone, devCode, minutes(15))).status).toBe(400);
  });

  it("a code used to sign in can't sign in again after signing out, in the same browser", async () => {
    const phone = w.browser();
    const { devCode } = await w.ask(phone, "reg@example.com");
    const [nonce, value] = [...phone.jar].find(([k]) => k.includes("nonce"))!;
    expect((await verify(phone, devCode)).status).toBe(200);
    expect((await phone.call("POST", "/api/auth/sign-out")).status).toBe(200);
    // The nonce cookie went at sign-in; put it back, as a browser that kept it would
    phone.jar.set(nonce, value);
    const r = await verify(phone, devCode, minutes(1));
    expect(r.status).toBe(400);
    expect((await boot(phone, minutes(1))).status).toBe(401);
  });

  it("asking twice and signing in with the first code spends the second one too", async () => {
    const phone = w.browser();
    const nonce = () => [...phone.jar].find(([k]) => k.includes("nonce"))!;
    const first = await w.ask(phone, "reg@example.com");
    const second = await w.ask(phone, "reg@example.com", minutes(1));
    const kept = nonce();
    expect((await verify(phone, first.devCode, minutes(2))).status).toBe(200);
    // Someone with the same browser's nonce (the cookie copied before it was cleared) and the second code gets nowhere
    const copy = w.browser();
    copy.jar.set(kept[0], kept[1]);
    expect((await verify(copy, second.devCode, minutes(3))).status).toBe(400);
    expect(count("SELECT count(*) n FROM auth_sessions")).toBe(1);
  });
});

describe("a session's six months", () => {
  /** Signed in at NOW, and not used since. */
  const signedIn = async () => {
    const phone = w.browser();
    expect((await verify(phone, (await w.ask(phone, "reg@example.com")).devCode)).status).toBe(200);
    return phone;
  };

  it("left alone, it still works the day before it runs out", async () => {
    const phone = await signedIn();
    expect((await boot(phone, minutes(180 * DAY - 1))).status).toBe(200);
  });

  it("left alone, it has run out on the 180th day, to the minute", async () => {
    const phone = await signedIn();
    expect((await boot(phone, minutes(180 * DAY))).status).toBe(401);
  });

  it("used within a day it isn't written again; used a day later it moves on, with a fresh cookie", async () => {
    const phone = await signedIn();
    const soon = await boot(phone, minutes(DAY - 1));
    expect(soon.headers.getSetCookie().some((c) => c.includes("cougars_session"))).toBe(false);
    const later = await boot(phone, minutes(DAY));
    expect(
      later.headers.getSetCookie().some((c) => c.includes("cougars_session=") && c.includes("Max-Age=15552000")),
    ).toBe(true);
    // Moved on from that day: past the first 180 days, it still opens
    expect((await boot(phone, minutes(DAY + 180 * DAY - 1))).status).toBe(200);
  });

  it("a change (not only a read) also moves it on, and still carries the fresh cookie with its reply", async () => {
    const phone = await signedIn();
    const r = await phone.call(
      "PUT",
      "/api/me",
      { position: "F", phone: "", bio: "Back after the summer" },
      { now: minutes(2 * DAY) },
    );
    expect(r.status).toBe(200);
    expect(r.headers.getSetCookie().some((c) => c.includes("cougars_session=") && !c.includes("Max-Age=0"))).toBe(true);
  });
});

describe("signing out", () => {
  it("a copy of the session cookie kept from before signing out no longer opens the app", async () => {
    const phone = await w.signedIn("reg@example.com");
    const [name, value] = [...phone.jar].find(([k]) => k.includes("session"))!;
    expect((await phone.call("POST", "/api/auth/sign-out")).status).toBe(200);
    const thief = w.browser();
    thief.jar.set(name, value);
    expect((await boot(thief)).status).toBe(401);
  });

  it("signing out with no session, or twice, is fine and changes nothing on the record", async () => {
    const stranger = w.browser();
    expect((await stranger.call("POST", "/api/auth/sign-out")).status).toBe(200);
    const phone = await w.signedIn("reg@example.com");
    expect((await phone.call("POST", "/api/auth/sign-out")).status).toBe(200);
    const [name, value] = ["__Host-cougars_session", "made-up"];
    phone.jar.set(name, value);
    expect((await phone.call("POST", "/api/auth/sign-out")).status).toBe(200);
    expect(count("SELECT count(*) n FROM audit_log WHERE action = 'sign_out'")).toBe(1);
  });

  it("a made-up session cookie opens nothing", async () => {
    const b = w.browser();
    b.jar.set("__Host-cougars_session", "not-a-session");
    expect((await boot(b)).status).toBe(401);
    b.jar.set("__Host-cougars_session", "");
    expect((await boot(b)).status).toBe(401);
  });
});

describe("who can ask for a code", () => {
  it("a member made inactive gets no code, and is let back in by an admin making them active", async () => {
    const dana = await w.signedIn("dana@example.com");
    const reg = (await dana.call("GET", "/api/bootstrap")).body.members.find(
      (m: { name: string }) => m.name === "Reg Player",
    );
    expect((await dana.call("PUT", `/api/members/${reg.id}`, { ...reg, status: "inactive" })).status).toBe(200);
    expect((await w.ask(w.browser(), "reg@example.com")).devCode).toBeUndefined();
    expect((await dana.call("PUT", `/api/members/${reg.id}`, { ...reg, status: "active" })).status).toBe(200);
    expect((await w.ask(w.browser(), "reg@example.com")).devCode).toMatch(/^\d{6}$/);
  });

  // A member's reply used to wait for their code to be made and emailed, so it took measurably longer than a
  // stranger's (#81). Here the database never finishes writing a code: a member's reply still comes, as a stranger's
  // does, and the code is made after it.
  it("the reply doesn't wait for a member's code, so its timing says nothing about whose address it was", async () => {
    Object.assign(w.env, { TEAM_ENV: undefined, SITE_ENV: "dev", MAIL_SAFE_TO: "dev@example.com" });
    const writing = /^\s*(INSERT INTO|UPDATE) login_challenges/;
    const held = new Proxy(w.env.DB, {
      get(db, key) {
        if (key !== "prepare") return Reflect.get(db, key);
        return (sql: string) => {
          if (!writing.test(sql)) return db.prepare(sql);
          const never = () => new Promise(() => {});
          return { bind: () => ({ run: never, first: never, all: never }) };
        };
      },
    });
    const afterwards: Promise<unknown>[] = [];
    const ask = (email: string) =>
      handleApi(
        new Request("https://team.example/api/auth/start", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "https://team.example" },
          body: JSON.stringify({ email }),
        }),
        { ...w.env, DB: held },
        NOW,
        (p) => afterwards.push(p),
      );
    const stranger = await ask("nobody@example.com");
    const member = await ask("reg@example.com");
    expect([stranger.status, member.status]).toEqual([200, 200]);
    expect(await member.json()).toEqual(await stranger.json());
    expect(afterwards).toHaveLength(1);
  });

  it("someone who deleted their account can ask to join again with the same email", async () => {
    const reg = await w.signedIn("reg@example.com");
    expect((await reg.call("DELETE", "/api/me")).status).toBe(200);
    const r = await w
      .browser()
      .call("POST", "/api/auth/request", { name: "Reg Player", email: "reg@example.com", position: "F" });
    expect(r.status).toBe(200);
    expect(count("SELECT count(*) n FROM members WHERE email = 'reg@example.com' AND status = 'pending'")).toBe(1);
  });
});

describe("asking to join, at the edges", () => {
  const ask = (o: Record<string, unknown>) => w.browser().call("POST", "/api/auth/request", o);
  const asked = (email: string) =>
    w.db.raw.prepare("SELECT name, payment_reference ref, status FROM members WHERE email = ?").get(email) as
      { name: string; ref: string; status: string } | undefined;

  it("an email that's a member's in other capitals adds nobody, with the same thanks", async () => {
    const r = await ask({ name: "Reg Again", email: "Reg@Example.com", position: "F" });
    expect(r.status).toBe(200);
    expect(count("SELECT count(*) n FROM members WHERE lower(email) = 'reg@example.com'")).toBe(1);
  });

  it("a name with accents keeps them, and its bank reference is plain letters", async () => {
    expect((await ask({ name: "Zoë Ångström", email: "zoe@example.com", position: "D" })).status).toBe(200);
    expect(asked("zoe@example.com")).toEqual({ name: "Zoë Ångström", ref: "COUGARS ZOE A", status: "pending" });
  });

  it("a name with no letters a bank takes (emoji, another script) still gets a reference", async () => {
    expect((await ask({ name: "🏒🏒", email: "emoji@example.com", position: "F" })).status).toBe(200);
    expect(asked("emoji@example.com")?.ref).toBe("COUGARS MEMBER");
    expect((await ask({ name: "李雷", email: "li@example.com", position: "F" })).status).toBe(200);
    // Another with no bank letters takes the next one, never the same
    expect(asked("li@example.com")?.ref).toBe("COUGARS MEMBER2");
  });

  it("a name of 80 characters is fine; 81 is refused", async () => {
    expect((await ask({ name: "A".repeat(80), email: "long@example.com", position: "F" })).status).toBe(200);
    expect((await ask({ name: "A".repeat(81), email: "longer@example.com", position: "F" })).status).toBe(400);
  });

  it("without a position, or with one that isn't F, D or G, it's refused", async () => {
    expect((await ask({ name: "Nina New", email: "nina@example.com" })).status).toBe(400);
    expect((await ask({ name: "Nina New", email: "nina@example.com", position: "C" })).status).toBe(400);
    expect(asked("nina@example.com")).toBeUndefined();
  });

  // https://github.com/battersea-cougars/ark/issues/133
  // #133: a name of only spaces passed the "name is needed" check (it was trimmed after), so a member with no name
  // was made
  it("a name of only spaces is refused, like no name (#133)", async () => {
    const r = await ask({ name: "   ", email: "blank@example.com", position: "F" });
    expect(r.status).toBe(400);
    expect(asked("blank@example.com")).toBeUndefined();
  });

  it("with 50 waiting, the 51st is told to try tomorrow; once one is let in, there's room again", async () => {
    const insert = w.db.raw.prepare(
      "INSERT INTO members (name, email, position, status, joined_on, created_at) VALUES (?, ?, 'F', 'pending', '2026-10-06', ?)",
    );
    for (let i = 1; i <= 49; i++) insert.run(`Waiting ${i}`, `w${i}@example.com`, NOW.toISOString());
    expect((await ask({ name: "Fiftieth", email: "fifty@example.com", position: "F" })).status).toBe(200);
    const full = await ask({ name: "Fifty-first", email: "fiftyone@example.com", position: "F" });
    expect(full.status).toBe(429);
    w.db.raw.prepare("UPDATE members SET status = 'active' WHERE email = 'w1@example.com'").run();
    expect((await ask({ name: "Fifty-first", email: "fiftyone@example.com", position: "F" })).status).toBe(200);
  });
});
