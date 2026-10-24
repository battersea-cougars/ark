<script lang="ts">
  import { waitingFor } from "../app/editions.svelte";
  import PositionIcon from "../lib/PositionIcon.svelte";
  import { buzz, keepAwake } from "../app/native";
  // One game, full screen (ADR 0130). For everyone, the live scoreboard: the clock, the score, each goal as it went
  // in. One person keeps score: whoever presses Start scoring (a team sitting it out is suggested, but anyone can step
  // in) holds the scoresheet until they let it go, or an admin does. Only the game on now (or up next) is scored: the
  // next opens when this one's over. For the scorekeeper it's the scoresheet: Goal for a team then who scored and who
  // assisted, a quieter Penalty (who, 2 or 5 minutes, what for) whose clock runs beside the team, take the last goal or
  // penalty back, and Full time, which opens the review (lib/SealResult): the score, every goal and penalty, the last
  // goal to take back, and Seal the result, which makes the score the result; the clock's start and pause is
  // one big button right under the clock, with clear space before the goals, so it's easy to hit and hard to hit by
  // mistake.
  //
  // Few requests: the clock never ticks on the server. It's stored as time left and when it was last started, so each
  // phone counts down by itself (and it survives a reload or a locked phone); only start, pause, a goal and full time
  // are sent. Everyone on the page checks for changes as often as the admins set (ADR 0072), the scorekeeper too (the
  // same person may have it open twice), while the page is in view.
  import { goesBy, goesByOf, nameOfTeam, teamNamesOf } from "../lib/names";
  import { db } from "../demo/store.svelte";
  import { onDestroy, untrack } from "svelte";
  import { can } from "../access/actions";
  import Icon from "../app/shell/Icon.svelte";
  import BackBar from "../app/shell/BackBar.svelte";
  import Drawer from "../lib/Drawer.svelte";
  import Sheet from "../lib/Sheet.svelte";
  import ManageList, { type ManageItem } from "../lib/ManageList.svelte";
  import { phone } from "../lib/viewport.svelte";
  import TeamCrest from "../lib/TeamCrest.svelte";
  import RollNumber from "../lib/RollNumber.svelte";
  import SealResult from "../lib/SealResult.svelte";
  import { PLAYERS, type Player } from "../demo/data";
  import { granted, me } from "../demo/session.svelte";
  import { goBack, navigate, router } from "../app/router.svelte";
  import { currentTournament, typeById } from "../demo/schedule.svelte";
  import { editionPath } from "../lib/edition-address";
  import {
    addGoal,
    addPenalty,
    clockGame,
    nextPeriod,
    holdScoresheet,
    overrideScoresheet,
    removeGoal,
    removePenalty,
    undoPenalty,
    scoreGame,
    setGameClock,
    undoGoal,
  } from "../app/backend.svelte";
  import { clock, londonTime } from "../lib/dates";
  import { checkForUpdates, liveFeed } from "../lib/live-updates.svelte";
  import LiveNote from "../lib/LiveNote.svelte";
  import { breakLeftOf, leftOf, mmss, ticking } from "../lib/game-clock.svelte";
  import { kickOff, slotMinutes } from "../lib/fixtures";
  import BoxScore from "../lib/BoxScore.svelte";
  import GameTimeline from "../lib/GameTimeline.svelte";
  import { inGameTime, periodName } from "../lib/periods";
  import { teamHref, teamTone } from "../lib/team-tones";
  import {
    INFRACTIONS,
    infractionOf,
    manpower,
    PENALTY_KINDS,
    penaltyLine,
    playersShort,
    running as serving,
  } from "../lib/penalties";

  let { typeId, gameId }: { typeId: number; gameId: number } = $props();
  // A past one's, the app hasn't it yet: on its way (app/editions.svelte.ts)
  const waiting = $derived(!!gameId && !db.tournaments.some((t) => t.games?.some((g) => g.id === gameId)) && waitingFor("game", gameId));

  const type = $derived(typeById(typeId)!);
  // The game's own tournament: the current one, or a past one's (History)
  const tournament = $derived(
    db.tournaments.find((t) => t.games?.some((g) => g.id === gameId)) ?? currentTournament(typeId),
  );
  const teams = $derived(tournament?.teams ?? []);
  const game = $derived(tournament?.games?.find((g) => g.id === gameId));
  const byId = (id: number | null) => (id ? PLAYERS.find((p) => p.id === id) : undefined);
  const indexOf = (teamId: number | null) => teams.findIndex((t) => t.id === teamId);
  const teamName = (teamId: number | null) => {
    const t = teams[indexOf(teamId)];
    return nameOfTeam(t, teams, byId);
  };
  const roster = (teamId: number): Player[] => {
    const t = teams[indexOf(teamId)];
    return t ? [t.captainMemberId, ...t.players.map((p) => p.memberId)].flatMap((id) => byId(id) ?? []) : [];
  };
  const sides = $derived(game ? ([game.homeTeamId, game.awayTeamId] as (number | null)[]) : []);

  // One person keeps score: whoever holds the scoresheet. An admin can make them let go
  const keeper = $derived(!!game && game.keeperId === me().id);
  const holder = $derived(byId(game?.keeperId ?? null));
  const admin = $derived(can(granted(), "manage:Tournament"));
  // Scoring's taken on for the game up next (or on now): the first in the day's order that isn't over
  const upNext = $derived(tournament?.games?.find((g) => g.status !== "done")?.id === gameId);

  // The clock, ticking while this page is up
  $effect(() => ticking());
  // The clock counts down each period in turn (ADR 0130): full is a period's length
  const full = $derived((tournament?.gameMinutes ?? 12) * 60_000);
  const periods = $derived(tournament?.periods ?? 1);
  const period = $derived(game?.period ?? 1);
  const lastPeriod = $derived(period >= periods);
  const left = $derived(game && game.status !== "next" ? leftOf(game) : full);
  const running = $derived(!!game?.clockStartedAt);
  const over = $derived(game?.status === "done");
  // Between periods: the break counts down from when the last ended, for everyone, until the scorekeeper starts the
  // next (early, or once it's run out: then it says the next is up). Null: no break on
  const breakMs = $derived(
    game?.status === "live" && period > 1 ? breakLeftOf(game, tournament?.breakMinutes ?? 0) : null,
  );
  const onBreak = $derived(breakMs !== null && breakMs > 0);
  const breakFull = $derived((tournament?.breakMinutes ?? 0) * 60_000);
  // Time's up in the last period: full time. In one before it, the period's over and the next comes next
  const timeUp = $derived(game?.status === "live" && left === 0 && lastPeriod);
  const periodUp = $derived(game?.status === "live" && left === 0 && !lastPeriod);
  // A playoff can't end level (worker/tournaments/scoring.ts): level at time up, it plays on and the next goal wins
  const level = $derived(!!game && game.stage === "playoff" && (game.homeGoals ?? 0) === (game.awayGoals ?? 0));
  // A period's over (its time's up, or the scorekeeper says so): the next starts paused at its full length. Sent from
  // the scorekeeper's phone when the clock hits zero, and again until the server has it (the period moves on): once
  // a tap on its way (a goal at the buzzer) has gone, and a few seconds after one that didn't go through. Saying it
  // twice is harmless (the Worker knows the period's done)
  const endPeriod = () => tournament && game && act(() => nextPeriod(tournament.id, game.id, period));
  const RETRY_MS = 3000;
  let endRetry = $state(0);
  let endWaiting = false;
  $effect(() => {
    void endRetry;
    if (!periodUp || !keeper || busy || endWaiting || !tournament || !game) return;
    const [t, g, p] = [tournament.id, game.id, period];
    untrack(() =>
      act(async () => {
        if ((await nextPeriod(t, g, p)) !== null) return;
        endWaiting = true;
        setTimeout(() => {
          endWaiting = false;
          endRetry++;
        }, RETRY_MS);
      }),
    );
  });
  // A buzz when time runs out on the scorekeeper's phone
  let buzzed = false;
  $effect(() => {
    if ((timeUp || periodUp) && running && keeper && !buzzed) {
      buzzed = true;
      void buzz([400, 150, 400]);
    }
  });

  // Everyone's scoreboard follows along, from the game up next to full time: the hub's stream (ADR 0072), with a
  // check on the admins' beat as the fallback (ADR 0072), and the page says which. The scorekeeper's too: they may
  // have it open on another phone or browser
  const following = $derived(!!game && !over && (game.status === "live" || upNext));
  const sayFollowing = $derived(following && !keeper);
  $effect(() => {
    if (following) return checkForUpdates();
  });

  // The screen stays on while the scorekeeper's clock runs
  let sleep: (() => void) | null = null;
  $effect(() => {
    if (keeper && running && !sleep)
      // Refused: the screen may sleep, as it would anyway
      keepAwake()
        .then((s) => (sleep = s))
        .catch(() => {});
  });
  onDestroy(() => sleep?.());

  let busy = $state(false);
  async function act(what: () => Promise<unknown>) {
    if (busy) return;
    busy = true;
    try {
      await what();
    } finally {
      busy = false;
    }
  }
  const take = () => tournament && game && act(() => holdScoresheet(tournament.id, game.id, "claim"));
  const letGo = () => {
    handingOver = true;
    if (tournament && game) act(() => holdScoresheet(tournament.id, game.id, "release"));
  };

  // An admin's say over someone else's scoresheet (#116), behind Manage in the bar (ADR 0065): take it over (their
  // phone died, they've gone) or free it (for an admin who isn't at the rink). Each asks first, the yes in red. Sent
  // with who the page saw holding it: if it's changed hands since, the Worker says who has it now
  const manageable = $derived(admin && !!game && !over && !keeper && !!holder);
  let manageOpen = $state(false);
  let asking = $state<"takeover" | "free" | null>(null);
  const manageItems = $derived.by((): ManageItem[] => {
    if (!holder) return [];
    const name = goesBy(holder);
    return [
      {
        icon: "whistle",
        label: "Take over scoring",
        sub: `${name}'s phone stops scoring and yours starts, from where the game is.`,
        run: () => (asking = "takeover"),
      },
      {
        icon: "signOut",
        label: "Free the scoresheet",
        sub: `${name}'s off it, and anyone can take it on. For when you're not at the rink.`,
        run: () => (asking = "free"),
      },
    ];
  });
  function manage(run: () => void) {
    manageOpen = false;
    run();
  }
  function override() {
    const action = asking;
    asking = null;
    if (action && tournament && game)
      act(() => overrideScoresheet(tournament.id, game.id, action, game.keeperId ?? null));
  }
  // Remembered while the sheet goes: who it was taken from, for the question's words as it slides away
  let askedOf = $state("");
  $effect(() => {
    if (asking && holder) askedOf = goesBy(holder);
  });

  // This phone was the scoresheet and isn't any more, not by its own Hand over: an admin took it over or freed it.
  // The page hears it live (ADR 0072); its tools and pickers close, the phone buzzes, and the line under the clock
  // says so, until the sheet's this phone's again
  let handingOver = false;
  let wasKeeper = false;
  let lost = $state<{ to: string | null } | null>(null);
  $effect(() => {
    const now = keeper;
    if (now) lost = null;
    else if (wasKeeper && !over && !handingOver) {
      lost = { to: holder ? goesBy(holder) : null };
      toolsOpen = false;
      reviewing = false;
      picking = null;
      calling = null;
      setting = false;
      buzz([120, 60, 120]);
    }
    if (!now) handingOver = false;
    wasKeeper = now;
  });
  const games = $derived(tournament ? editionPath(type.slug, tournament.id) : `/tournaments/${type.slug}`);
  // Back is always to its edition's own page (the Fight card), wherever the game was opened from (a matchup, a
  // team, the home page, a push): a history step when that's where it came from, so the page is as it was left
  const back = $derived({ href: games, label: `The ${type.shortName}` });
  const toGames = () => (router.from === games ? goBack(games) : navigate(games));
  // When it's set to kick off on the day: the card's time until it starts (lib/fixtures.ts kickOff)
  const setFor = $derived(
    tournament && game ? kickOff(tournament.startTime, slotMinutes(tournament), game.position) : "",
  );
  // A match starts whenever its scorekeeper starts it, on the tournament's day or not: the day stays as an admin set
  // it, and the match keeps when it really started
  const startPause = () => {
    if (!tournament || !game || over) return;
    act(() => clockGame(tournament.id, game.id, running ? "pause" : "start"));
  };
  // Full time opens the review, the confirmation: the match stays live for everyone until it's sealed. Called early,
  // the clock stops while it's looked over (Keep scoring, then Start again, carries on)
  let reviewing = $state(false);
  function end() {
    if (!tournament || !game) return;
    toolsOpen = false;
    reviewing = true;
    if (running && left > 0) act(() => clockGame(tournament.id, game.id, "pause"));
  }
  // Seal the result: full time, the score's the result (a level playoff's refused, and plays on)
  async function seal() {
    if (!tournament || !game || busy) return false;
    busy = true;
    try {
      return (await clockGame(tournament.id, game.id, "end")) !== null;
    } finally {
      busy = false;
    }
  }
  const takeBackGoal = () => tournament && game && lastGoal && act(() => undoGoal(tournament.id, game.id, lastGoal.id));
  function setTimeFromReview() {
    reviewing = false;
    openSet();
  }

  // The tools behind Scoring in the bar: what the scorekeeper needs now and then, kept away from the big buttons
  let toolsOpen = $state(false);
  const lastGoal = $derived(game?.goals?.length ? game.goals[game.goals.length - 1] : undefined);
  const tool = (what: () => unknown) => {
    toolsOpen = false;
    what();
  };

  // Set the time: by the scorekeeper's watch (the game started late on the app, or the ref says so). Paused, it stays
  // paused; running, it runs on from the time set
  let setting = $state(false);
  const settable = $derived(keeper && game?.status === "live" && !onBreak);
  let setMin = $state(0);
  let setSec = $state(0);
  function openSet() {
    setMin = Math.floor(left / 60_000);
    setSec = Math.floor(left / 1000) % 60;
    setting = true;
  }
  function nudge(ms: number) {
    const t = Math.max(0, Math.min(60 * 60_000, (setMin * 60 + setSec) * 1000 + ms));
    setMin = Math.floor(t / 60_000);
    setSec = Math.floor(t / 1000) % 60;
  }
  function saveTime() {
    if (!tournament || !game) return;
    const ms = (Math.max(0, setMin) * 60 + Math.max(0, Math.min(59, setSec))) * 1000;
    setting = false;
    act(() => setGameClock(tournament.id, game.id, ms));
  }

  // An admin putting a played game's result right (or entering the game up next's): add goals (who, who assisted,
  // when) and take any off. The score is its goals
  let fixing = $state(false);
  const canFix = $derived(admin && !keeper && !holder);
  async function enterResult() {
    if (!tournament || !game) return;
    if (!(await scoreGame(tournament.id, game.id, 0, 0))) return;
    // Straight to the score: most results typed in are just that
    fixing = true;
    openScore();
  }
  // Or just the score: goals go on (nobody said who) or come off to match (fixtures.ts matchGoals)
  let scoring = $state(false);
  let score = $state([0, 0]);
  function openScore() {
    score = [game?.homeGoals ?? 0, game?.awayGoals ?? 0];
    scoring = true;
  }
  const bump = (i: number, by: number) => (score[i] = Math.max(0, Math.min(99, score[i] + by)));
  function saveScore() {
    if (!tournament || !game) return;
    const [h, a] = score;
    scoring = false;
    act(() => scoreGame(tournament.id, game.id, h, a));
  }
  let whenMin = $state(0);
  let whenSec = $state(0);
  let whenPeriod = $state(1);

  // A goal: the team, then who scored, then who assisted (or nobody said); an admin's, then when
  let picking = $state<{ team: number; scorer?: number | null; assist?: number | null } | null>(null);
  function choose(id: number | null) {
    if (!picking || !tournament || !game) return;
    if (picking.scorer === undefined) {
      picking = { ...picking, scorer: id };
      return;
    }
    if (fixing) {
      // Then when: an admin adding a goal after the game
      picking = { ...picking, assist: id };
      whenMin = 0;
      whenSec = 0;
      whenPeriod = 1;
      return;
    }
    const goal = { teamId: picking.team, scorerId: picking.scorer, assistId: id };
    picking = null;
    act(() => addGoal(tournament.id, game.id, goal));
  }
  // An admin's goal, at the time they say (or none)
  function addFixed(known: boolean) {
    if (!picking || !tournament || !game) return;
    const atMs = known ? Math.min(full, (Math.max(0, whenMin) * 60 + Math.max(0, Math.min(59, whenSec))) * 1000) : null;
    const goal = {
      teamId: picking.team,
      scorerId: picking.scorer ?? null,
      assistId: picking.assist ?? null,
      atMs,
      period: known ? whenPeriod : null,
    };
    picking = null;
    act(() => addGoal(tournament.id, game.id, goal));
  }
  // A penalty: what for, then who (or nobody: a bench penalty), the minutes (the tournament's usual length unless
  // said); an admin's, then when. One drawer, every choice a tap
  let calling = $state<{ team: number; memberId: number | null; minutes: number; infraction: string } | null>(null);
  const callPenalty = (team: number) => {
    calling = { team, memberId: null, minutes: usualPenalty, infraction: "" };
    whenMin = 0;
    whenSec = 0;
    whenPeriod = 1;
  };
  // The length the sheet starts on: the tournament's setting (a series' copied, ADR 0130)
  const usualPenalty = $derived(tournament?.defaultPenaltyMinutes ?? 2);
  // What for comes first: a bench one (too many players, a bench minor) starts on Bench at 2 minutes; back from one,
  // the usual length again
  function pickInfraction(f: (typeof INFRACTIONS)[number]) {
    if (!calling) return;
    const was = infractionOf(calling.infraction);
    calling.infraction = f.value;
    if (f.minorOnly) {
      calling.memberId = null;
      calling.minutes = 2;
    } else if (was?.minorOnly) calling.minutes = usualPenalty;
  }
  // Always for something; a player's infraction on someone (lib/penalties.ts, as the Worker checks)
  const callNeeds = $derived.by(() => {
    if (!calling) return "";
    const rule = infractionOf(calling.infraction);
    if (!rule) return "Choose what it's for";
    return !rule.bench && calling.memberId === null ? "Choose who it's on" : "";
  });
  function savePenalty(known = true) {
    if (!calling || !tournament || !game || callNeeds) return;
    const { team, memberId, minutes, infraction } = calling;
    const atMs = !fixing
      ? undefined
      : known
        ? Math.min(full, (Math.max(0, whenMin) * 60 + Math.max(0, Math.min(59, whenSec))) * 1000)
        : null;
    calling = null;
    act(() =>
      addPenalty(tournament.id, game.id, {
        teamId: team,
        memberId,
        minutes,
        infraction,
        atMs,
        period: atMs == null ? null : whenPeriod,
      }),
    );
  }
  const lastPenalty = $derived(
    game?.penalties?.length ? game.penalties.reduce((a, b) => (b.id > a.id ? b : a)) : undefined,
  );
  // The penalty clock, beside each team: what's being served now, in game time, so it stops when the clock does
  // (lib/penalties.ts; a power-play goal ends a minor)
  // How a penalty's served, the tournament's setting: in the box (a power play), or a penalty shot with the player
  // sitting out (nobody short; goals don't end it; a bench one has nobody to sit out)
  const rule = $derived(tournament?.penaltyRule ?? "power_play");
  const sitOut = $derived(rule === "sit_out");
  const inGame = $derived({
    penalties: (game?.penalties ?? []).map((p) => ({ ...p, atMs: inGameTime(p.period, p.atMs, full) })),
    goals: (game?.goals ?? []).map((g) => ({ ...g, atMs: inGameTime(g.period, g.atMs, full) })),
    now: inGameTime(period, full - left, full)!,
  });
  const box = $derived(game?.status === "live" ? serving(inGame.penalties, inGame.goals, inGame.now, rule) : []);
  // The strength on the ice, home first ("5 on 4", "4 on 4" for coincidental minors): only what doesn't cancel out
  // counts (lib/penalties.ts). Sitting out, never
  const strength = $derived.by(() => {
    if (game?.status !== "live") return "";
    const short = playersShort(inGame.penalties, inGame.goals, inGame.now, rule);
    return manpower(short.get(game.homeTeamId ?? -1) ?? 0, short.get(game.awayTeamId ?? -1) ?? 0);
  });
  const boxOf = (teamId: number | null) => box.filter((b) => b.penalty.teamId === teamId);
  const who = (memberId: number | null) => goesByOf(byId(memberId)) || "Bench";

  const pimOf = (memberId: number) =>
    (game?.penalties ?? []).filter((p) => p.memberId === memberId).reduce((n, p) => n + p.minutes, 0);
  const scoreOf = (i: number) => (i === 0 ? game?.homeGoals : game?.awayGoals) ?? 0;
  // The tournament's team names, which its crests are told apart among (logo.ts)
  const crestNames = $derived(teamNamesOf(teams, byId));
