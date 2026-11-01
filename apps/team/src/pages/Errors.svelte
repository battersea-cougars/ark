<script lang="ts">
  // The apps' recent errors, from Sentry (ADR 0110): each project's open issues in this environment, newest first,
  // each a link to it in Sentry. The server asks Sentry at most every few minutes, whoever opens this, so Refresh
  // shows what it last heard. Here in Settings → System rather than Dev tools, which production doesn't have.
  import { formatDayDate, formatTime, plural } from "../lib/dates";
  import { api } from "../app/api";
  import Icon from "../app/shell/Icon.svelte";
  import PageHeader from "../lib/PageHeader.svelte";

  interface Issue {
    id: string;
    shortId: string;
    title: string;
    culprit: string;
    count: number;
    users: number;
    level: string;
    firstSeen: string;
    lastSeen: string;
    link: string;
  }
  interface ProjectIssues {
    slug: string;
    name: string;
    issues: Issue[];
    more: boolean;
  }
  interface Errors {
    configured: boolean;
    unavailable?: "down" | "refused";
    environment: "production" | "dev";
    readAt: string | null;
    projects: ProjectIssues[];
  }

  let errors = $state<Errors | null>(null);
  let failed = $state("");
  let loading = $state(false);
  async function load() {
    loading = true;
    failed = "";
    try {
      errors = await api<Errors>("GET", "/api/sentry/issues");
    } catch (e) {
      failed = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }
  $effect(() => {
    load();
  });

  const n = (x: number) => x.toLocaleString("en-GB");
  const times = (x: number) => (x === 1 ? "once" : x === 2 ? "twice" : `${n(x)} times`);
  /** "Warning · 12 times, to 3 people": its level when it isn't an error, how often, and to how many */
  const about = (i: Issue) =>
    [
      i.level === "error" ? "" : i.level[0].toUpperCase() + i.level.slice(1),
      `${times(i.count)}${i.users ? `, to ${n(i.users)} ${i.users === 1 ? "person" : "people"}` : ""}`,
    ]
      .filter(Boolean)
      .join(" · ");
  /** "5 min ago", "3 hours ago", else the day and time */
  function when(iso: string) {
    const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    if (mins < 24 * 60) return `${plural(Math.round(mins / 60), "hour")} ago`;
    return `${formatDayDate(iso)}, ${formatTime(iso)}`;
  }
  /** Sentry's list of every open issue here, for a project with more than are shown. */
  const allOf = (p: ProjectIssues) => {
    const origin = p.issues[0] ? new URL(p.issues[0].link).origin : "https://battersea-cougars.sentry.io";
    return `${origin}/issues/?query=${encodeURIComponent("is:unresolved")}&environment=${errors?.environment}`;
  };
  const open = $derived(errors?.projects.reduce((sum, p) => sum + p.issues.length, 0) ?? 0);
</script>

<div class="page">
  <PageHeader title="Errors" subtitle="What's gone wrong lately in the team app and the website, from Sentry.">
    {#snippet actions()}
      <button class="btn sm ghost" onclick={load} disabled={loading}><Icon name="refresh" size={16} />Refresh</button>
    {/snippet}
  </PageHeader>

  {#if failed}
    <p class="error">{failed}</p>
  {:else if !errors}
    <p class="hint">Reading Sentry…</p>
  {:else if !errors.configured}
    <div class="panel pad note">
      <p><strong>Not set up yet.</strong></p>
      <p class="hint">
        The page reads Sentry with a read-only token. Make one in Sentry (a personal token with Issue &amp; Event: Read
        only), and store it in Secrets Manager as <code>SENTRY_ISSUES_TOKEN</code> (docs/secrets.md).
      </p>
    </div>
  {:else}
    {#if errors.unavailable === "refused"}
      <p class="hint warn">
        <Icon name="alert" size={16} />Sentry didn't accept the app's token. It needs Issue &amp; Event: Read
        (SENTRY_ISSUES_TOKEN, docs/secrets.md).
      </p>
    {:else if errors.unavailable}
      <p class="hint warn">
        <Icon name="alert" size={16} />Sentry can't be reached just now. Errors are still recorded there and emailed;
        this page tries again in a few minutes.
      </p>
    {/if}
    {#if errors.readAt}
      {#each errors.projects as p (p.slug)}
        <section class="project">
          <h2 class="section">{p.name}</h2>
          {#if p.issues.length}
            <div class="list">
              {#each p.issues as i (i.id)}
                <a class="row issue" href={i.link} target="_blank" rel="noopener noreferrer">
                  <span class="grow">
                    <span class="title">{i.title}</span>
                    {#if i.culprit}<span class="sub culprit">{i.culprit}</span>{/if}
                    <span class="sub num">{about(i)} · last <time datetime={i.lastSeen}>{when(i.lastSeen)}</time></span>
                  </span>
                  <Icon name="open" size={16} />
                </a>
              {/each}
            </div>
            {#if p.more}
              <a class="hint small more" href={allOf(p)} target="_blank" rel="noopener noreferrer"
                >The newest {p.issues.length} shown: the rest in Sentry</a
              >
            {/if}
          {:else}
            <p class="hint">Nothing open.</p>
          {/if}
        </section>
      {/each}
      <p class="hint small">
        {open ? `${n(open)} open` : "Nothing open"} in {errors.environment}, the last 14 days. Sentry said at
        {formatTime(errors.readAt)}; it's asked at most every 5 minutes. An issue fixed is resolved in Sentry, and drops
        off here.
      </p>
    {/if}
  {/if}
</div>

<style>
  .project {
    display: grid;
    gap: var(--s-3);
    margin-bottom: var(--s-6);
  }
  .section {
    margin: 0;
    font-size: var(--text-md);
  }
  p {
    margin: 0;
  }
  .hint.warn {
    margin-bottom: var(--s-4);
  }
  .issue {
    align-items: flex-start;
    color: inherit;
    text-decoration: none;
  }
  .issue :global(svg) {
    flex: none;
    margin-top: 0.2em;
    color: var(--fg-muted);
  }
  /* A title is often long (an error's message): two lines, then it trails off */
  .issue .title {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .culprit {
    font-size: var(--text-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .more {
    justify-self: start;
  }
  .note {
    display: grid;
    gap: var(--s-2);
  }
  .error {
    color: var(--red-hot);
  }
</style>
