<script lang="ts">
  // Settings → Venues (ADR 0030): places the club goes again and again, each with its address and the map link
  // pasted from Google Maps. Trainings, tournaments and events pick one, so changing it here fixes every one of them.
  // One that's no longer used is hidden from the pickers rather than deleted: what had it keeps it.
  import PageHeader from "../lib/PageHeader.svelte";
  import Sheet from "../lib/Sheet.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import { db } from "../demo/store.svelte";
  import { createVenue, updateVenue } from "../app/backend.svelte";
  import { readTagged } from "../app/api";
  import { reportUnexpected } from "../app/errors.early";
  import type { Venue } from "../demo/model";
  import { cleanMapUrl, placeOf } from "@cougars/shared/places";
  import { Edits } from "../lib/dirty.svelte";
  import SaveBar from "../lib/SaveBar.svelte";

  const blank = (): Venue => ({ id: 0, name: "", address: "", mapUrl: "", active: true });
  let open = $state(false);
  let draft = $state<Venue>(blank());
  let problem = $state("");
  // Unsaved changes: Save lights up, and closing asks first (lib/dirty.svelte.ts)
  const edits = new Edits();
  edits.watch(() => draft);

  function edit(v?: Venue) {
    draft = v ? { ...$state.snapshot(v) } : blank();
    edits.reset();
    edits.fresh = !v;
    problem = "";
    open = true;
  }

  // What picks each one, so it's clear what a change moves: every one held there, past ones too, read from the server
  // (#177); again after a change to what's on (the series, sessions and tournaments come back with it)
  let used = $state<{ venueId: number; names: string[] }[]>([]);
  $effect(() => {
    void [db.series, db.tournamentTypes, db.tournaments, db.oneOffs, db.venues];
    readTagged<{ used: typeof used }>("/api/venues/used", null)
      .then(({ data }) => data && (used = data.used))
      .catch((e) => reportUnexpected(e, "Couldn't read what each venue is used for"));
  });
  const usedBy = (id: number) => used.find((u) => u.venueId === id)?.names.join(", ") ?? "";

  const mapOf = (v: Venue) => placeOf({ venueId: v.id, name: "", mapUrl: "" }, [v])!.mapUrl;

  async function save(e: SubmitEvent) {
    e.preventDefault();
    const mapUrl = cleanMapUrl(draft.mapUrl);
    if (mapUrl === null) return void (problem = "That map link isn't a web link. In Google Maps: Share → Copy link.");
    const v = { ...draft, name: draft.name.trim(), address: draft.address.trim(), mapUrl };
    // Saved, it closes; the shell says so
    if ((await edits.run(() => (v.id ? updateVenue(v) : createVenue(v)))) !== null) open = false;
  }
</script>

<div class="page">
  <PageHeader title="Venues" subtitle="Places the club goes. Change one here and everything held there follows.">
    {#snippet actions()}
      <button class="btn sm primary" aria-haspopup="dialog" onclick={() => edit()}>
        <Icon name="plus" size={16} />Venue
      </button>
    {/snippet}
  </PageHeader>

  {#if db.venues.length}
    <div class="list">
      <div class="table-head">
        <span>Venue</span><span class="wide-only">Address</span><span class="wide-only">Used for</span>
      </div>
      <ul class="venues">
        {#each db.venues as v (v.id)}
          {@const used = usedBy(v.id)}
          <!-- The whole row opens it: the name's button stretches over the row; Map sits above it -->
          <li class="table-row" class:hidden={!v.active}>
            <button class="open" onclick={() => edit(v)}>
              <Icon name="pin" size={18} />
              <span class="what">
                <span class="name"
                  >{v.name}{#if !v.active}<span class="tag">Hidden</span>{/if}</span
                >
                <span class="hint small phone-only">{v.address || "No address"}{used ? ` · ${used}` : ""}</span>
              </span>
            </button>
            <span class="wide-only muted">{v.address || "No address"}</span>
            <span class="wide-only muted">{used || "Nothing yet"}</span>
            <a class="btn ghost sm map" href={mapOf(v)} target="_blank" rel="noopener noreferrer">Map</a>
            <Icon name="chevronRight" size={18} />
          </li>
        {/each}
      </ul>
    </div>
  {:else}
    <p class="hint">No venues yet. Add the rink, then choose it for trainings and tournaments.</p>
  {/if}
</div>

<Sheet bind:open title={draft.id ? "Edit venue" : "Add a venue"} {edits}>
  <form class="form" id="venue-form" onsubmit={save}>
    <label class="field"
      >Name <input
        class="input"
        bind:value={draft.name}
        placeholder="e.g. Battersea Sports Centre"
        maxlength="80"
        required
      /></label
    >
    <label class="field"
      >Address <input
        class="input"
        bind:value={draft.address}
        placeholder="e.g. London SW11 3AB"
        maxlength="160"
      /></label
    >
    <label class="field">
      Map link
      <input
        class="input"
        type="url"
        bind:value={draft.mapUrl}
        placeholder="https://maps.app.goo.gl/…"
        maxlength="500"
      />
      <span class="hint small"
        >In Google Maps, find it, then Share → Copy link. Empty: the map searches for the name and address.</span
      >
    </label>
    <label class="check"><input type="checkbox" bind:checked={draft.active} /> Offer it when choosing a place</label>
    {#if problem}<p class="problem" role="alert">{problem}</p>{/if}
  </form>
  {#snippet footer()}<SaveBar {edits} form="venue-form" label={draft.id ? "Save" : "Add venue"} />{/snippet}
</Sheet>

<style>
  /* The venue, its address, what picks it, the map, and the chevron's room */
  .list {
    --cols: minmax(10rem, 1fr) minmax(0, 1.2fr) minmax(0, 1fr) auto 18px;
  }
  .venues {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    position: relative;
  }
  li + li {
    border-top: 1px solid var(--border);
  }
  li:hover {
    background: color-mix(in srgb, var(--fg) 5%, transparent);
  }
  li.hidden > * {
    opacity: 0.6;
  }
  li > span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .open {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-width: 0;
    padding: 0;
    border: 0;
    background: none;
    color: var(--fg-body);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .open::after {
    content: "";
    position: absolute;
    inset: 0;
  }
  .map {
    position: relative;
    z-index: 1;
  }
  .what {
    display: grid;
    min-width: 0;
  }
  .name {
    color: var(--fg);
    font-weight: 600;
  }
  .muted {
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  .phone-only {
    display: none;
  }
  /* A phone: the venue (its address and what picks it under the name), the map, the chevron */
  @media (max-width: 900px) {
    .list {
      --cols: minmax(0, 1fr) auto 18px;
    }
    .table-head,
    .table-row {
      gap: var(--s-3);
    }
    .wide-only {
      display: none;
    }
    .phone-only {
      display: block;
    }
  }
  .tag {
    margin-left: var(--s-2);
    color: var(--fg-muted);
    font-size: var(--text-sm);
    font-weight: 400;
  }
  .problem {
    color: var(--red-hot);
  }
</style>
