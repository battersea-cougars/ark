<script lang="ts">
  // One game's matchup (ADR 0061), from the fight card's Details: the two teams side by side, each squad in full and
  // its record so far, the result and its goals once it's played, and when the captains' sides last met in a past
  // one (lib/matchups.ts). The game's live page (Game, /live: the clock, the score, and the scoresheet for whoever
  // keeps it) is behind Live, here and on the fight card.
  import { clock } from "../lib/dates";
  import { goesByOf, nameOfTeam } from "../lib/names";
  import { db } from "../demo/store.svelte";
  import { PLAYERS } from "../demo/data";
  import { me } from "../demo/session.svelte";
  import { currentTournament, typeById } from "../demo/schedule.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import TournamentHead from "../lib/TournamentHead.svelte";
  import TeamCrest from "../lib/TeamCrest.svelte";
  import { teamHref, teamTone } from "../lib/team-tones";
  import { kickOff, slotMinutes, table } from "../lib/fixtures";
  import BoxScore from "../lib/BoxScore.svelte";
  import GameTimeline from "../lib/GameTimeline.svelte";
  import { meetings } from "../lib/matchups";
  import { editionWhen } from "../lib/edition";

  let { typeId, gameId }: { typeId: number; gameId: number } = $props();

  const type = $derived(typeById(typeId)!);
  const tournament = $derived(
    db.tournaments.find((t) => t.games?.some((g) => g.id === gameId)) ?? currentTournament(typeId),
  );
  const game = $derived(tournament?.games?.find((g) => g.id === gameId));
  // Back to its fight card: the one on now's, else the past one's own page (its every fight)
  const onNow = $derived(!!tournament && tournament.id === currentTournament(typeId)?.id);
  const teams = $derived(tournament?.teams ?? []);
  const byId = (id: number | null) => (id ? PLAYERS.find((p) => p.id === id) : undefined);
  const indexOf = (teamId: number | null) => teams.findIndex((t) => t.id === teamId);
  const teamName = (i: number) => nameOfTeam(teams[i], teams, byId);
  const nth = (n: number | null) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);

  // The two sides, home then away: the team (or the place a playoff waits on), its squad, its record so far
  const records = $derived(
    tournament
      ? new Map(
          table(
            teams.flatMap((t) => (t.id ? [t.id] : [])),
            (tournament.games ?? []).filter((g) => g.stage === "group"),
            { win: tournament.pointsWin, draw: tournament.pointsDraw, loss: tournament.pointsLoss },
          ).map((r) => [r.teamId, r]),
        )
      : new Map(),
  );
  const sides = $derived(
    game
      ? [
          { teamId: game.homeTeamId, seed: game.homeSeed },
          { teamId: game.awayTeamId, seed: game.awaySeed },
        ].map(({ teamId, seed }) => {
          const i = indexOf(teamId);
          const t = i >= 0 ? teams[i] : undefined;
          return {
            i,
            team: t,
            name: t ? teamName(i) : nth(seed),
            captain: byId(t?.captainMemberId ?? null),
            players: t?.players ?? [],
            record: t?.id ? records.get(t.id) : undefined,
          };
        })
      : [],
  );
  const played = $derived(game?.status === "done");
  const href = $derived(`/tournaments/${type.slug}/games/${gameId}`);

  // When these captains' sides last met, in past ones of this series
  const past = $derived.by(() => {
    const [a, b] = sides.map((s) => s.team?.captainMemberId ?? null);
    if (!tournament || !a || !b) return [];
    return meetings(
      db.tournaments.filter((t) => t.typeId === tournament.typeId),
      tournament,
      a,
      b,
    ).slice(0, 5);
  });
  const tally = $derived({
    a: past.filter((m) => m.for > m.against).length,
    d: past.filter((m) => m.for === m.against).length,
    b: past.filter((m) => m.for < m.against).length,
  });
  const nameOf = (t: { teams: typeof teams }, id: number | null) => {
    const team = t.teams.find((x) => x.id === id);
    return nameOfTeam(team, t.teams, byId);
  };
