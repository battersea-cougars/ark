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
    `CPU (workerd on this machine, D1's SQLite included): ${ms(usage.cpuMs)} ms all told, ${ms(usage.cpuMs / Math.max(1, requests.length))} ms a request (free plan: ${FREE.cpuMsPerRequest} ms a request, D1 not counted)`,
    `D1: ${usage.d1.queries} statements, ${usage.d1.rowsRead} rows read (${ms(usage.d1.rowsRead / Math.max(1, requests.length))} a request), ${usage.d1.rowsWritten} written`,
    `Share of a free day: requests ${share(requests.length, FREE.requestsPerDay)}, rows read ${share(usage.d1.rowsRead, FREE.rowsReadPerDay)}, rows written ${share(usage.d1.rowsWritten, FREE.rowsWrittenPerDay)}`,
  );
  if (stats.errors.size) lines.push("", "Errors:", ...[...stats.errors].map(([k, n]) => `  ${n} × ${k}`));
  if (usage.notes?.length) lines.push("", ...usage.notes);
  return lines.join("\n");
}

const share = (n, of) => `${((100 * n) / of).toFixed(1)}%`;
