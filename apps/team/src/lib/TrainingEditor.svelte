<script lang="ts">
  // One training's editor, inside the panel a card opens (Settings → Training). A series is a rule (every N weeks on
  // some days, from a first date, optionally to a last one) plus what every session shares (ADR 0030). Saving makes
  // its sessions; each one can then be cancelled on its own.
  import TimeSelect from "./TimeSelect.svelte";
  import DateField from "../lib/DateField.svelte";
  import { tick } from "svelte";
  import type { TrainingSeries } from "../demo/model";
  import { resolve } from "../demo/schedule.svelte";
  import { db } from "../demo/store.svelte";
  import { createSeries, moreSessions, setCancelled, updateSeries } from "../app/backend.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import StylePicker from "./StylePicker.svelte";
  import PlacePicker from "./PlacePicker.svelte";
  import { clock, formatDayDate, londonISO, londonToday, pounds } from "./dates";
  import { feeOn } from "./dues";
  import { collectedFor } from "../demo/dues.svelte";
  import { granted } from "../demo/session.svelte";
  import { can } from "../access/actions";
  import { WEEKDAYS, addDays, describeRule, weekdayOf } from "./recurrence";

  const DAY_NAMES = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

  let { seriesId, oncreated }: { seriesId?: number; oncreated?: (id: number) => void } = $props();

  const selected = $derived<number | "new">(seriesId ?? "new");
  let form = $state<TrainingSeries | null>(null);
  // Upcoming sessions, 12 weeks a page; paging past the last one made asks the server to make the next 12
  const PAGE_DAYS = 12 * 7;
  let page = $state(0);
  let fetching = $state(false);

  const blank = (): TrainingSeries => {
    const today = londonToday();
    return {
      id: 0,
      slug: "",
      name: "",
      shortName: "",
      icon: "skate",
      tone: "green",
      repeatEvery: 1,
      weekdays: [weekdayOf(today)],
      startsOn: today,
      endsOn: null,
      startTime: "19:30",
      endTime: "21:00",
      venueId: null,
      venue: "",
      mapUrl: "",
      capacity: 20,
      goalieCapacity: 2,
      public: true,
      active: true,
      fees: [{ pence: 1000, from: today }],
    };
  };

  $effect(() => {
    const s = selected === "new" ? blank() : db.series.find((x) => x.id === selected);
    form = s ? structuredClone($state.snapshot(s)) : null;
  });

  // Dues (ADR 0007): whoever sets fees sets a training's; whoever sees dues sees what each night collected
  const setsFees = $derived(can(granted(), "manage:Fees"));
  const seesDues = $derived(can(granted(), "read:Dues") || can(granted(), "record:Payment"));

  // The fee, going forward: a new amount applies from its date; sessions already held keep theirs (ADR 0007).
  const current = $derived(form ? feeOn(form.fees, londonToday()) : 0);
  let feeAmount = $state("");
  let feeFrom = $state(londonToday());
  $effect(() => {
    feeAmount = form ? String(feeOn(form.fees, londonToday()) / 100) : "";
    feeFrom = londonToday();
  });
  function applyFee() {
    if (!form) return;
    const pence = Math.round(Number(feeAmount) * 100);
    if (!Number.isFinite(pence) || pence < 0 || pence === feeOn(form.fees, feeFrom)) return;
    form.fees = [...form.fees.filter((f) => f.from !== feeFrom), { pence, from: feeFrom }].sort((a, b) =>
      a.from.localeCompare(b.from),
    );
  }

  const fullDate = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Europe/London",
    });

  // Sessions already held: what each was due, and what it has collected so far
  const held = $derived(
    typeof selected === "number"
      ? db.sessions
          .filter((s) => s.seriesId === selected && s.heldOn < londonToday())
          .sort((a, b) => b.heldOn.localeCompare(a.heldOn))
          .slice(0, 8)
      : [],
  );

  const upcoming = $derived(
    typeof selected === "number" ? db.sessions.filter((s) => s.seriesId === selected && s.heldOn >= londonToday()) : [],
  );
  const pageStart = $derived(addDays(londonToday(), page * PAGE_DAYS));
  const shown = $derived(upcoming.filter((x) => x.heldOn >= pageStart && x.heldOn < addDays(pageStart, PAGE_DAYS)));
  const shortDate = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "Europe/London",
    });
  const range = $derived(`${shortDate(pageStart)} – ${shortDate(addDays(pageStart, PAGE_DAYS - 1))}`);
  async function nextPage() {
    if (typeof selected !== "number") return;
    const lastMade = upcoming.reduce((m, x) => (x.heldOn > m ? x.heldOn : m), "");
    page++;
    // Not made that far yet: the server makes the next 12 weeks
    if (lastMade < addDays(pageStart, PAGE_DAYS - 7)) {
      fetching = true;
      await moreSessions(selected);
      fetching = false;
    }
  }

  function toggleDay(d: (typeof WEEKDAYS)[number]) {
    if (!form) return;
    form.weekdays = form.weekdays.includes(d) ? form.weekdays.filter((x) => x !== d) : [...form.weekdays, d];
  }

  // Its fields on tabs, as Gwenda ops lays out a menu item (Build, Menu, Pricing): what it is, when it runs, and
  // (once saved) its sessions. Each tab lays its fields out on a 12-column grid.
  type Tab = "details" | "schedule" | "sessions";
  let tab = $state<Tab>("details");
  const tabs = $derived<{ id: Tab; label: string }[]>([
    { id: "details", label: "Details" },
    { id: "schedule", label: "Schedule" },
    ...(typeof selected === "number" ? [{ id: "sessions" as const, label: "Sessions" }] : []),
  ]);
  let formEl = $state<HTMLFormElement | undefined>();

  /** Save from another tab with something missing: go to its tab and say what. */
  async function showMissing(on: Tab) {
    tab = on;
    await tick();
    formEl?.reportValidity();
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!form) return;
    if (!form.name) return showMissing("details");
    if (!form.weekdays.length || !form.startsOn) return showMissing("schedule");
    if (!form.shortName) form.shortName = form.name.split(" ")[0];
    applyFee();
    if (selected === "new") {
      const created = await createSeries(form);
      // The blank form gives way to the new training's editor, in the same panel
      if (created) oncreated?.(created.id);
    } else {
      await updateSeries(form);
    }
  }

  // Cancelling keeps the session (a row in D1), so whoever signed up can be told.
  function toggleCancel(id: number) {
    const s = db.sessions.find((x) => x.id === id)!;
    setCancelled(id, !s.cancelledAt);
  }
