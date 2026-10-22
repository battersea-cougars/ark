<script lang="ts">
  // A tournament series' page (ADR 0074): one page for the one on or coming up (lib/edition.ts currentOf), by status.
  // The header (its day, its place on the map, where everyone goes after), then the track of its statuses (Sign-up
  // open, Draft open, Teams set, Fixtures set, KUMITE!; teams that enter skip the draft), then the status's view, each
  // the same shape: its one action card for whoever runs it (members see the card without the button, or nothing),
  // then what it's about. Sign-up: are you in, and who's in. Draft open: the draft, for its captains and whoever runs
  // it; everyone else is fighting blind. Teams set: every team, in full. Fixtures set: the matches, a list. KUMITE!:
  // your turn to keep score, the matches as a carousel with the one on now in front, where everyone goes after, the
  // board. A status it's been through opens from the track, read-only, at its own address (/sign-up, /draft, /teams,
  // /schedule); the page's own address is the status it's at. Moving between them the header and the track stay still
  // and the view slides in from the way you went. History is a quiet link at the foot.
  // Once the last game's played it's history: with nothing on, the page says so, big (the Kumite in its Bloodsport
  // motif), with an admin's Next Kumite, and every past one under it, newest first, each opening its own page.
  import { nameOfTeam } from "../lib/names";
  import { can } from "../access/actions";
  import { granted, me } from "../demo/session.svelte";
  import { PLAYERS } from "../demo/data";
  import { currentTournament, pastTournaments, tournamentAfter, typeById } from "../demo/schedule.svelte";
  import SignUpLine from "../lib/SignUpLine.svelte";
  import Kanji from "../lib/Kanji.svelte";
  import { kanjiFor } from "../lib/motif";
  import TournamentHead from "../lib/TournamentHead.svelte";
  import PastEditions from "../lib/PastEditions.svelte";
  import Leaderboard from "../lib/Leaderboard.svelte";
  import { editTournament } from "../lib/TournamentEditorPanel.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import { checkForUpdates } from "../lib/live-updates.svelte";
  import { clock, londonToday } from "../lib/dates";
  import { kickOff, slotMinutes } from "../lib/fixtures";
  import { afterMomentOf, myTeamIndex, onTheDayOf, statusList, statusOf, viewOf } from "../lib/tournament-front";
  import type { After } from "@cougars/shared/places";
  import YourTeam from "../lib/YourTeam.svelte";
  import BoardTable from "../lib/BoardTable.svelte";
  import WhosIn from "../lib/WhosIn.svelte";
  import PickLog from "../lib/PickLog.svelte";
  import DraftStep from "../lib/DraftStep.svelte";
  import Draft from "./Draft.svelte";
  import Schedule from "./Schedule.svelte";
  import TournamentTeams from "./TournamentTeams.svelte";
  import { router } from "../app/router.svelte";
  import { phone } from "../lib/viewport.svelte";
  import { prefersReducedMotion } from "../app/motion";
  import { db } from "../demo/store.svelte";
  import { blindLine } from "../lib/quips";
  import { untrack } from "svelte";
  import { cubicOut } from "svelte/easing";

  let { typeId }: { typeId: number } = $props();

  const perms = $derived(granted());
  const type = $derived(typeById(typeId)!);
  const tournament = $derived(currentTournament(typeId));
  const past = $derived(tournament ? [] : pastTournaments(typeId));
  // While one's on, the past ones are History: not a tab, a link at the foot here
  const earlier = $derived(tournament ? pastTournaments(typeId).length : 0);
  const kumite = $derived(!!kanjiFor(type, "onTheMat"));
  const teams = $derived(tournament?.teams ?? []);
  const teamName = (i: number) => nameOfTeam(teams[i], teams, (id) => PLAYERS.find((p) => p.id === id));
  const manage = $derived(can(perms, "manage:Tournament"));
  const today = $derived(londonToday());

  const games = $derived(tournament?.games ?? []);
  // Everyone sees the score as it happens: on the day, until the last game's over, from the hub's stream, with a
  // check on the admins' beat as the fallback (ADR 0061, 0072)
  const following = $derived(
    games.some((g) => g.status === "live") || (tournament?.heldOn === today && games.some((g) => g.status !== "done")),
  );
  $effect(() => {
    if (following) return checkForUpdates();
  });

  const mine = $derived(tournament ? myTeamIndex(tournament, me().id) : -1);
  const myTeamId = $derived(mine >= 0 ? teams[mine].id : undefined);
  // Keeping score (ADR 0061): a game whose scoresheet you hold, else the game up next when it's your team's turn and
  // nobody's taken it yet. Only the game up next (or on now) is taken on: the first in the day's order not over
  const upNext = $derived(games.find((g) => g.status !== "done"));
  const duty = $derived(
    games.find((g) => g.status !== "done" && g.keeperId === me().id) ??
      (myTeamId && upNext && upNext.scoringTeamId === myTeamId && !upNext.keeperId ? upNext : undefined),
  );
  const holding = $derived(duty?.keeperId === me().id);
  const vs = (g: { homeTeamId: number | null; awayTeamId: number | null }) =>
    [g.homeTeamId, g.awayTeamId].map((id) => teamName(teams.findIndex((t) => t.id === id))).join(" v ");
  const at = (position: number) =>
    tournament ? clock(kickOff(tournament.startTime, slotMinutes(tournament), position)) : "";

  // The status it's at, and the one showing: the page's own address shows the one it's at; /draft, /teams,
  // /schedule, /sign-up one it's been through (lib/tournament-front.ts viewOf)
  const base = $derived(`/tournaments/${type.slug}`);
  const rest = $derived(router.path.startsWith(base + "/") ? router.path.slice(base.length + 1) : "");
  const status = $derived(tournament ? statusOf(tournament, today) : "signup");
  const view = $derived(tournament ? viewOf(tournament, today, rest) : "signup");
  const drafted = $derived(tournament?.kind === "draft");
  // The draft is its captains' and whoever runs it (ADR 0060): everyone else fights blind until it's done
  const inDraft = $derived(teams.some((t) => t.captainMemberId === me().id) || can(perms, "run:Draft"));
  // Which view's in the pane. One Draft goes from the draw to the picking, so the shuffle plays as the draft opens;
  // the teams (complete) are another, so closing it slides on to them
  const pane = $derived.by(() => {
    if (!drafted || !inDraft || teams.length < 2) return view === "draft" ? "blind" : view;
    if (view === "draft" || (view === "signup" && status === "signup")) return "draft";
    return view;
  });
  // The draft being picked, on a phone: the header makes room, the track stays, the players scroll inside
  let picking = $state(false);
  // The draft's own jobs (undo a pick, add a player, close or reset it), in the header's Manage while it's showing
  let draftJobs = $state<(() => void) | null>(null);
  const extra = $derived(
    pane === "draft" && draftJobs
      ? [
          {
            icon: "draft" as const,
            label: "Manage the draft",
            sub: "Undo a pick, add a player, close it or start again",
            run: draftJobs,
          },
        ]
      : [],
  );
  const compact = $derived(phone.current && pane === "draft" && picking);
  // Moving between statuses: the view slides in from the way you went (forward from the right), the one leaving the
  // other way; the header and the track stay still. Stacked in one cell, so the area never collapses between them
  const order = $derived(tournament ? statusList(tournament) : []);
  let lastAt = -1;
  let dir = 1;
  $effect.pre(() => {
    const i = order.indexOf(view);
    untrack(() => {
      if (lastAt >= 0 && i !== lastAt) dir = i > lastAt ? 1 : -1;
      lastAt = i;
    });
  });
  const paneIn = (_node: Element) => ({
    duration: prefersReducedMotion ? 0 : 320,
    easing: cubicOut,
    css: (t: number, u: number) => `transform: translateX(${u * 48 * dir}px); opacity: ${t}`,
  });
  const paneOut = (_node: Element) => ({
    duration: prefersReducedMotion ? 0 : 220,
    css: (t: number, u: number) => `transform: translateX(${-u * 32 * dir}px); opacity: ${t}`,
  });
  // On the day: the match on now (or up next) and the next; yours a line
  const day = $derived(tournament ? onTheDayOf(tournament, me().id) : undefined);
  // Where everyone goes afterwards, and whether it's for later, next or now (lib/tournament-front.ts). With nothing on,
  // the one just played, the evening of its day
  const after = $derived.by(() => {
    const t = tournament ?? past[0];
    const moment = t ? afterMomentOf(t, today) : null;
    const place = t && moment ? tournamentAfter(t) : null;
    return place && moment && (tournament || moment === "now") ? { place, moment } : null;
  });
  // History, the one quiet link at the foot while one's running
  const links = $derived(
    earlier ? [{ href: `/tournaments/${type.slug}/history`, label: "History", icon: "medal" as const }] : [],
  );
