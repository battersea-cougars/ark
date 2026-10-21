<script lang="ts">
  // A tournament series' front page, for the one on or coming up (lib/edition.ts currentOf). The date is the header's;
  // the page follows the day, from what's happened:
  //   Before: by its stage, each leading with one thing (lib/tournament-front.ts): are you in; the draft; your team;
  //   the fight card. What's had its day goes (History keeps it).
  //   During: your turn to keep score, your next fight, the game on now and the next, the latest results.
  // Once the last game's played it's history: with nothing on, the page says so, big (the Kumite in its Bloodsport
  // motif), with an admin's Next Kumite, and every past one under it, newest first, each opening its own page.
  import { shortNameOf, nameOfTeam, teamNamesOf } from "../lib/names";
  import { can } from "../access/actions";
  import { granted, me } from "../demo/session.svelte";
  import { PLAYERS } from "../demo/data";
  import { currentTournament, pastTournaments, typeById } from "../demo/schedule.svelte";
  import SignUpLine from "../lib/SignUpLine.svelte";
  import { editionState } from "../lib/edition";
  import Kanji from "../lib/Kanji.svelte";
  import GameCard from "../lib/GameCard.svelte";
  import { kanjiFor } from "../lib/motif";
  import FixtureRow from "../lib/FixtureRow.svelte";
  import TournamentHead from "../lib/TournamentHead.svelte";
  import TeamCrest from "../lib/TeamCrest.svelte";
  import { teamHref, teamTone } from "../lib/team-tones";
  import DraftStatus from "../lib/DraftStatus.svelte";
  import PastEditions from "../lib/PastEditions.svelte";
  import Leaderboard from "../lib/Leaderboard.svelte";
  import { editTournament } from "../lib/TournamentEditorPanel.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import { checkForUpdates, liveFeed } from "../lib/live-updates.svelte";
  import LiveNote from "../lib/LiveNote.svelte";
  import { clock, londonToday } from "../lib/dates";
  import { kickOff, slotMinutes } from "../lib/fixtures";
  import { fightCardOf, frontOf, myTeamIndex, nextFightOf } from "../lib/tournament-front";
  import FightCard from "../lib/FightCard.svelte";
  import YourTeam from "../lib/YourTeam.svelte";

  let { typeId }: { typeId: number } = $props();

  const perms = $derived(granted());
  const type = $derived(typeById(typeId)!);
  const tournament = $derived(currentTournament(typeId));
  const past = $derived(tournament ? [] : pastTournaments(typeId));
  // While one's on, the past ones are History: not a tab (the strip has what matters now), a row at the foot here
  const earlier = $derived(tournament ? pastTournaments(typeId).length : 0);
  const kumite = $derived(!!kanjiFor(type, "onTheMat"));
  const firstName = (id: number | null) => shortNameOf(PLAYERS.find((p) => p.id === id));
  const teams = $derived(tournament?.teams ?? []);
  const teamName = (i: number) => nameOfTeam(teams[i], teams, (id) => PLAYERS.find((p) => p.id === id));
  const manage = $derived(can(perms, "manage:Tournament"));

  // The games, in brief: what's on now, and the last result; before any, the first game
  const games = $derived(tournament?.games ?? []);
  // The game on now, with its score, then the next game. Between games: the next game, then the one after that.
  // Each start moves them all along
  const live = $derived(games.find((g) => g.status === "live"));
  const ahead = $derived(games.filter((g) => g.status !== "done" && g.status !== "live"));
  const now = $derived(live ?? ahead[0]);
  const after = $derived(live ? ahead[0] : ahead[1]);

  // Everyone sees the score as it happens: on the day, until the last game's over, from the hub's stream, with a
  // check on the admins' beat as the fallback (ADR 0061, 0072)
  const following = $derived(
    !!live || (tournament?.heldOn === londonToday() && games.some((g) => g.status !== "done")),
  );
  $effect(() => {
    if (following) return checkForUpdates();
  });

  // The teams: a draft's only once it's closed, unless you're in it (the server holds back the rest, ADR 0060)
  const mine = $derived(tournament ? myTeamIndex(tournament, me().id) : -1);
  const teamsHidden = $derived(
    tournament?.kind === "draft" &&
      tournament.draftState !== "closed" &&
      !teams.some((t) => t.captainMemberId === me().id) &&
      !can(perms, "run:Draft") &&
      !manage,
  );
  // Keeping score (ADR 0061): a game whose scoresheet you hold, else the game up next when it's your team's turn and
  // nobody's taken it yet
  const myTeamId = $derived(mine >= 0 ? teams[mine].id : undefined);
  // Only the game up next (or on now) is taken on: the first in the day's order that isn't over
  const upNext = $derived(games.find((g) => g.status !== "done"));
  const duty = $derived(
    games.find((g) => g.status !== "done" && g.keeperId === me().id) ??
      (myTeamId && upNext && upNext.scoringTeamId === myTeamId && !upNext.keeperId ? upNext : undefined),
  );
  const holding = $derived(duty?.keeperId === me().id);
  const vs = (g: { homeTeamId: number | null; awayTeamId: number | null }) =>
    [g.homeTeamId, g.awayTeamId].map((id) => teamName(teams.findIndex((t) => t.id === id))).join(" v ");
  const schedule = $derived(`/tournaments/${type.slug}/schedule`);
  const board = $derived(`/tournaments/${type.slug}/standings`);

  // Which act, by the games (lib/edition.ts): during (one being scored or in), else before
  const mode = $derived(tournament && editionState(tournament) === "live" ? "during" : "before");
  // Before the first game, what leads and what follows, by the stage (lib/tournament-front.ts)
  const blocks = $derived(tournament ? frontOf(tournament, me().id, londonToday()) : []);
  // Its captains and whoever runs it go back into a done draft
  const inDraft = $derived(teams.some((t) => t.captainMemberId === me().id) || can(perms, "run:Draft"));
  // Your team's next game; the fight card, every game while there are a few (lib/tournament-front.ts)
  const myFight = $derived(tournament ? nextFightOf(tournament, me().id) : undefined);
  const card = $derived(tournament ? fightCardOf(tournament, me().id) : undefined);
  // The latest results, newest first; the final, last of the playoffs
  const results = $derived(games.filter((g) => g.status === "done").sort((a, b) => b.position - a.position));
  // The tournament's team names, which its crests are told apart among (logo.ts)
  const crestNames = $derived(teamNamesOf(teams, (id) => PLAYERS.find((p) => p.id === id)));
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
  {:else if mode === "during"}
    <!-- During: your team's turn to keep score (once you hold it, your game's card wears the whistle instead), what's
         on and next, what's just happened -->
    {#if duty && !holding}
      <div class="duty">
        <Icon name="whistle" size={20} />
        <span class="grow">
          <span class="duty-title">Your team's turn to keep score</span>
          <span class="duty-sub"
            >Game {duty.position} · {vs(duty)}{duty.status === "next"
              ? ` · ${clock(kickOff(tournament.startTime, slotMinutes(tournament), duty.position))}`
              : ""}</span
          >
        </span>
        <a class="btn sm outline" href="/tournaments/{type.slug}/games/{duty.id}/live">Keep score</a>
      </div>
    {/if}
    {#if myFight && myTeamId && myFight !== now && myFight !== after}
      <section class="part">
        <h2 class="section-title">Your next fight<Kanji text={kanjiFor(type, "fights")} /></h2>
        <FightCard {tournament} games={[myFight]} teamId={myTeamId} chant="{type.shortName}!" />
      </section>
    {/if}
    <section class="part">
      <div class="part-head">
        <h2 class="section-title">On the mat<Kanji text={kanjiFor(type, "onTheMat")} /></h2>
        <a class="btn ghost sm" href={schedule}>Full fight card<Icon name="chevronRight" size={16} /></a>
      </div>
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
      {#if now}
        <!-- A card each: the game on (or up next), then the one after -->
        <GameCard {tournament} game={now} />
        {#if after}<GameCard {tournament} game={after} />{/if}
      {:else}
        <p class="note">Every fight's been fought. The final word's on <a href={board}>the board</a>.</p>
      {/if}
    </section>
    {#if results.length}
      <section class="part">
        <div class="part-head">
          <h2 class="section-title">Latest results<Kanji text={kanjiFor(type, "results")} /></h2>
          <a class="btn ghost sm" href={board}>The board<Icon name="chevronRight" size={16} /></a>
        </div>
        <div class="list">
          {#each results.slice(0, 3) as g (g.id)}
            <FixtureRow {tournament} game={g} />
          {/each}
        </div>
      </section>
    {/if}
  {:else}
    <!-- Before the first game: the page follows the stage, each leading with one thing (lib/tournament-front.ts, ADR
         0074). Sign-up: are you in, then the draft. The draft on: the draft, your sign-up a line under it. The teams
         set: your team, then the others, the draft one line. The fixtures out: the fight card (yours marked, the
         next one up), the teams. What's had its day goes; History keeps it -->
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
      {:else if block === "teams" && teams.length}
        <section class="part">
          <div class="part-head">
            <h2 class="section-title">{blocks.includes("my-team") ? "The other teams" : "Teams"}</h2>
            <!-- No See all: every team's on the page (yours above, when it leads); each opens its own, and the Teams
                 tab has them all -->
          </div>
          {#if teamsHidden}
            <p class="note">The captains pick the teams in the draft. They're out once it's done.</p>
          {:else}
            <!-- Each team: its crest and name, yours marked; each opens the team -->
            <div class="teams-grid">
              {#each teams as t, i (t.id ?? i)}
                {#if !(i === mine && blocks.includes("my-team"))}
                  <a class="chip-team" href={t.id ? teamHref(type.slug, t.id) : undefined}>
                    <TeamCrest among={crestNames} name={teamName(i)} logo={t.logo} tone={teamTone(i)} size="3.5rem" />
                    <span class="chip-text">
                      <span class="chip-name">{teamName(i)}</span>
                      <!-- Only what the name doesn't say: that it's yours, or whose it is once it has a name of its own -->
                      {#if i === mine}<span class="chip-sub yours">Your team</span>
                      {:else if t.name}<span class="chip-sub">Captain {firstName(t.captainMemberId)}</span>{/if}
                    </span>
                  </a>
                {/if}
              {/each}
            </div>
          {/if}
        </section>
      {:else if block === "fight-card" && card?.games.length}
        <section class="part">
          <div class="part-head">
            <h2 class="section-title">Fight card<Kanji text={kanjiFor(type, "fights")} /></h2>
            {#if !card.whole}<a class="btn ghost sm" href={schedule}
                >Full fight card<Icon name="chevronRight" size={16} /></a
              >{/if}
          </div>
          <FightCard {tournament} games={card.games} upNext={card.upNext} teamId={myTeamId} chant="{type.shortName}!" />
        </section>
      {:else if block === "make-fixtures" && manage && teams.length >= 2}
        <p class="note">The fight card isn't out yet. <a href={schedule}>Make it</a></p>
      {/if}
    {/each}
  {/if}
  {#if earlier}
    <section class="part">
      <h2 class="section-title">Past {type.shortName}s<Kanji text={kanjiFor(type, "martial")} /></h2>
      <div class="list">
        <a class="row" href="/tournaments/{type.slug}/history">
          <span class="glyph"><Icon name="medal" size={20} /></span>
          <span class="grow">
            <span class="title">History</span>
            <span class="sub">{earlier} played, and who won</span>
          </span>
          <Icon name="chevronRight" size={18} />
        </a>
      </div>
    </section>
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
  /* The teams, on the page: a crest and a name each, as many to a row as fit */
  .teams-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: var(--s-2);
  }
  .chip-team {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-width: 0;
    padding: var(--s-2) var(--s-3) var(--s-2) var(--s-2);
    border-radius: var(--r-lg);
    color: var(--fg);
    transition: background-color var(--t-fast) var(--ease);
  }
  .chip-team:hover {
    background: var(--surface-2);
  }
  .chip-text {
    display: grid;
    gap: 0.1rem;
    min-width: 0;
  }
  .chip-name {
    overflow: hidden;
    font-family: var(--font-display);
    font-size: 1.2rem;
    text-transform: uppercase;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .chip-sub {
    color: var(--fg-muted);
    font-size: var(--text-xs);
  }
  /* Yours: the club's red, in the words, not a fill */
  .chip-sub.yours {
    color: var(--red-hot);
    font-weight: 600;
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
