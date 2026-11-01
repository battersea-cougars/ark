#!/usr/bin/env node
// CPU time per route, from Workers Logs, for finding what makes the Usage page's CPU figures high (ADR 0059), and for
// a load run against dev (scripts/load/load.analytics.mjs, the run's window).
//   node scripts/env-pull.mjs -- node scripts/cpu-by-route.mjs [hours]      (dev; default the last 24 hours)
// Needs Workers Observability Read on CLOUDFLARE_ANALYTICS_TOKEN (docs/secrets.md#cloudflare_analytics_token__dev; dev only).
// On a quiet Worker most requests start it cold, so expect higher figures than a busy one gives. Workers Logs gives
// at most 2,000 invocations a query: a busy window's figures are a sample of it.
import { pathToFileURL } from "node:url";

/** Each Worker and route's invocations, p50 and max CPU ms, between `from` and `to` (ms), busiest first. */
export async function cpuByRoute({ account, token, from, to }) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/workers/observability/telemetry/query`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        queryId: "cpu-by-route",
        timeframe: { from, to },
        view: "invocations",
        limit: 2000,
        parameters: {},
      }),
    },
  );
  const body = await res.json();
  if (!body.success) throw new Error(`Cloudflare said ${res.status}: ${JSON.stringify(body.errors)}`);

  // One row per Worker and route, ids folded so /api/members/4 and /api/members/6 count together
  const routes = new Map();
  for (const events of Object.values(body.result?.invocations ?? {})) {
    const w = (events.find((e) => e.$workers?.cpuTimeMs != null) ?? events[0]).$workers ?? {};
    if (w.cpuTimeMs == null) continue;
    const url = w.event?.request?.url;
    const path = url ? new URL(url).pathname.replace(/\/\d+(?=\/|$)/g, "/:id") : `(${w.eventType})`;
    const key = `${w.scriptName} ${path}`;
    routes.set(key, [...(routes.get(key) ?? []), w.cpuTimeMs]);
  }
  const rows = [...routes].map(([key, ms]) => {
    ms.sort((a, b) => a - b);
    return { key, n: ms.length, p50: ms[Math.floor(ms.length / 2)], max: ms.at(-1) };
  });
  return rows.sort((a, b) => b.p50 * b.n - a.p50 * a.n);
}

/** The table, as text. */
export const cpuTable = (rows) =>
  [
    "requests  p50 ms  max ms  route",
    ...rows.map(
      (r) => `${String(r.n).padStart(8)}  ${String(r.p50).padStart(6)}  ${String(r.max).padStart(6)}  ${r.key}`,
    ),
  ].join("\n");

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_ANALYTICS_TOKEN: token } = process.env;
  if (!account || !token) {
    console.error("Run through env-pull: node scripts/env-pull.mjs -- node scripts/cpu-by-route.mjs");
    process.exit(2);
  }
  const hours = Number(process.argv[2] ?? 24);
  const to = Date.now();
  try {
    console.log(cpuTable(await cpuByRoute({ account, token, from: to - hours * 3600_000, to })));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
