<script lang="ts">
  // One award on the awards page's stage (ADR 0074): a card, its size fixed, so nothing round it moves. The award's
  // name big in brass stays put; under it the winner's area, a "?" while it's sealed. Revealed, the "?" goes and the
  // winner (a team's crest and name, or a player's name and their team) rolls into that area alone, clipped to it,
  // then the 賞 hanko lands. The champions' card (the award the table decides) is the finale's: bigger, ringed in
  // brass, the crest and name a size up, 優勝 slammed down, the page darkened round it while it's revealed. `beat` is
  // what's playing (the page's, from the change of state, lib/afters beatOf); none, it's just as it is. The timing is
  // lib/award-reveal.css.
  import type { Tournament, TournamentType } from "../demo/model";
  import { PLAYERS } from "../demo/data";
  import type { revealOf } from "./afters";
  import BoardWords from "./BoardWords.svelte";
  import HankoPress from "./HankoPress.svelte";
  import TeamCrest from "./TeamCrest.svelte";
  import { kanjiFor } from "./motif";
  import { goesByOf, nameOfTeam, teamNamesOf } from "./names";
  import { teamTone } from "./team-tones";

  type Award = ReturnType<typeof revealOf>["awards"][number];

  let {
    type,
    tournament: t,
    award,
    at,
    count,
    face,
    finale,
    beat = null,
    leaving = false,
    onreveal,
  }: {
    type: TournamentType;
    tournament: Tournament;
    award: Award;
    /** Its place in the order (0 first), of `count`. */
    at: number;
    count: number;
    face: "sealed" | "up";
    /** The champions' card: the finale's. */
    finale: boolean;
    /** What's playing: the reveal, or this card coming in (Next award). */
    beat?: "reveal" | "next" | null;
    /** The last card, dissolving as the next comes in. */
    leaving?: boolean;
    /** Whoever runs it: a tap on the sealed card reveals it, as the button under it does. */
    onreveal?: () => void;
  } = $props();

  const teams = $derived(t.teams);
  const byId = (id: number | null) => PLAYERS.find((p) => p.id === id);
  const teamIndex = (id: number | null) => teams.findIndex((x) => x.id === id);
  const teamName = (id: number | null) => nameOfTeam(teams[teamIndex(id)], teams, byId);
  const teamOf = (memberId: number | null) =>
    teams.find((x) => x.captainMemberId === memberId || x.players.some((p) => p.memberId === memberId))?.id ?? null;
  const crestNames = $derived(teamNamesOf(teams, byId));
  const won = $derived((t.winners ?? []).filter((w) => w.award === award.name));
  const kumite = $derived(!!kanjiFor(type, "awards"));
  const mark = $derived(kanjiFor(type, finale ? "champions" : "awards"));
  const revealing = $derived(beat === "reveal" && face === "up");
  // What it's called tonight (the judges' call's name, once confirmed), and what it's for
  const name = $derived(award.title ?? award.name);
  const about = $derived(award.title ? `${award.name}${award.about ? `: ${award.about}` : ""}` : award.about);
  const sizes = $derived(
    finale ? { name: "2.3rem", who: "2.9rem", crest: "4.75rem" } : { name: "1.7rem", who: "2.1rem", crest: "2.9rem" },
  );
</script>

<div
  class="award-card"
  class:finale
  class:up={face === "up"}
  class:revealing
  class:entering={beat === "next" && !leaving}
  class:leaving
  aria-hidden={leaving || undefined}
