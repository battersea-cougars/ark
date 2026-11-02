<script lang="ts">
  // Where something is held (apps/team/worker/training/README.md): one of the club's saved venues (Settings → Venues), or somewhere else, typed
  // with the map link pasted from Google Maps, so a social never needs a venue made for it. Left unset, it follows
  // `usual` (a tournament's series) when there is one. The venue's address and map show beneath, to check it.
  import { db } from "../demo/store.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import Select from "./Select.svelte";
  import { placeOf, type Place } from "@cougars/shared/places";

  let {
    venueId = $bindable(),
    name = $bindable(),
    mapUrl = $bindable(),
    usual,
    id = "place",
    placeholder = "e.g. The Latchmere, Battersea",
  }: {
    venueId: number | null;
    name: string;
    mapUrl: string;
    /** What it follows when nothing is set; undefined when it follows nothing. */
    usual?: Place | null;
    id?: string;
    placeholder?: string;
  } = $props();

  // "Somewhere else" picked, before anything's typed in it
  let elsewhere = $state(false);
  const choice = $derived(venueId != null ? `venue:${venueId}` : elsewhere || name || mapUrl ? "elsewhere" : "");

  const options = $derived([
    { value: "", label: usual ? `Usual: ${usual.name}` : usual === null ? "Usual (none set)" : "Not set" },
    // The ones still offered, and this one's even if it isn't
    ...db.venues.filter((v) => v.active || v.id === venueId).map((v) => ({ value: `venue:${v.id}`, label: v.name })),
    { value: "elsewhere", label: "Somewhere else…" },
  ]);

  function pick(value: string) {
    elsewhere = value === "elsewhere";
    venueId = value.startsWith("venue:") ? Number(value.slice(6)) : null;
    if (value !== "elsewhere") {
      name = "";
      mapUrl = "";
    }
  }

  // What the choice comes to, to check: the venue's (or the usual) address and map
  const shown = $derived(choice === "elsewhere" ? null : placeOf({ venueId, name: "", mapUrl: "" }, db.venues, usual));
</script>

<div class="place">
  <div class="field">
    Where
    <Select {id} value={choice} onchange={pick} {options} aria-label="Where" />
  </div>
  {#if choice === "elsewhere"}
    <div class="cols">
      <label class="field">Name <input class="input" bind:value={name} maxlength="120" {placeholder} /></label>
      <label class="field">
        Map link
        <input class="input" type="url" bind:value={mapUrl} placeholder="https://maps.app.goo.gl/…" maxlength="500" />
      </label>
    </div>
    <p class="hint small">
      In Google Maps, find it, then Share → Copy link, and paste it here. No link: the map searches for the name.
      Somewhere the club goes often is better saved under Settings → Venues.
    </p>
  {:else if shown}
    <p class="hint small where">
      <Icon name="pin" size={14} />
      <span>{shown.address || shown.name}</span>
      <a href={shown.mapUrl} target="_blank" rel="noopener noreferrer">Check the map</a>
    </p>
  {/if}
</div>

<style>
  .place {
    display: grid;
    gap: var(--s-3);
  }
  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: var(--s-3);
  }
  .where {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2);
  }
</style>
