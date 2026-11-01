<script lang="ts">
  // A tournament's teams in its editor (ADR 0030): a row each, read as text, which opens the team's sheet
  // (lib/TeamSheet): its captain, and a team that entered its players; its name and logo are its own page's. A draft's
  // row is its captain: their crest, their name, what their team's called (or will be: its own name, the team they
  // bring, else "Team Dan"), its place in the pick order once the draft's drawn it (ADR 0060), and who they've picked.
  // Add a captain finds a member and they're one. A team that entered reads as its name, captain and players; + Team
  // opens a new one's sheet. Which team is open is `open`, one value its editor can hold (and a URL drive).
  import Icon from "../app/shell/Icon.svelte";
  import PersonPicker from "./PersonPicker.svelte";
  import TeamCrest from "./TeamCrest.svelte";
  import TeamSheet from "./TeamSheet.svelte";
  import { nameOfTeam, shortName } from "./names";
  import { db } from "../demo/store.svelte";
  import type { BroughtTeam } from "./brought-team";
  import type { TournamentKind, TournamentTeam } from "../demo/model";

  const MAX_TEAMS = 16;

  let {
    teams = $bindable(),
    kind,
    drawn,
    members,
    pageOf,
    ongo,
    open = $bindable(null),
  }: {
    teams: TournamentTeam[];
    kind: TournamentKind;
    /** The draft's opened and drawn the pick order: the rows are in it, numbered. */
    drawn: boolean;
    /** `brings`: the team a captain brings from the series' last edition they captained (brought-team.ts). */
    members: { id: number; name: string; brings?: BroughtTeam | null }[];
    /** A saved team's own page, where its name and logo are edited (Edit the team); null: none (yet). */
    pageOf?: (team: TournamentTeam) => string | null;
    /** Off to a team's page, from its sheet. */
    ongo?: (path: string) => void;
    /** The team whose sheet is open, by its place in the list; null: none. */
    open?: number | null;
  } = $props();

  const draft = $derived(kind === "draft");
  const person = (id: number | null) => db.members.find((m) => m.player.id === id)?.player;
  const nameOf = (id: number | null) => members.find((m) => m.id === id)?.name ?? "";
  // Members already on a team: nobody's on two (ADR 0030)
  const taken = $derived(
    new Set(teams.flatMap((t) => [t.captainMemberId, ...t.players.map((p) => p.memberId)]).filter((m) => m !== null)),
  );

  /** The team a new draft team takes if it's left unnamed with no logo (worker/tournaments/team-name.ts). */
  const broughtBy = (team: TournamentTeam) =>
    team.id || team.name || team.logo ? null : (members.find((m) => m.id === team.captainMemberId)?.brings ?? null);
  /** What it's called with no name of its own: the team its captain brings, else "Team Dan". */
  const fallbackOf = (team: TournamentTeam) =>
    broughtBy(team)?.name || nameOfTeam({ ...team, name: "" }, teams, person);
  const crestNames = $derived(teams.map((t) => t.name || fallbackOf(t)));
  const picked = (team: TournamentTeam) =>
    team.players.map((p) => (p.memberId ? shortName({ name: nameOf(p.memberId) }) : p.name)).join(", ");

  function addCaptain(memberId: number) {
    teams.push({ name: "", logo: null, captainMemberId: memberId, captainName: "", contact: "", players: [] });
  }
  // A team that entered: added, its sheet opens; closed with nothing in it, it goes again
  let added = $state<number | null>(null);
  function addTeam() {
    teams.push({ name: "", logo: null, captainMemberId: null, captainName: "", contact: "", players: [] });
    added = open = teams.length - 1;
  }
  const empty = (team: TournamentTeam) =>
    !team.name.trim() && !team.logo && !team.captainMemberId && !team.captainName.trim() && !team.players.length;

  // Closing: the sheet stays while it slides away, then goes
  let leaving = $state<number | null>(null);
  const shown = $derived(open ?? leaving);
  function closed(i: number) {
    if (open !== i) return;
    open = null;
    if (added === i && teams[i] && empty(teams[i])) teams.splice(i, 1);
    else leaving = i;
    added = null;
  }
</script>

