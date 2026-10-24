// The show switch's two pages (ADR 0115; the third, /__secrets, is secrets-page.mjs): the holding page a public port answers with while the shown app isn't
// answering (it looks again every 2 s), and the control page at /__app on each public port.

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const STYLE = `:root{color-scheme:dark;--ink:#ecebe6;--dim:#a19f97;--line:#2b2a27;--accent:#f7d117;--bad:#ff6b5b;--ok:#6fdc8c}
body{margin:0;min-height:100vh;background:#131211;color:var(--ink);font:14px/1.5 system-ui,sans-serif}
h1{margin:0 0 6px;font:700 15px system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--accent)}
p{margin:0;color:var(--dim)}a{color:var(--accent)}
pre{margin:14px 0 0;padding:12px;background:#1b1a18;max-height:45vh;overflow:auto;white-space:pre-wrap;font:12px/1.45 ui-monospace,monospace;color:var(--dim)}`;

/** While the shown app starts, fails or isn't answering. */
export function holdingPage({ title, detail, log }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="2"><title>${esc(title)}</title>
<style>${STYLE}body{display:grid;place-items:center}main{width:min(40rem,calc(100vw - 32px));padding:20px 0}</style></head>
<body><main><h1>${esc(title)}</h1><p>${esc(detail)}</p>${log ? `<pre>${esc(log)}</pre>` : ""}
<p style="margin-top:14px"><a href="/__app">Checkouts: show, restart, logs →</a></p></main></body></html>`;
}

/** Every checkout, which one the ports show, each app's state and log, with Show, Restart and Stop. */
export function panelPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cougars apps</title>
<style>${STYLE}
main{max-width:60rem;margin:0 auto;padding:20px 16px}
.sub{margin:0 0 16px}.busy{color:var(--accent)}
.co{padding:12px 14px;background:#1b1a18;margin-bottom:10px;border-radius:6px}
.co.shown{box-shadow:inset 3px 0 0 var(--accent)}
.head{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.name{font-weight:700;overflow-wrap:anywhere}.tag{color:var(--accent);font-size:12px;text-transform:uppercase;letter-spacing:.06em}
.app{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:6px;font-size:13px;color:var(--dim);cursor:pointer}
.app.sel .svc{color:var(--ink);text-decoration:underline}
.svc{min-width:5.5rem}.up{color:var(--ok)}.failed{color:var(--bad)}.starting,.down{color:var(--accent)}
.grow{flex:1}
button{font:600 12px system-ui,sans-serif;color:var(--ink);background:#2b2a27;border:0;border-radius:4px;padding:5px 10px;cursor:pointer}
button.main{background:var(--accent);color:#131211}button:disabled{opacity:.4;cursor:wait}
</style></head><body><main>
<h1>Cougars apps</h1>
<p class="sub" id="sub"></p>
<p class="sub"><a href="/__secrets">Secrets: hand one to Bitwarden, check what's there →</a></p>
<div id="list"></div>
<pre id="log"></pre>
</main><script>
let sel = null, busy = "", msg = "";
const esc = ${esc.toString()};
async function load() {
  const s = await (await fetch("/__app/status", { cache: "no-store" })).json();
  const apps = s.checkouts.flatMap((c) => c.apps.map((a) => ({ ...a, dir: c.dir, key: c.dir + "#" + a.service })));
  if (!sel || !apps.some((a) => a.key === sel)) sel = (apps.find((a) => a.shown) ?? apps[0])?.key ?? null;
  const ports = Object.entries(s.ports).map(([k, p]) => '<a href="//' + location.hostname + ":" + p + '/">' + p + "</a> " + k).join(", ");
  document.getElementById("sub").innerHTML = "The ports " + ports + " show the checkout marked. " + '<span class="busy">' + esc(busy || msg) + "</span>";
  document.getElementById("list").innerHTML = s.checkouts.map((c) => \`
    <div class="co \${c.shown ? "shown" : ""}" data-dir="\${esc(c.dir)}">
      <div class="head"><span class="name">\${esc(c.name)}</span>\${c.shown ? '<span class="tag">shown</span>' : ""}\${c.ownDb ? '<span class="tag">own D1</span>' : ""}
        <span class="grow"></span>
        <button class="main" data-act="show" \${c.shown || busy ? "disabled" : ""}>Show</button>
        \${c.apps.length ? \`<button data-act="restart" \${busy ? "disabled" : ""}>Restart</button><button data-act="stop" \${busy ? "disabled" : ""}>Stop</button>\` : ""}</div>
      \${c.apps.map((a) => \`<div class="app \${c.dir + "#" + a.service === sel ? "sel" : ""}" data-key="\${esc(c.dir + "#" + a.service)}" data-service="\${a.service}">
        <span class="svc">\${a.label}</span><span class="\${a.state}">\${a.state}</span><span>port \${a.port}</span><span>idle \${a.idle}m</span>
        \${a.note ? "<span>" + esc(a.note) + "</span>" : ""}<span class="grow"></span>
        <button data-act="restart" \${busy ? "disabled" : ""}>Restart</button><button data-act="stop" \${busy ? "disabled" : ""}>Stop</button></div>\`).join("")}
    </div>\`).join("");
  const app = apps.find((a) => a.key === sel);
  const log = document.getElementById("log");
  const atEnd = log.scrollTop + log.clientHeight >= log.scrollHeight - 4;
  log.textContent = app ? app.label + ", " + app.dir + "\\n\\n" + app.log : "";
  if (atEnd) log.scrollTop = log.scrollHeight;
}
document.getElementById("list").addEventListener("click", async (e) => {
  const co = e.target.closest(".co"), row = e.target.closest(".app"), act = e.target.closest("button")?.dataset.act;
  if (!co) return;
  if (row) sel = row.dataset.key;
  if (!act) return load();
  const q = "dir=" + encodeURIComponent(co.dataset.dir) + (row ? "&service=" + row.dataset.service : "");
  busy = act + ": " + co.querySelector(".name").textContent + (row ? " " + row.dataset.service : "") + "…";
  await load();
  try {
    const r = await (await fetch("/__app/" + act + "?" + q, { method: "POST" })).json();
    msg = r.ok === false ? (r.error ?? "it didn't come up") : "";
  } finally {
    busy = "";
    await load();
  }
});
load();
setInterval(() => void load().catch(() => {}), 2000);
</script></body></html>`;
}
