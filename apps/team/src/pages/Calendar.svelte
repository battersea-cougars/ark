<script lang="ts">
  // Everything on: training sessions, tournaments and one-offs, in date order. Each training and tournament type
  // has its own icon and colour, and the chips at the top filter to one kind. An admin's New event puts any of them
  // on (lib/new-event.ts): a one-off in its sheet here, a training or a tournament in the same editor Settings opens
  // (ADR 0065), over this page.
  import TimeSelect from "../lib/TimeSelect.svelte";
  import DateField from "../lib/DateField.svelte";
  import PageHeader from "../lib/PageHeader.svelte";
  import Sheet from "../lib/Sheet.svelte";
  import { cancelClashes } from "../app/clashes.backend";
  import { createClubEvent, setClubEventCancelled, updateClubEvent, type ClubEventBody } from "../app/backend.svelte";
  import ClashSheet from "../lib/ClashSheet.svelte";
  import { eventWindow } from "../lib/clashes";
  import { can } from "../access/actions";
  import type { IconName } from "../app/shell/icons";
  import Icon from "../app/shell/Icon.svelte";
  import type { Tone } from "../demo/model";
  import { calendar } from "../demo/schedule.svelte";
  import { granted, impersonating, realGranted } from "../demo/session.svelte";
  import { db } from "../demo/store.svelte";
  import EventCard from "../lib/EventCard.svelte";
  import { londonISO, londonTime, londonToday } from "../lib/dates";
  import type { Bookable, OneOff } from "../demo/model";
  import PlacePicker from "../lib/PlacePicker.svelte";
  import ManageMenu from "../lib/ManageMenu.svelte";
  import type { ManageItem } from "../lib/ManageList.svelte";
  import TrainingEditorPanel from "../lib/TrainingEditorPanel.svelte";
  import TournamentEditorPanel from "../lib/TournamentEditorPanel.svelte";
  import { editTournament } from "../lib/tournament-panel.svelte";
  import { newEventKinds, type NewEventKind } from "../lib/new-event";
  import { switchUpFor } from "../app/settings-entry.svelte";
  import { Edits } from "../lib/dirty.svelte";
  import SaveBar from "../lib/SaveBar.svelte";
  import { byMonth } from "../lib/months";

  const perms = $derived(granted());

  // ─── Filter ───
  const FILTER_KEY = "team.calendar.filter";
  let filter = $state(readFilter());
  function readFilter() {
    try {
      return localStorage.getItem(FILTER_KEY) ?? "all";
    } catch {
      return "all";
    }
  }
  function setFilter(f: string) {
    filter = f;
    try {
      localStorage.setItem(FILTER_KEY, f);
    } catch {
      // Private mode: the filter resets on reload.
    }
  }
  const chips = $derived<{ id: string; label: string; icon?: IconName; tone?: Tone }[]>([
    { id: "all", label: "All" },
    ...db.series
      .filter((s) => s.active)
      .map((s) => ({ id: `series:${s.id}`, label: s.shortName, icon: s.icon, tone: s.tone })),
    ...db.tournamentTypes
      .filter((t) => t.active)
      .map((t) => ({ id: `type:${t.id}`, label: t.shortName, icon: t.icon, tone: t.tone })),
    { id: "social", label: "Socials", icon: "glass", tone: "amber" },
  ]);
  const items = $derived(calendar().filter((e) => filter === "all" || e.filter === filter));

  // Group by month for the running order, each month in its year (lib/months.ts)
  const months = $derived(byMonth(items));

  // ─── New event: what kind ───
  // Your full role's kinds, so the button shows in your everyday role too and switches you up as you pick one (as
  // the Settings gear does); while viewing as someone, theirs
  const kinds = $derived(newEventKinds(impersonating() ? perms : realGranted(), db.tournamentTypes));
  let choosing = $state(false);
  // A new training's editor, open over the calendar
  let newTraining = $state(false);
  function newEvent() {
    // One kind isn't a menu (ADR 0065): straight to it
    if (kinds.length === 1) pick(kinds[0]);
    else choosing = true;
  }
  const kindItems: ManageItem[] = $derived(
    kinds.map((kind) => ({
      icon: kind.icon,
      label: kind.label,
      sub: kind.sub,
      tone: kind.tone ? `var(--tone-${kind.tone})` : undefined,
      run: () => pick(kind),
    })),
  );
  function pick(kind: NewEventKind) {
    choosing = false;
    switchUpFor(kind.action);
    if (kind.id === "one-off") startAdding();
    else if (kind.id === "training") newTraining = true;
    else editTournament("new", { typeId: kind.typeId });
  }

  // ─── Add or edit a one-off ───
  const blank = () => ({
    title: "",
    date: "",
    start: "19:30",
    end: "22:30",
    venueId: null as number | null,
    venue: "",
    mapUrl: "",
    description: "",
    public: true,
    signup: true,
  });
  let adding = $state(false);
  /** The one-off being edited; null while adding a new one. */
  let editing = $state<OneOff | null>(null);
  let draft = $state(blank());
  // Unsaved changes: Save lights up, and closing asks first (lib/dirty.svelte.ts)
  const edits = new Edits();
  edits.watch(() => draft);

  function startAdding() {
    editing = null;
    draft = blank();
    edits.reset();
    edits.fresh = true;
    adding = true;
  }
  function startEditing(o: OneOff) {
    editing = o;
    draft = {
      title: o.title,
      date: londonToday(new Date(o.startsAt)),
      start: londonTime(o.startsAt),
      end: londonTime(o.endsAt),
      venueId: o.venueId,
      venue: o.venue,
      mapUrl: o.mapUrl,
      description: o.description,
      public: o.public,
      signup: o.signup,
    };
    edits.reset();
    edits.fresh = false;
    adding = true;
  }
  const oneOff = (event: Bookable) => (event.kind === "social" ? (event.entries as OneOff) : null);

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!draft.title || !draft.date) return;
    const startsAt = londonISO(draft.date, draft.start);
    let endsAt = londonISO(draft.date, draft.end || draft.start);
    // Ends after midnight: the next day
    if (endsAt < startsAt) endsAt = new Date(Date.parse(endsAt) + 24 * 3600_000).toISOString();
    const body: ClubEventBody = {
      title: draft.title,
      startsAt,
      endsAt,
      venueId: draft.venueId,
      venue: draft.venueId ? "" : draft.venue,
      mapUrl: draft.venueId ? "" : draft.mapUrl,
      description: draft.description,
      public: draft.public,
      signup: draft.signup,
      capacity: editing?.capacity ?? null,
    };
    // Over something already on (Friday Training)? Asked first; closing the question saves nothing (ADR 0122)
    const window = eventWindow({ id: editing?.id, startsAt, endsAt }, editing ?? undefined);
    const chosen = window ? await clashSheet?.ask(window, draft.title) : [];
    if (chosen === null) return;
    const id = editing?.id;
    // Saved, it closes; the shell says so
    const done = await edits.run(() => (id ? updateClubEvent(id, body) : createClubEvent(body)));
    if (done === null) return;
    adding = false;
    await cancelClashes(chosen ?? []);
  }
  let clashSheet = $state<ClashSheet | undefined>();
  async function toggleCancelled() {
    if (!editing) return;
    if ((await setClubEventCancelled(editing.id, !editing.cancelledAt)) === null) return;
    adding = false;
  }
