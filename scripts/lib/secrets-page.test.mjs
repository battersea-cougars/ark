// Handing a secret over on the Secrets page (#149): the real handler on a real local server, Bitwarden faked.
import { createServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fingerprint } from "./secret-shapes.mjs";
import { refused, secretsPage } from "./secrets-page.mjs";

const TOKEN = "page-token";
const CLIENT_SECRET = `GOCSPX-${"a1B2c3D4e5".repeat(2)}abcdEFGH`;

/** A Bitwarden that keeps secrets in a Map, and can be locked. */
function fakeBitwarden() {
  const store = new Map([["GMAIL_REFRESH_TOKEN", { value: `1//0${"x".repeat(50)}`, updated: "2026-10-20T10:00:00Z" }]]);
  return {
    store,
    locked: false,
    list() {
      if (this.locked) throw new Error("No Bitwarden token. Run bw-unlock");
      return [...store].map(([key, s]) => ({ key, value: s.value, project: "cougars-dev", updated: s.updated }));
    },
    set(name, value) {
      if (this.locked) throw new Error(`bws failed: rejected ${value}`);
      const had = store.has(name);
      store.set(name, { value, updated: "2026-10-24T12:00:00Z" });
      return had ? "Updated" : "Created";
    },
    reconnect() {
      this.locked = false;
    },
  };
}

const NAMES = [
  { name: "GMAIL_REFRESH_TOKEN", system: "Google", env: "both", used: "email" },
  { name: "GMAIL_WEB_CLIENT_SECRET", system: "Google", env: "both", used: "email" },
  { name: "BACKUP_KEY__PRODUCTION", system: "Us", env: "prod", used: "backups" },
];

let server, base, bitwarden, logged, restarted;
beforeEach(async () => {
  bitwarden = fakeBitwarden();
  logged = [];
  restarted = 0;
  const serve = secretsPage({
    bitwarden,
    names: () => NAMES,
    restart: async () => (restarted++, [{ name: "main web and team", ok: true }]),
    log: (line) => logged.push(line),
    token: TOKEN,
  });
  server = createServer(serve);
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  base = `http://localhost:${server.address().port}`;
});
afterEach(() => new Promise((done) => server.close(done)));

const call = (path, body, headers = {}) =>
  fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      "x-secrets-token": TOKEN,
      origin: base,
      ...(body && { "content-type": "application/json" }),
      ...headers,
    },
    body: body && JSON.stringify(body),
  });
const json = async (path, body, headers) => {
  const r = await call(path, body, headers);
  return { status: r.status, ...(await r.json()) };
};

