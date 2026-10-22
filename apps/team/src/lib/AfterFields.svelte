<script lang="ts">
  // Where everyone goes afterwards (ADR 0074), in an admin form: one of the club's saved venues (Settings → Venues),
  // an optional time and a few words on what for. A series' is every one of its dates' (Kumite → The Anchor, for the
  // celebration and awards); a date (`mode` bound) can leave it on Usual, pick its own, or say None this time.
  import { db } from "../demo/store.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import Select from "./Select.svelte";
  import TimeSelect from "./TimeSelect.svelte";
  import { clock } from "./dates";
  import type { After, AfterMode } from "@cougars/shared/places";

  let {
    venueId = $bindable(),
    time = $bindable(),
    note = $bindable(),
    mode = $bindable(),
    usual,
    id = "after",
  }: {
    venueId: number | null;
    time: string | null;
    note: string;
    /** A date's: its series' (usual), its own, or none. Left unbound for a series, which has only its own. */
    mode?: AfterMode;
    /** A date's series' afterwards, what Usual comes to (null: the series has none). */
    usual?: After | null;
    id?: string;
  } = $props();

  const dated = $derived(mode !== undefined);
  const choice = $derived(dated && mode !== "own" ? (mode ?? "usual") : venueId != null ? `venue:${venueId}` : "none");
  const options = $derived([
    ...(dated ? [{ value: "usual", label: usual ? `Usual: ${usual.name}` : "Usual (none set)" }] : []),
    ...(dated ? [] : [{ value: "none", label: "Nowhere" }]),
    // The ones still offered, and this one's even if it isn't
    ...db.venues.filter((v) => v.active || v.id === venueId).map((v) => ({ value: `venue:${v.id}`, label: v.name })),
    ...(dated ? [{ value: "none", label: "None this time" }] : []),
  ]);

  function pick(value: string) {
    if (!value.startsWith("venue:")) {
      if (dated) mode = value as AfterMode;
      venueId = null;
      time = null;
      note = "";
      return;
    }
    // Moving off Usual starts from it, so a different time is one change
    if (dated && mode !== "own" && usual) {
      time = usual.time;
      note = usual.note;
    }
    if (dated) mode = "own";
    venueId = Number(value.slice(6));
  }

  const own = $derived(choice.startsWith("venue:"));
  // What Usual comes to, to check
  const shown = $derived(choice === "usual" ? usual : null);
</script>

<div class="after">
  <div class="field">
    Afterwards
    <Select {id} value={choice} onchange={pick} {options} aria-label="Afterwards" />
  </div>
  {#if own}
    <div class="cols">
      <div class="field">
        From <TimeSelect
          id="{id}-time"
          optional
          bind:value={() => time ?? "", (v) => (time = v || null)}
          aria-label="From"
        />
      </div>
      <label class="field"
        >What for <input
          class="input"
          bind:value={note}
          maxlength="80"
          placeholder="e.g. Celebration and awards"
        /></label
      >
    </div>
  {:else if shown}
    <p class="hint small where">
      <Icon name="pin" size={14} />
      <span>{[shown.name, shown.time && `from ${clock(shown.time)}`, shown.note].filter(Boolean).join(" · ")}</span>
      <a href={shown.mapUrl} target="_blank" rel="noopener noreferrer">Check the map</a>
    </p>
  {/if}
</div>

<style>
  .after {
    display: grid;
    gap: var(--s-3);
  }
  .cols {
    display: grid;
    grid-template-columns: minmax(8rem, 1fr) minmax(12rem, 2fr);
    gap: var(--s-3);
  }
  @media (max-width: 480px) {
    .cols {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .where {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2);
  }
</style>
