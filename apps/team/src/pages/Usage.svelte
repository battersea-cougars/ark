<script lang="ts">
  // The club's free Cloudflare allowance today (ADR 0059): one account runs the website, this app and their
  // database, and its daily limits reset at midnight UTC. If one runs out, this app stops until then; the hourly
  // check emails the admins at 80%. Each Worker's CPU time per request is shown against the free plan's 10 ms, past
  // which Cloudflare stops the request (ADR 0059). Below them, this month's Sanity requests as we count them, since
  // Sanity has no usage API (ADR 0059). Read when the page opens, and again on Refresh.
  import { api } from "../app/api";
  import Icon from "../app/shell/Icon.svelte";
  import PageHeader from "../lib/PageHeader.svelte";
  import { can } from "../access/actions";
  import { granted } from "../demo/session.svelte";
  import { db } from "../demo/store.svelte";
  import { saveSettings } from "../app/backend.svelte";
  import { everyHowOften } from "../lib/live-updates.svelte";

  interface Metric {
    id: string;
    label: string;
    used: number;
    limit: number;
  }
  interface WorkerCpu {
    name: string;
    p50Ms: number;
    p99Ms: number;
    stopped: number;
  }
  interface Usage {
    configured: boolean;
    unavailable?: boolean;
    day: string;
    resetsAt: string;
    metrics: Metric[];
    cpu?: { limitMs: number; workers: WorkerCpu[] };
    backup: { takenAt: string; why: string; bytes: number } | null;
    sanity: SanityUsage;
  }
  interface SanityQuota extends Metric {
    projected: number;
  }
  interface SanityUsage {
    project: string;
    name: string;
    month: string;
    resetsAt: string;
    quotas: SanityQuota[];
  }
  const SANITY_ABOUT: Record<string, string> = {
    api: "Straight to Sanity, uncached. Our reads all go through its CDN, so this should stay near nothing.",
    cdn: "The website's reads: a few per build, and its live pages, at most once a minute each.",
  };

  const ABOUT: Record<string, string> = {
    requests: "Every time this app talks to the server. The website's pages are free and don't count.",
    rowsRead: "Rows the app and the website's live pages read from the club's database.",
    rowsWritten: "Sign-ups, picks, saves: every change made.",
    liveRequests: "Phones opening a live page's stream, and changes sent down them (ADR 0072).",
    liveTime: "How long the live hub was up today, at 128 MB a second. A 2-hour draft night is about 900.",
  };

  let usage = $state<Usage | null>(null);
  let error = $state("");
  let loading = $state(false);
  async function load() {
    loading = true;
    error = "";
    try {
      usage = await api<Usage>("GET", "/api/usage");
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }
  $effect(() => {
    load();
  });

  // How often live pages check for updates when their stream is down (ADR 0072): a game being scored, the
  // tournament's home on the day, the draft room. Each check is a request, so it's set here, beside what's left of
  // the day
  const CHOICES = [5, 10, 15, 30, 60];
  const canSet = $derived(can(granted(), "manage:Settings"));
  const seconds = $derived(db.settings.liveRefreshSeconds);
  // A tournament day, roughly: 30 phones on a live page for 4 hours
  const tournamentDay = $derived(Math.round((30 * 4 * 3600) / seconds));
  const requestLimit = $derived(usage?.metrics.find((m) => m.id === "requests")?.limit ?? 100_000);
  async function choose(s: number) {
    if (s !== seconds) await saveSettings({ liveRefreshSeconds: s });
  }

  const pct = (m: Metric) => Math.min(100, Math.round((m.used / m.limit) * 100));
  const level = (m: Metric) => (pct(m) >= 80 ? "high" : pct(m) >= 50 ? "mid" : "low");
  const n = (x: number) => x.toLocaleString("en-GB");
  const cpuPct = (w: WorkerCpu, limit: number) => Math.min(100, Math.round((w.p99Ms / limit) * 100));
  const cpuLevel = (w: WorkerCpu, limit: number) =>
    w.stopped || w.p99Ms >= limit * 0.8 ? "high" : w.p99Ms >= limit * 0.5 ? "mid" : "low";
  // Nightly, so a day and a half without one means the backup job has stopped (ADR 0106)
  const STALE_MS = 36 * 3600_000;
  const backedUp = $derived(
    usage?.backup
      ? new Intl.DateTimeFormat("en-GB", {
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/London",
        }).format(new Date(usage.backup.takenAt))
      : "",
  );
  // When Sanity's quotas reset: midnight UTC on the 1st
  const sanityResets = $derived(
    usage?.sanity
      ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(
          new Date(usage.sanity.resetsAt),
        )
      : "",
  );
  const stale = $derived(!usage?.backup || Date.now() - Date.parse(usage.backup.takenAt) > STALE_MS);
  const resets = $derived(
    usage
      ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }).format(
          new Date(usage.resetsAt),
        )
      : "",
  );
