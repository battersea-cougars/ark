<script lang="ts">
  // The after-party (ADR 0074): the evening a tournament ends, its last status. Everyone's at the afterwards (the
  // Kumite's The Anchor), so the page is the pub after the film's last fight: warm brass on the carbon, the Kumite's
  // motif kept. Whoever runs it has one card, Reveal the next award (Confirm the awards first, if they aren't yet);
  // each tap turns ONE award over for everyone watching (the live hub), in the order listed. Still face down, an award
  // is a card with a question mark; turned over while you watch, it flips and its winner burns in under a 賞 hanko;
  // opened later, what's out is just there. Then where everyone is, the final table (the champions first) and the
  // day's results, one line each. The last one out: "That's the Kumite. See you at the next one."
  import type { Tournament, TournamentType } from "../demo/model";
  import type { After } from "@cougars/shared/places";
  import { PLAYERS } from "../demo/data";
  import Icon from "../app/shell/Icon.svelte";
  import { revealAward } from "../app/backend.svelte";
  import { prefersReducedMotion } from "../app/motion";
  import { untrack } from "svelte";
  import { enterAwards } from "./AwardsDrawer.svelte";
  import BurnReveal from "./BurnReveal.svelte";
  import DraftStep from "./DraftStep.svelte";
  import Kanji from "./Kanji.svelte";
  import TeamCrest from "./TeamCrest.svelte";
  import { finalOrder, revealOf } from "./afters";
  import { kanjiFor } from "./motif";
  import InkStamp from "./InkStamp.svelte";
  import { goesByOf, nameOfTeam, teamNamesOf } from "./names";
  import { teamHref, teamTone } from "./team-tones";
  import { afterNoteWords } from "./tournament-front";
  import { clock } from "./dates";

  let {
    type,
    tournament: t,
    after,
    manage,
  }: {
    type: TournamentType;
    tournament: Tournament;
    /** Where everyone is: the afterwards, or none this time. */
    after: After | null;
    /** Whoever runs it (manage:Tournament): the reveal is theirs. */
    manage: boolean;
  } = $props();

  const reveal = $derived(revealOf(t));
  const teams = $derived(t.teams);
  const byId = (id: number | null) => PLAYERS.find((p) => p.id === id);
  const teamIndex = (id: number | null) => teams.findIndex((x) => x.id === id);
  const teamName = (id: number | null) => nameOfTeam(teams[teamIndex(id)], teams, byId);
  const teamOf = (memberId: number | null) =>
    teams.find((x) => x.captainMemberId === memberId || x.players.some((p) => p.memberId === memberId))?.id ?? null;
  const crestNames = $derived(teamNamesOf(teams, byId));
  const winnersOf = (award: string) => (t.winners ?? []).filter((w) => w.award === award);
  const standings = $derived(finalOrder(t));
  const games = $derived([...(t.games ?? [])].sort((a, b) => a.position - b.position));
  const kumite = $derived(!!kanjiFor(type, "awards"));

  // An award turned over while you watch: it flips and burns in. Opened later (or after a step back), they're just
  // as they are
  let seen = untrack(() => reveal.revealed);
  let turning = $state<number[]>([]);
  $effect.pre(() => {
    const n = reveal.revealed;
    untrack(() => {
      if (n > seen && !prefersReducedMotion) {
        const fresh = Array.from({ length: n - seen }, (_, k) => seen + k);
        turning = [...turning, ...fresh];
        setTimeout(() => (turning = turning.filter((i) => !fresh.includes(i))), 2200);
      }
      seen = n;
    });
  });

  // One tap, one award: the tap says which it saw face down, so a double tap (or a second phone) reveals one
  let busy = $state(false);
  async function next() {
    if (busy || !reveal.next) return;
    busy = true;
    try {
      await revealAward(t.id, reveal.revealed);
    } finally {
      busy = false;
    }
  }
  const sub = $derived(
    after
      ? [afterNoteWords(after.note) || "celebration and awards", after.time && `from ${clock(after.time)}`]
          .filter(Boolean)
          .join(" · ")
      : "",
  );
</script>

