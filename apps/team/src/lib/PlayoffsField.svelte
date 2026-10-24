<script lang="ts">
  // A tournament's playoffs (ADR 0061): the games after the round robin, by table position. A list of formats, each
  // saying what happens ("1st v 2nd"), so choosing one plainly changes the day; "Something else" opens the games to
  // edit, picking places by name (1st, 2nd…) rather than typing numbers.
  import { ordinal } from "./dates";
  import type { Playoff } from "../demo/model";
  import Icon from "../app/shell/Icon.svelte";
  import Select, { type SelectOption } from "./Select.svelte";
  import { teamsForPlayoffs } from "./fixtures";

  let {
    playoffs = $bindable(),
    teams = 0,
  }: {
    playoffs: Playoff[];
    /** The teams so far (captains), to warn when the playoffs need more; 0: not known yet, no warning. */
    teams?: number;
  } = $props();
  const need = $derived(teamsForPlayoffs(playoffs));

  const PRESETS: { id: string; label: string; games: Playoff[] }[] = [
    { id: "none", label: "No playoffs", games: [] },
    { id: "final", label: "A final", games: [{ name: "Final", home: 1, away: 2 }] },
    {
      id: "final3",
      label: "A final and a 3rd-place game",
      games: [
        { name: "3rd place", home: 3, away: 4 },
        { name: "Final", home: 1, away: 2 },
      ],
    },
  ];
  const same = (a: Playoff[], b: Playoff[]) => JSON.stringify(a) === JSON.stringify(b);
  const matched = $derived(PRESETS.find((p) => same(p.games, playoffs))?.id);
  // Chose "Something else" by hand: stays open even while the games happen to match a preset
  let editing = $state(false);
  const chosen = $derived(editing || !matched ? "custom" : matched);

  const PLACES: SelectOption[] = Array.from({ length: 16 }, (_, i) => ({
    value: String(i + 1),
    label: ordinal(i + 1),
  }));
  const says = (games: Playoff[]) =>
    games.length
      ? games.map((g) => `${g.name || "A game"}: ${ordinal(g.home)} v ${ordinal(g.away)}`).join(" · ")
      : "The top of the table wins it.";

  function choose(id: string) {
    if (id === "custom") {
      editing = true;
      if (!playoffs.length) playoffs = [{ name: "Final", home: 1, away: 2 }];
      return;
    }
    editing = false;
    playoffs = structuredClone(PRESETS.find((p) => p.id === id)!.games);
  }
  const add = () => playoffs.push({ name: "", home: playoffs.length * 2 + 1, away: playoffs.length * 2 + 2 });
</script>

<div class="playoffs">
  <div class="formats" role="radiogroup" aria-label="Playoffs">
    {#each [...PRESETS, { id: "custom", label: "Something else", games: [] }] as p (p.id)}
      <button type="button" role="radio" aria-checked={chosen === p.id} onclick={() => choose(p.id)}>
        <span class="dot" aria-hidden="true"></span>
        <span class="text">
          <span class="label">{p.label}</span>
          <span class="sub">{p.id === "custom" ? "Your own games, by place in the table" : says(p.games)}</span>
        </span>
      </button>
    {/each}
  </div>

  {#if teams && teams < need}
    <p class="hint warn">
      <Icon name="alert" size={16} />These need {need} teams, and there are {teams} captains so far. Add captains, or choose
      fewer playoffs: otherwise the fight card can't be made.
    </p>
  {/if}

  {#if chosen === "custom"}
    <div class="custom">
      <ol class="games">
        {#each playoffs as game, i (i)}
          <li>
            <input
              class="input"
              aria-label="Game name"
              placeholder="e.g. Semi-final"
              maxlength="40"
              bind:value={game.name}
            />
            <Select
              id="po-{i}-home"
              size="sm"
              aria-label="{game.name || 'Game'}: home place"
              options={PLACES}
              bind:value={() => String(game.home), (v) => (game.home = Number(v))}
            />
            <span class="v">v</span>
            <Select
              id="po-{i}-away"
              size="sm"
              aria-label="{game.name || 'Game'}: away place"
              options={PLACES}
              bind:value={() => String(game.away), (v) => (game.away = Number(v))}
            />
            <button
              type="button"
              class="btn sm ghost icon"
              aria-label="Remove {game.name || 'this game'}"
              onclick={() => playoffs.splice(i, 1)}><Icon name="x" size={16} /></button
            >
          </li>
        {/each}
      </ol>
      {#if playoffs.length < 8}
        <button type="button" class="btn sm add" onclick={add}><Icon name="plus" size={16} />Playoff game</button>
      {/if}
      <p class="hint small">Places in the table once every group game has a result. Played in this order.</p>
    </div>
  {/if}
</div>

<style>
  .playoffs {
    display: grid;
    gap: var(--s-3);
    justify-items: start;
  }
  .formats {
    display: grid;
    gap: 2px;
    width: 100%;
  }
  .formats button {
    display: flex;
    gap: var(--s-3);
    align-items: flex-start;
    padding: var(--s-2) var(--s-3);
    border: 0;
    border-radius: var(--r-sm);
    background: none;
    color: var(--fg-muted);
    text-align: left;
  }
  .formats button:hover {
    background: color-mix(in srgb, var(--fg) 5%, transparent);
  }
  .formats button[aria-checked="true"] {
    background: color-mix(in srgb, var(--fg) 10%, var(--surface-2));
    color: var(--fg);
  }
  /* A radio: a ring, filled red-hot when chosen (colour as an accent) */
  .dot {
    flex: none;
    width: 1rem;
    height: 1rem;
    margin-top: 0.2rem;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1.5px var(--fg-subtle);
  }
  [aria-checked="true"] .dot {
    box-shadow:
      inset 0 0 0 1.5px var(--red-hot),
      inset 0 0 0 4px var(--surface-2);
    background: var(--red-hot);
  }
  .text {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .label {
    font-weight: 600;
  }
  .sub {
    color: var(--fg-subtle);
    font-size: var(--text-sm);
  }
  /* Under its option, lined up with the option's words */
  .custom {
    display: grid;
    gap: var(--s-3);
    justify-items: start;
    width: 100%;
    padding-left: calc(var(--s-3) + 1rem + var(--s-3));
  }
  .games {
    display: grid;
    gap: var(--s-2);
    width: 100%;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .games li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 5.5rem auto 5.5rem auto;
    gap: var(--s-2);
    align-items: center;
  }
  .v {
    color: var(--fg-subtle);
  }
  /* Phone: the name on its own line, the places under it */
  @media (max-width: 599px) {
    .custom {
      padding-left: 0;
    }
    .games {
      gap: var(--s-3);
    }
    .games li {
      grid-template-columns: 1fr auto 1fr auto;
    }
    .games li > input {
      grid-column: 1 / -1;
    }
  }
</style>
