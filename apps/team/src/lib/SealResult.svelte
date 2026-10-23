<script lang="ts">
  // Full time's review (ADR 0061): the scorekeeper's look back before the score becomes the result. The final score
  // with both teams, every goal and penalty in order, the last goal to take back, and one main button, Seal the result,
  // which is full time. The Kumite's carries its 決 (sealed) mark, stamped down as it's pressed (lib/motif.ts); any
  // other series', plain. Until it's sealed the match stays live for everyone. A level playoff can't be sealed: it
  // plays on. A side drawer on a desktop, a tall sheet on a phone (lib/Drawer, ADR 0103).
  import Icon from "../app/shell/Icon.svelte";
  import Drawer from "./Drawer.svelte";
  import GameTimeline from "./GameTimeline.svelte";
  import TeamCrest from "./TeamCrest.svelte";
  import { goesByOf, nameOfTeam, teamNamesOf } from "./names";
  import { teamTone } from "./team-tones";
  import { mmss } from "./game-clock.svelte";
  import { kanjiFor } from "./motif";
  import { prefersReducedMotion } from "../app/motion";
  import { PLAYERS } from "../demo/data";
  import type { Tournament, TournamentGame, TournamentType } from "../demo/model";

  let {
    open = $bindable(false),
    type,
    tournament,
    game,
    busy = false,
    level = false,
    onseal,
    ontakeback,
    onsettime,
  }: {
    open?: boolean;
    type: TournamentType;
    tournament: Tournament;
    game: TournamentGame;
    busy?: boolean;
    /** A playoff that's level: no sealing it, it plays on. */
    level?: boolean;
    /** Full time: the score's the result. True once it's sealed. */
    onseal: () => Promise<boolean>;
    ontakeback: () => void;
    onsettime: () => void;
  } = $props();

  const teams = $derived(tournament.teams);
  const byId = (id: number | null) => (id ? PLAYERS.find((p) => p.id === id) : undefined);
  const indexOf = (teamId: number | null) => teams.findIndex((t) => t.id === teamId);
  const teamName = (teamId: number | null) => nameOfTeam(teams[indexOf(teamId)], teams, byId);
  const crestNames = $derived(teamNamesOf(teams, byId));
  const sides = $derived([
    { teamId: game.homeTeamId, goals: game.homeGoals ?? 0 },
    { teamId: game.awayTeamId, goals: game.awayGoals ?? 0 },
  ]);
  const lastGoal = $derived(game.goals?.at(-1));
  const mark = $derived(kanjiFor(type, "sealed"));

  // Pressed: the seal comes down (the Kumite's, with its ink specks), and as it lands it's sent
  let stamping = $state(false);
  async function seal() {
    if (busy || level || stamping) return;
    stamping = true;
    if (mark && !prefersReducedMotion) await new Promise((r) => setTimeout(r, 420));
    try {
      if (await onseal()) open = false;
    } finally {
      stamping = false;
    }
  }
</script>