</script>

<div class="page">
  <PageHeader title="Usage" subtitle="The club runs on Cloudflare's free plan. Today's use, against its daily limits.">
    {#snippet actions()}
      <button class="btn sm" onclick={load} disabled={loading}><Icon name="undo" size={16} />Refresh</button>
    {/snippet}
  </PageHeader>

  {#if error}
    <p class="error">{error}</p>
  {:else if !usage}
    <p class="hint">Reading Cloudflare…</p>
  {:else if !usage.configured}
    <div class="panel pad note">
      <p><strong>Not set up yet.</strong></p>
      <p class="hint">
        The page reads Cloudflare's analytics with a read-only token. Create one in Cloudflare (Account Analytics:
        Read), and store it in Secrets Manager as <code>CLOUDFLARE_ANALYTICS_TOKEN</code> (docs/secrets.md).
      </p>
    </div>
  {:else if usage.unavailable}
    <p class="hint">Cloudflare's analytics can't be read right now. Try Refresh in a minute.</p>
  {:else}
    <div class="meters">
      {#each usage.metrics as m, i (m.id)}
        <section class="meter rise" style:animation-delay="{i * 60}ms">
          <div class="top">
            <h2>{m.label}</h2>
            <span class="pct num {level(m)}">{pct(m)}%</span>
          </div>
          <div
            class="bar"
            role="meter"
            aria-label={m.label}
            aria-valuemin={0}
            aria-valuemax={m.limit}
            aria-valuenow={m.used}
          >
            <span class="fill {level(m)}" style:width="{pct(m)}%"></span>
          </div>
          <p class="num">{n(m.used)} <span class="hint">of {n(m.limit)}</span></p>
          <p class="hint small">{ABOUT[m.id]}</p>
        </section>
      {/each}
    </div>
    {#if usage.cpu?.workers.length}
      {@const limit = usage.cpu.limitMs}
      <h2 class="section">CPU time per request</h2>
      <p class="hint small">
        Cloudflare stops a request that computes for more than {limit} ms. Waiting for the database or another service doesn't
        count.
      </p>
      <div class="meters">
        {#each usage.cpu.workers as w (w.name)}
          <section class="meter">
            <div class="top">
              <h2>{w.name}</h2>
              <span class="pct num {cpuLevel(w, limit)}">{w.p99Ms} ms</span>
            </div>
            <div
              class="bar"
              role="meter"
              aria-label="{w.name}, slowest CPU time"
              aria-valuemin={0}
              aria-valuemax={limit}
              aria-valuenow={w.p99Ms}
            >
              <span class="fill {cpuLevel(w, limit)}" style:width="{cpuPct(w, limit)}%"></span>
            </div>
            <p class="num">{w.p50Ms} ms <span class="hint">typical, {w.p99Ms} ms slowest 1 in 100</span></p>
            {#if w.stopped}
              <p class="high small">{n(w.stopped)} stopped today for going over {limit} ms</p>
            {/if}
          </section>
        {/each}
      </div>
    {/if}
    <p class="hint">
      Resets at {resets} (midnight UTC). If anything reaches its limit, this app stops working until then; the admins get
      an email at 80%.
    </p>
  {/if}

  {#if usage?.sanity}
    <!-- Sanity's monthly quotas (ADR 0059): our own count, as Sanity has no usage API -->
    <section class="live">
      <h2 class="section">Sanity this month</h2>
      <p class="hint small">
        The website's content is in Sanity ({usage.sanity.name}), on its free plan. Sanity doesn't share its count, so
        the website and this app count their own requests. The Studio's aren't counted (nor by Sanity), and neither are
        builds or dev servers on a laptop.
      </p>
      <div class="meters">
        {#each usage.sanity.quotas as q (q.id)}
          <section class="meter">
            <div class="top">
              <h2>{q.label}</h2>
              <span class="pct num {level(q)}">{pct(q)}%</span>
            </div>
            <div
              class="bar"
              role="meter"
              aria-label="Sanity {q.label}"
              aria-valuemin={0}
              aria-valuemax={q.limit}
              aria-valuenow={q.used}
            >
              <span class="fill {level(q)}" style:width="{pct(q)}%"></span>
            </div>
            <p class="num">{n(q.used)} <span class="hint">of {n(q.limit)}</span></p>
            <p class="small" class:hint={q.projected <= q.limit} class:high={q.projected > q.limit}>
              On pace for {n(q.projected)} by {sanityResets}{q.projected > q.limit ? ": more than the allowance" : ""}
            </p>
            <p class="hint small">{SANITY_ABOUT[q.id]}</p>
          </section>
        {/each}
      </div>
      <p class="hint small">
        Resets on {sanityResets} (midnight UTC). If one runs out, Sanity refuses until then: the website's builds fail and
        its live pages fall back. The admins get an email at 50% and 80%, and when the pace would run out; at 90% of the CDN's,
        the website's live pages stop reading Sanity so the builds keep the rest. Sanity's own figures are on sanity.io/manage.
      </p>
    </section>
  {/if}

  {#if usage}
    <!-- The database's backups (ADR 0106): nightly, kept for 90 days as GitHub artifacts -->
    <section class="live">
      <h2 class="section">Backups</h2>
      {#if usage.backup}
        <p class:high={stale}>
          Last backed up {backedUp} ({usage.backup.why}), {n(Math.round(usage.backup.bytes / 1024))} KB.
        </p>
      {:else}
        <p class="high">Not backed up yet.</p>
      {/if}
      <p class="hint small">
        Every night, and before a deploy changes the database, it's copied, sealed with the club's backup key and kept
        for 90 days in GitHub (Actions, Back up).{stale
          ? " More than a day without one means that job has stopped."
          : ""}
      </p>
    </section>
  {/if}

  <!-- Live updates: how often, and what it costs the free day -->
  <section class="live">
    <h2 class="section">Live updates</h2>
    <p class="hint small">
      A game being scored, the tournament's home on the day, and the draft room hear about changes as they happen, from
      the live hub. When a phone's stream is down it checks for changes {everyHowOften()} instead. Every check from every
      phone is a request against the free daily allowance: faster feels more live, slower lasts the day.
    </p>
    {#if canSet}
      <div class="choices" role="radiogroup" aria-label="Check for updates every">
        {#each CHOICES as c (c)}
          <button
            class="btn sm"
            class:primary={c === seconds}
            class:outline={c !== seconds}
            role="radio"
            aria-checked={c === seconds}
            onclick={() => choose(c)}>{c < 60 ? `${c}s` : `${c / 60} min`}</button
          >
        {/each}
      </div>
    {/if}
    <p class="hint small">
      Without its stream, a phone on a live page makes {n(Math.round(3600 / seconds))} requests an hour. A tournament day
      of that, say 30 phones for 4 hours, is about {n(tournamentDay)}: {Math.round(
        (tournamentDay / requestLimit) * 100,
      )}% of the {n(requestLimit)} a day. On a paid plan, faster costs nothing extra to speak of.
    </p>
  </section>
</div>

<style>
  .live {
    display: grid;
    gap: var(--s-3);
    margin-top: var(--s-6);
  }
  .live .section {
    margin: 0;
  }
  .live p {
    margin: 0;
  }
  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .meters {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
    gap: var(--s-3);
    margin-bottom: var(--s-4);
  }
  .meter {
    display: grid;
    gap: var(--s-2);
    padding: var(--s-4);
    border-radius: var(--r-lg);
    background: var(--surface-1);
  }
  .top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .pct {
    font-size: 1.5rem;
    font-weight: 700;
  }
  .bar {
    height: 0.5rem;
    overflow: hidden;
    border-radius: 999px;
    background: var(--surface-2);
  }
  .fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    transition: width var(--t-slow) var(--ease);
  }
  .low {
    color: var(--green-ink);
  }
  .fill.low {
    background: var(--green);
  }
  .mid {
    color: var(--caution-ink);
  }
  .fill.mid {
    background: var(--caution);
  }
  .high {
    color: var(--red-hot);
  }
  .fill.high {
    background: var(--red-hot);
  }
  p {
    margin: 0;
  }
  .section {
    margin-bottom: var(--s-1);
    font-size: var(--text-md);
  }
  .note {
    display: grid;
    gap: var(--s-2);
  }
  .error {
    color: var(--red-hot);
  }
</style>