{#if teams.length}
  <ul class="teams" class:drawn>
    {#each teams as team, i (i)}
      {@const brought = broughtBy(team)}
      <li>
        <button type="button" class="team" onclick={() => (open = i)}>
          {#if drawn}<span class="pick num" title="Pick order, drawn as the draft opened">{i + 1}</span>{/if}
          <span class="crest" class:brought={!team.logo && brought?.logo}>
            <TeamCrest name={crestNames[i]} among={crestNames} logo={team.logo ?? brought?.logo ?? null} />
          </span>
          <span class="text">
            {#if draft}
              <span class="main">{nameOf(team.captainMemberId) || "No captain: name one"}</span>
              <span class="sub" class:quiet={!team.name}
                >{team.name || (brought?.name ? `Brings ${brought.name}` : fallbackOf(team))}</span
              >
              {#if team.players.length}<span class="picked">Picked: {picked(team)}</span>{/if}
            {:else}
              <span class="main" class:missing={!team.name.trim()}>{team.name || "Needs a name"}</span>
              <span class="sub">
                {nameOf(team.captainMemberId) || team.captainName || "No captain: name one"} · {team.players.length}
                {team.players.length === 1 ? "player" : "players"}
              </span>
            {/if}
          </span>
          <Icon name="chevronRight" size={16} />
        </button>
      </li>
    {/each}
  </ul>
{:else if !draft}
  <p class="hint">No teams yet.</p>
{/if}

{#if teams.length < MAX_TEAMS}
  {#if draft}
    <!-- The next captain's row, lined up with theirs: find a member and they're one -->
    <div class="add-captain" class:drawn>
      {#if drawn}<span aria-hidden="true"></span>{/if}
      <span class="slot" aria-hidden="true"><Icon name="plus" size={18} /></span>
      <PersonPicker
        id="add-captain"
        {members}
        exclude={taken}
        clearOnPick
        quiet
        placeholder="Add a captain…"
        aria-label="Add a captain"
        onpick={addCaptain}
      />
    </div>
  {:else}
    <button type="button" class="btn sm add" onclick={addTeam}><Icon name="plus" size={16} />Team</button>
  {/if}
{/if}

{#if shown !== null && teams[shown]}
  {@const i = shown}
  <TeamSheet
    bind:team={teams[i]}
    bind:open={() => open === i, (v) => !v && closed(i)}
    {kind}
    title={added === i ? "New team" : teams[i].name || fallbackOf(teams[i])}
    fallback={fallbackOf(teams[i])}
    page={pageOf?.(teams[i]) ?? null}
    {ongo}
    {members}
    {taken}
    onclose={() => (leaving = null)}
    onremove={() => {
      open = leaving = added = null;
      teams.splice(i, 1);
    }}
  />
{/if}

<style>
  .teams {
    display: grid;
    gap: 2px;
    max-width: 34rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  /* A row that reads as text: the crest, the names, a chevron; a faint fill under the pointer */
  .team {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: var(--s-3);
    align-items: center;
    width: 100%;
    padding: var(--s-2);
    border: 0;
    border-radius: var(--r-md);
    background: none;
    color: var(--fg-subtle);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background-color var(--t-fast) var(--ease);
  }
  .drawn .team {
    grid-template-columns: 1.5rem auto minmax(0, 1fr) auto;
  }
  .team:hover,
  .team:focus-visible {
    background: var(--surface-2);
  }
  .pick {
    color: var(--fg-muted);
    font-weight: 600;
    text-align: center;
  }
  .crest {
    display: grid;
  }
  /* The logo a new team brings, quiet till it's saved */
  .crest.brought {
    opacity: 0.6;
  }
  .text {
    display: grid;
    min-width: 0;
  }
  .main,
  .sub,
  .picked {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .main {
    color: var(--fg);
    font-weight: 600;
  }
  .main.missing {
    color: var(--fg-muted);
    font-style: italic;
  }
  .sub {
    color: var(--fg-body);
    font-size: var(--text-sm);
  }
  .sub.quiet,
  .picked {
    color: var(--fg-subtle);
    font-size: var(--text-xs);
  }
  .sub.quiet {
    font-size: var(--text-sm);
  }
  .add {
    justify-self: start;
  }
  /* Lined up with the rows above: the crest's square (and the pick's column once drawn), then the search */
  .add-captain {
    display: grid;
    grid-template-columns: 2.75rem minmax(0, 1fr);
    gap: var(--s-3);
    align-items: center;
    max-width: 34rem;
    padding-inline: var(--s-2);
  }
  .add-captain.drawn {
    grid-template-columns: 1.5rem 2.75rem minmax(0, 1fr);
  }
  .add-captain .slot {
    display: grid;
    place-items: center;
    height: 2.75rem;
    border-radius: var(--r-md);
    background: var(--field-bg);
    color: var(--fg-muted);
  }
</style>