<Drawer bind:open title="Full time?" sub="Game {game.position} · check it, then seal it">
  <div class="review">
    <div class="final" aria-label="Final score">
      {#each sides as side, i (i)}
        <div class="side" class:away={i === 1}>
          {#if side.teamId}
            <TeamCrest
              among={crestNames}
              name={teamName(side.teamId)}
              logo={teams[indexOf(side.teamId)]?.logo ?? null}
              tone={teamTone(indexOf(side.teamId))}
              size="3.5rem"
            />
          {/if}
          <span class="name">{teamName(side.teamId)}</span>
          <span class="display goals num">{side.goals}</span>
        </div>
      {/each}
    </div>

    <!-- Kept a line's room, so nothing moves when taking a goal back makes it level -->
    <p class="level hint" aria-live="polite">{level ? "It's level: a playoff needs a winner. Play on." : ""}</p>

    <section class="log" aria-label="Goals and penalties">
      {#if game.goals?.length || game.penalties?.length}
        <GameTimeline {tournament} {game} />
      {:else}
        <p class="hint">No goals: it ends 0–0.</p>
      {/if}
    </section>

    <!-- A mistake: the last goal back, or back to the clock -->
    <div class="fixes">
      <button class="btn ghost sm" disabled={busy || stamping || !lastGoal} onclick={ontakeback}
        ><Icon name="undo" size={16} /><span
          >{lastGoal
            ? `Take back ${goesByOf(byId(lastGoal.scorerId)) || teamName(lastGoal.teamId)}'s goal · ${mmss(lastGoal.atMs)}`
            : "No goal to take back"}</span
        ></button
      >
      <button class="btn ghost sm" disabled={stamping} onclick={onsettime}
        ><Icon name="clock" size={16} />Set the time</button
      >
    </div>
  </div>

  {#snippet footer()}
    <div class="actions">
      <button class="btn ghost" disabled={stamping} onclick={() => (open = false)}>Keep scoring</button>
      <button class="btn primary seal" class:stamping disabled={busy || level} onclick={seal}
        ><span class="stamp"
          >{#if mark}<span class="kj" lang="ja" aria-hidden="true">{mark}</span>{/if}Seal the result{#if stamping && mark}{#each [0, 1, 2, 3, 4, 5] as k (k)}<i
                class="ink"
                style:--a="{k * 60 + 15}deg"
                style:--d="{0.7 + (k % 3) * 0.3}rem"
              ></i>{/each}{/if}</span
        ></button
      >
    </div>
  {/snippet}
</Drawer>

<style>
  .review {
    display: grid;
    gap: var(--s-4);
  }
  .final {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
  .side {
    display: grid;
    justify-items: center;
    align-content: start;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-3);
    text-align: center;
  }
  .side.away {
    border-left: 1px solid var(--border);
  }
  .name {
    display: flex;
    align-items: center;
    min-height: 2.3em;
    color: var(--fg-muted);
    font-weight: 600;
    line-height: 1.15;
    text-wrap: balance;
  }
  .goals {
    color: var(--fg);
    font-size: 3.5rem;
    line-height: 1;
  }
  .level {
    min-height: 1.4em;
    margin: 0;
    color: var(--red-hot);
    text-align: center;
  }
  .log {
    display: grid;
    gap: var(--s-2);
  }
  .fixes {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--s-2);
  }
  .fixes .btn {
    gap: var(--s-1);
    min-width: 0;
  }
  .fixes .btn span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .actions {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--s-2);
    width: 100%;
  }
  .seal {
    height: 3.5rem;
    font-size: var(--text-md);
    font-weight: 700;
  }
  .stamp {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
  }
  /* The Kumite's 決, in its kanji face: the seal pressed onto the button */
  .kj {
    font-family: var(--font-kanji);
    font-size: 1.5rem;
    font-weight: 900;
    line-height: 1;
  }
  /* Pressed: it comes down like the draft's Yes, big and tilted, then flat, ink specks out from it */
  .seal.stamping .stamp {
    animation: stamp 350ms cubic-bezier(0.55, 0, 0.75, 0.2) both;
  }
  @keyframes stamp {
    0% {
      transform: scale(1.35) rotate(-9deg);
    }
    100% {
      transform: none;
    }
  }
  .ink {
    position: absolute;
    top: 50%;
    left: 0.75rem;
    width: 0.3rem;
    height: 0.3rem;
    border-radius: 50%;
    background: currentColor;
    opacity: 0;
    animation: ink 380ms 300ms ease-out both;
  }
  @keyframes ink {
    0% {
      opacity: 0.8;
      transform: rotate(var(--a)) translateX(0);
    }
    100% {
      opacity: 0;
      transform: rotate(var(--a)) translateX(var(--d));
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .seal.stamping .stamp,
    .ink {
      animation: none;
    }
  }
</style>
