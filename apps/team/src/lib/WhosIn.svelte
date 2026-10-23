<script lang="ts">
  // Who's in, for a tournament's Sign-up open view (ADR 0074), as Friday's Who's coming says it: one line a player,
  // their initials, name and position, numbered in the order they said they're in, the captains marked once they're
  // named; then whoever's waiting, then (for whoever sees it) who said they're out. Nobody in yet: a quip about
  // slackers (Settings → Quips, "Nobody in"), as Friday's says it. The Kumite's is by invitation (lib/motif.ts
  // invitationOnly): its players are The fighters, each with their fighter's number (lib/fighters.ts), whoever's
  // waiting the Reserves, numbered too, and who said out Declined.
  import { PLAYERS, type Player } from "../demo/data";
  import type { Tournament } from "../demo/model";
  import { me } from "../demo/session.svelte";
  import { db } from "../demo/store.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import Person from "./Person.svelte";
  import { pick } from "./quips";
  import { untrack } from "svelte";
  import Kanji from "./Kanji.svelte";
  import { invitationOnly, kanjiFor } from "./motif";
  import { fighterNo } from "./fighters";
  import { typeById } from "../demo/schedule.svelte";

  let { tournament: t }: { tournament: Tournament } = $props();

  // The Kumite's motif beside the heading, where Friday's has none: 組手, the fighters (lib/motif.ts)
  const kanji = $derived(kanjiFor(typeById(t.typeId), "onTheMat"));
  const fighters = $derived(invitationOnly(typeById(t.typeId)));
  const said = $derived(
    fighters
      ? { going: "Who's in", waiting: "Reserves", out: "Declined" }
      : { going: "Who's in", waiting: "Waiting", out: "Out" },
  );
  const byId = (id: number) => PLAYERS.find((p) => p.id === id);
  const people = (ids: readonly number[]) => ids.flatMap((id) => byId(id) ?? []);
  const captains = $derived(new Set(t.teams.flatMap((x) => x.captainMemberId ?? [])));
  const going = $derived(people(t.going));
  const waiting = $derived(people(t.waitlist));
  const out = $derived(people(t.out ?? []));
  const SLACKERS = "No slackers allowed. Be the first one in.";
  // Picked once for the page, so a live update never swaps it
  const slackers = untrack(() => pick(db.quips.filter((q) => q.kind === "empty" && q.text.trim()))?.text ?? SLACKERS);
</script>

{#snippet rows(list: Player[], numbered: boolean)}
  <div class="list tight">
    {#each list as p, i (p.id)}
      <div class="row" class:you={p.id === me().id}>
        {#if numbered}<span class="n num" class:no={fighters}>{fighters ? fighterNo(i + 1) : i + 1}</span>{/if}
        <Person player={p} bare />
        {#if captains.has(p.id)}<span class="badge"><Icon name="shield" size={12} />Captain</span>{/if}
        <span class="pos" class:g={p.position === "G"}>{p.position}</span>
      </div>
    {/each}
  </div>
{/snippet}

<section class="whos-in" aria-label={said.going}>
  <h2 class="section-title">{said.going} <span class="count num">{going.length}</span><Kanji text={kanji} /></h2>
  {#if going.length}
    {@render rows(going, true)}
  {:else}
    <p class="slackers">{slackers}</p>
  {/if}
  {#if waiting.length}
    <h3 class="sub-title">{said.waiting} <span class="count num">{waiting.length}</span></h3>
    {@render rows(waiting, fighters)}
  {/if}
  {#if out.length}
    <h3 class="sub-title">{said.out} <span class="count num">{out.length}</span></h3>
    {@render rows(out, false)}
  {/if}
</section>

<style>
  .whos-in {
    display: grid;
    gap: var(--s-3);
  }
  .section-title,
  .sub-title {
    display: flex;
    align-items: baseline;
    gap: var(--s-2);
    margin: 0;
  }
  .sub-title {
    margin-top: var(--s-2);
    color: var(--fg-muted);
    font-size: var(--text-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }
  .count {
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  .row {
    gap: var(--s-3);
    min-height: 2.75rem;
  }
  .row.you :global(.title) {
    color: var(--red-hot);
  }
  .n {
    width: 1.5rem;
    color: var(--fg-subtle);
    font-size: var(--text-sm);
    text-align: right;
  }
  /* A fighter's number, as the pass prints it: two figures in the poster type */
  .n.no {
    width: 1.75rem;
    color: var(--fg-muted);
    font-family: var(--font-display);
    font-size: var(--text-md);
    letter-spacing: 0.03em;
  }
  .badge {
    gap: 0.25rem;
    flex: none;
  }
  .pos {
    flex: none;
    width: 1.25rem;
    color: var(--fg-muted);
    font-size: var(--text-sm);
    font-weight: 600;
    text-align: center;
  }
  .pos.g {
    color: var(--fg);
  }
  .slackers {
    margin: 0;
    color: var(--fg-muted);
  }
</style>
