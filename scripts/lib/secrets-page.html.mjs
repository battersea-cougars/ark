// The Secrets page's HTML (#149; its handler is secrets-page.mjs). No <form>: nothing is submitted, so a value never
// reaches the address bar, the history or a password manager's "save this?"; each field is cleared once used. The Check
// box never sends anything: it hashes the pasted value in the browser and compares fingerprints.
import { FINGERPRINT_HEX, shapeWarnings } from "./secret-shapes.mjs";

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

const STYLE = `:root{color-scheme:dark;--ink:#ecebe6;--dim:#a19f97;--panel:#1b1a18;--field:#262522;--accent:#f7d117;--bad:#ff6b5b;--ok:#6fdc8c}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:#131211;color:var(--ink);font:14px/1.5 system-ui,sans-serif}
main{max-width:60rem;margin:0 auto;padding:20px 16px 48px}
h1{margin:0 0 6px;font:700 15px system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--accent)}
h2{margin:0 0 10px;font:700 12px system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}
p{margin:0;color:var(--dim)}a{color:var(--accent)}
.top{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;justify-content:space-between;margin-bottom:6px}
.lede{margin-bottom:18px;max-width:46rem}
.box{background:var(--panel);border-radius:6px;padding:14px;margin-bottom:12px}
.grid{display:grid;grid-template-columns:7rem 1fr;gap:10px 12px;align-items:center}
@media (max-width:560px){.grid{grid-template-columns:1fr}}
label{color:var(--dim);font-size:13px}
select,input[type=password]{width:100%;font:14px ui-monospace,monospace;color:var(--ink);background:var(--field);border:0;border-radius:4px;padding:8px 10px}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.row>input{flex:1;min-width:12rem}
button{font:600 12px system-ui,sans-serif;color:var(--ink);background:#2b2a27;border:0;border-radius:4px;padding:7px 12px;cursor:pointer}
button.main{background:var(--accent);color:#131211}button:disabled{opacity:.4;cursor:wait}
.about{font-size:13px;min-height:1.5em}
.note{min-height:1.5em;font-size:13px}.ok{color:var(--ok)}.bad{color:var(--bad)}.warn{color:var(--accent)}
ul.warns{margin:0;padding-left:18px;color:var(--accent);font-size:13px}
.list{display:grid;gap:2px}
.item{display:grid;grid-template-columns:minmax(0,1fr) 3.5rem minmax(0,19rem) 6.5rem;gap:10px;padding:7px 10px;border-radius:4px;cursor:pointer;font-size:13px}
.item:hover,.item.sel{background:var(--field)}
.item .n{font-family:ui-monospace,monospace;overflow-wrap:anywhere}.item .e,.item .d{color:var(--dim)}
.item .f{font-family:ui-monospace,monospace;color:var(--dim);overflow-wrap:anywhere}
@media (max-width:560px){.item{grid-template-columns:1fr auto}.item .f,.item .d{grid-column:1/-1}}
.hidden{display:none}`;

