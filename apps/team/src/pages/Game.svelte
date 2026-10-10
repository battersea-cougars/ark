<script lang="ts">
  // One game, full screen (ADR 0061). For everyone, the live scoreboard: the clock, the score, each goal as it went
  // in. One person keeps score: whoever presses Start scoring (a team sitting it out is suggested, but anyone can step
  // in) holds the scoresheet until they let it go, or an admin does. Only the game on now (or up next) is scored: the
  // next opens when this one's over. For the scorekeeper it's the scoresheet: Goal for a team then who scored and who
  // assisted, take the last goal back, and Full time, which makes the score the result; the clock's start and pause is
  // one big button right under the clock, with clear space before the goals, so it's easy to hit and hard to hit by
  // mistake.
  //
  // Few requests: the clock never ticks on the server. It's stored as time left and when it was last started, so each
  // phone counts down by itself (and it survives a reload or a locked phone); only start, pause, a goal and full time
  // are sent. Everyone on the page checks for changes as often as the admins set (ADR 0072), the scorekeeper too (the
  // same person may have it open twice), while the page is in view.
  import { goesBy, goesByOf, nameOfTeam } from "../lib/names";
  import { db } from "../demo/store.svelte";
  import { onDestroy } from "svelte";
  import { can } from "../access/actions";
  import Icon from "../app/shell/Icon.svelte";
  import BackBar from "../app/shell/BackBar.svelte";
  import Drawer from "../lib/Drawer.svelte";
  import Sheet from "../lib/Sheet.svelte";
  import { phone } from "../lib/viewport.svelte";
  import TeamCrest from "../lib/TeamCrest.svelte";
  import RollNumber from "../lib/RollNumber.svelte";
  import { PLAYERS, type Player } from "../demo/data";
  import { granted, me } from "../demo/session.svelte";
  import { goBack, router } from "../app/router.svelte";
  import { routes } from "../app/routes.svelte";
  import { currentTournament, typeById } from "../demo/schedule.svelte";
  import {
    addGoal,
    clockGame,
    holdScoresheet,
    removeGoal,
    scoreGame,
    setGameClock,
    undoGoal,
    updateTournament,
  } from "../app/backend.svelte";
  import { clock, formatDayDate, londonISO, londonTime, londonToday } from "../lib/dates";
  import { checkForUpdates, liveFeed } from "../lib/live-updates.svelte";
  import LiveNote from "../lib/LiveNote.svelte";
  import { leftOf, mmss, ticking } from "../lib/game-clock.svelte";
  import { kickOff, startingNow } from "../lib/fixtures";
  import { teamHref, teamTone } from "../lib/team-tones";

  let { typeId, gameId }: { typeId: number; gameId: number } = $props();

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
  const full = $derived((tournament?.gameMinutes ?? 12) * 60_000);
  const left = $derived(game && game.status !== "next" ? leftOf(game) : full);
  const running = $derived(!!game?.clockStartedAt);
  const over = $derived(game?.status === "done");
  const timeUp = $derived(game?.status === "live" && left === 0);
  // A playoff can't end level (worker/tournaments/scoring.ts): level at time up, it plays on and the next goal wins
  const level = $derived(!!game && game.stage === "playoff" && (game.homeGoals ?? 0) === (game.awayGoals ?? 0));
  // A buzz when time runs out on the scorekeeper's phone
  let buzzed = false;
  $effect(() => {
    if (timeUp && running && keeper && !buzzed) {
      buzzed = true;
      navigator.vibrate?.([400, 150, 400]);
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
  let wakeLock: WakeLockSentinel | null = null;
  $effect(() => {
    if (keeper && running && !wakeLock)
      navigator.wakeLock
        ?.request("screen")
        .then((w) => (wakeLock = w))
        .catch(() => {});
  });
  onDestroy(() => wakeLock?.release());

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
  const letGo = () => tournament && game && act(() => holdScoresheet(tournament.id, game.id, "release"));
  const games = $derived(`/tournaments/${type.slug}`);
  // Back where you came from (the Fight card, a team, the home page), named for it; else the tournament's home
  const back = $derived.by(() => {
    const from = router.from ? routes().find((r) => r.path === router.from) : undefined;
    return from ? { href: from.path, label: from.name } : { href: games, label: `The ${type.shortName}` };
  });
  // Starting the first game on another day than the tournament's: asked first, as it moves the tournament's day to
  // today and its hours so this game kicks off now (lib/fixtures.ts startingNow)
  const offDay = $derived(!!tournament && !!game && game.status === "next" && tournament.heldOn !== londonToday());
  let askingDay = $state(false);
  const startPause = () => {
    if (!tournament || !game || over) return;
    if (offDay && !running) return void (askingDay = true);
    act(() => clockGame(tournament.id, game.id, running ? "pause" : "start"));
  };
  /** Yes: the tournament moves to now, then the clock starts. */
  const startToday = () =>
    tournament &&
    game &&
    act(async () => {
      const moved = startingNow(
        $state.snapshot(tournament),
        game.position,
        londonToday(),
        londonTime(new Date().toISOString()),
      );
      askingDay = false;
      if (await updateTournament(moved)) await clockGame(tournament.id, game.id, "start");
    });
  // Full time asks once: it can't be taken back here
  let confirmEnd = $state(false);
  function end() {
    if (!tournament || !game) return;
    if (!confirmEnd) {
      // Asks for a few seconds, then lets it be
      confirmEnd = true;
      setTimeout(() => (confirmEnd = false), 4000);
      return;
    }
    confirmEnd = false;
    toolsOpen = false;
    act(() => clockGame(tournament.id, game.id, "end"));
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
  const settable = $derived(keeper && game?.status === "live");
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
    const goal = { teamId: picking.team, scorerId: picking.scorer ?? null, assistId: picking.assist ?? null, atMs };
    picking = null;
    act(() => addGoal(tournament.id, game.id, goal));
  }
  // The goals, latest first, each with the score it made: home goals on the left, away on the right
  const stream = $derived.by(() => {
    let home = 0;
    let away = 0;
    return (game?.goals ?? [])
      .map((g) => {
        const isHome = g.teamId === game?.homeTeamId;
        if (isHome) home++;
        else away++;
        return { ...g, isHome, score: `${home}–${away}` };
      })
      .reverse();
  });
  const scoreOf = (i: number) => (i === 0 ? game?.homeGoals : game?.awayGoals) ?? 0;
</script>

<BackBar
  href={back.href}
  label={back.label}
  onclick={() => goBack(games)}
  title={game ? `Game ${game.position}` : "Game"}
  right={over ? "Full time" : game?.status === "live" ? (running ? "Running" : "Paused") : "Not started"}
  action={keeper && !over ? scoring_ : undefined}
/>
<!-- Keeping score: said in the bar, in red, and a tap opens the scorekeeper's tools, so the clock gets the screen -->
{#snippet scoring_()}
  <button class="btn ghost sm keeping" aria-label="You're keeping score: tools" onclick={() => (toolsOpen = true)}
    ><Icon name="whistle" size={18} />Scoring</button
  >
{/snippet}

{#if !tournament || !game}
  <p class="note missing">No such game.</p>
{:else}
  <div class="game">
    <!-- The clock: to read, and for the scorekeeper, a tap sets it (ADR 0103). Its start and pause is the big button
         under it -->
    <svelte:element
      this={settable ? "button" : "div"}
      class="clock"
      class:running
      class:done={over || timeUp}
      class:settable
      role={settable ? undefined : "timer"}
      aria-label={settable ? `Set the time: ${mmss(left)} left` : mmss(left)}
      onclick={settable ? openSet : undefined}
    >
      <span class="time display num">{mmss(left)}</span>
      <span class="meter"><span style:transform="scaleX({left / full})"></span></span>
      <span class="cue hint">
        {#if over}Full time
        {:else if game.status === "next"}Kick-off {clock(
            kickOff(tournament.startTime, tournament.gameMinutes, game.position),
          )}
        {:else if timeUp && level}Level: next goal wins
        {:else if timeUp}{keeper ? "Time's up: call full time" : "Time's up"}
        {:else}{running ? "Live" : "Paused"}{/if}
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
        {#if holder}
          <span class="hint"><i class="rec" aria-hidden="true"></i>Score kept by {goesBy(holder)}</span>
          {#if admin}<button class="btn ghost sm" disabled={busy} onclick={letGo}>Let it go</button>{/if}
        {:else if upNext && game.homeTeamId && game.awayTeamId}
          <span class="hint"
            >Nobody's keeping score{game.scoringTeamId ? ` · ${teamName(game.scoringTeamId)}'s turn` : ""}</span
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
        <!-- Time's up: the big button is full time. Tap twice: it can't be taken back here (Set the time for more) -->
        <button class="btn control full-time" class:confirming={confirmEnd} disabled={busy} onclick={end}>
          <Icon name="whistle" size={26} />
          {confirmEnd ? "Tap again: full time" : "Full time"}
        </button>
      {:else if keeper && askingDay && tournament}
        <!-- Not the tournament's day: say so, and what starting now does, before it does it -->
        <div class="ask-day" role="alert">
          <p>
            The {type.shortName} is on {formatDayDate(londonISO(tournament.heldOn, tournament.startTime))}. Start this
            game now? Its day moves to today, {formatDayDate(new Date().toISOString())}, and its times so this game
            starts now.
          </p>
          <div class="ask-actions">
            <button class="btn ghost" disabled={busy} onclick={() => (askingDay = false)}>Not yet</button>
            <button class="btn primary" disabled={busy} onclick={startToday}>Start it today</button>
          </div>
        </div>
      {:else if keeper}
        <button class="btn control" class:start={!running} class:pause={running} disabled={busy} onclick={startPause}>
          <Icon name={running ? "pause" : "play"} size={26} />
          {running ? "Pause" : game.status === "next" ? "Start the game" : "Start again"}
        </button>
      {/if}
    {/if}

    <div class="sides">
      {#each sides as teamId, i (i)}
        <div class="side" class:away={i === 1}>
          {#if teamId}
            <TeamCrest
              name={teamName(teamId)}
              logo={teams[indexOf(teamId)]?.logo ?? null}
              tone={teamTone(indexOf(teamId))}
              size="6rem"
            />
          {/if}
          <span class="display name">{teamName(teamId)}</span>
          <span class="display goals num"><RollNumber value={scoreOf(i)} /></span>
          {#if teamId && ((keeper && game.status === "live") || (fixing && over))}
            <button class="btn outline goal" disabled={busy} onclick={() => (picking = { team: teamId })}
              >{fixing ? "Add a goal" : "Goal"}</button
            >
          {/if}
        </div>
      {/each}
    </div>

    <section class="log">
      <h2 class="section-title">Goals</h2>
      {#if game.goals?.length}
        <!-- A timeline: each goal on its team's side, when it went in and the score it made down the middle -->
        <ol class="stream">
          {#each stream as g (g.id)}
            <li class="goal-row" class:home={g.isHome}>
              <span class="scored">
                <TeamCrest
                  name={teamName(g.teamId)}
                  logo={teams[indexOf(g.teamId)]?.logo ?? null}
                  tone={teamTone(indexOf(g.teamId))}
                  size="3.75rem"
                />
                <span class="who">
                  <span class="team-label">{teamName(g.teamId)}</span>
                  <span class="scorer">{goesByOf(byId(g.scorerId)) || "Goal"}</span>
                  {#if g.assistId}<span class="assist">Assist · {goesByOf(byId(g.assistId))}</span>{/if}
                </span>
              </span>
              {#if fixing}
                <!-- Putting it right: any goal comes off, from the empty side of its row -->
                <button
                  class="btn ghost sm take-off"
                  disabled={busy}
                  onclick={() => act(() => removeGoal(tournament.id, game.id, g.id))}
                  ><Icon name="x" size={15} />Take off</button
                >
              {/if}
              <span class="at">
                <span class="at-time display num">{g.atMs === null ? "–" : mmss(g.atMs)}</span>
                <span class="at-score num">{g.score}</span>
              </span>
            </li>
          {/each}
        </ol>
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
                  <li>
                    <span class="c display">{p.id === teams[indexOf(teamId)]?.captainMemberId ? "C" : ""}</span>
                    <span class="pname">{goesBy(p)}</span>
                    {#if scored}<span class="badge">{scored > 1 ? `${scored} goals` : "Goal"}</span>{/if}
                    <span class="pos">{p.position}</span>
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

  <!-- The tools: big rows, one tap each (full time asks again), each done right here. Up from the bottom on a phone,
       a side drawer on a desktop (ADR 0103) -->
  {#snippet toolList()}
    <div class="tools">
      <p class="hint tools-note">Only you can run the clock and log goals, until you hand it over.</p>
      {#if game.status === "live"}
        <button
          class="tool"
          disabled={busy || !lastGoal}
          onclick={() => tool(() => act(() => undoGoal(tournament.id, game.id)))}
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
        <button class="tool" class:danger={confirmEnd} disabled={busy || level} onclick={end}>
          <Icon name="whistle" size={22} />
          <span class="tool-text"
            ><strong>{confirmEnd ? "Tap again: full time" : "Full time now"}</strong><span
              >{level
                ? "Not while it's level: a playoff needs a winner."
                : "The score's the result. Can't be taken back."}</span
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

  <!-- Set the score, in a sheet (a short form, ADR 0103): each side's goals, up and down -->
  <Sheet bind:open={scoring} title="Set the score">
    <p class="hint">Goals go on, nobody said who, or the latest come off to match.</p>
    <div class="score-set">
      {#each sides as teamId, i (i)}
        {#if teamId}
          <div class="score-side">
            <TeamCrest
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
            ><span>{goesBy(p)}</span><small>{p.position}</small></button
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
{/if}

<style>
  .missing {
    padding: var(--s-6) var(--gutter);
  }
  .game {
    display: grid;
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
  /* In the empty half of a goal's row */
  .take-off {
    grid-row: 1;
    grid-column: 3;
    justify-self: start;
    gap: var(--s-1);
  }
  .home .take-off {
    grid-column: 3;
  }
  .goal-row:not(.home) .take-off {
    grid-column: 1;
    justify-self: end;
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
  }
  .keep-line .btn {
    gap: var(--s-1);
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
  .control.full-time.confirming {
    border-color: var(--red);
    background: var(--red);
    color: var(--on-red);
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
  /* The stream: home goals left, away goals right, the time and the score down the middle */
  .stream {
    display: grid;
  }
  .goal-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 4.5rem minmax(0, 1fr);
    align-items: center;
    min-height: 5.5rem;
    padding-block: var(--s-3);
  }
  .goal-row + .goal-row {
    border-top: 1px solid var(--border);
  }
  .at {
    display: grid;
    justify-items: center;
    gap: 0.1rem;
    grid-column: 2;
    grid-row: 1;
  }
  .at-time {
    color: var(--fg);
    font-size: 1.5rem;
    line-height: 1;
  }
  .at-score {
    color: var(--fg-subtle);
    font-size: var(--text-xs);
    font-weight: 600;
  }
  .scored {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-width: 0;
    grid-column: 3;
    grid-row: 1;
  }
  .home .scored {
    flex-direction: row-reverse;
    grid-column: 1;
    text-align: right;
  }
  .who {
    display: grid;
    gap: 0.1rem;
    min-width: 0;
  }
  .team-label {
    overflow: hidden;
    color: var(--fg-subtle);
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .scorer {
    overflow: hidden;
    color: var(--fg);
    font-weight: 600;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .assist {
    overflow: hidden;
    color: var(--fg-muted);
    font-size: var(--text-sm);
    white-space: nowrap;
    text-overflow: ellipsis;
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
  .tool.danger {
    background: var(--red);
    color: var(--on-red);
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
  .tool.danger .tool-text strong,
  .tool.danger .tool-text span {
    color: var(--on-red);
  }
  .tool-text span {
    font-size: var(--text-sm);
  }
  /* Scoring, in the bar: says this phone's the scoresheet, and opens its tools */
  .keeping {
    gap: var(--s-1);
    color: var(--red-hot);
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
  /* The question before starting on another day: in the big button's place, the same width */
  .ask-day {
    display: grid;
    gap: var(--s-3);
    width: min(100%, 26rem);
    justify-self: center;
    color: var(--fg-body);
    text-align: center;
  }
  .ask-day p {
    margin: 0;
  }
  .ask-actions {
    display: flex;
    justify-content: center;
    gap: var(--s-2);
  }
</style>
