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
  import { goesBy, nameOfTeam } from "./names";
  import Icon from "../app/shell/Icon.svelte";
  import InkStamp from "./InkStamp.svelte";
  import { myTeamIndex } from "./tournament-front";

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
  // Who's scoring it, until it's over (#116): whoever else holds the sheet (yours is the red whistle, not said twice)
  const scorer = $derived.by(() => {
    if (g.status === "done" || !g.keeperId || keeping) return "";
    const p = PLAYERS.find((x) => x.id === g.keeperId);
    return p ? goesBy(p) : "";
  });
  const playoff = $derived(g.stage === "playoff");
  const count = $derived(tournament.games?.length ?? 0);
  // 決勝 is the Final's own; any other playoff (a semi-final, 3rd place) gets the fights'
  const kanji = $derived(kanjiFor(type, playoff && /^(the )?final$/i.test(g.name.trim()) ? "final" : "fights"));
  const stage = $derived(playoff ? g.name : grouped ? "" : "Round robin");
  const place = $derived(`Game ${g.position} of ${count}`);
  const done = $derived(g.status === "done");
  // The next to be played: Chong Li's line for the Kumite ("You are next!", to Dux after he's beaten Jackson), plainly Up next for the rest
  const upNext = $derived(
    g.status === "next" && !(tournament.games ?? []).some((x) => x.status === "next" && x.position < g.position),
  );
  // Your team's in it: its stamp is the club's red, the one other accent on the card than the match on now. Every
  // Kumite match up next still says You are next!, the line from the film, whoever's playing
  // A stamp that takes over from another while the card's on screen (You are next! to KUMITE! to the result) flies in
  // and lands; one already there when the page opens just sits. Read as each stamp is made, so it's that moment's
  const born = Date.now();
  const arriving = () => Date.now() - born > 800;
  const yours = $derived.by(() => {
    const id = tournament.teams[myTeamIndex(tournament, me().id)]?.id;
    return !!id && (g.homeTeamId === id || g.awayTeamId === id);
  });
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

<!-- On now, it's the main draw: bigger, its KUMITE! stamp glowing, and the whole card opens the live page -->
<div class="list game-card" class:live class:done>
  <GameHead {stage} {kanji} {playoff} {place} {scorer} opens={!live && !keeping}>
    {#snippet centre()}
      {#if live}<span class="stamp-at glowing"
          ><InkStamp
            size="card"
            tone="red"
            kanji={kanjiFor(type, "onTheMat")}
            icon="swords"
            text="{type?.shortName ?? 'Live'}!"
            land={arriving()}
          /></span
        >
      {:else if upNext}<span class="stamp-at"
          ><InkStamp
            size="card"
            tone={yours ? "red" : "faint"}
            kanji={kanjiFor(type, "next")}
            icon={yours ? "user" : undefined}
            text={type?.slug === "kumite" ? "You are next!" : "Up next"}
            tilt={yours ? -5 : -3}
            land={yours || arriving()}
          /></span
        >
      {:else if done && winner}<span class="stamp-at"
          ><InkStamp
            size="card"
            tone="bone"
            kanji={kanjiFor(type, "won")}
            icon="trophy"
            text="{winner} wins"
            land={arriving()}
          /></span
        >
      {:else if done}<span class="stamp-at"
          ><InkStamp size="card" tone="faint" kanji={kanjiFor(type, "drawn")} text="Draw" land={arriving()} /></span
        >{/if}
    {/snippet}
    {#snippet action()}
      {#if keeping}<span class="keeping" title="You're keeping score" aria-label="You're keeping score"
          ><Icon name="whistle" size={20} /></span
        >{/if}
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
  /* A card: its own panel (the stamp may sit on its top edge, so nothing's clipped) */
  .game-card {
    position: relative;
    overflow: visible;
    transition:
      background-color var(--t-fast) var(--ease-in-out),
      border-color var(--t-fast) var(--ease-in-out);
  }
  /* The stamp, top right in the head row (no taller than it): on the game on now, KUMITE! outlined in the club's red,
     a little askew, its dot pulsing, which says it's live */
  /* The match on now, Up next and the results: ink stamps (lib/InkStamp), as the page's status is. The club's red is your team's You are
     next! (stamped down as it shows) and the match on now's; a win in bone, a draw and Up next faint (ADR 0084: colour
     is an accent). A long winner's name is cut short; the stamp's size is the same on every card */
  /* One box whichever stamp it holds (KUMITE!, You are next!, a result), so the head never shifts as one gives way to
     the next */
  .stamp-at {
    display: inline-flex;
    justify-content: flex-end;
    align-items: center;
    width: 15rem;
    height: 2.25rem;
    min-width: 0;
  }
  /* The match being played: a stamp like the rest, glowing (on the box: the stamp's worn-ink mask would clip its own
     glow), breathing while it's on */
  .glowing {
    filter: drop-shadow(0 0 6px color-mix(in srgb, var(--red-hot) 55%, transparent));
  }
  @media (prefers-reduced-motion: no-preference) {
    .glowing {
      animation: glow 1.6s var(--ease-in-out) infinite;
    }
  }
  @keyframes glow {
    50% {
      filter: drop-shadow(0 0 14px color-mix(in srgb, var(--red-hot) 90%, transparent)) brightness(1.15);
    }
  }
  .keeping {
    display: inline-flex;
    margin-left: var(--s-3);
    color: var(--red-hot);
  }
  /* A phone: the stamp's a sticker on the card's edge, a size down; Live a compact pill, its hit area kept */
  @media (max-width: 600px) {
    .stamp-at {
      width: 10.5rem;
      height: 2rem;
    }
  }
  /* A card reads as a card on any screen: its own fill, the page's carbon shut out (no see-through glass, which a
     phone's frost tint left near the page's own black), a lit top edge, no border. Played, a step quieter, still
     solid */
  .game-card {
    background:
      linear-gradient(180deg, rgb(255 255 255 / 0.05), rgb(255 255 255 / 0.015) 60%, transparent), var(--card-fill);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.07);
    --card-fill: var(--surface-1);
  }
  /* A touch screen (a phone outdoors, at the rink): a step lighter, so the edge holds against the carbon */
  @media (pointer: coarse) {
    .game-card {
      --card-fill: color-mix(in srgb, var(--surface-2) 70%, var(--surface-1));
    }
  }
  .game-card.done {
    background: var(--card-fill);
    box-shadow: none;
  }
  @media (hover: hover) {
    .game-card:hover {
      border-color: var(--border-strong);
      background: color-mix(in srgb, var(--red-hot) 7%, var(--surface-2));
    }
  }
</style>