</script>

<div class="page">
  <TournamentHead {type} {tournament} title="Matchup" />

  {#if !tournament || !game}
    <p class="note">There's no such game.</p>
  {:else}
    <a class="back" href="/tournaments/{type.slug}/{onNow ? 'schedule' : `history/${tournament.id}`}"
      ><Icon name="chevronLeft" size={16} />{onNow ? "Fight card" : tournament.name}</a
    >

    <!-- The two teams, face to face: the score once it's played, else the kick-off -->
    <section class="face">
      {#each sides as s, k (k)}
        <a
          class="side"
          class:away={k === 1}
          href={s.team?.id ? teamHref(type.slug, s.team.id) : undefined}
          aria-label={s.name}
        >
          {#if s.team}<TeamCrest name={s.name} logo={s.team.logo} tone={teamTone(s.i)} size="4.5rem" />{/if}
          <span class="side-name display">{s.name}</span>
          {#if s.record}
            <span class="rec num" aria-label="{s.record.w} won, {s.record.d} drawn, {s.record.l} lost"
              >{s.record.w}W {s.record.d}D {s.record.l}L</span
            >
          {/if}
        </a>
        {#if k === 0}
          <div class="mid">
            {#if game.homeGoals !== null}
              <span class="score display num">{game.homeGoals}<span class="dash">–</span>{game.awayGoals}</span>
            {:else}
              <span class="vs">vs</span>
            {/if}
            <span class="when hint num"
              >{game.status === "live"
                ? "On now"
                : played
                  ? "Full time"
                  : clock(kickOff(tournament.startTime, slotMinutes(tournament), game.position))} · {game.name ||
                `Game ${game.position}`}</span
            >
          </div>
        {/if}
      {/each}
    </section>

    {#if !played && game.homeTeamId && game.awayTeamId}
      <!-- Live: the same for everyone; whoever keeps score takes it on there -->
      <div class="clock-row">
        <a
          class="btn clock"
          class:primary={game.status === "live"}
          class:outline={game.status !== "live"}
          href="{href}/live"><Icon name="play" size={16} />{game.status === "live" ? "Live now" : "Live"}</a
        >
      </div>
    {/if}

    {#if played}
      <!-- The box score, then the game as it went, by period (lib/BoxScore, lib/GameTimeline: as on the live page) -->
      <section class="part">
        <h2 class="section-title">{game.penalties?.length ? "Goals and penalties" : "The goals"}</h2>
        <BoxScore {tournament} {game} />
        {#if game.goals?.length || game.penalties?.length}<GameTimeline {tournament} {game} />{/if}
      </section>
    {/if}

    <!-- Both squads, side by side: captain first -->
    <section class="squads">
      {#each sides as s, k (k)}
        <div class="squad">
          <h2 class="section-title">{s.name}</h2>
          {#if s.team}
            <ol class="rows">
              {#if s.captain}
                <li class="row">
                  <span class="c display" title="Captain" aria-label="Captain">C</span>
                  <span class="name"
                    >{goesByOf(s.captain)}{#if s.captain.id === me().id}<span class="you-stamp">You</span>{/if}</span
                  >
                  <span class="pos-badge">{s.captain.position}</span>
                </li>
              {/if}
              {#each s.players as p (p.memberId ?? p.name)}
                {@const m = byId(p.memberId)}
                <li class="row">
                  <span class="c"></span>
                  <span class="name"
                    >{goesByOf(m) || p.name}{#if p.memberId === me().id}<span class="you-stamp">You</span>{/if}</span
                  >
                  {#if m}<span class="pos-badge">{m.position}</span>{/if}
                </li>
              {/each}
            </ol>
          {:else}
            <p class="note">Decided by the table: {s.name} after the group games.</p>
          {/if}
        </div>
      {/each}
    </section>

    {#if sides.every((s) => s.captain)}
      <section class="part">
        <h2 class="section-title">Last time they met</h2>
        {#if past.length}
          <p class="hint">
            {goesByOf(sides[0].captain)}'s side {tally.a} · drawn {tally.d} · {goesByOf(sides[1].captain)}'s side
            {tally.b}, in past {type.shortName}s
          </p>
          <ol class="meetings">
            {#each past as m (m.game.id)}
              <li>
                <span class="m-when hint">{editionWhen(m.tournament).day ?? editionWhen(m.tournament).season}</span>
                <span class="m-teams"
                  >{nameOf(m.tournament, m.game.homeTeamId)}
                  <span class="num">{m.game.homeGoals}–{m.game.awayGoals}</span>
                  {nameOf(m.tournament, m.game.awayTeamId)}</span
                >
              </li>
            {/each}
          </ol>
        {:else}
          <p class="note">
            {goesByOf(sides[0].captain)} and {goesByOf(sides[1].captain)} haven't been on opposite sides in a past
            {type.shortName}.
          </p>
        {/if}
      </section>
    {/if}
  {/if}
</div>

<style>
  .back {
    display: inline-flex;
    justify-self: start;
    align-items: center;
    gap: var(--s-1);
    margin-bottom: calc(-1 * var(--s-2));
    color: var(--fg-muted);
    font-size: var(--text-sm);
    font-weight: 500;
  }
  .back:hover {
    color: var(--fg);
  }
  /* Face to face: home, the score (or vs and the kick-off), away */
  .face {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: var(--s-4);
  }
  .side {
    display: grid;
    justify-items: start;
    gap: var(--s-2);
    min-width: 0;
    color: var(--fg);
  }
  .side.away {
    justify-items: end;
    text-align: right;
  }
  /* A name that doesn't fit its side takes a second line ("Team / Charlie" on a phone), never "Team C…" */
  .side-name {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    max-width: 100%;
    overflow: hidden;
    font-size: clamp(1.4rem, 4vw, 2.2rem);
    line-height: 1.05;
    overflow-wrap: break-word;
    text-wrap: balance;
  }
  .rec {
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  .mid {
    display: grid;
    justify-items: center;
    gap: var(--s-2);
  }
  .score {
    color: var(--fg);
    font-size: clamp(2.6rem, 8vw, 4rem);
    line-height: 1;
  }
  .dash {
    margin: 0 0.15em;
    color: var(--fg-subtle);
  }
  .vs {
    color: var(--fg-subtle);
    font-size: var(--text-sm);
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  /* "7pm · Game 1": one line where there's room, two on a narrow phone, so the names keep theirs */
  .when {
    text-align: center;
    text-wrap: balance;
  }
  /* The clock button, centred under the score (a page's direct children take its full width) */
  .clock-row {
    display: flex;
    justify-content: center;
  }
  .clock {
    gap: var(--s-2);
  }
  .part {
    display: grid;
    gap: var(--s-3);
  }
  .section-title {
    margin: 0;
  }
  /* The two squads side by side; one under the other on a phone */
  .squads {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-8);
  }
  .squad {
    display: grid;
    align-content: start;
    gap: var(--s-3);
    min-width: 0;
  }
  @media (max-width: 600px) {
    .squads {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--s-6);
    }
  }
  .rows {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .row {
    display: grid;
    grid-template-columns: 1.25rem minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--s-3);
    min-height: 2.5rem;
    padding: 0;
    border-bottom: 1px solid var(--border);
  }
  .c {
    color: var(--red-hot);
    font-size: 1rem;
  }
  .name {
    overflow: hidden;
    color: var(--fg);
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meetings {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .meetings li {
    display: flex;
    align-items: baseline;
    gap: var(--s-3);
    min-height: 2.5rem;
    padding: var(--s-2) 0;
    border-bottom: 1px solid var(--border);
  }
  .m-when {
    width: 8rem;
    flex-shrink: 0;
  }
  .m-teams {
    color: var(--fg);
  }
  .m-teams .num {
    margin: 0 var(--s-2);
    font-weight: 700;
  }
</style>
