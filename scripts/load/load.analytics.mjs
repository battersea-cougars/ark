// Cloudflare's own numbers for a load run against dev (docs/load-testing.md, "Against dev"): the team Worker's
// requests, errors and CPU time, D1's rows read and written, and the live hub's requests, for the run's window, from
// the GraphQL Analytics API (as the Usage page reads the day's, worker/settings/usage.ts); CPU by route from Workers
// Logs (scripts/cpu-by-route.mjs). Read with CLOUDFLARE_ANALYTICS_TOKEN (read-only, dev's, from env-pull). The
// figures are the whole account's for the window: anyone else using dev then, and the crons, are in them too.
import { cpuByRoute, cpuTable } from "../cpu-by-route.mjs";
import { FREE } from "./load.report.mjs";

const QUERY = `query ($account: String!, $from: Time!, $to: Time!) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      workers: workersInvocationsAdaptive(limit: 100, filter: { datetime_geq: $from, datetime_leq: $to }) {
        sum { requests errors subrequests }
        quantiles { cpuTimeP50 cpuTimeP90 cpuTimeP99 }
        dimensions { scriptName status }
      }
      d1: d1AnalyticsAdaptiveGroups(limit: 100, filter: { datetimeMinute_geq: $from, datetimeMinute_leq: $to }) {
        sum { readQueries writeQueries rowsRead rowsWritten }
        dimensions { databaseId }
      }
      live: durableObjectsInvocationsAdaptiveGroups(limit: 100, filter: { datetimeMinute_geq: $from, datetimeMinute_leq: $to }) {
        sum { requests }
      }
    }
  }
}`;

/** Cloudflare's numbers between `from` and `to` (Dates) for the `team` Worker and the database `databaseId`. */
export async function usageBetween({ account, token, databaseId, from, to }) {
  const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { account, from: from.toISOString(), to: to.toISOString() } }),
  });
  const body = await res.json().catch(() => ({}));
  const a = body.data?.viewer?.accounts?.[0];
  if (!a) throw new Error(`Cloudflare analytics: ${res.status} ${JSON.stringify(body.errors ?? body)}`);
  const team = (a.workers ?? []).filter((w) => w.dimensions.scriptName === "team");
  const d1 = (a.d1 ?? []).filter((d) => d.dimensions.databaseId === databaseId);
  const sum = (rows, pick) => rows.reduce((n, r) => n + (pick(r) ?? 0), 0);
  return {
    requests: sum(team, (w) => w.sum.requests),
    errors: sum(team, (w) => w.sum.errors),
    subrequests: sum(team, (w) => w.sum.subrequests),
    /** Requests by how they ended: success, exceededResources (over the CPU limit), clientDisconnected… */
    byStatus: Object.fromEntries(team.map((w) => [w.dimensions.status, w.sum.requests])),
    /** CPU ms (Cloudflare gives µs) of the busiest status's quantiles, by status. */
    cpuMs: Object.fromEntries(
      team.map((w) => [
        w.dimensions.status,
        { p50: w.quantiles.cpuTimeP50 / 1000, p90: w.quantiles.cpuTimeP90 / 1000, p99: w.quantiles.cpuTimeP99 / 1000 },
      ]),
    ),
    readQueries: sum(d1, (d) => d.sum.readQueries),
    writeQueries: sum(d1, (d) => d.sum.writeQueries),
    rowsRead: sum(d1, (d) => d.sum.rowsRead),
    rowsWritten: sum(d1, (d) => d.sum.rowsWritten),
    liveRequests: sum(a.live ?? [], (o) => o.sum.requests),
  };
}

/** Today's use so far (the free allowance resets at 00:00 UTC). */
export const usageToday = (auth, now = new Date()) =>
  usageBetween({ ...auth, from: new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`), to: now });

const pct = (n, of) => `${((100 * n) / of).toFixed(1)}%`;

/** The run's window as Cloudflare saw it, as text, with CPU by route (a sample) when Workers Logs answers. */
export async function cloudflareReport(auth, from, to) {
  const u = await usageBetween({ ...auth, from, to });
  const cpu = Object.entries(u.cpuMs)
    .map(([status, q]) => `${status} p50 ${q.p50.toFixed(1)} / p90 ${q.p90.toFixed(1)} / p99 ${q.p99.toFixed(1)} ms`)
    .join("; ");
  const lines = [
    "",
    `Cloudflare, ${from.toISOString()} to ${to.toISOString()} (the whole dev account: the crons and anyone else on dev too)`,
    `Worker "team": ${u.requests} requests (${Object.entries(u.byStatus)
      .map(([k, n]) => `${k} ${n}`)
      .join(", ")}), ${u.errors} errors, ${u.subrequests} subrequests`,
    `CPU a request: ${cpu || "none"} (free plan: ${FREE.cpuMsPerRequest} ms; exceededResources is a request stopped for it)`,
    `D1 ${auth.databaseName ?? ""}: ${u.readQueries} reads, ${u.writeQueries} writes, ${u.rowsRead} rows read (${pct(u.rowsRead, FREE.rowsReadPerDay)} of a free day), ${u.rowsWritten} written (${pct(u.rowsWritten, FREE.rowsWrittenPerDay)})`,
    `Live hub: ${u.liveRequests} Durable Object requests (${pct(u.liveRequests, FREE.doRequestsPerDay)})`,
  ];
  try {
    const rows = await cpuByRoute({ ...auth, token: auth.logsToken ?? auth.token, from: +from, to: +to });
    lines.push("", "CPU by route (Workers Logs, up to 2,000 invocations of the window):", cpuTable(rows.slice(0, 25)));
  } catch (e) {
    lines.push("", `CPU by route: not read (${e.message})`);
  }
  return { usage: u, text: lines.join("\n") };
}
