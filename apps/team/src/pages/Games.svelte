<script lang="ts">
  // A tournament series' front page, for the one on or coming up (lib/edition.ts currentOf). The date is the header's;
  // under it, the track of its stages (sign-up, the draft, the teams, the fight card, the day) with the one it's at lit
  // and what's next, then that stage's one thing (lib/tournament-front.ts):
  //   Before the day: are you in; the draft; your team; the first match.
  //   On the day: your turn to keep score, the match on now and the next. Nothing else.
  // The teams, the board, the whole fight card and History are a quiet line of links at the foot (and their tabs).
  // Once the last game's played it's history: with nothing on, the page says so, big (the Kumite in its Bloodsport
  // motif), with an admin's Next Kumite, and every past one under it, newest first, each opening its own page.
  import { nameOfTeam } from "../lib/names";
  import { can } from "../access/actions";
  import { granted, me } from "../demo/session.svelte";
  import { PLAYERS } from "../demo/data";
  import { currentTournament, pastTournaments, typeById } from "../demo/schedule.svelte";
  import SignUpLine from "../lib/SignUpLine.svelte";
  import { editionState, stageOf } from "../lib/edition";
  import Kanji from "../lib/Kanji.svelte";
  import GameCard from "../lib/GameCard.svelte";
  import { kanjiFor } from "../lib/motif";
  import TournamentHead from "../lib/TournamentHead.svelte";
  import DraftStatus from "../lib/DraftStatus.svelte";
  import PastEditions from "../lib/PastEditions.svelte";
  import Leaderboard from "../lib/Leaderboard.svelte";
  import { editTournament } from "../lib/TournamentEditorPanel.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import { checkForUpdates, liveFeed } from "../lib/live-updates.svelte";
  import LiveNote from "../lib/LiveNote.svelte";
  import { clock, londonToday } from "../lib/dates";
  import { kickOff, slotMinutes } from "../lib/fixtures";
  import { firstUpOf, frontOf, myTeamIndex, onTheDayOf } from "../lib/tournament-front";
  import FightCard from "../lib/FightCard.svelte";
  import StageTrack from "../lib/StageTrack.svelte";
  import YourTeam from "../lib/YourTeam.svelte";

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
  const schedule = $derived(`/tournaments/${type.slug}/schedule`);
  const board = $derived(`/tournaments/${type.slug}/standings`);

  // Which act, by the games (lib/edition.ts): during (one being scored or in), else before
  const mode = $derived(tournament && editionState(tournament) === "live" ? "during" : "before");
  // Before the first game, what the stage leads with (lib/tournament-front.ts)
  const blocks = $derived(tournament ? frontOf(tournament, me().id, today) : []);
  // Its captains and whoever runs it go back into a done draft
  const inDraft = $derived(teams.some((t) => t.captainMemberId === me().id) || can(perms, "run:Draft"));
  // Before the first match: the first, and yours if it's later. On the day: on now and next, yours a line
  const first = $derived(tournament ? firstUpOf(tournament, me().id) : undefined);
  const day = $derived(tournament ? onTheDayOf(tournament, me().id) : undefined);
  // The quiet links at the foot: what has a page of its own once there's something on it
  const stage = $derived(tournament ? stageOf(tournament) : "signup");
  const links = $derived(
    [
      // Before the day, First up has its own Full fight card
      stage === "fixtures" &&
        mode === "during" && { href: schedule, label: "Fight card", icon: kumite ? "gong" : "calendar" },
      stage === "fixtures" && { href: board, label: "The board", icon: "list" },
      stage !== "signup" && { href: `/tournaments/${type.slug}/teams`, label: "Teams", icon: "teams" },
      earlier && { href: `/tournaments/${type.slug}/history`, label: "History", icon: "medal" },
    ].filter((l) => !!l) as { href: string; label: string; icon: "gong" | "calendar" | "list" | "teams" | "medal" }[],
  );
</script>

