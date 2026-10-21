// What a load run found (docs/load-testing.md): each kind of request's latency (p50/p95/p99) and errors, the Worker's
// CPU per request (workerd's own, on this machine), and D1's rows read and written, against the Workers Free plan.

/** The free plan's limits (ADR 0003). */
export const FREE = {
  cpuMsPerRequest: 10,
  subrequests: 50,
  requestsPerDay: 100_000,
  rowsReadPerDay: 5_000_000,
  rowsWrittenPerDay: 100_000,
  doRequestsPerDay: 100_000,
};

const pct = (sorted, p) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0;
const ms = (n) => (n >= 100 ? n.toFixed(0) : n.toFixed(1));

/** One row per kind of request: how many, p50/p95/p99 in ms, and errors (no answer, or 5xx/429). */
export function latencies(stats) {
  return stats.labels().map((label) => {
    const rows = stats.rows.filter((r) => r.label === label);
    const times = rows.map((r) => r.ms).sort((a, b) => a - b);
    const errors = rows.filter((r) => r.status === 0 || r.status >= 500 || r.status === 429).length;
    const refused = rows.filter((r) => r.status >= 400 && r.status < 500 && r.status !== 429).length;
    return { label, n: rows.length, p50: pct(times, 50), p95: pct(times, 95), p99: pct(times, 99), errors, refused };
  });
}

/** The run's report, as text. `usage`: the Worker requests made, CPU ms and D1 rows across the run. */
export function report(name, stats, usage) {
  const lines = [`\n${name}`, "─".repeat(name.length)];
  const rows = latencies(stats);
  const w = Math.max(...rows.map((r) => r.label.length), 10);
  lines.push(`${"request".padEnd(w)}      n    p50    p95    p99  errors  refused`);
  for (const r of rows) {
    if (r.label === "live: event") {
      lines.push(`${r.label.padEnd(w)} ${String(r.n).padStart(6)}  (events heard)`);
      continue;
    }
    lines.push(
      `${r.label.padEnd(w)} ${String(r.n).padStart(6)} ${ms(r.p50).padStart(6)} ${ms(r.p95).padStart(6)} ${ms(r.p99).padStart(6)} ${String(r.errors).padStart(7)} ${String(r.refused).padStart(8)}`,
    );
  }
  const requests = stats.rows.filter((r) => !r.label.startsWith("live: event") && r.label !== "live: change to screen");
  const errors = requests.filter((r) => r.status === 0 || r.status >= 500 || r.status === 429).length;
  lines.push(
    "",
    `Worker requests: ${requests.length}, errors ${errors} (${((100 * errors) / Math.max(1, requests.length)).toFixed(2)}%), over ${usage.seconds.toFixed(1)} s`,
  );
  // A local Worker's own counters; against dev, Cloudflare's numbers follow the report (load.analytics.mjs)
  if (usage.d1)
    lines.push(
      `CPU (workerd on this machine, D1's SQLite included): ${ms(usage.cpuMs)} ms all told, ${ms(usage.cpuMs / Math.max(1, requests.length))} ms a request (free plan: ${FREE.cpuMsPerRequest} ms a request, D1 not counted)`,
      `D1: ${usage.d1.queries} statements, ${usage.d1.rowsRead} rows read (${ms(usage.d1.rowsRead / Math.max(1, requests.length))} a request), ${usage.d1.rowsWritten} written`,
      `Share of a free day: requests ${share(requests.length, FREE.requestsPerDay)}, rows read ${share(usage.d1.rowsRead, FREE.rowsReadPerDay)}, rows written ${share(usage.d1.rowsWritten, FREE.rowsWrittenPerDay)}`,
    );
  else lines.push(`Share of a free day: requests ${share(requests.length, FREE.requestsPerDay)}`);
  if (usage.oneAddress) lines.push(...addressLines(stats));
  const statuses = {};
  for (const r of requests) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
  lines.push(
    `Answers by status: ${Object.entries(statuses)
      .map(([k, n]) => `${k === "0" ? "none" : k} ${n}`)
      .join(", ")}`,
  );
  if (stats.errors.size) lines.push("", "Errors:", ...[...stats.errors].map(([k, n]) => `  ${n} × ${k}`));
  if (usage.notes?.length) lines.push("", ...usage.notes);
  return lines.join("\n");
}

const share = (n, of) => `${((100 * n) / of).toFixed(1)}%`;

/** The API's limit for one address (apps/team/worker/api/api.limits.ts) and the domain's rule (ratelimit-setup.mjs). */
export const ADDRESS_LIMITS = [
  { name: "the API's 600 a minute an address (api.limits.ts, #113)", limit: 600, seconds: 60 },
  { name: "the domain's 150 in 10 s an address (ratelimit-setup.mjs, #57)", limit: 150, seconds: 10 },
];

/**
 * The run's requests as production's per-address limits would count them if they all came from one address (the
 * rink's wifi; against dev they do: this machine). Counted as the API's limiter counts, in fixed windows of the
 * clock: each request at the moment it was sent; over the limit, a request would have been a 429. Dev itself can't
 * say: on *.workers.dev the Cache API the limiter counts in does nothing, and the domain's rule is production's
 * (ADR 0055).
 */
export function addressLimits(stats) {
  const sent = stats.rows
    .filter((r) => r.label !== "live: event" && r.label !== "live: change to screen")
    .map((r) => stats.startedAt + r.at - r.ms);
  return ADDRESS_LIMITS.map(({ name, limit, seconds }) => {
    const windows = new Map();
    for (const t of sent) {
      const w = Math.floor(t / 1000 / seconds);
      windows.set(w, (windows.get(w) ?? 0) + 1);
    }
    const counts = [...windows.values()];
    const over = counts.reduce((n, c) => n + Math.max(0, c - limit), 0);
    return {
      name,
      limit,
      seconds,
      peak: Math.max(0, ...counts),
      windowsOver: counts.filter((c) => c > limit).length,
      windows: counts.length,
      refused: over,
      requests: sent.length,
    };
  });
}

/** The per-address lines of a report. */
export const addressLines = (stats) => [
  "",
  "If every request came from one address (production's limits; dev enforces neither):",
  ...addressLimits(stats).map(
    (l) =>
      `  ${l.name}: peak ${l.peak} in ${l.seconds} s; over it in ${l.windowsOver} of ${l.windows} windows, ` +
      `${l.refused} of ${l.requests} requests (${share(l.refused, Math.max(1, l.requests))}) would have been 429s`,
  ),
  `  429s actually received: ${stats.rows.filter((r) => r.status === 429).length}`,
];
