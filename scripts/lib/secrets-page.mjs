// The Secrets page (#149, docs/secrets.md "Handing a secret over"): at /__secrets on the show switch's ports, where
// you hand a secret straight to Bitwarden Secrets Manager and check what's there. A value goes from the page to
// Bitwarden in this process's memory and nowhere else: never to a file, a log or a terminal, and never back to the
// page, which only ever sees a stored value's fingerprint (length, last 4, the start of its SHA-256).
//
// Only for this machine: a request must come from loopback and name localhost (no other host, no DNS rebinding);
// every API call must carry the page's own token, as JSON from the page's own origin.
import { randomBytes, randomUUID } from "node:crypto";
import { secretsPageHtml } from "./secrets-page.html.mjs";
import { fingerprint, shapeWarnings } from "./secret-shapes.mjs";
import { projectFor } from "./bitwarden.mjs";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const MAX_BODY = 256 * 1024;

const HEADERS = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

/**
 * The page's handler for every /__secrets request.
 * - `bitwarden`: { list() → [{ key, value, project, updated }], set(name, value) → "Created" | "Updated", reconnect() }
 * - `names()`: the documented names (secret-names.mjs)
 * - `restart()`: starts the apps that read secrets again; resolves to [{ name, ok }]
 * - `log(line)`: the supervisor's log; it only ever gets a name and what happened
 */
export function secretsPage({
  bitwarden,
  names,
  restart,
  log = () => {},
  token = randomBytes(24).toString("base64url"),
}) {
  const routes = {
    "GET /__secrets/list": () => list(bitwarden, names),
    "POST /__secrets/save": (body) => save(bitwarden, names, body, log),
    "POST /__secrets/restart": async () => ({ ok: true, apps: await restart() }),
    "POST /__secrets/reconnect": () => reconnect(bitwarden, names),
  };
  return async function serve(req, res) {
    const why = refused(req);
    if (why) return send(res, 403, { ok: false, error: why });
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "GET" && (path === "/__secrets" || path === "/__secrets/")) return page(res);
    const route = routes[`${req.method} ${path}`];
    if (!route) return send(res, 404, { ok: false, error: "no such page" });
    if (req.headers["x-secrets-token"] !== token) return send(res, 403, { ok: false, error: "reload the page" });
    if (req.method === "POST" && !String(req.headers["content-type"]).startsWith("application/json"))
      return send(res, 415, { ok: false, error: "JSON only" });
    let body = {};
    try {
      if (req.method === "POST") body = await readJson(req);
    } catch {
      return send(res, 400, { ok: false, error: "not JSON, or too big" });
    }
    const { status = 200, ...answer } = await route(body);
    send(res, status, answer);
  };

  function page(res) {
    const nonce = randomUUID();
    res.writeHead(200, {
      ...HEADERS,
      "content-type": "text/html; charset=utf-8",
      "content-security-policy":
        `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; ` +
        "form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
    });
    res.end(secretsPageHtml({ nonce, token }));
  }
}

/** Why a request isn't served, if it isn't: only this machine, only at localhost, writes only from the page itself. */
export function refused(req) {
  if (!LOOPBACK.has(req.socket?.remoteAddress ?? "")) return "The Secrets page only answers this machine.";
  const host = req.headers.host ?? "";
  if (!LOCAL_HOST.test(host)) return "Open it at localhost.";
  if (req.method === "GET") return undefined;
  if (req.headers.origin !== `http://${host}`) return "Only the page itself can do that.";
  return undefined;
}

function send(res, status, body) {
  res.writeHead(status, { ...HEADERS, "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) return (req.destroy(), reject(new Error("too big")));
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

// ---- what the page asks ----------------------------------------------------------------------------------------

/** Every name, documented or stored, with each stored one's fingerprint; and whether Bitwarden answers. */
function list(bitwarden, names) {
  const documented = names();
  let stored = [];
  let connected = { ok: true };
  try {
    stored = bitwarden.list();
  } catch (e) {
    connected = { ok: false, error: plain(e) };
  }
  const byName = new Map(stored.map((s) => [s.key, s]));
  const rows = documented.map((d) => ({ ...d, documented: true }));
  for (const s of stored) if (!documented.some((d) => d.name === s.key)) rows.push({ name: s.key, documented: false });
  return {
    bitwarden: { ...connected, count: stored.length },
    secrets: rows.map((row) => {
      const s = byName.get(row.name);
      return {
        ...row,
        project: projectOf(row.name),
        stored: s ? { ...fingerprint(s.value), updated: s.updated } : null,
      };
    }),
  };
}

/** Stores one value: a name the page offers, a value that looks right (or `anyway`). Answers with its fingerprint. */
function save(bitwarden, names, body, log) {
  const name = String(body.name ?? "");
  const value = typeof body.value === "string" ? body.value.trim() : "";
  if (!offered(bitwarden, names, name))
    return { status: 400, ok: false, error: `${name || "That"} isn't a secret here.` };
  if (!value) return { status: 400, ok: false, error: "Paste a value first." };
  const warnings = shapeWarnings(name, value);
  if (warnings.length && body.anyway !== true) return { status: 422, ok: false, warnings };
  try {
    const result = bitwarden.set(name, value);
    log(`secrets: ${name} ${result.toLowerCase()} in ${projectFor(name)}`);
    return { ok: true, name, result, project: projectFor(name), at: new Date().toISOString(), ...fingerprint(value) };
  } catch (e) {
    log(`secrets: ${name} not saved`);
    return { status: 502, ok: false, error: plain(e, value) };
  }
}

function reconnect(bitwarden, names) {
  try {
    bitwarden.reconnect();
  } catch (e) {
    return { status: 502, ok: false, error: plain(e) };
  }
  return { ok: true, ...list(bitwarden, names) };
}

function offered(bitwarden, names, name) {
  if (names().some((d) => d.name === name)) return true;
  try {
    return bitwarden.list().some((s) => s.key === name);
  } catch {
    return false;
  }
}

const projectOf = (name) => {
  try {
    return projectFor(name);
  } catch {
    return "";
  }
};

/** An error as one line for the page, with the value taken out should a tool ever have echoed it. */
function plain(e, value) {
  const line = String(e?.message ?? e).split("\n")[0];
  return value ? line.split(value).join("[the value]") : line;
}
