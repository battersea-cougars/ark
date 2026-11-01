<script lang="ts">
  // The choices (ADR 0060): every pick of a draft in order, by round, the player over their team, and who chose for
  // a captain when it wasn't them. For its captains and whoever runs the draft, from the page header's Manage once the
  // draft's open; a bottom sheet on a phone, a side drawer on a desktop. As a `column` (the draft room on a wide
  // screen): a line each, "3 · Team Alex chose Hayden Harlow D", the newest at the top, burning in as it lands, the
  // rounds' turns of the snake as quiet breaks.
  import BurnReveal from "./BurnReveal.svelte";
  import { prefersReducedMotion } from "../app/motion";
  import type { Tournament } from "../demo/model";
  import { PLAYERS } from "../demo/data";
  import { me } from "../demo/session.svelte";
  import { goesByOf, nameOfTeam, shortNameOf } from "./names";
  import Sheet from "./Sheet.svelte";
  import Drawer from "./Drawer.svelte";
  import { phone } from "./viewport.svelte";

  let {
    tournament: t,
    open = $bindable(false),
    inline = false,
    column = false,
    burning = null,
  }: {
    tournament: Tournament;
    open?: boolean;
    /** On the page (the draft done, for its captains and whoever runs it: Draft's Pick log tab, which names it). */
    inline?: boolean;
    /** One line a choice, the newest first (the draft room's Choices column). */
    column?: boolean;
    /** The player whose name is burning in just now (lib/BurnReveal). */
    burning?: number | null;
  } = $props();

  const byId = (id: number) => PLAYERS.find((p) => p.id === id);
  const teamName = (i: number) => nameOfTeam(t.teams[i], t.teams, (id) => (id ? byId(id) : undefined));
  // A pick someone made for the captain (whoever runs the draft) says who
  const pickerOf = (p: { pickedBy?: number | null }, team: number) =>
    p.pickedBy && p.pickedBy !== t.teams[team]?.captainMemberId ? shortNameOf(byId(p.pickedBy)) || "An admin" : "";
  const log = $derived(
    t.teams
      .flatMap((x, team) =>
        x.players.flatMap((p) => (typeof p.pick === "number" ? [{ ...p, pick: p.pick, team }] : [])),
      )
      .sort((a, b) => a.pick - b.pick)
      .map((p, i) => ({
        n: i + 1,
        id: p.memberId,
        pos: p.memberId ? (byId(p.memberId)?.position ?? "") : "",
        team: p.team,
        name: p.memberId ? goesByOf(byId(p.memberId)) || p.name : p.name,
        you: p.memberId === me().id,
        by: pickerOf(p, p.team),
      })),
  );
  const rounds = $derived.by(() => {
    const out: { round: number; picks: typeof log }[] = [];
    for (const l of log) {
      const r = Math.ceil(l.n / Math.max(1, t.teams.length));
      if (out.at(-1)?.round !== r) out.push({ round: r, picks: [] });
      out.at(-1)!.picks.push(l);
    }
    return out;
  });
</script>

{#snippet list()}
  <div class="log">
    {#each rounds as r (r.round)}
      <section>
        <h4 class="eyebrow">Round {r.round}</h4>
        <ol>
          {#each r.picks as l (l.n)}
            <li>
              <span class="n num">{l.n}</span>
              <span class="lp"
                >{l.name}{#if l.you}<small>you</small>{/if}</span
              >
              <span class="lt">{l.by ? `${l.by} for ${teamName(l.team)}` : teamName(l.team)}</span>
            </li>
          {/each}
        </ol>
      </section>
    {/each}
  </div>
{/snippet}

{#snippet lines()}
  <ol class="lines">
    {#each [...rounds].reverse() as r (r.round)}
      {#each [...r.picks].reverse() as l (l.n)}
        {@const hot = burning !== null && l.id === burning}
        <li class="line" class:burning={hot}>
          {#if hot && !prefersReducedMotion}<BurnReveal />{/if}
          <span class="n num">{l.n}</span>
          <span class="said"
            ><span class="team">{teamName(l.team)}</span> chose <strong>{l.name}</strong>{#if l.pos}<small class="pos"
                >{l.pos}</small
              >{/if}{#if l.you}<small>you</small>{/if}{#if l.by}<span class="by"> · {l.by}'s choice</span>{/if}</span
          >
        </li>
      {/each}
      {#if r.round > 1}<li class="round" aria-label="Round {r.round}">
          <span>Round {r.round} <span aria-hidden="true">↺</span></span>
        </li>{/if}
    {/each}
  </ol>
{/snippet}

{#if inline && column}
  {#if log.length}{@render lines()}{:else}<p class="hint">Nobody's chosen yet.</p>{/if}
{:else if inline}
  {#if log.length}
    <section class="inline" aria-label="Choices">{@render list()}</section>
  {/if}
{:else if phone.current}
  <Sheet bind:open title="Choices"
    >{#if log.length}{@render list()}{:else}<p class="hint">Nobody's chosen yet.</p>{/if}</Sheet
  >
{:else}
  <Drawer bind:open title="Choices" sub="{log.length} {log.length === 1 ? 'choice' : 'choices'}"
    >{#if log.length}{@render list()}{:else}<p class="hint">Nobody's chosen yet.</p>{/if}</Drawer
  >
{/if}

<style>
  /* The column: a line a choice, newest first; the round's turn a quiet break with the snake's ↺ */
  .lines {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .line {
    position: relative;
    display: grid;
    grid-template-columns: 1.6rem minmax(0, 1fr);
    column-gap: var(--s-2);
    align-items: baseline;
    padding: var(--s-2) 0;
  }
  .line .said {
    min-width: 0;
    color: var(--fg-muted);
    font-size: var(--text-sm);
    line-height: 1.35;
  }
  .line .team {
    color: var(--fg-body);
  }
  .line strong {
    color: var(--fg);
    font-weight: 600;
  }
  .line small {
    margin-left: var(--s-2);
    color: var(--fg-subtle);
    font-size: var(--text-2xs);
    font-weight: 700;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }
  .line .by {
    color: var(--fg-subtle);
    font-size: var(--text-xs);
  }
  .line.burning strong {
    animation: cool 1.2s ease-out both;
  }
  @keyframes cool {
    from {
      color: var(--tone-amber);
    }
  }
  .round {
    padding: var(--s-3) 0 var(--s-1);
    color: var(--fg-subtle);
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }
  @media (prefers-reduced-motion: reduce) {
    .line.burning strong {
      animation: none;
    }
  }
  .inline {
    display: grid;
    gap: var(--s-3);
  }
  .log {
    display: grid;
    gap: var(--s-6);
  }
  .log section {
    display: grid;
    gap: var(--s-2);
  }
  .log h4 {
    margin: 0;
  }
  .log ol {
    display: grid;
    gap: var(--s-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .log li {
    display: grid;
    grid-template-columns: 1.6rem minmax(0, 1fr);
    column-gap: var(--s-3);
    align-items: center;
    padding: var(--s-2) 0;
  }
  .n {
    grid-row: 1 / 3;
    color: var(--fg-subtle);
    font-size: var(--text-sm);
  }
  .lp {
    overflow: hidden;
    color: var(--fg);
    font-weight: 500;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .lp small {
    margin-left: var(--s-2);
    color: var(--fg-muted);
    font-size: var(--text-2xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }
  .lt {
    overflow: hidden;
    color: var(--fg-muted);
    font-size: var(--text-xs);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
</style>