</script>

<BackBar
  href={back.href}
  label={back.label}
  onclick={toGames}
  title={game ? `Game ${game.position}` : "Game"}
  right={over
    ? "Full time"
    : game?.status === "live"
      ? running
        ? "Running"
        : onBreak
          ? "Break"
          : "Paused"
      : "Not started"}
  action={keeper && !over ? scoring_ : manageable ? manage_ : undefined}
/>
<!-- An admin's tools for someone else's scoresheet: the page's one Manage (ADR 0065) -->
{#snippet manage_()}
  <button
    class="btn sm ghost icon"
    aria-haspopup="dialog"
    aria-label="Manage the scoresheet"
    title="Manage"
    onclick={() => (manageOpen = true)}><Icon name="settings" size={18} /></button
  >
{/snippet}
<!-- Keeping score: said in the bar, in red, and a tap opens the scorekeeper's tools, so the clock gets the screen -->
{#snippet scoring_()}
  <button class="btn ghost sm keeping" aria-label="You're keeping score: tools" onclick={() => (toolsOpen = true)}
    ><Icon name="whistle" size={18} />You're scoring</button
  >
{/snippet}

{#if waiting}
  <!-- Its tournament on its way (#175): the room the page takes -->
  <div class="waiting" aria-busy="true" aria-label="Loading"></div>
{:else if !tournament || !game}
  <p class="note missing">No such game.</p>
{:else}
  <div class="game">
    <!-- The clock: to read, and for the scorekeeper, a tap sets it (ADR 0065). Its start and pause is the big button
         under it -->
    <svelte:element
      this={settable ? "button" : "div"}
      class="clock"
      class:running
      class:done={over || timeUp}
      class:on-break={onBreak}
      class:settable
      role={settable ? undefined : "timer"}
      aria-label={settable ? `Set the time: ${mmss(left)} left` : onBreak ? `Break: ${mmss(breakMs!)}` : mmss(left)}
      onclick={settable ? openSet : undefined}
    >
      <!-- On a break, the break's countdown in place of the paused clock -->
      <span class="time display num">{onBreak ? mmss(breakMs!) : mmss(left)}</span>
      <span class="meter"><span style:transform="scaleX({onBreak ? breakMs! / breakFull : left / full})"></span></span>
      <span class="cue hint">
        {#if over}Full time{#if game.startedAt}
            · Started {clock(londonTime(game.startedAt))}{#if londonTime(game.startedAt) !== setFor}, set for {clock(
                setFor,
              )}{/if}{/if}
        {:else if game.status === "next"}Kick-off {clock(setFor)}
        {:else if timeUp && level}Level: next goal wins
        {:else if timeUp}{keeper ? "Time's up: call full time" : "Time's up"}
        {:else if onBreak}Break · {periodName(period)} period next
        {:else if breakMs === 0}Break's over · {periodName(period)} period next
        {:else}{periods > 1 ? `${periodName(period)} period · ` : ""}{running ? "Live" : "Paused"}{strength
            ? ` · ${strength}`
            : ""}{/if}
      </span>
    </svelte:element>

    {#if sayFollowing}
      <!-- The score follows along: live from the hub's stream, else on the admins' beat (ADR 0072) -->
      <p class="updates hint">
        <Icon name={liveFeed.on ? "live" : "clock"} size={14} /><LiveNote tail=", to keep the club on the free plan" />
      </p>
    {/if}

    {#if !over && !keeper}
      <!-- Who's keeping score, for everyone following: taken on here, on purpose, never by the big button (someone
           watching from home shouldn't take it by accident). One person holds it until they hand it over -->
      <div class="keep-line">
        {#if lost?.to && holder}
          <!-- This phone's sheet was taken over: said here, where the big button was -->
          <span class="hint lost"
            ><Icon name="whistle" size={16} />{goesBy(holder)}'s taken over scoring. You're off the clock.</span
          >
        {:else if holder}
          <span class="hint"><i class="rec" aria-hidden="true"></i>Score kept by {goesBy(holder)}</span>
        {:else if upNext && game.homeTeamId && game.awayTeamId}
          <span class="hint" class:lost={lost && !lost.to}
            >{lost && !lost.to
              ? "An admin freed your scoresheet. Keep score to take it back"
              : `Nobody's keeping score${game.scoringTeamId ? ` · ${teamName(game.scoringTeamId)}'s turn` : ""}`}</span
          >
          <button class="btn outline sm" disabled={busy} onclick={take}
            ><Icon name="whistle" size={16} />Keep score</button
          >
        {:else}
          <span class="hint">Scoring opens when it's the game up next</span>
        {/if}
      </div>
    {/if}

    <!-- The scorekeeper's big button, under the clock it runs, with clear space before the goals: start and pause -->
    {#if !over && keeper}
      {#if keeper && timeUp && level}
        <!-- A level playoff plays on: no full time until a goal wins it; the goal buttons below are what to press -->
        <div class="control sudden" role="status">
          <Icon name="whistle" size={26} />Play on: next goal wins
        </div>
      {:else if keeper && timeUp}
        <!-- Time's up: the big button is full time, which opens the review to seal the result -->
        <button class="btn control full-time" disabled={busy} onclick={end}>
          <Icon name="whistle" size={26} />
          Full time
        </button>
      {:else if keeper}
        <button class="btn control" class:start={!running} class:pause={running} disabled={busy} onclick={startPause}>
          <Icon name={running ? "pause" : "play"} size={26} />
          {running
            ? "Pause"
            : game.status === "next"
              ? "Start the game"
              : periods > 1 && left === full
                ? `Start the ${periodName(period)}`
                : "Start again"}
        </button>
      {/if}
    {/if}

    <div class="sides">
      {#each sides as teamId, i (i)}
        <div class="side" class:away={i === 1}>
          {#if teamId}
            <TeamCrest
              among={crestNames}
              name={teamName(teamId)}
              logo={teams[indexOf(teamId)]?.logo ?? null}
              tone={teamTone(indexOf(teamId))}
              size="6rem"
            />
          {/if}
          <span class="display name">{teamName(teamId)}</span>
          <span class="display goals num"><RollNumber value={scoreOf(i)} /></span>
          {#if game.status === "live"}
            <!-- The penalty clock: who's in the box and the time left, counting down with the game clock. Two lines'
                 room kept whether or not anyone's in, so nothing moves when a penalty's called or served -->
            <ul class="box" aria-label="{teamName(teamId)}'s penalties">
              {#each boxOf(teamId).slice(0, 2) as b (b.penalty.id)}
                <!-- One waiting for the player's last to end: its whole length, "then 2:00" -->
                <li class:waiting={b.waiting}>
                  <span class="box-who">{who(b.penalty.memberId)}</span>
                  {#if sitOut && !b.waiting}<span class="box-double">sits out</span>{/if}
                  <span class="box-left num">{b.waiting ? `then ${mmss(b.leftMs)}` : mmss(b.leftMs)}</span>
                  {#if b.double}<span class="box-double num" title="Double minor">2+2</span>{/if}
                </li>
              {/each}
              {#if boxOf(teamId).length > 2}<li class="box-more hint">+{boxOf(teamId).length - 2} more</li>{/if}
            </ul>
          {/if}
          {#if teamId && ((keeper && game.status === "live") || (fixing && over))}
            <button class="btn outline goal" disabled={busy} onclick={() => (picking = { team: teamId })}
              >{fixing ? "Add a goal" : "Goal"}</button
            >
            <!-- Quieter than Goal: the main event's the goals -->
            <button class="btn ghost sm penalty" disabled={busy} onclick={() => callPenalty(teamId)}
              ><Icon name="flag" size={16} />{fixing ? "Add a penalty" : "Penalty"}</button
            >
          {/if}
        </div>
      {/each}
    </div>

    <section class="log">
      <h2 class="section-title">{game.penalties?.length ? "Goals and penalties" : "Goals"}</h2>
      {#if game.status !== "next"}<BoxScore {tournament} {game} />{/if}
      {#if game.goals?.length || game.penalties?.length}
        <GameTimeline
          {tournament}
          {game}
          latestFirst={!over}
          {busy}
          onremove={fixing
            ? (kind, id) =>
                act(() =>
                  kind === "goal" ? removeGoal(tournament.id, game.id, id) : removePenalty(tournament.id, game.id, id),
                )
            : undefined}
        />
      {:else}
        <p class="hint">{game.status === "next" ? "Not kicked off yet." : "No goals yet."}</p>
      {/if}
    </section>

    <!-- Both teams: who's playing, the captain marked, and anyone who's scored in this game -->
    <section class="rosters">
      <h2 class="section-title">The teams</h2>
      <div class="squads">
        {#each sides as teamId, i (i)}
          <div class="squad">
            {#if teamId}
              <a class="squad-head" href={teamHref(type.slug, teamId)}>
                <TeamCrest
                  among={crestNames}
                  name={teamName(teamId)}
                  logo={teams[indexOf(teamId)]?.logo ?? null}
                  tone={teamTone(indexOf(teamId))}
                  size="2.25rem"
                />
                <span class="squad-name">{teamName(teamId)}</span>
              </a>
              <ol class="squad-list">
                {#each roster(teamId) as p (p.id)}
                  {@const scored = (game.goals ?? []).filter((x) => x.scorerId === p.id).length}
                  {@const pim = pimOf(p.id)}
                  <li>
                    <span class="c display">{p.id === teams[indexOf(teamId)]?.captainMemberId ? "C" : ""}</span>
                    <span class="pname">{goesBy(p)}</span>
                    {#if scored}<span class="badge">{scored > 1 ? `${scored} goals` : "Goal"}</span>{/if}
                    {#if pim}<span class="badge">PIM {pim}</span>{/if}
                    <span class="pos"><PositionIcon position={p.position} /></span>
                  </li>
                {/each}
              </ol>
            {:else}
              <p class="hint">Known once the table's done.</p>
            {/if}
          </div>
        {/each}
      </div>
    </section>

    <!-- Who's keeping score: take it on, let it go -->
    <div class="kept">
      {#if keeper}
        <!-- Hand over is in the tools, from Scoring in the bar -->
      {:else if holder}
        <!-- Said under the clock -->
      {:else if over && canFix}
        <!-- An admin puts the result right: goals on and off -->
        {#if fixing}
          <button class="btn outline let-go" disabled={busy} onclick={openScore}>Set the score</button>
          <button class="btn primary let-go" onclick={() => (fixing = false)}>Done</button>
        {:else}
          <button class="btn outline let-go" onclick={() => (fixing = true)}>Edit the result</button>
        {/if}
      {:else if !over && upNext}
        {#if canFix && game.status === "next" && game.homeTeamId && game.awayTeamId}
          <!-- Or an admin types it in after the fact: played, 0–0, then the goals -->
          <button class="btn outline let-go" disabled={busy} onclick={enterResult}>Enter the result instead</button>
        {/if}
      {/if}
    </div>
  </div>

  <!-- The tools: big rows, one tap each (full time opens its review), each done right here. Up from the bottom on a phone,
       a side drawer on a desktop (ADR 0065) -->
  {#snippet toolList()}
    <div class="tools">
      <p class="hint tools-note">Only you can run the clock and log goals and penalties, until you hand it over.</p>
      {#if game.status === "live"}
        <button
          class="tool"
          disabled={busy || !lastGoal}
          onclick={() => lastGoal && tool(() => act(() => undoGoal(tournament.id, game.id, lastGoal.id)))}
        >
          <Icon name="undo" size={22} />
          <span class="tool-text"
            ><strong>Take back the last goal</strong><span
              >{lastGoal
                ? `${goesByOf(byId(lastGoal.scorerId)) || teamName(lastGoal.teamId)} · ${mmss(lastGoal.atMs)}`
                : "No goals yet"}</span
            ></span
          >
        </button>
        <button
          class="tool"
          disabled={busy || !lastPenalty}
          onclick={() => lastPenalty && tool(() => act(() => undoPenalty(tournament.id, game.id, lastPenalty.id)))}
        >
          <Icon name="undo" size={22} />
          <span class="tool-text"
            ><strong>Take back the last penalty</strong><span
              >{lastPenalty
                ? `${penaltyLine(lastPenalty, (id) => who(id))} · PIM ${lastPenalty.minutes} · ${lastPenalty.atMs === null ? "–" : mmss(lastPenalty.atMs)}`
                : "No penalties yet"}</span
            ></span
          >
        </button>
        {#if !lastPeriod}
          <button class="tool" disabled={busy} onclick={() => tool(endPeriod)}>
            <Icon name="whistle" size={22} />
            <span class="tool-text"
              ><strong>End the {periodName(period)} period</strong><span
                >The {periodName(period + 1)} starts paused, the clock back to {mmss(full)}.</span
              ></span
            >
          </button>
        {/if}
        <button class="tool" disabled={busy || level} onclick={end}>
          <Icon name="whistle" size={22} />
          <span class="tool-text"
            ><strong>Full time now</strong><span
              >{level
                ? "Not while it's level: a playoff needs a winner."
                : "Stops the clock to look it over, then seal the result."}</span
            ></span
          >
        </button>
      {/if}
      <button class="tool" disabled={busy} onclick={() => tool(letGo)}>
        <Icon name="signOut" size={22} />
        <span class="tool-text"
          ><strong>Hand over</strong><span>Someone else can take it on from where you are.</span></span
        >
      </button>
    </div>
  {/snippet}
  {#if phone.current}
    <Sheet bind:open={toolsOpen} title="You're keeping score">{@render toolList()}</Sheet>
  {:else}
    <Drawer bind:open={toolsOpen} title="You're keeping score">{@render toolList()}</Drawer>
  {/if}

  <!-- Full time's review: look it over, put a mistake right, then seal the result -->
  {#if keeper || reviewing}
    <SealResult
      bind:open={reviewing}
      {type}
      {tournament}
      {game}
      {busy}
      {level}
      onseal={seal}
      ontakeback={takeBackGoal}
      onsettime={setTimeFromReview}
    />
  {/if}

  <!-- An admin's Manage: a sheet on a phone, a side drawer on a desktop (ADR 0065) -->
  {#snippet manageList()}<ManageList items={manageItems} go={manage} />{/snippet}
  {#if phone.current}
    <Sheet bind:open={manageOpen} title="Manage the scoresheet" sub="Game {game.position}">{@render manageList()}</Sheet
    >
  {:else}
    <Drawer bind:open={manageOpen} title="Manage the scoresheet" sub="Game {game.position}"
      >{@render manageList()}</Drawer
    >
  {/if}

  <!-- Taking someone's sheet: asked first, the yes in red (the one red fill, ADR 0084) -->
  <Sheet
    bind:open={() => !!asking, (v) => !v && (asking = null)}
    title={asking === "free" ? "Free the scoresheet?" : `Take over Game ${game.position}?`}
  >
    <p class="ask">
      {#if asking === "free"}
        {askedOf} stops scoring straight away. The clock and the goals stay as they are, and anyone can take it on.
      {:else}
        {askedOf}'s phone stops scoring the moment you tap. The clock and the goals carry on from here, on yours.
      {/if}
    </p>
    {#snippet footer()}
      <button class="btn ghost" type="button" onclick={() => (asking = null)}>Leave it</button>
      <button class="btn yes" type="button" disabled={busy} onclick={override}
        >{asking === "free" ? "Free it" : "Take over"}</button
      >
    {/snippet}
  </Sheet>

  <!-- Set the score, in a sheet (a short form, ADR 0065): each side's goals, up and down -->
  <Sheet bind:open={scoring} title="Set the score">
    <p class="hint">Goals go on, nobody said who, or the latest come off to match.</p>
    <div class="score-set">
      {#each sides as teamId, i (i)}
        {#if teamId}
          <div class="score-side">
            <TeamCrest
              among={crestNames}
              name={teamName(teamId)}
              logo={teams[indexOf(teamId)]?.logo ?? null}
              tone={teamTone(indexOf(teamId))}
              size="3.5rem"
            />
            <span class="score-name">{teamName(teamId)}</span>
            <div class="stepper">
              <button
                class="btn outline step"
                aria-label="One fewer"
                disabled={score[i] === 0}
                onclick={() => bump(i, -1)}>−</button
              >
              <span class="score-n display num" aria-live="polite">{score[i]}</span>
              <button class="btn outline step" aria-label="One more" onclick={() => bump(i, 1)}>+</button>
            </div>
          </div>
        {/if}
      {/each}
    </div>
    {#snippet footer()}
      <div class="when-actions">
        <button class="btn outline name-skip" onclick={() => (scoring = false)}>Cancel</button>
        <button class="btn primary name-skip" onclick={saveScore}>Save the score</button>
      </div>
    {/snippet}
  </Sheet>

  <!-- Set the time, in a sheet from the clock: minutes and seconds left, or nudge it -->
  <Sheet bind:open={setting} title="Set the time">
    <div class="set-time">
      <label class="field"
        ><span>Minutes</span><input
          class="input num"
          type="number"
          min="0"
          max="60"
          inputmode="numeric"
          bind:value={setMin}
        /></label
      >
      <span class="colon display">:</span>
      <label class="field"
        ><span>Seconds</span><input
          class="input num"
          type="number"
          min="0"
          max="59"
          inputmode="numeric"
          bind:value={setSec}
        /></label
      >
    </div>
    <div class="nudges">
      <button class="btn outline sm" onclick={() => nudge(-60_000)}>−1:00</button>
      <button class="btn outline sm" onclick={() => nudge(-10_000)}>−0:10</button>
      <button class="btn outline sm" onclick={() => nudge(10_000)}>+0:10</button>
      <button class="btn outline sm" onclick={() => nudge(60_000)}>+1:00</button>
    </div>
    <p class="hint">{running ? "The clock runs on from here." : "The clock stays paused until you start it."}</p>
    {#snippet footer()}
      <button class="btn ghost" onclick={() => (setting = false)}>Cancel</button>
      <button class="btn primary" onclick={saveTime}>Set the clock</button>
    {/snippet}
  </Sheet>

  <!-- Who scored, then who assisted: a side drawer (the whole screen on a phone), big names, quick to hit at the
       side of the rink -->
  <Drawer
    bind:open={() => !!picking, (v) => !v && (picking = null)}
    title={picking?.scorer === undefined ? "Who scored?" : picking?.assist === undefined ? "Who assisted?" : "When?"}
    sub={picking
      ? `Goal ${teamName(picking.team)}${picking.scorer ? ` · ${goesByOf(byId(picking.scorer))}` : ""}`
      : undefined}
  >
    {#if picking && picking.scorer !== undefined && picking.assist !== undefined}
      <!-- When, in game time: minutes and seconds in -->
      {#if periods > 1}
        <div class="seg block sm when-period" role="group" aria-label="Which period">
          {#each Array.from({ length: periods }, (_, k) => k + 1) as n (n)}
            <button type="button" aria-pressed={whenPeriod === n} onclick={() => (whenPeriod = n)}
              >{periodName(n)}</button
            >
          {/each}
        </div>
      {/if}
      <div class="set-time">
        <label class="field"
          ><span>Minutes in</span><input
            class="input num"
            type="number"
            min="0"
            inputmode="numeric"
            bind:value={whenMin}
          /></label
        >
        <span class="colon display">:</span>
        <label class="field"
          ><span>Seconds</span><input
            class="input num"
            type="number"
            min="0"
            max="59"
            inputmode="numeric"
            bind:value={whenSec}
          /></label
        >
      </div>
    {:else if picking}
      <div class="names">
        {#each roster(picking.team).filter((p) => p.id !== picking?.scorer) as p (p.id)}
          <button class="name-pick" onclick={() => choose(p.id)}
            ><span>{goesBy(p)}</span><small><PositionIcon position={p.position} size={12} /></small></button
          >
        {/each}
      </div>
    {/if}
    {#snippet footer()}
      {#if picking?.assist !== undefined}
        <div class="when-actions">
          <button class="btn outline name-skip" onclick={() => addFixed(false)}>Don't know when</button>
          <button class="btn primary name-skip" onclick={() => addFixed(true)}>Add the goal</button>
        </div>
      {:else}
        <button class="btn outline name-skip" onclick={() => choose(null)}
          >{picking?.scorer === undefined ? "Didn't see who" : "No assist"}</button
        >
      {/if}
    {/snippet}
  </Drawer>

  <!-- A penalty: what for, who, the length, each a tap, in a drawer (a tall sheet on a phone, ADR 0065) like a
       goal's. Stamped with the game clock; an admin putting a result right says when -->
  <Drawer
    bind:open={() => !!calling, (v) => !v && (calling = null)}
    title="Penalty"
    sub={calling ? `${teamName(calling.team)}${calling.memberId ? ` · ${who(calling.memberId)}` : ""}` : undefined}
  >
    {#if calling}
      {@const rule = infractionOf(calling.infraction)}
      <div class="call">
        <div class="field call-part">
          <span id="pen-for">For</span>
          <div class="seg block sm pick-grid" role="group" aria-labelledby="pen-for">
            {#each INFRACTIONS as f (f.value)}
              <button type="button" aria-pressed={calling.infraction === f.value} onclick={() => pickInfraction(f)}
                >{f.label}</button
              >
            {/each}
          </div>
        </div>
        <div class="field call-part">
          <span id="pen-who">Who</span>
          <!-- Bench is there for a bench infraction (on nobody); a player's needs a player -->
          <div class="seg block pick-grid" role="group" aria-labelledby="pen-who">
            <button
              type="button"
              aria-pressed={!!rule?.bench && calling.memberId === null}
              disabled={!!rule && !rule.bench}
              onclick={() => calling && (calling.memberId = null)}>Bench</button
            >
            {#each roster(calling.team) as p (p.id)}
              <button
                type="button"
                aria-pressed={calling.memberId === p.id}
                onclick={() => calling && (calling.memberId = calling.memberId === p.id && rule?.bench ? null : p.id)}
                >{goesBy(p)}</button
              >
            {/each}
          </div>
        </div>
        <div class="field call-part">
          <span id="pen-min">Length</span>
          <div class="seg block tiles" role="group" aria-labelledby="pen-min">
            {#each PENALTY_KINDS as k (k.minutes)}
              <button
                type="button"
                aria-pressed={calling.minutes === k.minutes}
                disabled={!!rule?.minorOnly && k.minutes !== 2}
                onclick={() => calling && (calling.minutes = k.minutes)}
                ><Icon name="clock" size={22} /><span class="name">{k.name}</span><span class="sub">{k.length}</span
                ></button
              >
            {/each}
          </div>
        </div>
        {#if fixing}
          <div class="field call-part">
            <span>When</span>
            {#if periods > 1}
              <div class="seg block sm when-period" role="group" aria-label="Which period">
                {#each Array.from({ length: periods }, (_, k) => k + 1) as n (n)}
                  <button type="button" aria-pressed={whenPeriod === n} onclick={() => (whenPeriod = n)}
                    >{periodName(n)}</button
                  >
                {/each}
              </div>
            {/if}
            <div class="set-time">
              <label class="field"
                ><span>Minutes in</span><input
                  class="input num"
                  type="number"
                  min="0"
                  inputmode="numeric"
                  bind:value={whenMin}
                /></label
              >
              <span class="colon display">:</span>
              <label class="field"
                ><span>Seconds</span><input
                  class="input num"
                  type="number"
                  min="0"
                  max="59"
                  inputmode="numeric"
                  bind:value={whenSec}
                /></label
              >
            </div>
          </div>
        {/if}
      </div>
    {/if}
    {#snippet footer()}
      <!-- What's still needed, in a line kept for it -->
      <div class="call-foot">
        <p class="hint foot-hint" aria-live="polite">{callNeeds}</p>
        <div class="when-actions">
          {#if fixing}
            <button class="btn outline name-skip" disabled={busy || !!callNeeds} onclick={() => savePenalty(false)}
              >Don't know when</button
            >
          {:else}
            <button class="btn outline name-skip" onclick={() => (calling = null)}>Cancel</button>
          {/if}
          <button class="btn primary name-skip" disabled={busy || !!callNeeds} onclick={() => savePenalty(true)}
            >{fixing ? "Add the penalty" : `Penalty${calling ? ` · ${calling.minutes} min` : ""}`}</button
          >
        </div>
      </div>
    {/snippet}
  </Drawer>
{/if}

<style>
  .missing {
    padding: var(--s-6) var(--gutter);
  }
  .game {
    display: grid;
    /* One column the window's width, never its content's (as .page): a long line wraps, it doesn't widen the page */
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s-6);
    width: 100%;
    max-width: 36rem;
    margin: 0 auto;
    padding: var(--s-5) var(--gutter) var(--s-10);
  }
  .clock {
    display: grid;
    justify-items: center;
    gap: var(--s-3);
    padding: var(--s-4) 0 var(--s-2);
    color: var(--fg);
  }
  /* The scorekeeper's: a tap sets it. No box; it lifts a little under a finger */
  button.clock {
    width: 100%;
    border: 0;
    border-radius: var(--r-lg);
    background: none;
    font: inherit;
    cursor: pointer;
    transition: background-color var(--t-fast) var(--ease-in-out);
  }
  button.clock:hover,
  button.clock:active {
    background: color-mix(in srgb, var(--fg) 4%, transparent);
  }
  .time {
    font-size: clamp(6rem, 32vw, 9rem);
    letter-spacing: 0.02em;
    color: var(--fg-muted);
    transition: color var(--t-slow) var(--ease);
  }
  .running .time {
    color: var(--fg);
  }
  .done .time {
    color: var(--red-hot);
  }
  /* The break's countdown: an accent, so it's never mistaken for the game clock */
  .on-break .time {
    color: var(--caution-ink);
  }
  .meter {
    width: min(100%, 18rem);
    height: 3px;
    border-radius: 2px;
    background: color-mix(in srgb, var(--fg) 10%, transparent);
    overflow: hidden;
  }
  .meter span {
    display: block;
    height: 100%;
    transform-origin: left;
    background: var(--red);
    transition: transform 1s linear;
  }
  .set-time {
    display: flex;
    align-items: flex-end;
    justify-content: center;
    gap: var(--s-3);
  }
  .set-time .input {
    width: 6rem;
    font-size: 2rem;
    text-align: center;
  }
  .score-set {
    display: grid;
    gap: var(--s-5);
  }
  .score-side {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--s-4);
  }
  .score-name {
    overflow: hidden;
    color: var(--fg);
    font-size: var(--text-md);
    font-weight: 600;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .stepper {
    display: flex;
    align-items: center;
    gap: var(--s-3);
  }
  .step {
    width: 3.25rem;
    height: 3.25rem;
    padding: 0;
    font-size: 1.6rem;
  }
  .score-n {
    min-width: 2ch;
    color: var(--fg);
    font-size: 2.75rem;
    text-align: center;
  }
  .when-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--s-2);
  }
  .colon {
    padding-bottom: 0.4rem;
    font-size: 2rem;
  }
  .nudges {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--s-2);
    margin-top: var(--s-4);
  }
  .cue {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
  }
  /* Clear space below it, before the goals, so a goal isn't a pause by mistake */
  .control {
    width: 100%;
    height: 5rem;
    margin-bottom: var(--s-6);
    gap: var(--s-3);
    border-radius: var(--r-lg);
    font-family: var(--font-display);
    font-size: 1.6rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  /* No cream fills on the dark scoresheet: a heavy outline says "the button", the words and icon say which */
  .control {
    border: 3px solid var(--fg);
    background: transparent;
    color: var(--fg);
  }
  .control:hover:not(:disabled) {
    background: var(--surface-2);
  }
  /* Start: the one main thing to tap, so sticker yellow; Pause stays the outline, so the two never look alike */
  .control.start {
    border-color: var(--action);
    background: var(--action);
    color: var(--on-action);
  }
  .control.start:hover:not(:disabled) {
    border-color: var(--action-hover);
    background: var(--action-hover);
  }
  /* Who's keeping score, under the clock: a line, with Keep score beside it when nobody is */
  .keep-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--s-2) var(--s-3);
    min-height: var(--control-h-sm);
    margin-bottom: var(--s-6);
  }
  .keep-line .hint {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    text-align: center;
    text-wrap: balance;
  }
  .keep-line .btn {
    gap: var(--s-1);
  }
  /* This phone lost the sheet: the words in the club's red, the whistle with them */
  .keep-line .lost {
    color: var(--red-hot);
  }
  .ask {
    margin: 0;
    color: var(--fg-muted);
    line-height: 1.5;
  }
  /* The armed "are you sure": the one red fill (ADR 0084) */
  .yes {
    background: var(--red);
    color: var(--on-red);
  }
  .yes:hover:not(:disabled) {
    background: var(--red-hot);
  }
  .rec {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--red-hot);
  }
  .sides {
    display: grid;
    grid-template-columns: 1fr 1fr;
    border-block: 1px solid var(--border);
  }
  .side {
    display: grid;
    justify-items: center;
    align-content: start;
    gap: var(--s-2);
    padding: var(--s-5) var(--s-4);
    text-align: center;
  }
  .side.away {
    border-left: 1px solid var(--border);
  }
  /* Two lines' room, centred, whatever the name: the scores and Goal buttons line up across the two sides */
  .name {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 2.3em;
    font-size: 1.3rem;
    line-height: 1.1;
    color: var(--fg-muted);
    text-wrap: balance;
  }
  .goals {
    font-size: 4.5rem;
    color: var(--fg);
  }
  /* Goal: the app's outline button, big, with big words */
  .goal {
    width: 100%;
    height: 4rem;
    margin-top: var(--s-2);
    border-width: 2px;
    border-radius: var(--r-lg);
    font-family: var(--font-display);
    font-size: 1.5rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  /* Not a button: the words in the big button's place, so nothing moves when the winning goal brings Full time back */
  .control.sudden {
    display: flex;
    align-items: center;
    justify-content: center;
    border-color: transparent;
    background: var(--surface-2);
    color: var(--red-hot);
    font-size: 1.4rem;
  }
  /* Quieter than Goal: a ghost button under it, words and a flag */
  .penalty {
    width: 100%;
    gap: var(--s-1);
    color: var(--fg-muted);
  }
  /* The penalty clock: two lines kept, a name and the time left each, no box around it */
  .box {
    display: grid;
    align-content: start;
    gap: 0.1rem;
    width: 100%;
    min-height: calc(2 * 1.5rem + 0.1rem);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .box li {
    display: flex;
    justify-content: center;
    align-items: baseline;
    gap: var(--s-2);
    height: 1.5rem;
    min-width: 0;
    font-size: var(--text-sm);
  }
  .box-who {
    overflow: hidden;
    color: var(--fg-muted);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .box-left {
    color: var(--red-hot);
    font-weight: 700;
  }
  /* Waiting its turn: not counting down yet, so not red */
  .box li.waiting .box-left {
    color: var(--fg-muted);
    font-weight: 400;
  }
  /* A double minor: one clock, four minutes, marked */
  .box-double {
    flex-shrink: 0;
    white-space: nowrap;
    color: var(--fg-subtle);
    font-size: var(--text-2xs);
    font-weight: 700;
  }
  .box-more {
    font-size: var(--text-xs);
  }
  .call {
    display: grid;
    gap: var(--s-6);
  }
  .call-part {
    display: grid;
    gap: var(--s-2);
  }
  .when-period {
    margin-bottom: var(--s-4);
  }
  .call-foot {
    display: grid;
    width: 100%;
  }
  .foot-hint {
    min-height: 1.4em;
    margin: 0 0 var(--s-2);
    font-size: var(--text-sm);
    text-align: center;
  }
  .pick-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .log {
    display: grid;
    gap: var(--s-3);
  }
  .log .section-title {
    margin: 0 var(--s-1);
  }
  ol {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .rosters {
    display: grid;
    gap: var(--s-3);
  }
  .rosters .section-title {
    margin: 0 var(--s-1);
  }
  .squads {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: var(--s-5);
  }
  .squad {
    display: grid;
    align-content: start;
    gap: var(--s-2);
  }
  .squad-head {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    color: var(--fg);
  }
  .squad-name {
    overflow: hidden;
    font-weight: 600;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .squad-list {
    display: grid;
  }
  .squad-list li {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    min-height: 2.5rem;
  }
  /* The captain: a red C */
  .c {
    flex-shrink: 0;
    width: 1.2rem;
    color: var(--red-hot);
    text-align: center;
  }
  .pname {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--fg);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .pos {
    width: 1.2rem;
    color: var(--fg-subtle);
    font-size: var(--text-2xs);
    font-weight: 700;
    text-align: right;
  }
  .kept {
    display: grid;
    justify-items: center;
    gap: var(--s-2);
    text-align: center;
  }
  .updates {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: var(--s-2);
    margin: calc(-1 * var(--s-3)) 0 0;
    font-size: var(--text-sm);
    text-align: center;
  }
  .tools {
    display: grid;
    gap: var(--s-2);
  }
  .tool {
    display: flex;
    align-items: center;
    gap: var(--s-4);
    min-height: 4.5rem;
    padding: var(--s-3) var(--s-4);
    border: 0;
    border-radius: var(--r-lg);
    background: var(--surface-2);
    color: var(--fg-muted);
    text-align: left;
  }
  .tool:disabled {
    opacity: 0.5;
  }
  .tool-text {
    display: grid;
    gap: 0.15rem;
  }
  .tool-text strong {
    color: var(--fg);
    font-size: var(--text-md);
    font-weight: 600;
  }
  .tool-text span {
    font-size: var(--text-sm);
  }
  /* Scoring, in the bar: says this phone's the scoresheet, and opens its tools */
  .keeping {
    gap: var(--s-1);
    color: var(--red-hot);
  }
  /* A narrow phone: the words, not the whistle, so the bar's Back keeps its line */
  @media (max-width: 360px) {
    .keeping :global(svg) {
      display: none;
    }
  }
  .tools-note {
    margin: 0 0 var(--s-2);
  }
  .let-go {
    width: 100%;
    height: 3.5rem;
    font-size: var(--text-md);
    font-weight: 600;
  }
  .names {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--s-2);
  }
  .name-pick {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
    min-height: 4.5rem;
    padding: 0 var(--s-5);
    border: 1.5px solid color-mix(in srgb, var(--fg) 60%, transparent);
    border-radius: var(--r-lg);
    background: transparent;
    color: var(--fg);
    font-size: 1.35rem;
    font-weight: 600;
    text-align: left;
  }
  .name-pick:active {
    border-color: var(--fg);
    background: color-mix(in srgb, var(--fg) 7%, transparent);
    transform: scale(0.99);
  }
  .name-pick small {
    color: var(--fg-subtle);
    font-size: var(--text-xs);
    font-weight: 600;
  }
  .name-skip {
    width: 100%;
    height: 3.5rem;
  }
  .waiting {
    min-height: 60vh;
  }
</style>