<div class="page">
  <TournamentHead
    {type}
    {tournament}
    title="The {type.shortName}"
    manage
    note={tournament ? undefined : "Between bouts."}
  />

  {#if !tournament}
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
    <!-- Where it's got to, unmistakably: every stage, the one it's at lit, and what happens next -->
    <StageTrack {type} {tournament} {today} />
    {#if mode === "during"}
      <!-- On the day: your team's turn to keep score (once you hold it, your game's card wears the whistle instead),
           then the match on now and the next. Nothing else competes -->
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
      {#if day?.now}
        <section class="part">
          <h2 class="section-title">{day.live ? "On now" : "Up next"}<Kanji text={kanjiFor(type, "onTheMat")} /></h2>
          {#if following}
            <!-- The scores follow along: live from the hub's stream, else on the admins' beat (ADR 0072) -->
            <p class="updates hint">
              <Icon name={liveFeed.on ? "live" : "clock"} size={14} /><LiveNote
                what="Scores update"
                live="Scores update live"
                tail=", to keep the club on the free plan"
              />
            </p>
          {/if}
          <GameCard {tournament} game={day.now} />
        </section>
        {#if day.after}
          <section class="part">
            <h2 class="section-title">{day.live ? "Next" : "After that"}</h2>
            <GameCard {tournament} game={day.after} />
          </section>
        {/if}
        {#if day.yours}
          <p class="yours">
            <Icon name="user" size={16} />Your next:
            <a href="/tournaments/{type.slug}/games/{day.yours.id}"
              >Game {day.yours.position} · {vs(day.yours)} · {at(day.yours.position)}</a
            >
          </p>
        {/if}
      {:else}
        <p class="note">Every match has been played. The final word's on <a href={board}>the board</a>.</p>
      {/if}
    {:else}
      <!-- Before the first match: the stage's one thing (lib/tournament-front.ts, ADR 0074). Sign-up: are you in. The
           draft on: the draft, your sign-up a line under it. The teams set: your team, the draft one line, an admin's
           Make the fight card. The fixtures out: the first match, and yours if it's later -->
      {#each blocks as block (block)}
        {#if block === "signup"}
          <SignUpLine {tournament} canSignUp={can(perms, "signup:Event")} />
        {:else if block === "signup-line"}
          <SignUpLine {tournament} canSignUp={false} line />
        {:else if block === "draft"}
          <DraftStatus {type} {tournament} />
        {:else if block === "draft-done"}
          <!-- Done, said once; its captains and whoever runs it go back in from here (to reopen it, or make the fixtures) -->
          <p class="draft-done">
            <Icon name="draft" size={18} /><span>Draft done</span>
            {#if inDraft}<a class="btn ghost sm" href="/tournaments/{type.slug}/draft"
                >Go to the draft<Icon name="chevronRight" size={16} /></a
              >{/if}
          </p>
        {:else if block === "my-team"}
          <YourTeam {type} {tournament} index={mine} />
        {:else if block === "first-up" && first?.games.length}
          <section class="part">
            <div class="part-head">
              <h2 class="section-title">First up<Kanji text={kanjiFor(type, "fights")} /></h2>
              <a class="btn ghost sm" href={schedule}>Full fight card<Icon name="chevronRight" size={16} /></a>
            </div>
            <FightCard
              {tournament}
              games={first.games}
              upNext={first.upNext}
              teamId={myTeamId}
              chant="{type.shortName}!"
            />
          </section>
        {:else if block === "make-fixtures" && manage && teams.length >= 2}
          <p class="make">
            <span>The fight card isn't out yet.</span>
            <a class="btn sm primary" href={schedule}>Make the fight card</a>
          </p>
        {/if}
      {/each}
    {/if}
    {#if links.length}
      <!-- Everything else, a link away: quiet, at the foot -->
      <nav class="more" aria-label="More of the {type.shortName}">
        {#each links as l (l.href)}
          <a href={l.href}><Icon name={l.icon} size={16} />{l.label}</a>
        {/each}
      </nav>
    {/if}
  {/if}
</div>

<style>
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
  .updates {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    margin: 0;
    font-size: var(--text-sm);
  }
  .part {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s-3);
  }
  .part .section-title {
    margin: 0;
  }
  .part-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0 var(--s-2);
  }
  .part-head .btn {
    gap: var(--s-1);
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
  .note a {
    color: var(--fg);
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
  /* An admin's way to the fight card, while it's to make: the stage's one action */
  .make {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2) var(--s-4);
    margin: 0;
    color: var(--fg-muted);
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
  /* The draft, done: one line on the page */
  .draft-done {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2) var(--s-3);
    margin: 0;
    color: var(--fg-muted);
  }
  .draft-done .btn {
    gap: var(--s-1);
  }
</style>
