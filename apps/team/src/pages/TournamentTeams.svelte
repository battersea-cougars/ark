<script lang="ts">
  // A tournament's teams, at a glance: each one's crest, name and record so far, yours marked. A team opens its own
  // page (TournamentTeam): the squad, its games, and there its captain (or an admin) edits it.
  import { shortNameOf, nameOfTeam, teamNamesOf } from "../lib/names";
  import { me } from "../demo/session.svelte";
  import { PLAYERS } from "../demo/data";
  import { currentTournament, typeById } from "../demo/schedule.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import TeamCrest from "../lib/TeamCrest.svelte";
  import TournamentHead from "../lib/TournamentHead.svelte";
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
  const firstName = (id: number | null) => shortNameOf(PLAYERS.find((p) => p.id === id));
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
  // The tournament's team names, which its crests are told apart among (logo.ts)
  const crestNames = $derived(teamNamesOf(teams, (id) => PLAYERS.find((p) => p.id === id)));
</script>

<div class="page">
  {#if tournament}
    <TournamentHead {type} {tournament} title="Teams" />
  {/if}

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
          <a class="btn outline" href="/tournaments/{type.slug}/draft"><Icon name="draft" size={18} />The draft</a>
          {#if admin}
            <button class="btn outline" onclick={() => editTournament(tournament.id, { tab: "teams" })}
              ><Icon name="userPlus" size={18} />Name the captains</button
            >
          {/if}
        {/if}
      {/snippet}
    </EmptyState>
  {:else}
    <div class="list">
      {#each order as i (teams[i].id ?? i)}
        {@const t = teams[i]}
        {@const r = t.id ? records.get(t.id) : undefined}
        <a class="row team" href={t.id ? teamHref(type.slug, t.id) : undefined}>
          <TeamCrest among={crestNames} name={teamName(i)} logo={t.logo} tone={teamTone(i)} size="3.5rem" />
          <span class="grow">
            <span class="name display">{teamName(i)}</span>
            <span class="sub">Captain {firstName(t.captainMemberId) || t.captainName}</span>
          </span>
          {#if isMine(i)}<span class="badge red"><Icon name="user" size={13} />Your team</span>{/if}
          <span class="record num" aria-label="Record">
            {#if played && r}
              <span><strong>{r.w}</strong>W</span><span><strong>{r.d}</strong>D</span><span
                ><strong>{r.l}</strong>L</span
              >
              <span class="pts"><strong>{r.pts}</strong>pts</span>
            {:else}
              <span class="none">No games yet</span>
            {/if}
          </span>
          <Icon name="chevronRight" size={18} />
        </a>
      {/each}
    </div>
  {/if}
</div>

<style>
  .team {
    gap: var(--s-4);
    min-height: 5rem;
    color: var(--fg);
  }
  .grow {
    display: grid;
    flex: 1;
    gap: 0.2rem;
    min-width: 0;
  }
  .name {
    overflow: hidden;
    font-size: 1.5rem;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .sub {
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  .team .badge {
    gap: 0.3rem;
    flex-shrink: 0;
  }
  /* The record: plain numbers, the letters quiet */
  .record {
    display: flex;
    flex-shrink: 0;
    gap: var(--s-3);
    color: var(--fg-subtle);
    font-size: var(--text-xs);
  }
  .record strong {
    margin-right: 0.15rem;
    color: var(--fg-muted);
    font-size: var(--text-sm);
    font-weight: 400;
  }
  .pts {
    padding-left: var(--s-3);
    border-left: 1px solid var(--border);
  }
  .none {
    font-weight: 500;
  }
  @media (max-width: 900px) {
    .team {
      flex-wrap: wrap;
    }
    /* The record on a line of its own, last, so the chevron stays up by the name */
    .record {
      order: 1;
      width: 100%;
      padding-left: calc(3.5rem + var(--s-4));
    }
  }
  /* A phone: Your team under the name, so the name keeps the row ("TE…" beside it on an SE): the name holds at least
     half the row, so the badge can't squeeze in beside it */
  @media (max-width: 600px) {
    .grow {
      min-width: 50%;
    }
    .team .badge {
      order: 1;
      margin-left: calc(3.5rem + var(--s-4));
    }
  }
</style>
