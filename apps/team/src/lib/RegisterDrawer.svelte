<script lang="ts">
  import { goesBy, matchesName, shortName } from "./names";
  import { MEMBERS, type Player } from "../demo/data";
  import { nextSession, resolve, seriesById, sessionBookable } from "../demo/schedule.svelte";
  import { granted } from "../demo/session.svelte";
  import { can } from "../access/actions";
  import Icon from "../app/shell/Icon.svelte";
  import Drawer from "./Drawer.svelte";
  import Person from "./Person.svelte";
  import { formatDayDate } from "./dates";
  import { letIn, markHere } from "../app/backend.svelte";
  import { roomFor } from "./places";

  // The register for the night, in a drawer over the training page: every active member, sign-ups first and
  // already ticked, everyone else below to tick as they walk in. Search narrows the list. Ticks are written to the
  // session: a walk-in joins its sign-ups (so the page counts them in), a no-show stays signed up but marked. Adding
  // someone keeps to the places (ADR 0131): on a full night they wait, and the team maker lets them in, right here.
  let { seriesId, open = $bindable(false) }: { seriesId: number; open?: boolean } = $props();

  const series = $derived(seriesById(seriesId)!);
  const session = $derived(nextSession(series));
  const when = $derived(session ? formatDayDate(sessionBookable(session).startsAt) : "No session coming up");
  // The night's places: the skaters', keepers' counted apart (lib/places.ts)
  const limits = $derived(session ? resolve(session, series) : { capacity: null });
  const going = $derived(session?.going ?? []);
  const waitlist = $derived(session?.waitlist ?? []);
  const walkIns = $derived(session?.walkIns ?? []);
  const noShows = $derived(session?.noShows ?? []);
  // Full for skaters; a keeper may still have a place
  const full = $derived(!roomFor(0, going, limits, () => false));
  // Who's playing over the limit is the team maker's call (ADR 0076)
  const letting = $derived(can(granted(), "publish:Teams"));
  const here = (id: number) => going.includes(id) && !noShows.includes(id);
  const waiting = (id: number) => waitlist.includes(id);
  let search = $state("");

  const active = $derived(
    MEMBERS.filter((m) => m.status === "active")
      .map((m) => m.player)
      .sort((a, b) => goesBy(a).localeCompare(goesBy(b))),
  );
  const found = (p: Player) => search.length < 2 || matchesName(p, search);
  // Walk-ins stay where they were ticked, under everyone else, so the list doesn't jump under your finger: waiting
  // too, badged where they are
  const signedUpIds = $derived(going.filter((id) => !walkIns.includes(id)));
  const signedUp = $derived(
    signedUpIds.map((id) => active.find((p) => p.id === id)).filter((p): p is Player => !!p && found(p)),
  );
  const others = $derived(active.filter((p) => !signedUpIds.includes(p.id) && found(p)));

  function toggle(p: Player) {
    const s = session;
    const id = p.id;
    if (!s) return;
    if (signedUpIds.includes(id)) {
      // Signed up: a tap marks a no-show, or takes it back
      void markHere(s.id, id, !here(id));
      s.noShows = noShows.includes(id) ? noShows.filter((x) => x !== id) : [...noShows, id];
    } else if (walkIns.includes(id)) {
      // Added here by mistake (in or waiting): off the session again
      void markHere(s.id, id, false);
      s.going = s.going.filter((x) => x !== id);
      s.waitlist = s.waitlist.filter((x) => x !== id);
      s.walkIns = walkIns.filter((x) => x !== id);
    } else if (waiting(id)) {
      // Signed up and waiting: they keep their place in the queue until a place comes up or they're let in
      void markHere(s.id, id, true, shortName(p));
    } else {
      // Turned up without signing up: in if there's room, else on the waiting list for the team maker to let in.
      // (A Quarterly Member may take someone's place: the server's reply puts the lists right.)
      void markHere(s.id, id, true, shortName(p));
      if (!roomFor(id, going, limits)) s.waitlist = [...s.waitlist, id];
      else s.going = [...s.going, id];
      s.out = s.out?.filter((x) => x !== id);
      s.walkIns = [...walkIns, id];
    }
  }

  // The team maker lets someone waiting in, over the limit (ADR 0076)
  function admit(p: Player) {
    const s = session;
    if (!s || !waiting(p.id)) return;
    s.waitlist = s.waitlist.filter((x) => x !== p.id);
    s.going = [...s.going, p.id];
    void letIn(s.id, p.id, shortName(p));
  }
