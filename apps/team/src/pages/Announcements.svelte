<script lang="ts">
  // More → Announcements (#85, ADR 0107): everything the club has said, newest first, a page at a time, with who
  // posted it, when it ran and whether you said "Got it". One still on can be got here too; whoever may post can take
  // one that's still on down from its row (it may be gone from their own Home). Read when the page opens.
  import { can } from "../access/actions";
  import Icon from "../app/shell/Icon.svelte";
  import PageHeader from "../lib/PageHeader.svelte";
  import EmptyState from "../lib/EmptyState.svelte";
  import { granted } from "../demo/session.svelte";
  import { formatDayDate, londonToday } from "../lib/dates";
  import {
    dismissAnnouncement,
    pastAnnouncements,
    removeAnnouncement,
    type PastAnnouncement,
  } from "../app/backend.svelte";
  import { slide } from "svelte/transition";
  import { prefersReducedMotion } from "../app/motion";

  const poster = $derived(can(granted(), "post:Announcement"));
  const today = londonToday();

  let items = $state<PastAnnouncement[]>([]);
  let more = $state(false);
  let loading = $state(true);
  let error = $state("");

  async function load(before?: number) {
    loading = true;
    error = "";
    try {
      const page = await pastAnnouncements(before);
      items = before ? [...items, ...page.announcements] : page.announcements;
      more = page.more;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }
  $effect(() => {
    void load();
  });

  const on = (a: PastAnnouncement) => a.endsOn >= today;
  const day = (ymd: string) => formatDayDate(`${ymd}T12:00:00Z`);
  const when = (a: PastAnnouncement) =>
    [formatDayDate(a.createdAt), a.by, on(a) ? `on until ${day(a.endsOn)}` : `ended ${day(a.endsOn)}`]
      .filter(Boolean)
      .join(" · ");

  async function gotIt(a: PastAnnouncement) {
    a.gotIt = true;
    if ((await dismissAnnouncement(a.id)) === null) a.gotIt = false;
  }
  async function takeDown(a: PastAnnouncement) {
    if ((await removeAnnouncement(a.id)) !== null) items = items.filter((x) => x.id !== a.id);
  }
</script>

<div class="page fit">
  <PageHeader title="Announcements" subtitle="Everything the club's said, newest first, and whether you got it." />

  {#if error}
    <p class="error">{error}</p>
  {:else if !items.length}
    {#if loading}
      <p class="hint">Reading back…</p>
    {:else}
      <EmptyState icon="megaphone" title="Quiet so far">When the club says something, it's here.</EmptyState>
    {/if}
  {:else}
    <ol class="list scroll-fill">
      {#each items as a (a.id)}
        <li class="row note" out:slide={{ duration: prefersReducedMotion ? 0 : 240 }}>
          <span class="glyph" class:on={on(a)}><Icon name="megaphone" size={18} /></span>
          <div class="grow">
            <span class="title">{a.title}</span>
            {#if a.body}<span class="body">{a.body}</span>{/if}
            <span class="sub">{when(a)}</span>
            {#if a.link || (poster && on(a))}
              <span class="links">
                {#if a.link}<a href={a.link} target="_blank" rel="noopener noreferrer">Read more</a>{/if}
                {#if poster && on(a)}<button class="link" onclick={() => takeDown(a)}>Take down</button>{/if}
              </span>
            {/if}
          </div>
          <!-- The same room either way, so getting one moves nothing -->
          <span class="status">
            {#if a.gotIt}
              <span class="badge green"><Icon name="check" size={14} />Got it</span>
            {:else if on(a)}
              <button class="btn outline sm" aria-label="Got it: {a.title}" onclick={() => gotIt(a)}>Got it</button>
            {:else}
              <span class="badge">Missed it</span>
            {/if}
          </span>
        </li>
      {/each}
      {#if more}
        <li class="row earlier">
          <button class="btn ghost sm" onclick={() => load(items[items.length - 1].id)} disabled={loading}>
            {loading ? "Reading…" : "Earlier"}
          </button>
        </li>
      {/if}
    </ol>
  {/if}
</div>

<style>
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
    /* Rows keep their full height (they wrap); the list scrolls instead of squeezing them */
    grid-auto-rows: max-content;
  }
  .note {
    align-items: flex-start;
  }
  .note .glyph {
    margin-top: 0.15rem;
  }
  /* Still on: the loudhailer in the brand's red, as on Home */
  .note .glyph.on {
    color: var(--red-hot);
  }
  /* The title and its line wrap: they're what the club said, all of it */
  .note .title {
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .body {
    display: block;
    margin-top: var(--s-1);
    color: var(--fg-body);
    line-height: 1.45;
    overflow-wrap: anywhere;
  }
  .note .sub {
    margin-top: var(--s-1);
  }
  .links {
    display: flex;
    gap: var(--s-4);
    margin-top: var(--s-2);
    font-size: var(--text-sm);
  }
  .links a {
    color: var(--fg);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .status {
    flex-shrink: 0;
    display: flex;
    justify-content: flex-end;
    min-width: 5.5rem;
  }
  .earlier {
    justify-content: center;
  }
</style>
