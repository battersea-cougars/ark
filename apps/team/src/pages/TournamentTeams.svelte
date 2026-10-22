<script lang="ts">
  // The Teams set view of a tournament's page (ADR 0074): every team top to bottom, in full: its crest and name, its
  // captain and every player with their position (the pick quietly beside them), a team with no goalie said so, and
  // its record once there are results; yours first and marked. Each a card that opens its own page (TournamentTeam),
  // where its captain (or an admin) edits it.
  import { goesByOf, nameOfTeam, teamNamesOf } from "../lib/names";
  import { me } from "../demo/session.svelte";
  import { PLAYERS } from "../demo/data";
  import { currentTournament, typeById } from "../demo/schedule.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import TeamCrest from "../lib/TeamCrest.svelte";
  import { table } from "../lib/fixtures";
  import { teamHref, teamTone } from "../lib/team-tones";
  import EmptyState from "../lib/EmptyState.svelte";
  import { editTournament } from "../lib/TournamentEditorPanel.svelte";
  import { can } from "../access/actions";
  import { granted } from "../demo/session.svelte";
  import { formatDayDate, londonISO } from "../lib/dates";

  let { typeId }: { typeId: number } = $props();

  const type = $derived(typeById(typeId)!);
  const tournament = $derived(currentTournament(typeId));
  const teams = $derived(tournament?.teams ?? []);
  const teamName = (i: number) => nameOfTeam(teams[i], teams, (id) => PLAYERS.find((p) => p.id === id));
  const isMine = (i: number) =>
    teams[i].captainMemberId === me().id || teams[i].players.some((p) => p.memberId === me().id);
  // Yours first
  const order = $derived(teams.map((_, i) => i).sort((a, b) => Number(isMine(b)) - Number(isMine(a))));
  // The record from the group games with a result: won, drawn, lost (in words), and points
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
  const admin = $derived(can(granted(), "manage:Tournament"));
  const draftNight = $derived(tournament?.draftOn ? formatDayDate(londonISO(tournament.draftOn, "12:00")) : null);
  const played = $derived((tournament?.games ?? []).some((g) => g.homeGoals !== null));
  // A team's squad, its captain first then the players in the order they were picked (the pick quietly beside them)
  const squadOf = (i: number) => {
    const t = teams[i];
    const person = (id: number | null) => (id ? PLAYERS.find((p) => p.id === id) : undefined);
    const cap = person(t.captainMemberId);
    return [
      ...(cap || t.captainName
        ? [
            {
              key: `c${t.captainMemberId ?? t.captainName}`,
              id: t.captainMemberId,
              name: cap ? goesByOf(cap) : t.captainName,
              position: cap?.position ?? "",
              captain: true,
              pick: null as number | null,
            },
          ]
        : []),
      ...t.players.map((p, k) => {
        const m = person(p.memberId);
        return {
          key: `p${p.memberId ?? p.name}${k}`,
          id: p.memberId,
          name: m ? goesByOf(m) : p.name,
          position: m?.position ?? "",
          captain: false,
          pick: typeof p.pick === "number" ? p.pick : null,
        };
      }),
    ];
  };
  // The tournament's team names, which its crests are told apart among (logo.ts)
  const crestNames = $derived(teamNamesOf(teams, (id) => PLAYERS.find((p) => p.id === id)));
</script>

<div class="teams-view">
  {#if !teams.length}
    <EmptyState icon="teams" title="No teams yet">
      {#if tournament?.kind === "draft"}
        The captains pick them on draft night{draftNight ? `, ${draftNight}` : ""}, a player at a time. They show up
        here as they're picked.
      {:else}
        Teams enter at sign-up. They show up here as they come in.
      {/if}
      {#snippet action()}
        {#if tournament?.kind === "draft"}
          {#if admin}
            <button class="btn outline" onclick={() => editTournament(tournament.id, { tab: "teams" })}
              ><Icon name="userPlus" size={18} />Name the captains</button
            >
          {/if}
        {/if}
      {/snippet}
    </EmptyState>
  {:else}
    <!-- Every team, top to bottom, in full: yours first and marked. Each a card that opens the team's page -->
    {#each order as i (teams[i].id ?? i)}
      {@const t = teams[i]}
      {@const squad = squadOf(i)}
      {@const r = t.id ? records.get(t.id) : undefined}
      <a class="list team-card" class:mine={isMine(i)} href={t.id ? teamHref(type.slug, t.id) : undefined}>
        <span class="head">
          <TeamCrest among={crestNames} name={teamName(i)} logo={t.logo} tone={teamTone(i)} size="3rem" />
          <span class="grow">
            <span class="name display">{teamName(i)}</span>
            <span class="sub"
              >{#if isMine(i)}<strong class="yours">Your team</strong> ·
              {/if}{squad.length}
              {squad.length === 1 ? "player" : "players"}{#if played && r}
                · {r.w}W {r.d}D {r.l}L · {r.pts} pts{/if}</span
            >
          </span>
          <Icon name="chevronRight" size={20} />
        </span>
        {#if !squad.some((p) => p.position === "G")}
          <span class="warn"><Icon name="alert" size={14} />No goalie</span>
        {/if}
        <ol class="squad">
          {#each squad as p (p.key)}
            <li class:you={p.id === me().id}>
              <span class="role"
                >{#if p.captain}<span class="c" title="Captain">C</span>{:else if p.pick}<span class="num"
                    >{p.pick}</span
                  >{/if}</span
              >
              <span class="who"
                >{p.name}{#if p.id === me().id}<small>you</small>{/if}</span
              >
              <span class="pos" class:g={p.position === "G"}>{p.position}</span>
            </li>
          {/each}
        </ol>
      </a>
    {/each}
  {/if}
</div>

<style>
  .teams-view {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s-4);
  }
  /* A team: its own card, the whole of it opening the team's page */
  .team-card {
    display: grid;
    gap: var(--s-3);
    padding: var(--s-4);
    color: var(--fg);
  }
  .team-card.mine {
    box-shadow: inset 3px 0 0 var(--red-hot);
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-width: 0;
  }
  .head :global(svg) {
    flex: none;
    color: var(--fg-muted);
  }
  .grow {
    display: grid;
    flex: 1;
    gap: 0.15rem;
    min-width: 0;
  }
  .name {
    overflow: hidden;
    font-size: 1.4rem;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .sub {
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  .yours {
    color: var(--red-hot);
    font-weight: 600;
  }
  .warn {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    color: var(--tone-amber);
    font-size: var(--text-sm);
  }
  .squad {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .squad li {
    display: grid;
    grid-template-columns: 1.5rem minmax(0, 1fr) 1.5rem;
    align-items: center;
    gap: var(--s-3);
    min-height: 2.25rem;
  }
  .squad li.you .who {
    color: var(--red-hot);
  }
  .role {
    color: var(--fg-subtle);
    font-size: var(--text-xs);
    text-align: center;
  }
  .c {
    color: var(--red-hot);
    font-family: var(--font-display);
    font-size: 1rem;
  }
  .who {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .who small {
    margin-left: var(--s-2);
    color: var(--fg-subtle);
    font-size: var(--text-2xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }
  .pos {
    color: var(--fg-muted);
    font-size: var(--text-sm);
    font-weight: 600;
    text-align: center;
  }
  .pos.g {
    color: var(--fg);
  }
</style>
