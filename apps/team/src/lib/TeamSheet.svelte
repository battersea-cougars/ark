<script lang="ts">
  // One team in a tournament's editor (ADR 0030, 0065), opened from its row: its captain, and a team that entered its
  // players, members or names from outside (a draft's come from the draft: Edit the squad, on the team's page). Its
  // name and logo are the team's own page's (Edit the team, its captain or an admin, saving at once): here they read
  // as text, with the way there. A team that enters, new here, is registered with its name (and logo) in this sheet,
  // as it must have one. Changes go into the editor's form and are saved with the editor's Save, never on their own;
  // Done closes it, Remove takes the team off (asking once when that loses a name, a logo or players).
  import Sheet from "./Sheet.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import PersonPicker from "./PersonPicker.svelte";
  import TeamLookFields from "./TeamLookFields.svelte";
  import TeamCrest from "./TeamCrest.svelte";
  import type { TournamentKind, TournamentTeam } from "../demo/model";

  const MAX_PLAYERS = 30;

  let {
    team = $bindable(),
    kind,
    open = $bindable(false),
    title,
    fallback,
    members,
    taken,
    page = null,
    ongo,
    onremove,
    onclose,
  }: {
    team: TournamentTeam;
    kind: TournamentKind;
    open?: boolean;
    /** What the row calls it. */
    title: string;
    /** What it's called with no name of its own ("Team Dan", or the team its captain brings). */
    fallback: string;
    members: { id: number; name: string }[];
    /** Members already on a team (this one's included), who can't be added again. */
    taken: Set<number>;
    /** The team's own page, where its name and logo are edited (saved teams of a series' tournament); null: none yet. */
    page?: string | null;
    /** Off to that page: the editor closes first (asking if anything's unsaved), never a sheet over a sheet. */
    ongo?: (path: string) => void;
    onremove: () => void;
    onclose?: () => void;
  } = $props();

  const nameOf = (id: number | null) => members.find((m) => m.id === id)?.name ?? "";
  const draft = $derived(kind === "draft");
  // A team that enters, not saved yet: named here, as it can't be without a name
  const registering = $derived(!draft && !team.id);

  function go(e: MouseEvent) {
    if (!page || !ongo) return;
    e.preventDefault();
    open = false;
    ongo(page);
  }

  function pickCaptain(id: number) {
    team.captainMemberId = id;
    team.captainName = "";
  }

  let outsider = $state("");
  function addOutsider() {
    const name = outsider.trim();
    if (name) team.players.push({ memberId: null, name });
    outsider = "";
  }

  // Remove asks once when it would lose something: a name, a logo or players
  let sure = $state(false);
  function remove() {
    if (!sure && (team.name.trim() || team.logo || team.players.length)) return void (sure = true);
    open = false;
    onremove();
  }
</script>

<Sheet
  bind:open
  {title}
  sub={draft && team.players.length
    ? `Picked: ${team.players.map((p) => nameOf(p.memberId) || p.name).join(", ")}`
    : undefined}
  tall={!draft}
  onclose={() => {
    sure = false;
    onclose?.();
  }}
>
  <div class="form">
    <div class="field">
      <span
        >Captain {#if !draft && team.captainMemberId}<span class="hint">· a member</span>{/if}</span
      >
      <PersonPicker
        id="team-captain"
        {members}
        value={team.captainMemberId}
        exclude={taken}
        placeholder={draft ? "Find a member" : "A member, or leave empty"}
        aria-label="Captain"
        onpick={pickCaptain}
      />
      {#if !draft && team.captainMemberId}
        <button type="button" class="link small" onclick={() => (team.captainMemberId = null)}>Not a member?</button>
      {/if}
    </div>
    {#if !draft && !team.captainMemberId}
      <div class="cols">
        <label class="field">Captain's name <input class="input" bind:value={team.captainName} maxlength="60" /></label>
        <label class="field"
          >How to reach them <input
            class="input"
            bind:value={team.contact}
            placeholder="Email or phone"
            maxlength="120"
          /></label
        >
      </div>
    {/if}

    {#if registering}
      <TeamLookFields bind:name={team.name} bind:logo={team.logo} {fallback} required autofocus={!team.name} />
    {:else}
      <!-- Its name and logo, as they are: changed on its page -->
      <div class="field">
        <span>Team</span>
        <div class="look">
          <TeamCrest name={team.name || fallback} logo={team.logo} />
          <span class="look-text">
            <span class="look-name" class:quiet={!team.name}>{team.name || fallback}</span>
            <span class="hint small">
              {#if page}
                <a class="link" href={page} onclick={go}>Edit the team</a> on its page: its name and logo.
              {:else}
                Its captain names it on its page, once it's saved.
              {/if}
            </span>
          </span>
        </div>
      </div>
    {/if}

    {#if !draft}
      <div class="field">
        <span>Players <span class="hint">· {team.players.length}</span></span>
        {#if team.players.length}
          <ol class="players">
            {#each team.players as player, i (i)}
              <li>
                <span class="grow">{player.memberId ? nameOf(player.memberId) : player.name}</span>
                {#if !player.memberId}<span class="hint small">not a member</span>{/if}
                <button
                  type="button"
                  class="btn sm ghost icon"
                  aria-label="Remove {player.memberId ? nameOf(player.memberId) : player.name}"
                  onclick={() => team.players.splice(i, 1)}><Icon name="x" size={14} /></button
                >
              </li>
            {/each}
          </ol>
        {/if}
        {#if team.players.length < MAX_PLAYERS}
          <PersonPicker
            id="team-player"
            {members}
            exclude={taken}
            clearOnPick
            placeholder="Add a member…"
            aria-label="Add a member"
            onpick={(id) => team.players.push({ memberId: id, name: "" })}
          />
          <div class="outsider">
            <input
              class="input"
              bind:value={outsider}
              placeholder="or someone from outside"
              maxlength="60"
              aria-label="A player from outside the club"
              onkeydown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                addOutsider();
              }}
            />
            <button type="button" class="btn sm" disabled={!outsider.trim()} onclick={addOutsider}>Add</button>
          </div>
        {/if}
      </div>
    {/if}
  </div>
  {#snippet footer()}
    <button type="button" class="btn ghost remove" onclick={remove} onblur={() => (sure = false)}>
      {sure ? "Sure? Remove them" : "Remove"}
    </button>
    <button type="button" class="btn primary" onclick={() => (open = false)}>Done</button>
  {/snippet}
</Sheet>

<style>
  .form {
    display: grid;
    gap: var(--s-4);
  }
  .cols {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-4);
  }
  .look {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--s-3);
    align-items: center;
  }
  .look-text {
    display: grid;
    min-width: 0;
  }
  .look-name {
    overflow: hidden;
    color: var(--fg);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .look-name.quiet {
    color: var(--fg-body);
    font-weight: 400;
  }
  .look .link {
    color: var(--fg);
  }
  .link {
    justify-self: start;
    padding: 0;
    border: 0;
    background: none;
    color: var(--fg-muted);
    text-decoration: underline;
    cursor: pointer;
  }
  .players {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
    counter-reset: player;
  }
  .players li {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    color: var(--fg-body);
    counter-increment: player;
  }
  .players li::before {
    content: counter(player);
    width: 1.5rem;
    color: var(--fg-subtle);
    font-size: var(--text-xs);
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .outsider {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--s-2);
  }
  /* Red words, never a red fill */
  .remove {
    color: var(--red-hot);
  }
</style>