/** The page's script, bar its token: the fields, Save, Restart, Reconnect, and Check (hashed here, never sent). */
const CLIENT = `const esc = ${esc.toString()};
const shapeWarnings = ${shapeWarnings.toString()};
const $ = (id) => document.getElementById(id);
let rows = [], fromFile = null;

async function api(path, body) {
  const init = { method: body ? "POST" : "GET", cache: "no-store", headers: { "x-secrets-token": TOKEN } };
  if (body) Object.assign(init, { body: JSON.stringify(body), headers: { ...init.headers, "content-type": "application/json" } });
  const r = await fetch("/__secrets/" + path, init);
  return r.json();
}
const current = () => rows.find((r) => r.name === $("name").value);
const printed = (s) => s ? s.length + " characters" + (s.last4 ? " · …" + s.last4 : "") + " · sha " + s.sha : "not in Bitwarden";
const day = (iso) => iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" }) : "";
const value = () => (fromFile ?? $("value").value).trim();

function show(answer) {
  const bw = answer.bitwarden;
  $("bw").className = "note " + (bw.ok ? "ok" : "bad");
  $("bw").textContent = bw.ok ? "Bitwarden: ✓ connected, " + bw.count + " secrets" : "Bitwarden: ✗ " + bw.error;
  rows = answer.secrets;
  const keep = $("name").value;
  $("name").innerHTML = rows.map((r) => '<option value="' + esc(r.name) + '">' + esc(r.name) + "</option>").join("");
  if (rows.some((r) => r.name === keep)) $("name").value = keep;
  render();
}
function render() {
  const r = current();
  $("about").textContent = r ? [r.project && "project " + r.project, r.env, r.used, !r.documented && "not in docs/secrets.md", printed(r.stored)].filter(Boolean).join(" · ") : "";
  $("list").innerHTML = rows.map((x) => '<div class="item' + (r && x.name === r.name ? " sel" : "") + '" data-name="' + esc(x.name) + '">' +
    '<span class="n">' + esc(x.name) + '</span><span class="e">' + esc(x.env ?? "") + '</span><span class="f">' + esc(printed(x.stored)) +
    '</span><span class="d">' + esc(day(x.stored?.updated)) + "</span></div>").join("");
  warn();
}
function warn() {
  const v = value(), r = current();
  $("warns").innerHTML = v && r ? shapeWarnings(r.name, v).map((w) => "<li>" + esc(w) + "</li>").join("") : "";
}
function clear() {
  $("value").value = "";
  fromFile = null;
  $("file").value = "";
  $("loaded").textContent = "";
  warn();
}

$("name").addEventListener("change", () => { clear(); $("checked").textContent = ""; render(); });
$("list").addEventListener("click", (e) => {
  const item = e.target.closest(".item");
  if (!item) return;
  $("name").value = item.dataset.name;
  clear();
  render();
  $("value").focus();
});
$("value").addEventListener("input", () => { fromFile = null; $("loaded").textContent = ""; warn(); });
$("pick").addEventListener("click", () => $("file").click());
$("file").addEventListener("change", async () => {
  const f = $("file").files[0];
  if (!f) return;
  fromFile = await f.text();
  $("value").value = "";
  $("loaded").textContent = f.name + " read: " + fromFile.trim().length + " characters (not shown).";
  $("file").value = "";
  warn();
});

$("save").addEventListener("click", async () => {
  const r = current(), v = value();
  if (!r) return;
  if (!v) return void ($("saved").textContent = "Paste a value first.");
  if (r.project === "cougars" && !confirm(r.name + " is production's. Save it?")) return;
  const warnings = shapeWarnings(r.name, v);
  if (warnings.length && !confirm("It doesn't look right:\\n\\n" + warnings.join("\\n") + "\\n\\nSave it anyway?")) return;
  $("save").disabled = true;
  $("saved").className = "note warn";
  $("saved").textContent = "Saving " + r.name + "…";
  try {
    const a = await api("save", { name: r.name, value: v, anyway: warnings.length > 0 });
    if (!a.ok) throw new Error(a.error ?? (a.warnings ?? []).join(" "));
    clear();
    $("saved").className = "note ok";
    $("saved").textContent = "✓ " + a.name + " " + a.result.toLowerCase() + " in " + a.project + " at " + day(a.at) + ": " + printed(a) + ". The apps read it when they start.";
    $("restart").classList.remove("hidden");
    show(await api("list"));
  } catch (e) {
    $("saved").className = "note bad";
    $("saved").textContent = "✗ Not saved: " + e.message;
  } finally {
    $("save").disabled = false;
  }
});

$("restart").addEventListener("click", async () => {
  $("restart").disabled = true;
  $("saved").className = "note warn";
  $("saved").textContent = "Restarting the apps that read secrets…";
  try {
    const a = await api("restart", {});
    const apps = a.apps ?? [];
    $("saved").className = "note " + (apps.every((x) => x.ok) ? "ok" : "bad");
    $("saved").textContent = apps.length ? apps.map((x) => (x.ok ? "✓ " : "✗ ") + x.name).join(", ") + " restarted with the new secrets." : "No app was running.";
    $("restart").classList.add("hidden");
  } finally {
    $("restart").disabled = false;
  }
});

$("reconnect").addEventListener("click", async () => {
  $("bw").className = "note";
  $("bw").textContent = "Bitwarden: reading the token from your vault again…";
  const a = await api("reconnect", {});
  if (a.ok) show(a);
  else ($("bw").className = "note bad"), ($("bw").textContent = "Bitwarden: ✗ " + a.error + " (run bw-unlock, then Reconnect)");
});

async function sha(v) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, HEX);
}
$("compare").addEventListener("click", async () => {
  const r = current(), v = $("check").value.trim();
  $("check").value = "";
  if (!r || !v) return;
  if (!r.stored) return void (($("checked").className = "note bad"), ($("checked").textContent = r.name + " isn't in Bitwarden yet."));
  const same = (await sha(v)) === r.stored.sha;
  $("checked").className = "note " + (same ? "ok" : "bad");
  $("checked").textContent = same ? "✓ Matches " + r.name + " in Bitwarden." : "✗ Different from " + r.name + " in Bitwarden (" + printed(r.stored) + ").";
});

api("list").then(show, (e) => ($("bw").textContent = "Bitwarden: ✗ " + e.message));
`;