>
  {#if kumite}<span class="ghost" lang="ja" aria-hidden="true">{mark}</span>{/if}
  <span class="order num">{at + 1} of {count}</span>
  <div class="name"><BoardWords text={name} size={sizes.name} /></div>
  <p class="about">{about || " "}</p>

  <!-- Who took it: a "?" till it's revealed, then the winner rolling in, here and nowhere else -->
  <div class="winner-area" aria-live={leaving ? undefined : "polite"}>
    {#if face === "sealed" || revealing}
      <span class="mystery display" aria-hidden={face === "up" || undefined}>?</span>
    {/if}
    {#if finale && revealing}
      <span class="finale-line display" aria-hidden="true">And your {type.shortName} champions…</span>
    {/if}
    {#if face === "up"}
      <div class="winner">
        {#if !won.length || won.length > 2}
          <span class="who" class:none={!won.length}
            ><BoardWords text={won.length ? `Shared by ${won.length}` : "Nobody this time"} size={sizes.who} /></span
          >
          <!-- A big tie: who shares it, a line under it -->
          {#if won.length}<span class="shared-names"
              >{won.map((w) => (w.teamId ? teamName(w.teamId) : goesByOf(byId(w.memberId)))).join(" · ")}</span
            >{/if}
        {:else}
          {#each won as w, k (k)}
            {#if w.teamId}
              <span class="who who-team">
                <TeamCrest
                  among={crestNames}
                  name={teamName(w.teamId)}
                  logo={teams[teamIndex(w.teamId)]?.logo ?? null}
                  tone={teamTone(teamIndex(w.teamId))}
                  size={sizes.crest}
                />
                <BoardWords text={teamName(w.teamId)} size={sizes.who} lines={won.length > 1 ? 1 : 2} />
              </span>
            {:else}
              <span class="who who-player">
                <BoardWords text={goesByOf(byId(w.memberId))} size={sizes.who} lines={won.length > 1 ? 1 : 2} />
                <span class="team-line">{teamOf(w.memberId) ? teamName(teamOf(w.memberId)) : " "}</span>
              </span>
            {/if}
          {/each}
        {/if}
      </div>
    {/if}
  </div>

  {#if kumite && face === "up"}
    <span class="stamp"><HankoPress text={mark} drop pressed={revealing} delay="var(--stamp-delay)" /></span>
  {/if}
  {#if finale && revealing}<span class="gong" aria-hidden="true"></span>{/if}
  {#if onreveal && face === "sealed" && !leaving}
    <button class="tap" type="button" aria-label="Reveal {name}" onclick={onreveal}></button>
  {/if}
</div>

<style>
  /* The card: carbon, the award's name in brass, room for each part kept, its size fixed (the finale's a size up) */
  .award-card {
    position: relative;
    display: grid;
    grid-area: 1 / 1;
    grid-template-rows: auto auto 2.6rem 1fr;
    align-content: start;
    width: min(100% - var(--s-4), 26rem);
    height: 17rem;
    padding: var(--s-4) var(--s-5) var(--s-5);
    overflow: visible;
    border-radius: var(--r-lg);
    background:
      repeating-linear-gradient(135deg, rgb(255 255 255 / 0.018) 0 6px, transparent 6px 12px),
      color-mix(in srgb, var(--bg) 72%, black);
  }
  .finale {
    width: 100%;
    height: 100%;
    padding: var(--s-5) var(--s-5) var(--s-6);
    grid-template-rows: auto auto 2.6rem 1fr;
  }
  /* The finale ringed in brass, a warm glow round it once it's out */
  .finale::before {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--brass) 50%, transparent),
      inset 0 0 3rem color-mix(in srgb, var(--brass) 10%, transparent);
    content: "";
    pointer-events: none;
  }
  .finale.up {
    box-shadow:
      0 0 0 100vmax rgb(0 0 0 / 0),
      0 0 3rem color-mix(in srgb, var(--brass) 32%, transparent);
  }
  .ghost {
    position: absolute;
    right: var(--s-3);
    bottom: -0.5rem;
    color: color-mix(in srgb, var(--brass) 9%, transparent);
    font-family: var(--font-kanji);
    font-size: 6rem;
    font-weight: 900;
    line-height: 1;
    pointer-events: none;
  }
  .finale .ghost {
    font-size: 9rem;
  }
  .order {
    color: var(--fg-subtle);
    font-size: var(--text-xs);
    font-weight: 600;
  }
  .name {
    margin-top: var(--s-1);
    color: var(--brass-ink);
  }
  .about {
    display: -webkit-box;
    margin: var(--s-1) 0 0;
    overflow: hidden;
    color: var(--fg-muted);
    font-size: var(--text-sm);
    line-height: 1.3;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  /* The winner's area: its own room, clipping the roll to it */
  .winner-area {
    position: relative;
    display: grid;
    align-self: end;
    height: 6rem;
    overflow: clip;
  }
  .finale .winner-area {
    height: 8.5rem;
  }
  .winner-area > * {
    grid-area: 1 / 1;
  }
  .mystery {
    align-self: center;
    justify-self: center;
    color: color-mix(in srgb, var(--brass) 75%, transparent);
    font-size: 4rem;
    line-height: 1;
  }
  .finale .mystery {
    font-size: 6rem;
  }
  .finale-line {
    align-self: center;
    justify-self: center;
    color: var(--brass-ink);
    font-size: clamp(1.25rem, 5.5vw, 1.75rem);
    font-style: italic;
    text-align: center;
    text-transform: uppercase;
    opacity: 0;
  }
  /* The winner fills the area, sitting at its foot, so the roll starts wholly out of sight above it */
  .winner {
    display: flex;
    flex-wrap: wrap;
    align-content: flex-end;
    align-items: flex-end;
    align-self: stretch;
    gap: var(--s-2) var(--s-4);
    min-width: 0;
    padding-right: 4.5rem;
  }
  .finale .winner {
    padding-right: 5.5rem;
  }
  .who {
    display: grid;
    flex: 1 1 9rem;
    row-gap: 0.2rem;
    min-width: 0;
    color: var(--fg);
  }
  .who.none {
    color: var(--fg-muted);
  }
  .who-team {
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    column-gap: var(--s-3);
  }
  .shared-names {
    color: var(--fg-muted);
    font-size: var(--text-sm);
    line-height: 1.4;
  }
  .team-line {
    overflow: hidden;
    color: var(--fg-muted);
    font-size: var(--text-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .stamp {
    position: absolute;
    right: var(--s-4);
    bottom: var(--s-4);
    z-index: 1;
  }
  .finale .stamp {
    right: var(--s-5);
    bottom: var(--s-5);
    scale: 1.35;
    transform-origin: bottom right;
  }
  .gong {
    position: absolute;
    inset: 0;
    border: 3px solid var(--brass);
    border-radius: inherit;
    opacity: 0;
    pointer-events: none;
    animation: award-gong 1400ms 150ms cubic-bezier(0.2, 0.6, 0.3, 1) both;
  }
  /* Whoever runs it: the sealed card is a button too, a brass edge saying so */
  .tap {
    position: absolute;
    inset: 0;
    z-index: 2;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: inherit;
    background: none;
    cursor: pointer;
  }
  .tap:focus-visible {
    outline: 2px solid var(--brass-ink);
    outline-offset: 2px;
  }
  .award-card:has(.tap) {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--brass) 30%, transparent);
  }

  /* The beats (their timing: lib/award-reveal.css). Next award: the last dissolving, this one zooming in */
  .leaving {
    pointer-events: none;
    animation: award-dissolve var(--dissolve-ms) ease-in forwards;
  }
  .entering {
    animation: award-enter var(--enter-ms) var(--enter-ease) both;
  }
  .entering .name {
    animation: award-settle 380ms var(--enter-name-delay) ease-out both;
  }
  /* The reveal: the "?" beats, fades; the winner rolls in after; the hanko lands */
  .revealing .mystery {
    animation:
      award-heartbeat var(--pulse-ms) ease-in-out,
      award-fade-out var(--fade-ms) var(--pulse-ms) ease-in forwards;
  }
  .revealing .finale-line {
    animation: award-line var(--line-ms) calc(var(--pulse-ms) + var(--fade-ms)) ease both;
  }
  .revealing .winner {
    animation: award-roll-in var(--roll-ms) var(--roll-delay) both;
  }
  /* The champions: the page darkened round the card, then a brass glow */
  .finale.revealing {
    z-index: 3;
    animation:
      award-spot-in var(--spot-in-ms) ease-out forwards,
      award-spot-out var(--spot-out-ms) var(--spot-out-delay) ease-in-out forwards;
  }

  /* Reduced motion: crossfades only, no heartbeat, no ring, no roll, no zoom; the champions' line still shown */
  @media (prefers-reduced-motion: reduce) {
    .leaving {
      animation: award-fade-out var(--dissolve-ms) ease forwards;
    }
    .entering {
      animation: award-fade-in var(--dissolve-ms) ease both;
    }
    .entering .name,
    .finale.revealing,
    .gong {
      animation: none;
    }
    .gong {
      display: none;
    }
    .revealing .mystery {
      animation: award-fade-out var(--fade-ms) ease forwards;
    }
    .revealing .finale-line {
      animation: award-line var(--line-ms) var(--fade-ms) ease both;
    }
    .revealing .winner {
      animation: award-fade-in 400ms calc(var(--fade-ms) + var(--line-ms)) ease both;
    }
  }
</style>
