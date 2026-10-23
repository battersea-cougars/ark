<script lang="ts">
  // The after-party (ADR 0074): the evening a tournament ends, its last status. Everyone's at the afterwards (the
  // Kumite's The Anchor), so the page is the pub after the film's last fight: warm brass on the carbon, the Kumite's
  // motif kept. The awards come up one at a time, in the order listed: what's out face up, then the next one sealed
  // (a card with a question mark), the rest not yet there (their room kept, so nothing moves). Whoever runs it taps the
  // sealed card to reveal it (Confirm the awards first, if they aren't yet); for everyone else it waits. Each tap turns
  // ONE award over for everyone watching (the live hub): the card stays put and its face becomes a dark board, like the
  // old scoreboards, the award's name and then who took it home clacking in flap by flap (lib/SplitFlap), then a 賞
  // hanko comes down; the page brings it into view, and the next sealed card rises in under it. Opened later, what's
  // out is just there. Then where everyone is, the final table (the champions first) and the day's results, one line
  // each.
  import type { Tournament, TournamentType } from "../demo/model";
  import type { After } from "@cougars/shared/places";
  import { PLAYERS } from "../demo/data";
  import Icon from "../app/shell/Icon.svelte";
  import { revealAward } from "../app/backend.svelte";
  import { prefersReducedMotion } from "../app/motion";
  import { untrack } from "svelte";
  import { enterAwards } from "./AwardsDrawer.svelte";
  import DraftStep from "./DraftStep.svelte";
  import Kanji from "./Kanji.svelte";
  import SplitFlap from "./SplitFlap.svelte";
  import TeamCrest from "./TeamCrest.svelte";
  import { finalOrder, revealOf } from "./afters";
  import { kanjiFor } from "./motif";
  import { flapMs } from "./split-flap";
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

  // What the board says under an award: who took it home (one or two), how many shared it, or that nobody did
  const wonWords = (award: string) => {
    const won = winnersOf(award);
    if (!won.length) return ["Nobody this time"];
    if (won.length > 2) return [`Shared by ${won.length}`];
    return won.map((w) => (w.teamId ? teamName(w.teamId) : goesByOf(byId(w.memberId))));
  };
  // A reveal's beats, ms after the tap lands: the board comes on, the award's name clacks in, then who took it home,
  // then the hanko comes down. About 2s, however long the names (long ones clack faster)
  const BOARD_ON_MS = 250;
  const BEAT_MS = 180;
  const boardOf = (award: string) => {
    const name = BOARD_ON_MS;
    const about = name + flapMs(award);
    const won = about + BEAT_MS;
    const stamp = won + Math.max(...wonWords(award).map(flapMs)) + 120;
    return { name, about, won, stamp };
  };

  // An award turned over while you watch: its face becomes the board and the words clack in (with reduced motion,
  // the board fades in, the words just there), the page brings it into view, and once the hanko's down the next
  // sealed card rises in. Opened later (or after a step back), they're just as they are
  let seen = untrack(() => reveal.revealed);
  let turning = $state<number[]>([]);
  let rising = $state(-1);
  const cards: HTMLElement[] = $state([]);
  $effect.pre(() => {
    const n = reveal.revealed;
    untrack(() => {
      if (n > seen) {
        const fresh = Array.from({ length: n - seen }, (_, k) => seen + k);
        const done = Math.max(...fresh.map((k) => boardOf(reveal.awards[k]?.name ?? "").stamp)) + 700;
        turning = [...turning, ...fresh];
        rising = n;
        setTimeout(() => (turning = turning.filter((i) => !fresh.includes(i))), done);
        setTimeout(() => {
          if (rising === n) rising = -1;
        }, done + 400);
        requestAnimationFrame(() =>
          cards[n - 1]?.scrollIntoView({ block: "center", behavior: prefersReducedMotion ? "auto" : "smooth" }),
        );
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
  {#if manage && reveal.awards.length && !reveal.confirmed}
    <!-- Whoever runs it confirms the awards first; then they tap each card to reveal it -->
    <DraftStep {type} mark="awards" title="Confirm the awards">
      Confirm the awards first, then tap each card to call them out one at a time.
      {#snippet action()}
        <button class="btn primary" onclick={() => enterAwards(t.id)}>Confirm the awards</button>
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
          {@const sealed = i === reveal.revealed}
          {@const tap = manage && sealed && reveal.confirmed}
          {@const times = boardOf(a.name)}
          {@const playing = turning.includes(i)}
          <li
            class="award"
            class:up={a.revealed}
            class:sealed
            class:later={i > reveal.revealed}
            class:turning={playing}
            class:rising={rising === i}
            style:--rise-at={rising === i && i > 0 ? `${boardOf(reveal.awards[i - 1].name).stamp + 200}ms` : null}
            aria-hidden={i > reveal.revealed}
            bind:this={cards[i]}
          >
            <!-- Face down: a question mark, the award's place in the order; for whoever runs it, the card to tap. Kept
                 under the board while it comes on -->
            {#if !a.revealed || playing}
              <div class="face back" aria-hidden={a.revealed}>
                <span class="order num">{i + 1}</span>
                <span class="mystery display">?</span>
                {#if kumite}<span class="back-kanji" lang="ja" aria-hidden="true">{kanjiFor(type, "awards")}</span>{/if}
                {#if sealed}
                  <span class="cue" class:go={tap}>
                    {#if tap}<Icon name="medal" size={16} />Tap to reveal: {a.name}
                    {:else if manage}Confirm the awards to reveal
                    {:else}Waiting for the reveal{/if}
                  </span>
                {/if}
                {#if tap}
                  <button
                    class="tap"
                    type="button"
                    disabled={busy}
                    aria-label="Reveal award {i + 1}: {a.name}"
                    onclick={next}
                  ></button>
                {:else if !a.revealed}
                  <span class="sr-only">Award {i + 1}, still face down</span>
                {/if}
              </div>
            {/if}
            <!-- Face up: a dark board, the award and who took it home clacking in, what it's for; the hanko last -->
            {#if a.revealed}
              <div
                class="face front"
                style:--about-at="{times.about}ms"
                style:--won-at="{times.won}ms"
                style:--stamp-at="{times.stamp}ms"
              >
                <span class="award-name"
                  ><SplitFlap text={a.name} play={playing} delay={times.name} size="1.15rem" /></span
                >
                {#if a.about}<span class="about">{a.about}</span>{/if}
                <span class="won">
                  {#if !won.length || won.length > 2}
                    <span class="who" class:none={!won.length}
                      ><SplitFlap text={wonWords(a.name)[0]} play={playing} delay={times.won} size="1.4rem" /></span
                    >
                  {:else}
                    {#each won as w, k (k)}
                      {#if w.teamId}
                        <a class="who who-team" href={teamHref(type.slug, w.teamId)}>
                          <span class="crest"
                            ><TeamCrest
                              among={crestNames}
                              name={teamName(w.teamId)}
                              logo={teams[teamIndex(w.teamId)]?.logo ?? null}
                              tone={teamTone(teamIndex(w.teamId))}
                              size="2.25rem"
                            /></span
                          >
                          <SplitFlap
                            text={teamName(w.teamId)}
                            play={playing}
                            delay={times.won}
                            size="1.4rem"
                            lines={won.length > 1 ? 1 : 2}
                          />
                        </a>
                      {:else}
                        <span class="who who-player">
                          <SplitFlap
                            text={goesByOf(byId(w.memberId))}
                            play={playing}
                            delay={times.won}
                            size="1.4rem"
                            lines={won.length > 1 ? 1 : 2}
                          />
                          {#if teamOf(w.memberId)}<span class="hint">{teamName(teamOf(w.memberId))}</span>{/if}
                        </span>
                      {/if}
                    {/each}
                  {/if}
                </span>
                {#if kumite}<span class="stamp"><Kanji text={kanjiFor(type, "awards")} seal /></span>{/if}
              </div>
            {/if}
          </li>
        {/each}
      </ol>
      <!-- Room kept for the line under the cards (members only, till the last is out), so nothing moves when it goes -->
      <p class="closing" aria-live="polite">
        {#if !reveal.all && !manage}
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
  /* The glow fades to nothing inside its own box on every side (the mask), and the box stays inside the page's
     sides (.view clips across), so it reads as warm light with no edge on a phone or a desktop */
  .afters::before {
    position: absolute;
    inset: -4rem -1rem auto;
    z-index: -1;
    height: 26rem;
    background: radial-gradient(60% 55% at 32% 40%, color-mix(in srgb, var(--brass) 15%, transparent), transparent 75%);
    content: "";
    pointer-events: none;
    mask-image: radial-gradient(closest-side, #000 55%, transparent);
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
  }
  .award {
    position: relative;
    height: 10.5rem;
  }
  .face {
    position: absolute;
    inset: 0;
    display: grid;
    overflow: hidden;
    border-radius: var(--r-lg);
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
  /* The sealed card's line: what it's waiting for, or (whoever runs it) the tap that reveals it */
  .cue {
    position: absolute;
    right: var(--s-3);
    bottom: var(--s-3);
    left: var(--s-3);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-1);
    overflow: hidden;
    color: var(--fg-muted);
    font-size: var(--text-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cue.go {
    color: var(--brass-ink);
    font-weight: 600;
  }
  /* The whole sealed card is the button, for whoever runs it (Enter or Space too): a brass glow says it's live */
  .tap {
    position: absolute;
    inset: 0;
    z-index: 1;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: inherit;
    background: none;
    cursor: pointer;
  }
  .tap:disabled {
    cursor: progress;
  }
  .tap:focus-visible {
    outline: 2px solid var(--brass-ink);
    outline-offset: 2px;
  }
  .sealed .back:has(.tap) {
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--brass) 35%, transparent),
      0 0 1.5rem color-mix(in srgb, var(--brass) 14%, transparent);
    transition: box-shadow var(--dur, 200ms) ease;
  }
  @media (hover: hover) {
    .sealed .back:has(.tap:hover) {
      box-shadow:
        inset 0 0 0 1px color-mix(in srgb, var(--brass) 60%, transparent),
        0 0 2rem color-mix(in srgb, var(--brass) 24%, transparent);
    }
  }
  .sealed .back:has(.tap:active) .mystery {
    transform: scale(0.94);
  }
  /* Not up yet, after the sealed one: an empty slot, just its number, its room kept so nothing moves as they come */
  .later .back {
    background: color-mix(in srgb, var(--surface-1) 70%, transparent);
  }
  .later .mystery,
  .later .back-kanji {
    visibility: hidden;
  }
  .later .order {
    opacity: 0.6;
  }
  /* The next card comes up once the last one's over: it rises into its slot */
  .rising {
    animation: rise 0.6s var(--rise-at, 0.85s) cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(1.5rem) scale(0.97);
    }
  }
  .order {
    position: absolute;
    top: var(--s-2);
    left: var(--s-3);
    color: var(--fg-subtle);
    font-size: var(--text-xs);
    font-weight: 600;
  }
  /* Face up: a dark board, as the old scoreboards: the award in brass flaps, what for, who took it home in bone
     (lib/SplitFlap); the hanko in the corner */
  .front {
    z-index: 1;
    grid-template-rows: auto auto 1fr;
    align-content: start;
    gap: 0.35rem;
    padding: var(--s-3) var(--s-4);
    background: color-mix(in srgb, var(--bg) 72%, black);
    --flap-face: color-mix(in srgb, var(--surface-2) 95%, var(--brass));
  }
  .award-name {
    padding-right: 3rem;
    color: var(--brass-ink);
  }
  .about {
    display: -webkit-box;
    overflow: hidden;
    padding-right: 3rem;
    color: var(--fg-muted);
    font-size: var(--text-sm);
    line-height: 1.3;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .won {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    align-self: end;
    gap: var(--s-2) var(--s-4);
    min-width: 0;
  }
  .who {
    flex: 1 1 9rem;
    min-width: 0;
    color: var(--fg);
  }
  .who.none {
    color: var(--fg-muted);
  }
  .who-team {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  .who-team :global(.split-flap) {
    flex: 1;
  }
  .crest {
    display: inline-flex;
    flex: none;
  }
  .who-player {
    display: grid;
    gap: 0.15rem;
  }
  .who-player .hint {
    overflow: hidden;
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
  /* Turned over while you watch: the board comes on over the face-down card, the words clack in (SplitFlap), what
     it's for and the crest come up as their words settle, and the hanko comes down once they have */
  .turning .front {
    animation: fade 0.25s ease both;
  }
  .turning .about {
    animation: fade 0.3s var(--about-at) ease both;
  }
  .turning .crest,
  .turning .who-player .hint {
    animation: fade 0.3s var(--won-at) ease both;
  }
  .turning .stamp {
    animation: stamp 0.45s var(--stamp-at) cubic-bezier(0.3, 1.4, 0.5, 1) both;
  }
  @keyframes stamp {
    from {
      opacity: 0;
      transform: scale(1.6) rotate(-12deg);
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
  /* Reduced motion: no flaps (SplitFlap's words are just there), no hanko coming down and no rise; the board and
     the next card fade in */
  @media (prefers-reduced-motion: reduce) {
    .turning .about,
    .turning .crest,
    .turning .who-player .hint,
    .turning .stamp {
      animation: none;
    }
    .turning .front {
      animation: fade 0.4s ease both;
    }
    .rising {
      animation: fade 0.4s 0.4s ease both;
    }
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
</style>