<div class="afters">
  {#if manage && reveal.awards.length && !reveal.all}
    <!-- The one card for whoever runs it: confirm the awards, then reveal them one at a time -->
    <DraftStep {type} mark="awards" title="Reveal the next award">
      {#if !reveal.confirmed}
        Confirm the awards first, then call them out one at a time.
      {:else}
        Next: <strong>{reveal.next?.name}</strong> · {reveal.revealed} of {reveal.awards.length} out
      {/if}
      {#snippet action()}
        {#if !reveal.confirmed}
          <button class="btn primary" onclick={() => enterAwards(t.id)}>Confirm the awards</button>
        {:else}
          <button class="btn primary" disabled={busy} onclick={next}>Reveal</button>
        {/if}
      {/snippet}
    </DraftStep>
  {/if}

  <!-- Where everyone is now: the place big, what for, the map -->
  <section class="part pub">
    <span class="eyebrow">Now</span>
    <div class="pub-body">
      <span class="pub-place display"
        ><Icon name="glass" size={24} />{after?.name ?? `After the ${type.shortName}`}</span
      >
      <span class="pub-sub">{sub || "Everyone's done. Get a round in."}</span>
      {#if after}
        <a class="btn sm outline" href={after.mapUrl} target="_blank" rel="noopener noreferrer"
          ><Icon name="pin" size={16} />Map</a
        >
      {/if}
    </div>
  </section>

  {#if reveal.awards.length}
    <section class="part" aria-labelledby="awards-title">
      <h2 class="section-title" id="awards-title">The awards<Kanji text={kanjiFor(type, "awards")} /></h2>
      <ol class="awards">
        {#each reveal.awards as a, i (a.name)}
          {@const won = winnersOf(a.name)}
          <li class="award" class:up={a.revealed} class:turning={turning.includes(i)}>
            <div class="flip">
              <!-- Face down: a question mark, the award's place in the order -->
              <div class="face back" aria-hidden={a.revealed}>
                <span class="order num">{i + 1}</span>
                <span class="mystery display">?</span>
                {#if kumite}<span class="back-kanji" lang="ja" aria-hidden="true">{kanjiFor(type, "awards")}</span>{/if}
                <span class="sr-only">{a.revealed ? "" : `Award ${i + 1}, still face down`}</span>
              </div>
              <!-- Face up: the award, what it's for, who took it home -->
              <div class="face front" aria-hidden={!a.revealed}>
                {#if a.revealed}
                  <span class="award-name display">{a.name}</span>
                  {#if a.about}<span class="about">{a.about}</span>{/if}
                  <span class="won">
                    {#if !won.length}
                      <span class="hint">Nobody this time</span>
                    {:else if won.length > 2}
                      <span class="who display">Shared by {won.length}</span>
                    {:else}
                      {#each won as w, k (k)}
                        {#if w.teamId}
                          <a class="who-team" href={teamHref(type.slug, w.teamId)}>
                            <TeamCrest
                              among={crestNames}
                              name={teamName(w.teamId)}
                              logo={teams[teamIndex(w.teamId)]?.logo ?? null}
                              tone={teamTone(teamIndex(w.teamId))}
                              size="2.25rem"
                            />
                            <span class="who display">{teamName(w.teamId)}</span>
                          </a>
                        {:else}
                          <span class="who-player">
                            <span class="who display">{goesByOf(byId(w.memberId))}</span>
                            {#if teamOf(w.memberId)}<span class="hint">{teamName(teamOf(w.memberId))}</span>{/if}
                          </span>
                        {/if}
                      {/each}
                    {/if}
                  </span>
                  {#if kumite}<span class="stamp"><Kanji text={kanjiFor(type, "awards")} seal /></span>{/if}
                  {#if turning.includes(i)}<BurnReveal />{/if}
                {/if}
              </div>
            </div>
          </li>
        {/each}
      </ol>
      <!-- Room kept for the last line, so nothing under it moves when it comes -->
      <p class="closing" aria-live="polite">
        {#if reveal.all}
          <Icon name="trophy" size={18} />That's the {type.shortName}. See you at the next one.
        {:else if !manage}
          {reveal.revealed
            ? `${reveal.revealed} of ${reveal.awards.length} out. Stay for the rest.`
            : "Face down till they're called. Stay put."}
        {/if}
      </p>
    </section>
  {/if}

  {#if standings.length}
    <section class="part">
      <h2 class="section-title">The final table<Kanji text={kanjiFor(type, "champions")} /></h2>
      <ol class="standings">
        {#each standings as r, i (r.teamId)}
          <li class="standing" class:champs={r.champions}>
            <span class="pos num">{i + 1}</span>
            <TeamCrest
              among={crestNames}
              name={teamName(r.teamId)}
              logo={teams[teamIndex(r.teamId)]?.logo ?? null}
              tone={teamTone(teamIndex(r.teamId))}
              size={r.champions ? "2.5rem" : "2rem"}
            />
            <a class="team display" href={teamHref(type.slug, r.teamId)}>{teamName(r.teamId)}</a>
            {#if r.champions}<span class="champ"
                ><InkStamp
                  size="card"
                  tone="bone"
                  kanji={kanjiFor(type, "champions")}
                  icon="trophy"
                  text="{type.shortName} Champions"
                /></span
              >{/if}
            <span class="pts num">{r.pts}<span class="unit">Pts</span></span>
          </li>
        {/each}
      </ol>
    </section>
  {/if}

  {#if games.length}
    <section class="part">
      <h2 class="section-title">The results<Kanji text={kanjiFor(type, "fights")} /></h2>
      <ol class="results">
        {#each games as g (g.id)}
          {@const home = teamIndex(g.homeTeamId)}
          {@const away = teamIndex(g.awayTeamId)}
          <li>
            <a class="result" href="/tournaments/{type.slug}/games/{g.id}">
              <span class="game hint">{g.name || `Game ${g.position}`}</span>
              <span class="side home" class:lost={(g.homeGoals ?? 0) < (g.awayGoals ?? 0)}
                >{home >= 0 ? teamName(g.homeTeamId) : "–"}</span
              >
              <span class="score num">{g.homeGoals ?? "–"}–{g.awayGoals ?? "–"}</span>
              <span class="side away" class:lost={(g.awayGoals ?? 0) < (g.homeGoals ?? 0)}
                >{away >= 0 ? teamName(g.awayTeamId) : "–"}</span
              >
            </a>
          </li>
        {/each}
      </ol>
    </section>
  {/if}
</div>

<style>
  /* The pub after the last fight: brass on the carbon, a warm glow over the top of the view in place of the red */
  .afters {
    --brass: #d9a84e;
    --brass-ink: #f0c879;
    --brass-wash: color-mix(in srgb, var(--brass) 10%, transparent);
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s-6);
  }
  .afters::before {
    position: absolute;
    inset: -3rem -2rem auto;
    z-index: -1;
    height: 22rem;
    background: radial-gradient(
      28rem 16rem at 30% 0%,
      color-mix(in srgb, var(--brass) 14%, transparent),
      transparent 70%
    );
    content: "";
    pointer-events: none;
  }
  .part {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s-3);
  }
  .part .section-title {
    margin: 0;
    color: color-mix(in srgb, var(--brass-ink) 70%, var(--fg-muted));
  }
  .section-title :global(.kanji) {
    color: color-mix(in srgb, var(--brass) 45%, var(--fg-subtle));
  }

  /* Where everyone is: on the page, no panel */
  .pub {
    gap: var(--s-1);
  }
  .pub .eyebrow {
    color: var(--brass-ink);
  }
  .pub-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--s-1) var(--s-4);
  }
  .pub-place {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    min-width: 0;
    color: var(--fg);
    font-size: clamp(1.9rem, 6vw, 2.6rem);
    line-height: 1;
  }
  .pub-place :global(svg) {
    flex: none;
    color: var(--brass);
  }
  .pub-sub {
    grid-column: 1;
    color: var(--fg-muted);
  }
  .pub-body .btn {
    grid-row: 1 / span 2;
    grid-column: 2;
    gap: var(--s-1);
  }

  /* The awards: a card each, face down till it's called. One size face up or down, so nothing moves */
  .awards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 16rem), 1fr));
    gap: var(--s-3);
    margin: 0;
    padding: 0;
    list-style: none;
    perspective: 900px;
  }
  .award {
    height: 9.5rem;
  }
  .flip {
    position: relative;
    height: 100%;
    transform-style: preserve-3d;
  }
  .face {
    position: absolute;
    inset: 0;
    display: grid;
    overflow: hidden;
    border-radius: var(--r-lg);
    backface-visibility: hidden;
  }
  /* Face down: carbon, a brass question mark, the kanji faint behind it */
  .back {
    place-items: center;
    background:
      repeating-linear-gradient(135deg, rgb(255 255 255 / 0.018) 0 6px, transparent 6px 12px), var(--surface-1);
  }
  .mystery {
    color: color-mix(in srgb, var(--brass) 70%, transparent);
    font-size: 3.4rem;
    line-height: 1;
  }
  .back-kanji {
    position: absolute;
    right: var(--s-3);
    bottom: -0.6rem;
    color: color-mix(in srgb, var(--brass) 12%, transparent);
    font-family: var(--font-kanji);
    font-size: 5.5rem;
    font-weight: 900;
    line-height: 1;
  }
  .order {
    position: absolute;
    top: var(--s-2);
    left: var(--s-3);
    color: var(--fg-subtle);
    font-size: var(--text-xs);
    font-weight: 600;
  }
  /* Face up: the award in brass, what for, who took it home; the hanko in the corner */
  .front {
    align-content: start;
    gap: 0.2rem;
    padding: var(--s-3) var(--s-4);
    background: linear-gradient(var(--brass-wash), var(--brass-wash)), var(--surface-1);
    transform: rotateY(180deg);
  }
  .up .flip {
    transform: rotateY(180deg);
  }
  .turning .flip {
    animation: turn 0.7s cubic-bezier(0.3, 0.7, 0.3, 1) both;
  }
  @keyframes turn {
    from {
      transform: rotateY(0) scale(1);
    }
    50% {
      transform: rotateY(90deg) scale(1.04);
    }
    to {
      transform: rotateY(180deg) scale(1);
    }
  }
  .award-name {
    padding-right: 3rem;
    color: var(--brass-ink);
    font-size: 1.25rem;
    font-style: italic;
    letter-spacing: 0.02em;
    line-height: 1.1;
    text-transform: uppercase;
  }
  .about {
    display: -webkit-box;
    overflow: hidden;
    padding-right: 3rem;
    color: var(--fg-muted);
    font-size: var(--text-sm);
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .won {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    align-self: end;
    gap: var(--s-2) var(--s-4);
    min-width: 0;
    margin-top: auto;
  }
  .front {
    grid-template-rows: auto auto 1fr;
  }
  .who-team {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    min-width: 0;
    color: var(--fg);
  }
  .who-player {
    display: grid;
    min-width: 0;
  }
  .who {
    overflow: hidden;
    color: var(--fg);
    font-size: 1.5rem;
    line-height: 1.05;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .stamp {
    position: absolute;
    top: var(--s-3);
    right: var(--s-3);
    transform: scale(0.72);
    transform-origin: top right;
  }
  /* Turned over while you watch: the hanko comes down once the card's over */
  .turning .stamp {
    animation: stamp 0.45s 0.75s cubic-bezier(0.3, 1.4, 0.5, 1) both;
  }
  @keyframes stamp {
    from {
      opacity: 0;
      transform: scale(1.6) rotate(-12deg);
    }
  }
  /* The burn sweeps the winner in after the flip */
  .front :global(.burn) {
    inset: auto 0 0;
    height: 55%;
    animation: wait 0.6s both;
  }
  @keyframes wait {
    from {
      visibility: hidden;
    }
  }

  .closing {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    min-height: 1.6rem;
    margin: 0;
    color: var(--fg-muted);
  }
  .closing :global(svg) {
    color: var(--brass);
  }

  /* The final table: a line each, the champions first and a size up */
  .standings,
  .results {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .standing {
    display: grid;
    grid-template-columns: 1.25rem auto minmax(0, 1fr) auto auto;
    align-items: center;
    gap: var(--s-3);
    min-height: 3.25rem;
    padding-block: var(--s-1);
  }
  .standing + .standing {
    border-top: 1px solid var(--border);
  }
  .pos {
    color: var(--fg-subtle);
    font-weight: 600;
  }
  .team {
    overflow: hidden;
    color: var(--fg);
    font-size: 1.15rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .champs .team {
    font-size: 1.45rem;
  }
  .champs .pos {
    color: var(--brass);
  }
  /* The champions' stamp, as the match cards' (lib/InkStamp): bone, the win's ink */
  .champ {
    grid-column: 4;
    display: inline-flex;
  }
  /* Always the last column, so the champions' badge never pushes their points out of line with the rest */
  .pts {
    grid-column: 5;
    justify-self: end;
    color: var(--fg-muted);
    font-weight: 600;
  }
  .unit {
    margin-left: 0.2rem;
    color: var(--fg-subtle);
    font-size: var(--text-xs);
    font-weight: 500;
  }

  /* The day's results: one line a match, the score in the middle */
  .result {
    display: grid;
    grid-template-columns: 4.5rem minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: var(--s-3);
    min-height: 2.75rem;
    color: var(--fg);
  }
  .results li + li .result {
    border-top: 1px solid var(--border);
  }
  .side {
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .home {
    text-align: right;
  }
  .lost {
    color: var(--fg-muted);
    font-weight: 500;
  }
  .score {
    color: var(--fg);
    font-weight: 700;
  }
  .game {
    font-size: var(--text-xs);
  }
  @media (hover: hover) {
    .result:hover .side:not(.lost) {
      color: var(--brass-ink);
    }
  }
  /* A phone: the champions' stamp goes (the trophy and the size say it) */
  @media (max-width: 440px) {
    .champ {
      display: none;
    }
    .result {
      grid-template-columns: 3.25rem minmax(0, 1fr) auto minmax(0, 1fr);
      gap: var(--s-2);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .turning .flip,
    .turning .stamp {
      animation: none;
    }
  }
</style>
