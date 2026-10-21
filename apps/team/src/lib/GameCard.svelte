<script lang="ts">
  // One game as a card of its own (the Kumite's home, the Fight card): its header (lib/GameHead), then the big row,
  // the teams either side of the time and the score. The whole card opens the game; the team names open the teams.
  // Under the pointer it warms with the club's red, its edge firms up, and its header lights. Nothing moves.
  import type { Tournament, TournamentGame } from "../demo/model";
  import { typeById } from "../demo/schedule.svelte";
  import FixtureRow from "./FixtureRow.svelte";
  import GameHead from "./GameHead.svelte";
  import { kanjiFor } from "./motif";
  import { me } from "../demo/session.svelte";
  import { PLAYERS } from "../demo/data";
  import { nameOfTeam } from "./names";
  import Icon from "../app/shell/Icon.svelte";

  let {
    tournament,
    game: g,
    grouped = false,
  }: {
    tournament: Tournament;
    game: TournamentGame;
    /** Under a group header that names the round robin: the card doesn't say it again (a playoff keeps its name). */
    grouped?: boolean;
  } = $props();

  const type = $derived(typeById(tournament.typeId));
  const live = $derived(g.status === "live");
  // You hold its scoresheet: a whistle in the header says so, and the card opens the scoresheet
  const keeping = $derived(g.status !== "done" && g.keeperId === me().id);
  const playoff = $derived(g.stage === "playoff");
  const count = $derived(tournament.games?.length ?? 0);
  // 決勝 is the Final's own; any other playoff (a semi-final, 3rd place) gets the fights'
  const kanji = $derived(kanjiFor(type, playoff && /^(the )?final$/i.test(g.name.trim()) ? "final" : "fights"));
  const stage = $derived(playoff ? g.name : grouped ? "" : "Round robin");
  const liveHref = $derived(`/tournaments/${type?.slug ?? ""}/games/${g.id}/live`);
  const place = $derived(`Game ${g.position} of ${count}`);
  const done = $derived(g.status === "done");
  // The next to be played: Chong Li's line for the Kumite ("You're next, Dux"), plainly Up next for the rest
  const upNext = $derived(
    g.status === "next" && !(tournament.games ?? []).some((x) => x.status === "next" && x.position < g.position),
  );
  // Played: who won it, for the stamp in the middle (a draw says so)
  const winner = $derived.by(() => {
    if (!done || g.homeGoals === null || g.awayGoals === null || g.homeGoals === g.awayGoals) return null;
    const id = g.homeGoals > g.awayGoals ? g.homeTeamId : g.awayTeamId;
    const teams = tournament.teams;
    return nameOfTeam(
      teams.find((t) => t.id === id),
      teams,
      (pid) => PLAYERS.find((p) => p.id === pid),
    );
  });
</script>

<!-- On now, it's the main draw: bigger, and the one main button, to the live page -->
<div class="list game-card" class:live class:done>
  <GameHead {stage} {kanji} {playoff} {place} opens={!live && !keeping}>
    {#snippet centre()}
      {#if live}<span class="chant">{type?.shortName ?? "Live"}!</span>
      {:else if upNext}<span class="chant result next">{type?.slug === "kumite" ? "You're next, Dux" : "Up next"}</span>
      {:else if done && winner}<span class="chant result">{winner} wins</span>
      {:else if done}<span class="chant result draw">Draw</span>{/if}
    {/snippet}
    {#snippet action()}
      {#if keeping}<span class="keeping" title="You're keeping score" aria-label="You're keeping score"
          ><Icon name="whistle" size={20} /></span
        >{/if}
      {#if live}<a class="btn primary sm watch" href={liveHref}><i class="dot" aria-hidden="true"></i>Live</a>{/if}
    {/snippet}
  </GameHead>
  <FixtureRow
    big
    carded
    feature={live}
    scoresheet={keeping}
    {tournament}
    game={g}
    {live}
    chant="{type?.shortName ?? 'Live'}!"
  />
</div>

<style>
  .game-card {
    position: relative;
    transition:
      background-color var(--t-fast) var(--ease-in-out),
      border-color var(--t-fast) var(--ease-in-out);
  }
  /* The chant, top middle of the game on now: a stamp like the header's ON NOW, outlined in the club's red and a
     little askew. It and Live both pulse: together they say it's on now */
  .chant {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 1rem 0.35rem;
    border: 2.5px solid currentColor;
    border-radius: 0.35rem;
    color: var(--red-hot);
    font-family: var(--font-display);
    font-size: 1.5rem;
    line-height: 1;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    white-space: nowrap;
    transform: rotate(-4deg);
    box-shadow: 0 0 18px -6px color-mix(in srgb, var(--red-hot) 60%, transparent);
  }
  .chant::before {
    content: "";
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    background: currentColor;
    animation: pulse 1.4s var(--ease-in-out) infinite;
  }
  /* Played: the result, the same stamp, still (no pulse), each in its accent: the winner in amber (gold), a draw in
     violet; red stays the live game's. The card steps back so what's to come leads */
  .result {
    color: var(--tone-amber);
    font-size: 1.15rem;
    box-shadow: none;
  }
  .result::before {
    display: none;
  }
  .result.draw {
    color: var(--tone-violet);
  }
  /* The next to be played, in blue: not live yet, so still */
  .result.next {
    color: var(--tone-blue);
  }
  .keeping {
    display: inline-flex;
    margin-left: var(--s-3);
    color: var(--red-hot);
  }
  /* Live is above the card's click */
  .watch {
    position: relative;
    z-index: 1;
    margin-left: var(--s-3);
    gap: var(--s-1);
  }
  .watch .dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--red-hot);
    animation: pulse 1.4s var(--ease-in-out) infinite;
  }
  .game-card.done {
    background: color-mix(in srgb, var(--panel-bg) 45%, transparent);
  }
  @media (hover: hover) {
    .game-card:hover {
      border-color: var(--border-strong);
      background: color-mix(in srgb, var(--red-hot) 7%, var(--surface-2));
    }
  }
</style>