</script>

<div class="page">
  <PageHeader
    title="Calendar"
    subtitle="Training, tournaments and everything else that's on."
    active={filter === "all" ? 0 : 1}
    onclear={() => setFilter("all")}
  >
    {#snippet actions()}
      <!-- New event: in the toolbar row on desktop, the bar on a phone, in words there too (no floating buttons:
           ADR 0084) -->
      {#if kinds.length}
        <button class="btn sm primary keep-label" aria-haspopup="dialog" onclick={newEvent}>
          <Icon name="plus" size={16} />New event
        </button>
      {/if}
    {/snippet}
    {#snippet filters()}
      <div class="filters" role="group" aria-label="Show">
        {#each chips as c (c.id)}
          <button
            class="filter"
            aria-pressed={filter === c.id}
            style:--tone={c.tone ? `var(--tone-${c.tone})` : undefined}
            style:--icon={c.tone ? `var(--tone-${c.tone})` : undefined}
            onclick={() => setFilter(c.id)}
          >
            {#if c.icon}<Icon name={c.icon} size={14} />{/if}
            {c.label}
          </button>
        {/each}
      </div>
    {/snippet}
  </PageHeader>

  {#each months as month (month.key)}
    <h2 class="section-title">{month.label}</h2>
    {#each month.events as event (event.key)}
      {@const o = oneOff(event)}
      {@const editable = !!o && can(perms, "update:Event")}
      {#snippet details()}
        {#if o?.description}<p class="about">{o.description}</p>{/if}
        {#if editable && o}
          <div class="admin">
            <span class="hint">{o.public ? "On the website" : "Members only"}</span>
            <button class="link" aria-haspopup="dialog" onclick={() => startEditing(o)}>Edit</button>
          </div>
        {/if}
      {/snippet}
      <EventCard
        {event}
        compact
        link
        canSignUp={can(perms, "signup:Event")}
        footer={o?.description || editable ? details : undefined}
      />
    {/each}
  {:else}
    <p class="hint">Nothing coming up{filter === "all" ? "" : " for this one"}.</p>
  {/each}
  <!-- A one-off event, in a sheet (a modal on desktop): the list stays where it is -->
  <Sheet bind:open={adding} title={editing ? "Edit event" : "Add an event"} {edits}>
    <form class="form" id="event-form" onsubmit={save}>
      {#if !editing}
        <p class="hint">A one-off: a social, a kit day. One date, on the calendar and, if you like, the website.</p>
      {/if}
      <label class="field"
        >Title <input class="input" bind:value={draft.title} placeholder="e.g. Summer social" required /></label
      >
      <div class="field">Date <DateField id="event-date" aria-label="Date" required bind:value={draft.date} /></div>
      <div class="two">
        <div class="field">Starts <TimeSelect id="event-start" bind:value={draft.start} aria-label="Starts" /></div>
        <div class="field">Ends <TimeSelect id="event-end" optional bind:value={draft.end} aria-label="Ends" /></div>
      </div>
      <PlacePicker id="event-place" bind:venueId={draft.venueId} bind:name={draft.venue} bind:mapUrl={draft.mapUrl} />
      <label class="field"
        >Description <textarea
          class="input"
          rows="2"
          maxlength="280"
          bind:value={draft.description}
          placeholder="A line or two for the website"></textarea></label
      >
      <label class="check"><input type="checkbox" bind:checked={draft.public} /> Show on the website</label>
      <label class="check"><input type="checkbox" bind:checked={draft.signup} /> Members say in or out</label>
      {#if editing}
        <button type="button" class="btn" onclick={toggleCancelled}>
          {editing.cancelledAt ? "It's back on" : "Cancel this event"}
        </button>
      {/if}
    </form>
    {#snippet footer()}
      <SaveBar {edits} form="event-form" label={editing ? "Save" : "Add to calendar"} />
    {/snippet}
  </Sheet>
</div>

{#if kinds.length > 1}
  <!-- What kind: up from the bottom on a phone, a side drawer on a desktop (ADR 0065, a menu of jobs) -->
  <ManageMenu bind:open={choosing} title="New event" sub="What's going on?" items={kindItems} />
{/if}
{#if newTraining && can(perms, "manage:Training")}
  <!-- Added: it closes on the calendar, which now has its sessions -->
  <TrainingEditorPanel open="new" onclose={() => (newTraining = false)} oncreated={() => (newTraining = false)} />
{/if}
{#if can(perms, "manage:Tournament")}<TournamentEditorPanel closeOnCreate />{/if}
<!-- A one-off over something already on: asked before it's saved (ADR 0122) -->
<ClashSheet bind:this={clashSheet} />

<style>
  /* A one-off's footer: its description, then (for whoever can change it) where it shows and Edit */
  .about,
  .admin {
    margin: 0;
    padding: var(--s-3) var(--s-5);
  }
  .about {
    color: var(--fg-body);
  }
  .about + .admin {
    padding-top: 0;
  }
  .admin {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--s-3);
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--fg);
    font: inherit;
    text-decoration: underline;
    text-underline-offset: 0.2em;
    cursor: pointer;
  }
  textarea.input {
    resize: vertical;
  }
  /* New event's kinds, as the Manage menus' rows: an icon in its colour, what it is, a line on what it makes */
</style>
