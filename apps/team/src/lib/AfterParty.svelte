<script lang="ts">
  // The after-party (ADR 0074): the evening a tournament ends, its last status. Everyone's at the afterwards (the
  // Kumite's The Anchor), so the page is the pub after the film's last match: warm brass on the carbon, the Kumite's
  // motif kept. Two steps (ADR 0044). First the awards are confirmed: everyone who played votes (Cast your vote),
  // whoever runs it checks the stats and draws and makes the judges' call (Confirm the awards), which closes voting.
  // Then the reveal, on one card, a drum like the old scoreboards': sealed, the award's name big and a question mark;
  // a tap (whoever runs it) rolls the face up in as the sealed face rolls away, one machine, then the hanko lands;
  // Next award rolls it on to the next, sealed. Everyone's phone follows each roll live (the live hub), so everyone
  // sees the same card. The champions (the award the table decides) are the finale: their card is the bigger one,
  // its roll heavier, its hanko bigger; the drum's room is the finale's from the start, so nothing ever moves, and
  // nothing scrolls. Under it, the winners so far, a line each as they come. Opened later, it's just where it is.
  // Then where everyone is, the final table (the champions first) and the day's results, one line each.
  import type { Tournament, TournamentType } from "../demo/model";
  import type { After } from "@cougars/shared/places";
  import { PLAYERS } from "../demo/data";
  import Icon from "../app/shell/Icon.svelte";
  import { nextAward, revealAward } from "../app/backend.svelte";
  import { untrack } from "svelte";
  import { enterAwards } from "./AwardsDrawer.svelte";
  import DraftStep from "./DraftStep.svelte";
  import Kanji from "./Kanji.svelte";
  import BoardWords from "./BoardWords.svelte";
  import BoardTable from "./BoardTable.svelte";
  import CastYourVote from "./CastYourVote.svelte";
  import { votersOf } from "./awards";
  import TeamCrest from "./TeamCrest.svelte";
  import { finalOrder, isFinale, revealOf } from "./afters";
  import { kanjiFor } from "./motif";
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
  // A roll's beats: the drum turns over in one roll (slow to start, quicker, a knock as it stops), then the hanko
  // comes down. The finale's drum is heavier: a slower roll, a bigger hanko
  const ROLL_MS = 750;
  const FINALE_ROLL_MS = 1200;
  const finale = (i: number) => !!reveal.awards[i] && isFinale(reveal.awards[i]);
  const rollOf = (i: number) => (finale(i) ? FINALE_ROLL_MS : ROLL_MS);
  const hasFinale = $derived(reveal.awards.some((a) => isFinale(a)));

  // The drum: the card showing (which award, which face), and while it rolls the one rolling away. A change from
  // the server (this tap, or another phone's) rolls it; opened later, it's just where it is
  type Card = { at: number; face: "sealed" | "up" };
  let shown = $state<Card>(untrack(() => reveal.drum));
  let leaving = $state<Card | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect.pre(() => {
    const d = reveal.drum;
    untrack(() => {
      if (d.at === shown.at && d.face === shown.face) return;
      leaving = shown;
      shown = d;
      clearTimeout(timer);
      timer = setTimeout(() => (leaving = null), rollOf(d.at) + 900);
    });
  });
  $effect(() => () => clearTimeout(timer));

  // The confirm stage, for whoever runs it: how many have voted for each voted award (never who for), and what's
  // still to choose (the judges' call)
  const positionOf = (id: number) => byId(id)?.position;
  const voteLines = $derived(
    reveal.awards
      .filter((a) => a.how.kind === "vote")
      .map(
        (a) =>
          `${a.name}: ${t.votes?.find((v) => v.award === a.name)?.cast ?? 0} of ${votersOf(a, t, { positionOf }).length} voted`,
      ),
  );
  const toChoose = $derived(reveal.awards.filter((a) => a.how.kind === "live").map((a) => a.name));

  // One tap, one roll: the tap says where it saw the drum, so a double tap (or a second phone) rolls it once. Every
  // winner's set when the awards are confirmed, so the reveal only turns them over
  let busy = $state(false);
  const canTap = $derived(
    manage && reveal.confirmed && !leaving && (shown.face === "sealed" || shown.at < reveal.awards.length - 1),
  );
  async function tap() {
    if (busy || !canTap) return;
    busy = true;
    try {
      if (shown.face === "sealed") await revealAward(t.id, reveal.revealed);
      else await nextAward(t.id, reveal.revealed);
    } finally {
      busy = false;
    }
  }
  // What it's called tonight: the judges' call's name, once confirmed
  const nameOf = (i: number) => reveal.awards[i]?.title ?? reveal.awards[i]?.name ?? "";
  // The winners so far, a line each as they come, the room for every one kept
  const sofar = $derived(reveal.awards.map((a, i) => ({ a, i, out: a.revealed && !(leaving && shown.at === i) })));
  const sub = $derived(
    after
      ? [afterNoteWords(after.note) || "celebration and awards", after.time && `from ${clock(after.time)}`]
          .filter(Boolean)
          .join(" · ")
      : "",
  );
