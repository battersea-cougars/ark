<script lang="ts" module>
  import { londonToday } from "./dates";
  import { seasonEnd, type Season } from "@cougars/shared/seasons";
  /**
   * What the quick form asks: the season, the day if it's known, the hours, when sign-up opens, the draft's day, the
   * captains in pick order.
   */
  export interface QuickValues {
    season: Season;
    seasonYear: number;
    /** Empty: just the season (ADR 0030) */
    heldOn: string;
    startTime: string;
    endTime: string;
    signupOpensOn: string;
    draftOn: string;
    captains: number[];
  }
  /** A new one's answers: next summer, its series' usual hours (ADR 0074), sign-up opening today. */
  export function blankQuick(series?: { defaultStartTime: string; defaultEndTime: string }): QuickValues {
    const year = Number(londonToday().slice(0, 4));
    return {
      season: "summer",
      seasonYear: londonToday() <= seasonEnd("summer", year) ? year : year + 1,
      heldOn: "",
      startTime: series?.defaultStartTime ?? "11:00",
      endTime: series?.defaultEndTime ?? "16:00",
      signupOpensOn: londonToday(),
      draftOn: "",
      captains: [],
    };
  }
</script>

<script lang="ts">
  // The next date in a series, as a wizard (ADR 0074, lib/Wizard ADR 0117): When (its season, its day once that's
  // known, its hours, the series' usual ones filled in), Sign-up (when it opens, and the draft's day), Captains (a
  // draft series only, in pick order, with the whole step to find them in), then Check, a look over it with a way
  // back to each answer, and Schedule it. Only the season is needed, so every step is open from the start; the draft's
  // day shows as TBC and the captains as "to be named" until they're set. The rest (place, fee, rules, awards) comes
  // from the series; Advanced opens the full editor with these filled in.
  import TimeSelect from "./TimeSelect.svelte";
  import DateField from "../lib/DateField.svelte";
  import { createTournament, saving } from "../app/backend.svelte";
  import type { Tournament, TournamentType } from "../demo/model";
  import { db } from "../demo/store.svelte";
  import { typePlace } from "../demo/schedule.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import { teamsForPlayoffs } from "./fixtures";
  import { goesBy } from "./names";
  import { clock, formatDayDate, londonISO, pounds } from "./dates";
  import Select from "./Select.svelte";
  import SearchField from "./SearchField.svelte";
  import Wizard from "./Wizard.svelte";
  import { reachableStep } from "./wizard";
  import { quickDay, quickProblem, quickSteps } from "./quick-create";
  import { findPeople } from "./person-search";
  import { seasonLabel, seasonOf, seasonsFrom } from "@cougars/shared/seasons";

  let {
    type,
    values = $bindable(),
    oncreated,
    onadvanced,
    close,
  }: {
    type: TournamentType;
    values: QuickValues;
    oncreated: (id: number) => void;
    /** The full editor, with these answers filled in. */
    onadvanced: () => void;
    /** Cancel. */
    close: () => void;
  } = $props();

  const draft = $derived(type.kind === "draft");
  const place = $derived(typePlace(type)?.name);
  const members = $derived(
    db.members
      .filter((m) => m.status === "active")
      .map((m) => ({ id: m.player.id, name: goesBy(m.player) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
  const nameOf = (id: number) => members.find((m) => m.id === id)?.name ?? "";

  // The steps, how far on it can go, and what stops the one in view
  const steps = $derived(quickSteps(draft));
  let step = $state(0);
  const problems = $derived(steps.map((s) => quickProblem(s, values, draft)));
  const reachable = $derived(reachableStep(problems.map((p) => !p)));
  let creating = $state(false);
  let failed = $state("");
  const problem = $derived(failed || problems[step] || "");

  // "Summer 2027": this season and the next few (as the full editor offers)
  const seasonOptions = $derived(
    seasonsFrom(londonToday(), 4).map(({ season, year }) => ({
      value: `${season} ${year}`,
      label: seasonLabel(season, seasonEnd(season, year)),
    })),
  );
  const day = $derived(quickDay(values));
  // A day sets its season; a season the day isn't in clears the day
  function pickDay(d: string) {
    values.heldOn = d;
    if (d) ({ season: values.season, year: values.seasonYear } = seasonOf(d));
  }
  function pickSeason(v: string) {
    const [season, year] = v.split(" ");
    values.season = season as Season;
    values.seasonYear = Number(year);
    if (values.heldOn) {
      const s = seasonOf(values.heldOn);
      if (s.season !== values.season || s.year !== values.seasonYear) values.heldOn = "";
    }
  }

  // Captains: typed for, the matches fill the step; a pick goes on the end of the order and the search empties
  let query = $state("");
  const found = $derived(
    findPeople(
      members.filter((m) => !values.captains.includes(m.id)),
      query,
    ),
  );
  const playoffTeams = $derived(teamsForPlayoffs(type.playoffs ?? []));
  function addCaptain(id: number) {
    values.captains.push(id);
    query = "";
  }
  function moveUp(i: number) {
    const [id] = values.captains.splice(i, 1);
    values.captains.splice(i - 1, 0, id);
  }
  function findKey(e: KeyboardEvent) {
    if (e.key === "Enter") {
      // Picks the first match; never goes on to the next step
      e.preventDefault();
      if (query.trim() && found[0]) addCaptain(found[0].id);
    } else if (e.key === "Escape" && query) {
      // Empties the search, not the sheet
      e.preventDefault();
      query = "";
    }
  }

  // How each answer reads on Check
  const dayText = (d: string) => `${formatDayDate(londonISO(d, "12:00"))} ${d.slice(0, 4)}`;
  const whenText = $derived(
    values.heldOn ? dayText(values.heldOn) : `${seasonLabel(values.season, day)}, day to be confirmed`,
  );

  async function create() {
    failed = "";
    creating = true;
    const t: Tournament = {
      id: 0,
      typeId: type.id,
      name: type.name,
      // None set: the series' place
      venueId: null,
      location: "",
      mapUrl: "",
      heldOn: day,
      season: values.heldOn ? null : values.season,
      startTime: values.startTime,
      endTime: values.endTime,
      capacity: 24,
      status: "planned",
      feePence: type.defaultFeePence,
      public: true,
      signupOpensOn: values.signupOpensOn || null,
      signupClosesOn: null,
      draftOn: draft && values.draftOn ? values.draftOn : null,
      pointsWin: type.pointsWin,
      pointsDraw: type.pointsDraw,
      pointsLoss: type.pointsLoss,
      gameMinutes: type.gameMinutes,
      kind: type.kind,
      awards: type.awards.map((a) => ({ ...a })),
      playoffs: (type.playoffs ?? []).map((g) => ({ ...g })),
      teams: values.captains.map((captainMemberId) => ({
        name: "",
        logo: null,
        captainMemberId,
        captainName: "",
        contact: "",
        players: [],
      })),
      going: [],
      waitlist: [],
    };
    const created = await createTournament(t);
    creating = false;
    if (created) oncreated(created.id);
    else failed = saving.message || "Couldn't schedule it. Try again?";
  }
</script>

<Wizard
  {steps}
  bind:step
  {reachable}
  {problem}
  ready="It goes on the {type.shortName}'s page and the calendar."
  working={creating ? "Scheduling…" : ""}
  {close}
>
  {#snippet children(name)}
    {#if name === "When"}
      <section class="q">
        <h3 class="section-title">When is it?</h3>
        <div class="fields">
          <div class="field">
            Season <Select
              id="quick-season"
              value={`${values.season} ${values.seasonYear}`}
              onchange={pickSeason}
              options={seasonOptions}
              aria-label="Season"
            />
          </div>
          <div class="field">
            <span>Day <span class="opt">· optional</span></span>
            <DateField
              id="quick-day"
              aria-label="Day"
              placeholder="Not set: just the season"
              min={londonToday()}
              bind:value={() => values.heldOn, (v) => pickDay(v)}
              aria-describedby="quick-day-hint"
            />
          </div>
        </div>
        <p class="hint" id="quick-day-hint">Not fixed yet? Leave the day: it shows as the season, date TBC.</p>
      </section>
      <section class="q">
        <h3 class="section-title">What time?</h3>
        <div class="fields">
          <div class="field time">
            Starts <TimeSelect id="quick-start" bind:value={values.startTime} aria-label="Starts" />
          </div>
          <div class="field time">
            Ends <TimeSelect id="quick-end" bind:value={values.endTime} aria-label="Ends" />
          </div>
        </div>
        <p class="hint">
          The {type.shortName}'s usual hours{place ? `, at ${place}` : ""}{type.defaultFeePence
            ? ` · ${pounds(type.defaultFeePence)}`
            : ""}. Change them for this one here, or the usual ones in the series' settings.
        </p>
      </section>
    {:else if name === "Sign-up"}
      <section class="q">
        <h3 class="section-title">When does sign-up open?</h3>
        <div class="fields">
          <div class="field">
            Day <DateField
              id="quick-signup"
              aria-label="Sign-up opens"
              required
              max={day}
              bind:value={values.signupOpensOn}
            />
          </div>
        </div>
        <p class="hint">Members can say they're in from then. Today, unless you'd rather wait.</p>
      </section>
      {#if draft}
        <section class="q">
          <h3 class="section-title">When's the draft? <span class="opt">· optional</span></h3>
          <div class="fields">
            <div class="field">
              Day <DateField
                id="quick-draft"
                aria-label="Draft day"
                placeholder="TBC"
                min={londonToday()}
                max={day}
                bind:value={values.draftOn}
              />
            </div>
          </div>
          <p class="hint">
            A reminder for the captains; you tell them when it opens. Not set yet? Leave it: it shows as TBC.
          </p>
        </section>
      {/if}
    {:else if name === "Captains"}
      <!-- The whole step: the search at the top, then either the captains so far or, while typing, who matches -->
      <section class="captains-step">
        <div class="q">
          <h3 class="section-title">Who are the captains? <span class="opt">· optional</span></h3>
          <p class="hint">In pick order: the first picks first. They can be named later.</p>
        </div>
        <div class="find">
          <SearchField
            bind:value={query}
            placeholder="Add a captain: type a name…"
            label="Find a member to add as a captain"
            onkeydown={findKey}
          />
        </div>
        <div class="pane">
          {#if query.trim()}
            <ul class="rows found" aria-label="Members who match">
              {#each found as m (m.id)}
                <li>
                  <button type="button" class="row-btn" onclick={() => addCaptain(m.id)}>
                    <span class="name">{m.name}</span><span class="add"
                      ><Icon name="plus" size={16} />Captain {values.captains.length + 1}</span
                    >
                  </button>
                </li>
              {:else}
                <li class="hint none">Nobody called “{query.trim()}”.</li>
              {/each}
            </ul>
          {:else if values.captains.length}
            <ol class="rows captains" aria-label="Captains, in pick order">
              {#each values.captains as id, i (id)}
                <li>
                  <span class="pick num">{i + 1}</span>
                  <span class="name">{nameOf(id)}</span>
                  <button
                    type="button"
                    class="btn ghost sm icon"
                    aria-label="Move {nameOf(id)} up"
                    disabled={i === 0}
                    onclick={() => moveUp(i)}><Icon name="chevronUp" size={16} /></button
                  >
                  <button
                    type="button"
                    class="btn ghost sm icon"
                    aria-label="Take {nameOf(id)} off"
                    onclick={() => values.captains.splice(i, 1)}><Icon name="x" size={16} /></button
                  >
                </li>
              {/each}
            </ol>
            {#if values.captains.length < playoffTeams}
              <p class="hint warn">
                <Icon name="alert" size={16} />The {type.shortName}'s playoffs need {playoffTeams} teams: add more captains,
                or choose fewer playoffs under Advanced.
              </p>
            {/if}
          {:else}
            <p class="hint none">Captains to be named. Type a name above to add the first.</p>
          {/if}
        </div>
      </section>
    {:else}
      <section class="q">
        <h3 class="section-title">All set?</h3>
        <dl class="check">
          <div>
            <dt class="eyebrow">When</dt>
            <dd>
              {whenText}<span class="sub"
                >{clock(values.startTime)}–{clock(values.endTime)}{place ? ` · ${place}` : ""}</span
              >
            </dd>
            <button type="button" class="btn ghost sm" onclick={() => (step = 0)}>Change</button>
          </div>
          <div>
            <dt class="eyebrow">Sign-up opens</dt>
            <dd>
              {values.signupOpensOn === londonToday() ? "Today" : dayText(values.signupOpensOn)}
              {#if draft}<span class="sub">Draft: {values.draftOn ? dayText(values.draftOn) : "TBC"}</span>{/if}
            </dd>
            <button type="button" class="btn ghost sm" onclick={() => (step = 1)}>Change</button>
          </div>
          {#if draft}
            <div>
              <dt class="eyebrow">Captains</dt>
              <dd>
                {#if values.captains.length}
                  {values.captains.map((id, i) => `${i + 1}. ${nameOf(id)}`).join(" · ")}
                {:else}
                  To be named
                {/if}
              </dd>
              <button type="button" class="btn ghost sm" onclick={() => (step = 2)}>Change</button>
            </div>
          {/if}
        </dl>
        <p class="hint">
          {type.defaultFeePence ? `${pounds(type.defaultFeePence)} · ` : ""}Rules, awards and playoffs as usual.
        </p>
      </section>
    {/if}
  {/snippet}
  {#snippet extra()}
    <button type="button" class="btn ghost sm advanced" disabled={creating} onclick={onadvanced}
      >Advanced<Icon name="chevronRight" size={16} /></button
    >
  {/snippet}
  {#snippet finish()}
    <button
      type="button"
      class="btn primary"
      disabled={creating || saving.busy > 0 || !!problems.some((p) => p)}
      onclick={create}>Schedule it</button
    >
  {/snippet}
</Wizard>

<style>
  .q {
    display: grid;
    gap: var(--s-3);
  }
  .section-title {
    margin: 0;
  }
  .opt {
    color: var(--fg-muted);
    font-family: var(--font);
    font-size: var(--text-sm);
    font-style: normal;
    letter-spacing: 0;
    text-transform: none;
  }
  .fields {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--s-3) var(--s-4);
  }
  .fields .field {
    flex: 0 1 12rem;
  }
  .fields .field.time {
    flex-basis: 8rem;
  }
  .hint {
    margin: 0;
  }

  /* Captains: the step's whole height. The search stays at the top; under it, one pane the same size whatever's in
     it, scrolling on its own */
  .captains-step {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--s-4);
    min-height: 0;
  }
  .find :global(.search) {
    width: 100%;
  }
  .pane {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--s-3);
    min-height: 12rem;
    margin: 0 calc(-1 * var(--s-2));
    padding: 0 var(--s-2);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .rows {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .captains li,
  .row-btn {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 3rem;
    padding: 0 var(--s-2) 0 var(--s-3);
    border-radius: var(--r-md);
    background: var(--surface-2);
  }
  .row-btn {
    width: 100%;
    border: 0;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    background: transparent;
    transition: background-color var(--t-fast) var(--ease-in-out);
  }
  .row-btn:hover,
  .row-btn:focus-visible {
    background: var(--surface-2);
  }
  .add {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  .row-btn:hover .add,
  .row-btn:focus-visible .add {
    color: var(--fg);
  }
  .pick {
    width: 1.5rem;
    color: var(--red-hot);
    font-family: var(--font-display);
    font-size: 1.15rem;
    text-align: center;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--fg);
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .none {
    padding: var(--s-3);
  }

  /* Check: each answer on a line of its own, set apart by space, a way back to it on the right */
  .check {
    display: grid;
    gap: var(--s-5);
    margin: 0;
  }
  .check > div {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--s-1) var(--s-3);
  }
  .check dt {
    grid-column: 1;
  }
  .check dd {
    display: grid;
    grid-column: 1;
    gap: 2px;
    margin: 0;
    color: var(--fg);
    font-weight: 500;
  }
  .check .sub {
    color: var(--fg-muted);
    font-size: var(--text-sm);
    font-weight: 400;
  }
  .check .btn {
    grid-column: 2;
    grid-row: 1 / span 2;
  }
  .advanced {
    flex-shrink: 0;
  }
</style>
