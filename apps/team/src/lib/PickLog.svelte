<script lang="ts">
  // The pick log (ADR 0060): every pick of a draft in order, by round, the player over their team, and who picked for
  // a captain when it wasn't them. For its captains and whoever runs the draft, from the page header's Manage once the
  // draft's open; a bottom sheet on a phone, a side drawer on a desktop.
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
  }: {
    tournament: Tournament;
    open?: boolean;
    /** On the page (the draft done, for its captains and whoever runs it: Draft's Pick log tab, which names it). */
    inline?: boolean;
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

{#if inline}
  {#if log.length}
    <section class="inline" aria-label="Pick log">{@render list()}</section>
  {/if}
{:else if phone.current}
  <Sheet bind:open title="Pick log"
    >{#if log.length}{@render list()}{:else}<p class="hint">Nobody's picked yet.</p>{/if}</Sheet
  >
{:else}
  <Drawer bind:open title="Pick log" sub="{log.length} {log.length === 1 ? 'pick' : 'picks'}"
    >{#if log.length}{@render list()}{:else}<p class="hint">Nobody's picked yet.</p>{/if}</Drawer
  >
{/if}

<style>
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