</script>

{#snippet face(c: { at: number; face: "sealed" | "up" })}
  {@const a = reveal.awards[c.at]}
  {@const won = winnersOf(a.name)}
  {@const big = finale(c.at)}
  {#if c.face === "sealed"}
    <!-- Sealed: the award's name, big, for everyone (what's coming isn't the secret: who took it is), a question mark
         where the winner will be, its place in the order -->
    <div class="face back">
      <span class="order num">{c.at + 1} of {reveal.awards.length}</span>
      <span class="back-name"><BoardWords text={nameOf(c.at)} size={big ? "1.8rem" : "1.35rem"} /></span>
      <span class="mystery display">?</span>
      {#if kumite}<span class="back-kanji" lang="ja" aria-hidden="true"
          >{kanjiFor(type, big ? "champions" : "awards")}</span
        >{/if}
      <span class="cue" class:go={manage && reveal.confirmed}>
        {#if manage && reveal.confirmed}<Icon name="medal" size={16} />Tap to reveal
        {:else if manage}Confirm the awards to reveal
        {:else}Waiting for the reveal{/if}
      </span>
    </div>
  {:else}
    <!-- Face up: the award in brass, what it's for, who took it home in bone; the hanko last -->
    <div class="face front">
      <span class="award-name"><BoardWords text={nameOf(c.at)} size={big ? "1.8rem" : "1.35rem"} /></span>
      {#if a.title}<span class="about">{a.name}{a.about ? `: ${a.about}` : ""}</span>
      {:else if a.about}<span class="about">{a.about}</span>{/if}
      <span class="won">
        {#if !won.length || won.length > 2}
          <span class="who" class:none={!won.length}
            ><BoardWords text={wonWords(a.name)[0]} size={big ? "2.4rem" : "1.65rem"} /><span
              class="hint"
              aria-hidden="true">&nbsp;</span
            ></span
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
                    size={big ? "4rem" : "2.25rem"}
                  /></span
                >
                <span class="who-name"
                  ><BoardWords
                    text={teamName(w.teamId)}
                    size={big ? "2.4rem" : "1.65rem"}
                    lines={won.length > 1 ? 1 : 2}
                  /><span class="hint" aria-hidden="true">&nbsp;</span></span
                >
              </a>
            {:else}
              <span class="who who-player">
                <BoardWords text={goesByOf(byId(w.memberId))} size="1.65rem" lines={won.length > 1 ? 1 : 2} />
                <!-- Always a line under the name, so the winner sits on the same line on every card -->
                <span class="hint">{teamOf(w.memberId) ? teamName(teamOf(w.memberId)) : "\u00a0"}</span>
              </span>
            {/if}
          {/each}
        {/if}
      </span>
      {#if kumite}<span class="stamp"><Kanji text={kanjiFor(type, big ? "champions" : "awards")} seal /></span>{/if}
      {#if manage && c.at < reveal.awards.length - 1}<span class="cue go next"
          ><Icon name="chevronRight" size={16} />Next award</span
        >{/if}
    </div>
  {/if}
{/snippet}

<div class="afters">
  <!-- The first step, before the reveal: voting open till the awards are confirmed. Everyone who played votes; whoever
       runs it confirms (making the judges' call); then the second, the reveal, one card at a time -->
  <CastYourVote {type} tournament={t} />
  {#if manage && reveal.awards.length && !reveal.confirmed}
    <DraftStep {type} mark="awards" title="Confirm the awards">
      {[...voteLines, toChoose.length ? `Still to choose: ${toChoose.join(", ")}` : ""].filter(Boolean).join(" · ") ||
        "Check them"}. Confirming closes voting; then the reveal, a tap a card.
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
      <!-- The drum: one card, the finale's room from the start. The card rolling away and the one rolling in share it -->
      <div class="drum" class:tall={hasFinale} aria-live="polite">
        {#if leaving}
          <div
            class="card out"
            class:finale={finale(leaving.at)}
            style:--roll="{rollOf(shown.at)}ms"
            aria-hidden="true"
          >
            {@render face(leaving)}
          </div>
        {/if}
        {#key `${shown.at}:${shown.face}`}
          <div
            class="card in"
            class:rolling={!!leaving}
            class:finale={finale(shown.at)}
            style:--roll="{rollOf(shown.at)}ms"
            style:--stamp-at="{rollOf(shown.at) + 150}ms"
          >
            {@render face(shown)}
            {#if canTap}
              <button
                class="tap"
                type="button"
                disabled={busy}
                aria-label={shown.face === "sealed" ? `Reveal ${nameOf(shown.at)}` : "Next award"}
                onclick={tap}
              ></button>
            {/if}
          </div>
        {/key}
      </div>
      <!-- The winners so far, a line each as they're revealed; every line's room kept, so nothing under moves -->
      <ol class="sofar" aria-label="The winners so far">
        {#each sofar as { a, i, out } (a.name)}
          <li class:out>
            {#if out}<span class="sofar-award">{nameOf(i)}</span><span class="sofar-who"
                >{wonWords(a.name).join(" & ")}</span
              >{/if}
          </li>
        {/each}
      </ol>
    </section>
  {/if}

  {#if standings.length}
    <!-- The table with the stats we track (played, won, drawn, lost, goal difference, points), the champions first -->
    <section class="part">
      <h2 class="section-title">The final table<Kanji text={kanjiFor(type, "champions")} /></h2>
      <BoardTable {type} tournament={t} order={standings} />
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

  /* The drum: one card for the awards, its room fixed (the finale's, if there is one, from the start), so nothing
     below it ever moves; the cards rolling in and away share it and it clips them */
  .drum {
    position: relative;
    height: 11rem;
    overflow: clip;
    border-radius: var(--r-lg);
  }
  .drum.tall {
    height: 15.5rem;
  }
  .card {
    position: absolute;
    inset: 0;
  }
  .face {
    position: absolute;
    inset: 0;
    display: grid;
    overflow: hidden;
    border-radius: var(--r-lg);
  }
  /* Sealed: carbon, the award's name in brass, a brass question mark, the kanji faint behind it */
  .back {
    place-items: center;
    background:
      repeating-linear-gradient(135deg, rgb(255 255 255 / 0.018) 0 6px, transparent 6px 12px), var(--surface-1);
  }
  .back-name {
    position: absolute;
    top: var(--s-3);
    right: 5rem;
    left: var(--s-4);
    color: var(--brass-ink);
  }
  .mystery {
    color: color-mix(in srgb, var(--brass) 70%, transparent);
    font-size: 3.4rem;
    line-height: 1;
  }
  .finale .mystery {
    font-size: 5rem;
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
  .finale .back-kanji {
    font-size: 8rem;
  }
  .order {
    position: absolute;
    top: var(--s-3);
    right: var(--s-4);
    color: var(--fg-subtle);
    font-size: var(--text-xs);
    font-weight: 600;
  }
  /* The card's line: what it's waiting for, or (whoever runs it) the tap: Tap to reveal, then Next award */
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
  .cue.next {
    right: var(--s-4);
    left: auto;
  }
  /* The whole card is the button, for whoever runs it (Enter or Space too): a brass glow says it's live */
  .tap {
    position: absolute;
    inset: 0;
    z-index: 2;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: var(--r-lg);
    background: none;
    cursor: pointer;
  }
  .tap:disabled {
    cursor: progress;
  }
  .tap:focus-visible {
    outline: 2px solid var(--brass-ink);
    outline-offset: -2px;
  }
  .card:has(.tap) .face {
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--brass) 35%, transparent),
      0 0 1.5rem color-mix(in srgb, var(--brass) 14%, transparent);
  }
  @media (hover: hover) {
    .card:has(.tap:hover) .face {
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--brass) 60%, transparent);
    }
  }
  /* Face up: a dark board: the award in brass poster capitals, what for, who took it home in bone
     (lib/BoardWords); the hanko in the corner */
  .front {
    grid-template-rows: auto auto 1fr;
    align-content: start;
    gap: 0.35rem;
    padding: var(--s-3) var(--s-4) var(--s-4);
    background: color-mix(in srgb, var(--bg) 72%, black);
  }
  /* The finale: the champions, bigger, ringed in brass, the crest and the name a size up */
  .finale .front {
    padding: var(--s-4) var(--s-5) var(--s-5);
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--brass) 45%, transparent),
      inset 0 0 3rem color-mix(in srgb, var(--brass) 10%, transparent);
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
  /* The winner at the card's foot, a line under the name always kept (the player's team, or empty) */
  .won {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    align-self: end;
    gap: var(--s-2) var(--s-4);
    min-width: 0;
    padding-right: 6rem;
  }
  .who {
    display: grid;
    flex: 1 1 9rem;
    row-gap: 0.15rem;
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
  .who-name {
    display: contents;
  }
  .who-team .hint {
    grid-column: 2;
  }
  .crest {
    display: inline-flex;
    flex: none;
  }
  .who .hint {
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
  .finale .stamp {
    top: auto;
    bottom: var(--s-4);
    right: var(--s-4);
    transform: scale(1.15);
    transform-origin: bottom right;
  }
  /* One roll, one machine: the card coming in rolls down into view as the one before rolls down and away, slow to
     start (the drum's weight), quicker, then a knock as it stops, a touch past and back. Then the hanko lands */
  .rolling {
    animation: roll-in var(--roll) both;
  }
  .out {
    animation: roll-out var(--roll) both;
  }
  @keyframes roll-out {
    0% {
      transform: none;
      animation-timing-function: cubic-bezier(0.7, 0, 0.95, 0.55);
    }
    80% {
      transform: translateY(119%);
      animation-timing-function: ease-out;
    }
    90% {
      transform: translateY(113.5%);
      animation-timing-function: ease-in-out;
    }
    100% {
      transform: translateY(115%);
    }
  }
  @keyframes roll-in {
    0% {
      transform: translateY(-115%);
      animation-timing-function: cubic-bezier(0.7, 0, 0.95, 0.55);
    }
    80% {
      transform: translateY(4%);
      animation-timing-function: ease-out;
    }
    90% {
      transform: translateY(-1.5%);
      animation-timing-function: ease-in-out;
    }
    100% {
      transform: none;
    }
  }
  .rolling .stamp {
    animation: stamp 0.45s var(--stamp-at) cubic-bezier(0.3, 1.4, 0.5, 1) both;
  }
  .rolling.finale .stamp {
    animation-duration: 0.6s;
  }
  @keyframes stamp {
    from {
      opacity: 0;
      scale: 1.6;
      rotate: -12deg;
    }
  }

  /* The winners so far: a line each, the award quiet and the winner bright; each line's room kept from the start */
  .sofar {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .sofar li {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--s-3);
    min-height: 2.25rem;
    padding-block: var(--s-1);
  }
  .sofar li.out + li.out {
    border-top: 1px solid var(--border);
  }
  .sofar-award {
    color: var(--brass-ink);
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .sofar-who {
    overflow: hidden;
    color: var(--fg);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .results {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
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
  /* A phone: the results' columns closer */
  @media (max-width: 440px) {
    .result {
      grid-template-columns: 3.25rem minmax(0, 1fr) auto minmax(0, 1fr);
      gap: var(--s-2);
    }
  }
  /* Reduced motion: no roll and no hanko coming down: the card coming in crossfades over the one going */
  @media (prefers-reduced-motion: reduce) {
    .rolling .stamp {
      animation: none;
    }
    .rolling {
      animation: fade 0.4s ease both;
    }
    .out {
      animation: fade 0.4s ease reverse both;
    }
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
</style>
