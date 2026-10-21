<script lang="ts">
  // One team in a tournament's editor (ADR 0030). In a draft it's a row: its captain (a member, found by typing) and an
  // optional name, with its place in the pick order once the draft's opened and drawn it (ADR 0060); its players come
  // from the draft. A team that entered may be from outside the club,
  // so it's a card: its logo and name, a captain who's a member or just a name with a way to reach them, and its
  // players, members found by typing or names from outside.
  import { shrinkLogo } from "./logo";
  import type { TournamentKind, TournamentTeam } from "../demo/model";
  import Icon from "../app/shell/Icon.svelte";
  import PersonPicker from "./PersonPicker.svelte";

  let {
    team = $bindable(),
    kind,
    place,
    pick = null,
    members,
    taken,
    onremove,
  }: {
    team: TournamentTeam;
    kind: TournamentKind;
    /** Its place in the editor's list, from 1: the order they're named in, which means nothing for the draft. */
    place: number;
    /** Its place in the draft's pick order, from 1, once the draft's opened and drawn it; null till then. */
    pick?: number | null;
    members: { id: number; name: string }[];
    /** Members already on a team (this one's included), who can't be added again. */
    taken: Set<number>;
    onremove: () => void;
  } = $props();

  const nameOf = (id: number | null) => members.find((m) => m.id === id)?.name ?? "";
  const label = $derived(team.name || nameOf(team.captainMemberId) || team.captainName || "New team");
  const initials = $derived(
    label
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase(),
  );

  // A logo: shrunk in the browser so it's small enough to keep in the database (logo.ts)
  let fileInput = $state<HTMLInputElement | undefined>();
  let logoError = $state("");
  async function pickLogo(file: File | undefined) {
    logoError = "";
    if (!file) return;
    try {
      team.logo = await shrinkLogo(file);
    } catch {
      logoError = "That image couldn't be read. Try a PNG or JPEG.";
    }
  }

  /** Changing a draft captain: the name gives way to a search box. */
  let changing = $state(false);

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
</script>