</script>

<div class="editor">
  {#if form}
    <div class="tablist" role="tablist" aria-label="Training">
      {#each tabs as t (t.id)}
        <button
          type="button"
          role="tab"
          id="training-tab-{t.id}"
          aria-selected={tab === t.id}
          aria-controls="training-panel"
          onclick={() => (tab = t.id)}
        >
          {t.label}
        </button>
      {/each}
    </div>
    <!-- Saved from the panel's footer (form="training-form"), whichever tab is showing -->
    <form class="form" id="training-form" onsubmit={save} bind:this={formEl}>
      {#key tab}
        <div class="panel-tab rise" id="training-panel" role="tabpanel" aria-labelledby="training-tab-{tab}">
          {#if tab === "details"}
            <div class="grid">
              <div class="checks span-12">
                <label class="check"><input type="checkbox" bind:checked={form.active} /> Running</label>
                <label class="check"><input type="checkbox" bind:checked={form.public} /> On the website calendar</label
                >
                <span class="hint">Untick Running to pause it: no new sessions.</span>
              </div>
              <label class="field span-8"
                >Name <input class="input" bind:value={form.name} placeholder="e.g. Sunday Skills" required /></label
              >
              <label class="field span-4">
                Short name
                <input class="input" bind:value={form.shortName} placeholder="e.g. Sunday" maxlength="12" />
              </label>
              <!-- Icon and colour side by side -->
              <div class="style span-12"><StylePicker bind:icon={form.icon} bind:tone={form.tone} /></div>
              <label class="field span-3">
                Skater places
                <input
                  class="input num"
                  type="number"
                  min="0"
                  value={form.capacity ?? ""}
                  onchange={(e) => form && (form.capacity = Number(e.currentTarget.value) || null)}
                />
              </label>
              <label class="field span-3">
                Goalie places
                <input
                  class="input num"
                  type="number"
                  min="0"
                  value={form.goalieCapacity ?? ""}
                  onchange={(e) =>
                    form && (form.goalieCapacity = e.currentTarget.value === "" ? null : Number(e.currentTarget.value))}
                />
              </label>
              {#if setsFees}
                <label class="field span-3">
                  Fee per session (£)
                  <input class="input num" inputmode="decimal" bind:value={feeAmount} />
                </label>
                <div class="field span-3">
                  Fee from <DateField id="training-fee-from" aria-label="Fee from" bind:value={feeFrom} />
                </div>
              {/if}
              <div class="span-12 tuck">
                <p class="hint small">
                  Leave places empty for no limit.{#if setsFees}
                    {current ? `${pounds(current)} now.` : "Free now."} A new fee applies from its date; sessions already
                    held keep theirs. Subscribers aren't charged.{/if}
                </p>
                {#if setsFees && form.fees.length > 1}
                  <p class="hint small">
                    {#each [...form.fees].reverse() as f, i (f.from)}{i ? " · " : ""}{pounds(f.pence)} from {fullDate(
                        f.from,
                      )}{/each}
                  </p>
                {/if}
              </div>
            </div>
          {:else if tab === "schedule"}
            <div class="grid">
              <fieldset class="field span-12">
                <legend>Repeats</legend>
                <div class="repeat">
                  Every
                  <input class="input num every" type="number" min="1" max="8" bind:value={form.repeatEvery} />
                  {form.repeatEvery === 1 ? "week" : "weeks"} on
                  <div class="days" role="group" aria-label="Days">
                    {#each WEEKDAYS as d (d)}
                      <button
                        type="button"
                        class="day"
                        aria-pressed={form.weekdays.includes(d)}
                        onclick={() => toggleDay(d)}
                      >
                        {DAY_NAMES[d]}
                      </button>
                    {/each}
                  </div>
                </div>
                <p class="hint">{describeRule(form)}</p>
              </fieldset>
              <div class="field span-3">
                First session <DateField
                  id="training-first"
                  aria-label="First session"
                  required
                  bind:value={form.startsOn}
                />
              </div>
              <div class="field span-3">
                Last session
                <DateField
                  id="training-last"
                  aria-label="Last session"
                  placeholder="Ongoing"
                  min={form.startsOn || undefined}
                  bind:value={() => form?.endsOn ?? "", (v) => form && (form.endsOn = v || null)}
                />
              </div>
              <div class="field span-3">
                Starts <TimeSelect id="training-start" bind:value={form.startTime} aria-label="Starts" />
              </div>
              <div class="field span-3">
                Ends <TimeSelect id="training-end" bind:value={form.endTime} aria-label="Ends" />
              </div>
              <p class="hint small span-12 tuck">
                Leave Last session empty to keep going; sessions are made 12 weeks ahead.
              </p>
              <div class="span-12">
                <PlacePicker
                  id="training-place"
                  bind:venueId={form.venueId}
                  bind:name={form.venue}
                  bind:mapUrl={form.mapUrl}
                  placeholder="e.g. The rink"
                />
              </div>
            </div>
          {:else}
            <div class="sessions">
              {#if upcoming.length}
                <!-- The coming sessions as a grid, as Gwenda ops lays out a series' nights -->
                <section class="nights">
                  <div class="nights-head">
                    <h2>Upcoming sessions</h2>
                    <span class="pager" role="group" aria-label="Weeks">
                      <button
                        type="button"
                        class="btn ghost icon"
                        aria-label="12 weeks before"
                        disabled={page === 0}
                        onclick={() => page--}
                      >
                        <Icon name="chevronLeft" size={18} />
                      </button>
                      <span class="range num" aria-live="polite">{range}</span>
                      <button
                        type="button"
                        class="btn ghost icon"
                        aria-label="12 weeks after"
                        disabled={fetching || addDays(pageStart, PAGE_DAYS) > addDays(londonToday(), 2 * 365)}
                        onclick={nextPage}
                      >
                        <Icon name="chevronRight" size={18} />
                      </button>
                    </span>
                  </div>
                  <div class="nights-grid">
                    {#each shown as session (session.id)}
                      {@const r = resolve(session)}
                      <div class="night" class:off={r.cancelled}>
                        <span class="when">{formatDayDate(londonISO(r.heldOn, r.startTime))}</span>
                        <button type="button" class="act" onclick={() => toggleCancel(session.id)}>
                          {r.cancelled ? "Restore" : "Cancel"}
                        </button>
                        <span class="sub num">{clock(r.startTime)}–{clock(r.endTime)}</span>
                        <span class="sub">{r.cancelled ? "Cancelled" : `${session.going.length} in`}</span>
                      </div>
                    {/each}
                  </div>
                  <p class="hint">Cancelling keeps the session, so whoever signed up can be told.</p>
                </section>
              {/if}
              {#if seesDues && held.length}
                <section class="nights">
                  <h2>Held</h2>
                  <div class="nights-grid">
                    {#each held as session (session.id)}
                      {@const c = collectedFor("session", session.id)}
                      <div class="night">
                        <span class="when"
                          >{formatDayDate(londonISO(session.heldOn, session.startTime ?? form.startTime))}</span
                        >
                        <span class="collected num" class:short={c.paid < c.due}>
                          <strong>{pounds(c.paid)}</strong> / {pounds(c.due)}
                        </span>
                        <span class="sub num">{session.going.length - (session.noShows?.length ?? 0)} came</span>
                        <span class="sub num">
                          {c.paidPeople} of {c.people} paid · {pounds(session.feePence ?? 0)} each
                        </span>
                      </div>
                    {/each}
                  </div>
                  <p class="hint">
                    What each session collected against what it was due. Mark payments on a member's profile.
                  </p>
                </section>
              {/if}
              {#if !upcoming.length && !held.length}
                <p class="hint">No sessions yet. Set when it runs under Schedule, then save.</p>
              {/if}
            </div>
          {/if}
        </div>
      {/key}
    </form>
  {/if}
</div>

<style>
  .nights {
    display: grid;
    gap: var(--s-3);
  }
  .nights h2 {
    padding-bottom: var(--s-3);
    border-bottom: 1px solid var(--border);
    color: var(--fg);
    font-size: var(--text-md);
    font-weight: 600;
  }
  .nights-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
    gap: 0 var(--s-6);
  }
  /* One session: the date, its time and how many are in; Cancel or Restore on the right */
  .night {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.125rem var(--s-3);
    padding-block: var(--s-3);
    border-bottom: 1px solid var(--border);
  }
  .night .sub {
    grid-column: 1;
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  .when {
    grid-column: 1;
    color: var(--fg);
    font-weight: 600;
  }
  .night.off .when {
    color: var(--fg-muted);
    text-decoration: line-through;
  }
  .act {
    grid-column: 2;
    grid-row: 1 / span 2;
    align-self: center;
    padding: 0;
    border: 0;
    background: none;
    /* The training's own colour (the panel carries it), like Gwenda's accent links */
    color: var(--tone, var(--caution));
    font: inherit;
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
  }
  .act:hover {
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }
  /* The tabs, then the tab showing. Its grid answers to the panel's width, not the screen's */
  .editor {
    display: grid;
    gap: var(--s-5);
    container-type: inline-size;
  }
  /* Twelve columns, as Gwenda's Build tab: fields span 3, 4, 8 or 12 */
  .grid {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: var(--s-5) var(--s-4);
  }
  .span-3 {
    grid-column: span 3;
  }
  .span-4 {
    grid-column: span 4;
  }
  .span-8 {
    grid-column: span 8;
  }
  .span-12 {
    grid-column: 1 / -1;
  }
  /* Narrower: fours become twos, and name and short name stack */
  @container (max-width: 44rem) {
    .span-3 {
      grid-column: span 6;
    }
    .span-4,
    .span-8 {
      grid-column: 1 / -1;
    }
  }
  /* Icon and colour on one line while they fit */
  .style {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-5) var(--s-8);
  }
  .sessions {
    display: grid;
    gap: var(--s-6);
  }
  .night .collected {
    grid-column: 2;
    grid-row: 1 / span 2;
    align-self: center;
    font-size: var(--text-sm);
  }
  .nights-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
    padding-bottom: var(--s-2);
    border-bottom: 1px solid var(--border);
  }
  .nights-head h2 {
    padding: 0;
    border: 0;
  }
  .pager {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
  }
  /* Wide enough for any range, so the arrows never move */
  .range {
    min-width: 9.5rem;
    color: var(--fg);
    font-size: var(--text-sm);
    font-weight: 600;
    text-align: center;
  }
  /* Running and the website, side by side at the top */
  .checks {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2) var(--s-5);
  }
  .collected {
    color: var(--fg-muted);
    white-space: nowrap;
  }
  .collected strong {
    color: var(--green);
    font-weight: 600;
  }
  .collected.short strong {
    color: var(--fg);
  }
  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
  }
  legend {
    padding: 0;
    margin-bottom: var(--s-2);
  }
  /* Every 1 week on Mon … Sun, on one line while it fits */
  .repeat {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2);
    color: var(--fg-body);
  }
  .every {
    width: 4.5rem;
    text-align: center;
  }
  .days {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1);
    margin-left: var(--s-2);
  }
  /* Filled tiles, as the icon picker's: lit in the training's colour when on */
  .day {
    min-width: 3rem;
    height: 2.25rem;
    border: 0;
    border-radius: var(--r-sm);
    background: var(--surface-2);
    color: var(--fg-muted);
    font-size: var(--text-sm);
    font-weight: 500;
    transition:
      background-color var(--t-fast) var(--ease-in-out),
      color var(--t-fast) var(--ease-in-out);
  }
  .day:hover {
    background: var(--surface-3);
    color: var(--fg);
  }
  .day[aria-pressed="true"] {
    background: color-mix(in srgb, var(--tone, var(--fg)) 24%, var(--surface-2));
    color: var(--fg);
  }
  /* Tucked under the fields it explains */
  .tuck {
    display: grid;
    gap: var(--s-1);
    margin-top: calc(-1 * var(--s-3));
  }
</style>