describe("handing a secret over", () => {
  it("opens the page, uncached, with nothing a password manager or another site can use", async () => {
    const r = await call("/__secrets");
    const html = await r.text();
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("content-security-policy")).toMatch(/frame-ancestors 'none'/);
    expect(html).toMatch(/type="password" autocomplete="new-password"/);
    expect(html).not.toMatch(/<form/);
  });

  it("lists every documented name, and what Bitwarden holds as a fingerprint only", async () => {
    const a = await json("/__secrets/list");
    expect(a.bitwarden).toEqual({ ok: true, count: 1 });
    expect(a.secrets.map((s) => s.name)).toEqual(NAMES.map((n) => n.name));
    const stored = a.secrets[0];
    expect(stored.stored).toEqual({
      ...fingerprint(bitwarden.store.get("GMAIL_REFRESH_TOKEN").value),
      updated: "2026-10-20T10:00:00Z",
    });
    expect(JSON.stringify(a)).not.toContain(bitwarden.store.get("GMAIL_REFRESH_TOKEN").value);
    expect(a.secrets[1].stored).toBeNull();
    expect(a.secrets[2].project).toBe("cougars");
  });

  it("stores a pasted value in Bitwarden and answers with its fingerprint, never the value", async () => {
    const a = await json("/__secrets/save", { name: "GMAIL_WEB_CLIENT_SECRET", value: `  ${CLIENT_SECRET}\n` });
    expect(a).toMatchObject({ ok: true, result: "Created", project: "cougars-dev", ...fingerprint(CLIENT_SECRET) });
    expect(JSON.stringify(a)).not.toContain(CLIENT_SECRET);
    expect(bitwarden.store.get("GMAIL_WEB_CLIENT_SECRET").value).toBe(CLIENT_SECRET);
    expect(logged).toEqual(["secrets: GMAIL_WEB_CLIENT_SECRET created in cougars-dev"]);
  });

  it("warns before saving a value that doesn't look like the secret, and saves it when asked to anyway", async () => {
    const wrong = await json("/__secrets/save", { name: "GMAIL_WEB_CLIENT_SECRET", value: "not-a-client-secret" });
    expect(wrong.status).toBe(422);
    expect(wrong.warnings.join(" ")).toMatch(/GOCSPX-/);
    expect(bitwarden.store.has("GMAIL_WEB_CLIENT_SECRET")).toBe(false);
    const anyway = await json("/__secrets/save", {
      name: "GMAIL_WEB_CLIENT_SECRET",
      value: "not-a-client-secret",
      anyway: true,
    });
    expect(anyway.ok).toBe(true);
  });

  it("only stores names the page offers", async () => {
    const a = await json("/__secrets/save", { name: "SOMETHING_ELSE", value: "x" });
    expect(a.status).toBe(400);
    expect(bitwarden.store.has("SOMETHING_ELSE")).toBe(false);
  });

  it("says Bitwarden is locked, lists the names anyway, and reconnects", async () => {
    bitwarden.locked = true;
    const locked = await json("/__secrets/list");
    expect(locked.bitwarden.ok).toBe(false);
    expect(locked.secrets).toHaveLength(3);
    const again = await json("/__secrets/reconnect", {});
    expect(again).toMatchObject({ ok: true, bitwarden: { ok: true } });
  });

  it("keeps the value out of an error that echoes it", async () => {
    bitwarden.locked = true;
    const a = await json("/__secrets/save", { name: "GMAIL_WEB_CLIENT_SECRET", value: CLIENT_SECRET });
    expect(a.status).toBe(502);
    expect(a.error).toBe("bws failed: rejected [the value]");
    expect(logged).toEqual(["secrets: GMAIL_WEB_CLIENT_SECRET not saved"]);
  });

  it("restarts the apps after a change, when asked", async () => {
    const a = await json("/__secrets/restart", {});
    expect(a).toMatchObject({ ok: true, apps: [{ name: "main web and team", ok: true }] });
    expect(restarted).toBe(1);
  });
});

describe("only for this machine", () => {
  it("refuses a call without the page's token, or from another site", async () => {
    expect((await json("/__secrets/list", undefined, { "x-secrets-token": "guess" })).status).toBe(403);
    const other = await json(
      "/__secrets/save",
      { name: "GMAIL_WEB_CLIENT_SECRET", value: CLIENT_SECRET },
      { origin: "http://evil.example" },
    );
    expect(other.status).toBe(403);
    expect(bitwarden.store.has("GMAIL_WEB_CLIENT_SECRET")).toBe(false);
  });

  it("refuses a form post (not JSON)", async () => {
    const r = await call("/__secrets/save", undefined, {});
    expect(r.status).toBe(404); // a GET of a POST route
    const form = await fetch(base + "/__secrets/save", {
      method: "POST",
      headers: { "x-secrets-token": TOKEN, origin: base, "content-type": "application/x-www-form-urlencoded" },
      body: "name=GMAIL_WEB_CLIENT_SECRET&value=x",
    });
    expect(form.status).toBe(415);
  });

  it("answers loopback at localhost only", () => {
    const req = (remoteAddress, host, extra = {}) => ({
      socket: { remoteAddress },
      headers: { host, ...extra },
      method: "GET",
    });
    expect(refused(req("127.0.0.1", "localhost:4500"))).toBeUndefined();
    expect(refused(req("::ffff:127.0.0.1", "127.0.0.1:4500"))).toBeUndefined();
    expect(refused(req("172.18.0.3", "localhost:4500"))).toMatch(/this machine/);
    expect(refused(req("127.0.0.1", "rebind.example:4500"))).toMatch(/localhost/);
  });
});