</script>

<!-- On the day, once the last match is on (Then) or played (Now): where everyone goes, big, on the page -->
{#snippet afterNow(a: After, now: boolean)}
  <section class="part after-now">
    <h2 class="section-title">{now ? "Now" : "Then"}<Kanji text={kanjiFor(type, "awards")} /></h2>
    <div class="after-body">
      <span class="after-place display"><Icon name="glass" size={22} />{a.name}</span>
      <span class="after-sub"
        >{[a.note, a.time && `from ${clock(a.time)}`].filter(Boolean).join(" · ") ||
          (now ? "Everyone's there." : "After the last match.")}</span
      >
      <a class="btn sm outline" href={a.mapUrl} target="_blank" rel="noopener noreferrer"
        ><Icon name="pin" size={16} />Map</a
      >
    </div>
  </section>
{/snippet}

<div class="page" class:full={drafted && pane === "draft"} class:fit={compact}>
  <TournamentHead
    {type}
    {tournament}
    title="The {type.shortName}"
    manage
    note={tournament ? undefined : "Between bouts."}
    track
    {extra}
    viewing={view}
    {compact}
  />

  {#if !tournament}
    {#if after}
      <!-- The evening it was played: everyone's gone on to the afterwards -->
      {@render afterNow(after.place, true)}
    {/if}
    <!-- Nothing on: said big, in the Kumite's motif (lib/motif.ts): 組手 down the side like a film poster, a hanko
         stamped on it, the gong. An admin calls the next one from here, over the page (ADR 0065, 0074) -->
    <section class="no-bout">
      {#if kumite}
        <span class="poster" aria-hidden="true"
          ><span class="big-kanji" lang="ja">{kanjiFor(type, "onTheMat")}</span><span class="seal"
            ><Kanji text={kanjiFor(type, "fist")} seal /></span
          ></span
        >
      {/if}
      <div class="words">
        <span class="eyebrow"><Icon name={kumite ? "gong" : type.icon} size={18} />Nothing on the card</span>
        <h2 class="display big">No {type.shortName} yet</h2>
        <p>{kumite ? "The gong's quiet. Train hard." : "Nothing on yet. Watch this space."}</p>
        {#if manage}
          <button class="btn primary" onclick={() => editTournament("new", { typeId: type.id })}
            ><Icon name="plus" size={18} />Next {type.shortName}</button
          >
        {/if}
      </div>
    </section>
    {#if past.length}
      <section class="part">
        <h2 class="section-title">Past {type.shortName}s<Kanji text={kanjiFor(type, "martial")} /></h2>
        <PastEditions {type} {past} />
      </section>
      <section class="part">
        <h2 class="section-title">All-time leaders</h2>
        <Leaderboard games={past.flatMap((t) => t.games ?? [])} label="All-time leaders" />
      </section>
    {/if}
  {:else}
    <div class="views" class:fill={compact}>
      {#key pane}
        <div class="pane" in:paneIn out:paneOut>
          {#if pane === "signup"}
            <!-- Sign-up: are you in, and who's coming (a status gone by: your answer, one line) -->
            <SignUpLine
              {tournament}
              canSignUp={status === "signup" && can(perms, "signup:Event")}
              line={status !== "signup"}
            />
            <WhosIn {tournament} />
          {:else if pane === "draft"}
            <!-- The draft, for its captains and whoever runs it: from the draw (the shuffle) through the picking.
                 While it's still sign-up, your answer first -->
            {#if view === "signup"}<SignUpLine {tournament} canSignUp={can(perms, "signup:Event")} line />{/if}
            <Draft {typeId} onpicking={(v) => (picking = v)} onmanage={(open) => (draftJobs = open)} />
            <!-- The draft done: how the picks went, round by round, under its teams -->
            {#if tournament.draftState === "closed" || (tournament.draftState === "open" && !picking)}
              <PickLog {tournament} inline />
            {/if}
            {#if view === "signup"}<WhosIn {tournament} />{/if}
          {:else if pane === "blind"}
            <!-- Everyone else: the draft's the captains' (ADR 0060). Chong Li's powder; Dux fought blind -->
            <DraftStep {type} mark="open" icon="blindfold" title="Fighting blind">
              {blindLine(db.quips)}
            </DraftStep>
            <SignUpLine {tournament} canSignUp={false} line />
          {:else if pane === "teams"}
            <!-- Teams set: yours first, then the teams; the next step's card for whoever runs it -->
            {#if mine >= 0}<YourTeam {type} {tournament} index={mine} />{/if}
            <!-- The next step's card (Make the fixtures) for whoever runs it, then every team, a card each to open -->
            {#if !games.length}<Schedule {typeId} />{/if}
            <TournamentTeams {typeId} />
          {:else if pane === "fixtures"}
            <Schedule {typeId} />
          {:else if pane === "day"}
            <!-- The day: your team's turn to keep score (once you hold it, your game's card wears the whistle
                 instead), the match on now and the next, then every match -->
            {#if duty && !holding}
              <div class="duty">
                <Icon name="whistle" size={20} />
                <span class="grow">
                  <span class="duty-title">Your team's turn to keep score</span>
                  <span class="duty-sub"
                    >Game {duty.position} · {vs(duty)}{duty.status === "next" ? ` · ${at(duty.position)}` : ""}</span
                  >
                </span>
                <a class="btn sm outline" href="/tournaments/{type.slug}/games/{duty.id}/live">Keep score</a>
              </div>
            {/if}
            <!-- Every match, the one on now (or up next) brought forward -->
            <Schedule {typeId} carousel />
            {#if day?.yours}
              <p class="yours">
                <Icon name="user" size={16} />Your next:
                <a href="/tournaments/{type.slug}/games/{day.yours.id}"
                  >Game {day.yours.position} · {vs(day.yours)} · {at(day.yours.position)}</a
                >
              </p>
            {/if}
            <!-- The last match on, then where everyone goes; every one played, everyone's there -->
            {#if after?.moment === "next" || after?.moment === "now"}{@render afterNow(
                after.place,
                after.moment === "now",
              )}{/if}
            <!-- The table as it stands, under the matches (ADR 0074): no page of its own -->
            {#if games.some((g) => g.stage === "group" && g.status === "done")}
              <section class="part">
                <h2 class="section-title">The board<Kanji text={kanjiFor(type, "results")} /></h2>
                <BoardTable {type} {tournament} />
              </section>
            {/if}
          {/if}
        </div>
      {/key}
    </div>
    {#if links.length && !compact}
      <!-- Everything else, a link away: quiet, at the foot -->
      <nav class="more" aria-label="More of the {type.shortName}">
        {#each links as l (l.href)}
          <a href={l.href}><Icon name={l.icon} size={16} />{l.label}</a>
        {/each}
      </nav>
    {/if}
    {#if kumite && !compact}
      <!-- The Kumite's motif, said plainly for anyone new to it (lib/motif.ts) -->
      <p class="homework">
        Don't get the references? You've got <a
          href="https://www.imdb.com/title/tt0092675/"
          target="_blank"
          rel="noopener noreferrer"
          title="Required viewing">some training</a
        > to do.
      </p>
    {/if}
  {/if}
</div>

<style>
  /* The status's view: stacked in one cell, so the one leaving and the one arriving overlap as they slide, and the
     area never collapses between them */
  .views {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }
  .pane {
    display: grid;
    grid-area: 1 / 1;
    grid-template-columns: minmax(0, 1fr);
    align-content: start;
    gap: var(--s-5);
    min-width: 0;
  }
  /* The draft being picked on a phone: the view takes the window's height left under the track */
  .views.fill {
    flex: 1 1 auto;
    grid-template-rows: minmax(0, 1fr);
    min-height: 0;
  }
  .views.fill .pane {
    grid-template-rows: minmax(0, 1fr);
    min-height: 0;
  }
  .homework {
    margin: 0;
    color: var(--fg-subtle);
    font-size: var(--text-xs);
  }
  .homework a {
    color: var(--fg-muted);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  /* Nothing on: the page's one big moment. The kanji down the side, quiet; the words beside them */
  .no-bout {
    display: flex;
    align-items: center;
    gap: clamp(var(--s-4), 5vw, var(--s-10));
    padding-block: clamp(var(--s-6), 6vw, var(--s-10));
  }
  .poster {
    position: relative;
    flex: none;
  }
  .big-kanji {
    display: block;
    color: var(--surface-3);
    font-family: var(--font-kanji);
    font-size: clamp(4.5rem, 16vw, 9.5rem);
    font-weight: 900;
    line-height: 1;
    writing-mode: vertical-rl;
  }
  /* The hanko, stamped across the foot of the kanji */
  .seal {
    position: absolute;
    right: -0.9rem;
    bottom: -0.5rem;
  }
  .words {
    display: grid;
    justify-items: start;
    gap: var(--s-3);
    min-width: 0;
  }
  .words .eyebrow {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
  }
  .big {
    margin: 0;
    color: var(--fg);
    font-size: clamp(2.6rem, 9vw, 5rem);
    line-height: 0.95;
  }
  .words p {
    margin: 0;
    color: var(--fg-muted);
    font-size: var(--text-md);
  }
  .words .btn {
    gap: var(--s-2);
    margin-top: var(--s-2);
  }
  /* A phone: the kanji across the top, big, the words under them */
  @media (max-width: 600px) {
    .no-bout {
      flex-direction: column;
      align-items: flex-start;
    }
    .big-kanji {
      font-size: 6.5rem;
      writing-mode: horizontal-tb;
    }
    .seal {
      right: -1.25rem;
      bottom: -0.75rem;
    }
  }
  .part {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s-3);
  }
  .part .section-title {
    margin: 0;
  }

  /* Your turn to keep score: a line between rules, not a card */
  .duty {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-3) var(--s-4);
    padding-block: var(--s-3);
    border-block: 1px solid var(--border);
    color: var(--fg-muted);
  }
  .duty .grow {
    display: grid;
    gap: 0.15rem;
  }
  .duty-title {
    color: var(--fg);
    font-weight: 600;
  }
  .duty-sub {
    font-size: var(--text-sm);
  }

  /* Your next match on the day, when it's neither on now nor next: one line */
  .yours {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2);
    margin: 0;
    color: var(--fg-muted);
  }
  .yours a {
    color: var(--red-hot);
    font-weight: 600;
  }

  /* The rest of it, a link away: one quiet line at the foot, no panel, no rules */
  .more {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1) var(--s-5);
    padding-top: var(--s-2);
  }
  .more a {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    min-height: 2.75rem;
    color: var(--fg-muted);
    font-weight: 500;
  }
  .more a:hover {
    color: var(--fg);
  }
  /* On the day, Then or Now: the place big, what for under it, the map a button. On the page, no panel */
  .after-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--s-1) var(--s-4);
  }
  .after-place {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    min-width: 0;
    color: var(--fg);
    font-size: clamp(1.6rem, 5vw, 2.2rem);
    line-height: 1.05;
  }
  .after-place :global(svg) {
    flex: none;
    color: var(--fg-muted);
  }
  .after-sub {
    grid-column: 1;
    color: var(--fg-muted);
  }
  .after-body .btn {
    grid-row: 1 / span 2;
    grid-column: 2;
    gap: var(--s-1);
  }
</style>
