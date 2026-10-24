<script lang="ts">
  // Settings → Website (#107): where the club's website is managed from the app. Studio changes go live at the next
  // rebuild: every morning, after a tournament result, or now, with Rebuild now (the same rebuild, sent at once,
  // ADR 0100). The Studio links here, and this page links to the Studio and the site. Refresh photos and videos (#109)
  // makes the website read YouTube and Instagram again at once, instead of within ten minutes.
  import { api } from "../app/api";
  import Icon from "../app/shell/Icon.svelte";
  import PageHeader from "../lib/PageHeader.svelte";
  import { formatDayDate, formatTime } from "../lib/dates";

  interface Status {
    lastRebuildAt: string | null;
    rebuildWanted: boolean;
    mediaRefreshedAt: string | null;
    canRebuild: boolean;
    siteUrl: string;
    studioUrl: string;
  }
  type Rebuilt = Status & { result: "sent" | "failed" | "recent" | "not-here" };

  let status = $state<Status | null>(null);
  let error = $state("");
  let rebuilding = $state(false);
  let rebuilt = $state<{ ok: boolean; text: string } | null>(null);

  async function load() {
    error = "";
    try {
      status = await api<Status>("GET", "/api/website");
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  void load();

  const when = (iso: string) => `${formatDayDate(iso)}, ${formatTime(iso)}`;

  function rebuildSaid({ result, lastRebuildAt }: Rebuilt) {
    switch (result) {
      case "sent":
        return { ok: true, text: "On its way: the website shows your changes in about five minutes." };
      case "recent":
        return {
          ok: true,
          text: `Already rebuilding${lastRebuildAt ? ` since ${formatTime(lastRebuildAt)}` : ""}: changes published before then are in it. Try again in a few minutes for any since.`,
        };
      case "not-here":
        return { ok: false, text: "This copy of the app doesn't rebuild the website (it's on a laptop)." };
      default:
        return { ok: false, text: "GitHub couldn't be reached. It's kept, and tried again within five minutes." };
    }
  }

  let refreshing = $state(false);
  let refreshed = $state<{ ok: boolean; text: string } | null>(null);

  async function refreshMedia() {
    refreshing = true;
    refreshed = null;
    try {
      status = await api<Status>("POST", "/api/website/refresh-media", {});
      refreshed = { ok: true, text: "Done: the website shows the newest photos and videos within a minute." };
    } catch (e) {
      refreshed = { ok: false, text: e instanceof Error ? e.message : String(e) };
    } finally {
      refreshing = false;
    }
  }

  async function rebuild() {
    rebuilding = true;
    rebuilt = null;
    try {
      const reply = await api<Rebuilt>("POST", "/api/website/rebuild", {});
      rebuilt = rebuildSaid(reply);
      status = reply;
    } catch (e) {
      rebuilt = { ok: false, text: e instanceof Error ? e.message : String(e) };
    } finally {
      rebuilding = false;
    }
  }
</script>

<div class="page">
  <PageHeader title="Website" subtitle="What's on the club's website, and putting Studio changes live." />
  {#if error}<p class="error">{error}</p>{/if}

  {#if status === null}
    {#if !error}<p class="hint">Reading…</p>{/if}
  {:else}
    <section class="part">
      <h2 class="section-title">Put Studio changes live</h2>
      <p class="hint">
        What you publish in the Studio (Fridays, the pub, the club, the team, the Kumite, sponsors) goes live when the
        website rebuilds: every morning by itself, or now. A rebuild takes about five minutes.
      </p>
      <dl class="facts">
        <dt>Last rebuilt from here</dt>
        <dd>
          {status.lastRebuildAt ? when(status.lastRebuildAt) : "Not yet: only the morning rebuilds so far"}
          {#if status.rebuildWanted}<br /><span class="hint">Another is waiting to go, within five minutes.</span>{/if}
        </dd>
      </dl>
      <div>
        <button class="btn primary" onclick={rebuild} disabled={rebuilding || !status.canRebuild}>
          <Icon name="refresh" size={16} />{rebuilding ? "Asking…" : "Rebuild now"}
        </button>
      </div>
      <!-- Room kept for the answer, so nothing moves when it comes -->
      <p class="said" class:ok={rebuilt?.ok} role="status">
        {#if rebuilt}<Icon name={rebuilt.ok ? "check" : "alert"} size={18} />{rebuilt.text}{/if}
      </p>
    </section>

    <section class="part">
      <h2 class="section-title">Refresh photos and videos</h2>
      <p class="hint">
        A video added to a playlist on YouTube, or a post on Instagram, is on the website within ten minutes by itself.
        To show it now, refresh: it needs no rebuild.
      </p>
      <dl class="facts">
        <dt>Last refreshed</dt>
        <dd>{status.mediaRefreshedAt ? when(status.mediaRefreshedAt) : "Not yet"}</dd>
      </dl>
      <div>
        <button class="btn" onclick={refreshMedia} disabled={refreshing}>
          <Icon name="refresh" size={16} />{refreshing ? "Refreshing…" : "Refresh photos and videos"}
        </button>
      </div>
      <p class="said" class:ok={refreshed?.ok} role="status">
        {#if refreshed}<Icon name={refreshed.ok ? "check" : "alert"} size={18} />{refreshed.text}{/if}
      </p>
    </section>

    <section class="part">
      <h2 class="section-title">Where each part comes from</h2>
      <dl class="facts">
        <dt>The Studio</dt>
        <dd>Fridays, the pub, the club, the team, the Kumite, sponsors: live at the next rebuild</dd>
        <dt>This app</dt>
        <dd>What's on (at once), the roster and results (at the next rebuild; a result asks for one by itself)</dd>
        <dt>YouTube</dt>
        <dd>Videos, from the club's playlists, within ten minutes (at once with a refresh)</dd>
        <dt>Instagram</dt>
        <dd>Photos, the newest posts, within ten minutes (at once with a refresh)</dd>
      </dl>
      <div class="links">
        <a class="btn" href={status.studioUrl} target="_blank" rel="noopener noreferrer">
          <Icon name="open" size={16} /> Open the Studio
        </a>
        <a class="btn" href={status.siteUrl} target="_blank" rel="noopener noreferrer">
          <Icon name="open" size={16} /> Open the website
        </a>
      </div>
    </section>
  {/if}
</div>

<style>
  .part {
    display: grid;
    gap: var(--s-2);
    margin-bottom: var(--s-6);
  }
  .part .section-title,
  .part .hint {
    margin: 0;
  }
  .facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--s-2) var(--s-4);
    margin: 0;
  }
  .facts dt {
    color: var(--fg-muted);
  }
  .facts dd {
    margin: 0;
    min-width: 0;
    color: var(--fg);
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .btn {
    gap: var(--s-1);
  }
  .said {
    display: flex;
    align-items: flex-start;
    gap: var(--s-2);
    margin: 0;
    min-height: 3em;
  }
  .said.ok {
    color: var(--fg);
  }
  .error {
    color: var(--red-hot);
  }
  @media (max-width: 30rem) {
    .facts {
      grid-template-columns: 1fr;
      gap: var(--s-1);
    }
    .facts dd {
      margin-bottom: var(--s-2);
    }
  }
</style>