{#snippet logo()}
  <button
    type="button"
    class="logo"
    aria-label={team.logo ? `Change ${label}'s logo` : `Add a logo for ${label}`}
    title={team.logo ? "Change the logo" : "Add a logo"}
    onclick={() => fileInput?.click()}
  >
    {#if team.logo}<img src={team.logo} alt="" />{:else}<span>{initials}</span>{/if}
  </button>
  <input
    bind:this={fileInput}
    class="file"
    type="file"
    accept="image/png,image/jpeg,image/webp"
    tabindex="-1"
    onchange={(e) => pickLogo(e.currentTarget.files?.[0])}
  />
{/snippet}

{#if kind === "draft"}
  <!-- A captain; the number is their pick, once the draft's drawn the order (the column's kept either way) -->
  <div class="captain">
    <span class="pick num" title={pick ? "Pick order, drawn as the draft opened" : undefined}>{pick ?? ""}</span>
    {@render logo()}
    {#if changing || !team.captainMemberId}
      <PersonPicker
        id="captain-{place}"
        {members}
        value={team.captainMemberId}
        exclude={taken}
        autofocus={changing}
        aria-label={pick ? `Captain, pick ${pick}` : "Captain"}
        onpick={(id) => (pickCaptain(id), (changing = false))}
        ondone={() => (changing = false)}
      />
    {:else}
      <!-- Who it is, as a name; click to change them -->
      <button type="button" class="who" title="Change the captain" onclick={() => (changing = true)}>
        <span class="who-name">{nameOf(team.captainMemberId)}</span>
      </button>
    {/if}
    <input
      class="input"
      bind:value={team.name}
      placeholder="Team name (optional)"
      maxlength="40"
      aria-label="Team name"
    />
    <div class="actions">
      <button type="button" class="btn sm ghost icon" aria-label="Remove {label}" onclick={onremove}>
        <Icon name="x" size={16} />
      </button>
    </div>
  </div>
  {#if team.players.length}
    <p class="picked hint small">
      Picked: {team.players.map((p) => (p.memberId ? nameOf(p.memberId).split(" ")[0] : p.name)).join(", ")}
    </p>
  {/if}
  {#if logoError}<p class="error small">{logoError}</p>{/if}
{:else}
  <!-- A team that entered -->
  <article class="team">
    <header class="head">
      {@render logo()}
      <input
        class="input grow"
        bind:value={team.name}
        placeholder="Team name, e.g. Clapham Crushers"
        maxlength="40"
        required
        aria-label="Team name"
      />
      {#if team.logo}
        <button type="button" class="btn sm ghost" onclick={() => (team.logo = null)}>Remove logo</button>
      {/if}
      <button type="button" class="btn sm ghost icon" aria-label="Remove {label}" onclick={onremove}>
        <Icon name="x" size={16} />
      </button>
    </header>
    {#if logoError}<p class="error small">{logoError}</p>{/if}

    <div class="cols">
      <div class="field">
        <span
          >Captain {#if team.captainMemberId}<span class="hint">· a member</span>{/if}</span
        >
        <PersonPicker
          id="captain-{pick}"
          {members}
          value={team.captainMemberId}
          exclude={taken}
          placeholder="A member, or leave empty"
          aria-label="Captain"
          onpick={pickCaptain}
        />
        {#if team.captainMemberId}
          <button type="button" class="link small" onclick={() => (team.captainMemberId = null)}>Not a member?</button>
        {/if}
      </div>
      {#if !team.captainMemberId}
        <label class="field">Captain's name <input class="input" bind:value={team.captainName} maxlength="60" /></label>
        <label class="field"
          >How to reach them <input
            class="input"
            bind:value={team.contact}
            placeholder="Email or phone"
            maxlength="120"
          /></label
        >
      {/if}
    </div>

    <div class="field">
      <span>Players <span class="hint">· {team.players.length}</span></span>
      {#if team.players.length}
        <ol class="players">
          {#each team.players as p, i (i)}
            <li>
              <span class="grow">{p.memberId ? nameOf(p.memberId) : p.name}</span>
              {#if !p.memberId}<span class="hint small">not a member</span>{/if}
              <button
                type="button"
                class="btn sm ghost icon"
                aria-label="Remove {p.memberId ? nameOf(p.memberId) : p.name}"
                onclick={() => team.players.splice(i, 1)}><Icon name="x" size={14} /></button
              >
            </li>
          {/each}
        </ol>
      {/if}
      {#if team.players.length < 30}
        <div class="add">
          <PersonPicker
            id="player-{pick}"
            {members}
            exclude={taken}
            clearOnPick
            placeholder="Add a member…"
            aria-label="Add a member"
            onpick={(id) => team.players.push({ memberId: id, name: "" })}
          />
          <input
            class="input"
            bind:value={outsider}
            placeholder="or someone from outside"
            maxlength="60"
            aria-label="A player from outside the club"
            onkeydown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addOutsider();
              }
            }}
          />
          <button type="button" class="btn sm" disabled={!outsider.trim()} onclick={addOutsider}>Add</button>
        </div>
      {/if}
    </div>
  </article>
{/if}

<style>
  /* A draft captain (not `.row`, the app's list row with lines): one line, everything the height of a field */
  .captain {
    display: grid;
    grid-template-columns: 1.5rem var(--control-h) minmax(0, 1fr) minmax(8rem, 15rem) auto;
    gap: var(--s-2);
    align-items: center;
  }
  /* The captain, as a person: their name; click it to change them */
  .who {
    display: grid;
    justify-items: start;
    align-items: center;
    height: var(--control-h);
    min-width: 0;
    padding: 0 var(--s-2);
    border: 0;
    border-radius: var(--r-md);
    background: none;
    text-align: left;
    cursor: pointer;
  }
  .who:hover {
    background: var(--surface-2);
  }
  .who-name {
    max-width: 100%;
    overflow: hidden;
    color: var(--fg);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pick {
    color: var(--fg-muted);
    font-weight: 600;
    text-align: center;
  }
  .picked {
    margin: calc(-1 * var(--s-1)) 0 0 calc(1.5rem + var(--control-h) + 2 * var(--s-2));
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  @container (max-width: 34rem) {
    .captain {
      grid-template-columns: 1.5rem var(--control-h) minmax(0, 1fr) auto;
    }
    /* The name field takes a line of its own under the name; the ✕ stays up on the name's line, not alone below */
    .captain > .input {
      grid-row: 2;
      grid-column: 3 / -1;
    }
    .captain > .actions {
      grid-row: 1;
      grid-column: 4;
    }
    .picked {
      margin-left: 0;
    }
  }

  /* A team that entered: a quiet card */
  .team {
    display: grid;
    gap: var(--s-4);
    padding: var(--s-4);
    border-radius: var(--r-lg);
    background: var(--surface-2);
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--s-3);
  }
  /* The logo, or its initials: a square the height of a field */
  .logo {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: var(--control-h);
    height: var(--control-h);
    padding: 0;
    overflow: hidden;
    border: 0;
    border-radius: var(--r-md);
    background: var(--field-bg);
    color: var(--fg-muted);
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
  }
  .logo img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .file {
    display: none;
  }
  .cols {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--s-4);
    align-items: start;
  }
  @container (max-width: 30rem) {
    .cols {
      grid-template-columns: minmax(0, 1fr);
    }
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
  .add {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
    gap: var(--s-2);
    align-items: center;
  }
  .error {
    color: var(--red-hot);
  }
</style>