</script>

{#snippet row(p: Player, signedUp: boolean)}
  <div class="entry" class:letting={letting && waiting(p.id)}>
    <button class="row" class:off={!here(p.id)} onclick={() => toggle(p)}>
      <Person player={p} />
      <span class="state">
        {#if here(p.id)}<span class="badge green">Here</span>
        {:else if signedUp}<span class="badge red">No-show</span>
        {:else if waiting(p.id)}<span class="badge">Waiting</span>
        {:else}<span class="badge"><Icon name="plus" size={14} /> Here</span>{/if}
      </span>
    </button>
    {#if letting && waiting(p.id)}
      <button class="btn sm outline let-in" aria-label="Let {goesBy(p)} in" onclick={() => admit(p)}>Let in</button>
    {/if}
  </div>
{/snippet}

<Drawer bind:open title="Add player" sub="{series.name} · {when}">
  {#snippet top()}
    <div class="stats num">
      <div class="stat">
        <span class="eyebrow">Here</span><span class="value">{going.length - noShows.length}</span>
      </div>
      <div class="stat">
        <span class="eyebrow">No-show</span><span class="value" class:warn={noShows.length}>{noShows.length}</span>
      </div>
      <div class="stat"><span class="eyebrow">Walk-in</span><span class="value">{walkIns.length}</span></div>
      <div class="stat">
        <span class="eyebrow">Waiting</span><span class="value" class:warn={waitlist.length}>{waitlist.length}</span>
      </div>
    </div>
    <label class="search">
      <Icon name="search" size={18} />
      <input class="input" aria-label="Find a player" placeholder="Find a player" bind:value={search} />
    </label>
  {/snippet}

  {#if search.length >= 2 && !signedUp.length && !others.length}
    <button class="btn outline block rise"><Icon name="plus" size={16} /> Add “{search}” as a first-timer</button>
  {/if}

  {#if signedUp.length}
    <h3 class="section-title">Signed up · tap a no-show</h3>
    <div class="list">
      {#each signedUp as p (p.id)}{@render row(p, true)}{/each}
    </div>
  {/if}

  {#if others.length}
    <!-- (Full or not, one short line: nothing below moves when the last place goes) -->
    <h3 class="section-title">Everyone else · {full ? "full, so a tap adds to Waiting" : "tap who turned up"}</h3>
    <div class="list">
      {#each others as p (p.id)}{@render row(p, false)}{/each}
    </div>
  {/if}

  {#snippet footer()}
    <button class="btn primary block" onclick={() => (open = false)}>Done</button>
  {/snippet}
</Drawer>

<style>
  .stat .value.warn {
    color: var(--caution);
  }
  .search {
    position: relative;
    display: block;
    color: var(--fg-subtle);
  }
  .search :global(svg) {
    position: absolute;
    left: var(--s-4);
    top: 50%;
    translate: 0 -50%;
  }
  .search input {
    padding-left: 2.75rem;
  }
  .state {
    display: inline-flex;
    justify-content: flex-end;
    min-width: 5.5rem;
  }
  .entry {
    display: flex;
    align-items: center;
  }
  .entry.letting {
    padding-right: var(--row-pad, var(--s-3));
  }
  .entry > .row {
    flex: 1;
    min-width: 0;
  }
  .entry + .entry {
    background-image: var(--rule);
    background-position: top;
    background-size: 100% 1px;
    background-repeat: no-repeat;
  }
  .row.off :global(.title),
  .row.off :global(.avatar) {
    opacity: 0.5;
  }
</style>