/** The page, with this load's script nonce and API token. */
export function secretsPageHtml({ nonce, token }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><title>Cougars secrets</title><style nonce="${nonce}">${STYLE}</style></head>
<body><main>
<div class="top"><h1>Secrets</h1><span class="row"><span id="bw" class="note">Bitwarden: asking…</span><button id="reconnect">Reconnect</button></span></div>
<p class="lede">Hand a secret straight to Bitwarden Secrets Manager. The value goes from this page to Bitwarden and nowhere
else: never to a file, a log or a terminal, and never back here. A stored value shows only as its length, last 4 characters
and the start of its SHA-256. <a href="/__app">Apps →</a></p>

<section class="box" aria-labelledby="store-h"><h2 id="store-h">Store</h2>
<div class="grid">
  <label for="name">Secret</label><select id="name"></select>
  <span></span><p id="about" class="about"></p>
  <label for="value">Value</label>
  <span class="row"><input id="value" type="password" autocomplete="new-password" spellcheck="false" autocapitalize="off"
    data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" placeholder="Paste it here">
  <button id="pick">From a file…</button><input id="file" class="hidden" type="file"></span>
  <span></span><div><p id="loaded" class="note"></p><ul id="warns" class="warns"></ul></div>
  <span></span><span class="row"><button id="save" class="main">Save to Bitwarden</button><button id="restart" class="hidden">Restart the apps</button></span>
  <span></span><p id="saved" class="note" role="status"></p>
</div></section>

<section class="box" aria-labelledby="check-h"><h2 id="check-h">Check</h2>
<div class="grid">
  <label for="check">Same value?</label>
  <span class="row"><input id="check" type="password" autocomplete="off" spellcheck="false" autocapitalize="off"
    data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" placeholder="Paste the provider's value to compare">
  <button id="compare">Check</button></span>
  <span></span><p id="checked" class="note" role="status">Compared here in the browser: nothing is sent.</p>
</div></section>

<section class="box" aria-labelledby="list-h"><h2 id="list-h">Every secret</h2><div id="list" class="list"></div></section>
</main><script nonce="${nonce}">
const TOKEN = ${JSON.stringify(token)};
const HEX = ${FINGERPRINT_HEX};
${CLIENT}</script></body></html>`;
}
