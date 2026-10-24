<script lang="ts">
  // The next date in a series, as a wizard (ADR 0128, lib/Wizard ADR 0117), its steps the full editor's tabs by the
  // same names and its fields the editor's own (lib/Tournament*Fields, #163): Details (its season, its day once that's
  // known, its hours, the series' usual ones filled in), Sign-up (when it opens), Teams (a draft series only: the
  // draft's day, and the captains, a set whose pick order the draft draws, with the whole step to find them in), then
  // Check, a look over it with a way back to each answer, and Schedule it. Only the season is needed, so every step is
  // open from the start; the draft's day shows as TBC and the captains as "to be named" until they're set.
  //
  // Advanced is a mode of the same wizard, not another form: each step shows the rest of its fields in place (Details:
  // the venue and afterwards, the name and type; Sign-up: when it closes, the places, the fee, the website; Teams for
  // teams that enter too), and Rules & awards comes in as a step before Check. Without it, each step says in a line
  // what it takes from the series ("£10 · 24 places · change it"), and "change it" turns Advanced on at that field.
  // The series' usual values stay in the series' settings.
  import { tick } from "svelte";
  import { cancelClashes, createTournament, saving } from "../app/backend.svelte";
  import ClashSheet from "./ClashSheet.svelte";
  import { tournamentWindow } from "./clashes";
  import { kindLabel, type TournamentType } from "../demo/model";
  import { db } from "../demo/store.svelte";
  import { tournamentAfter, tournamentPlace } from "../demo/schedule.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import { teamsForPlayoffs } from "./fixtures";
  import { goesBy } from "./names";
  import { clock, clockRange, formatDayDate, londonISO, londonToday, pounds } from "./dates";
  import Person from "./Person.svelte";
  import Wizard from "./Wizard.svelte";
  import FormSection from "./FormSection.svelte";
  import TeamsField from "./TeamsField.svelte";
  import TournamentWhatFields from "./TournamentWhatFields.svelte";
  import TournamentWhenFields from "./TournamentWhenFields.svelte";
  import TournamentVenueFields from "./TournamentVenueFields.svelte";
  import TournamentSignupFields from "./TournamentSignupFields.svelte";
  import TournamentDraftDay from "./TournamentDraftDay.svelte";
  import TournamentRulesFields from "./TournamentRulesFields.svelte";
  import { reachableStep } from "./wizard";
  import { quickProblem, quickSteps, sameStep, stepOf, type MoreField, type QuickStep } from "./quick-create";
  import { findPeople } from "./person-search";
  import { feePence, formDay, nextInSeries, toTournament, type TournamentForm } from "./tournament-form";
  import { seasonLabel } from "@cougars/shared/seasons";

  let {
    type,
    step = $bindable(0),
    advanced = $bindable(false),
    oncreated,
    close,
  }: {
    type: TournamentType;
    /** The step in view */
    step?: number;
    /** Every field, each on its step, and Rules & awards as a step of its own */
    advanced?: boolean;
    oncreated: (id: number) => void;
    /** Cancel. */
    close: () => void;
  } = $props();

  // The answers: the series' defaults as it opens, taken once (lib/tournament-form.ts nextInSeries). The panel mounts a
  // fresh wizard for each one opened; a refresh of the club's data while it's open (the series replaced) never resets them
  // svelte-ignore state_referenced_locally
  let values = $state<TournamentForm>(nextInSeries($state.snapshot(type)));

  const draft = $derived(values.kind === "draft");
  const members = $derived(
    db.members
      .filter((m) => m.status === "active")
      .map((m) => ({ id: m.player.id, name: goesBy(m.player), player: m.player }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
  const nameOf = (id: number | null) => members.find((m) => m.id === id)?.name ?? "";

  // The steps, how far on it can go, and what stops the one in view
  const steps = $derived(quickSteps(draft, advanced));
  const problems = $derived(steps.map((s) => quickProblem(s, values)));
  const reachable = $derived(reachableStep(problems.map((p) => !p)));
  const at = (name: QuickStep) => steps.indexOf(name);
  let creating = $state(false);
  let failed = $state("");
  const playoffTeams = $derived(teamsForPlayoffs(values.playoffs));
  // Too few captains for the playoffs: said at the foot of Teams, without holding it there
  const short = $derived(
    steps[step] === "Teams" && draft && values.teams.length > 0 && values.teams.length < playoffTeams
      ? `The ${type.shortName}'s playoffs need ${playoffTeams} teams: add more captains, or fewer playoffs under Advanced.`
      : "",
  );
  const problem = $derived(failed || problems[step] || short);

  /** Advanced on or off: the steps change, and the one in view stays (or it's Check, when that step has gone). */
  function setAdvanced(on: boolean) {
    const before = steps;
    advanced = on;
    step = sameStep(before, quickSteps(draft, on), step);
  }
  // Where each "change it" goes: the field, on its step, Advanced on
  const FOCUS: Record<MoreField, string> = { venue: "#quick-place", fee: "#quick-fee", rules: "" };
  async function more(field: MoreField) {
    setAdvanced(true);
    step = at(stepOf(field));
    await tick();
    const el = FOCUS[field] ? document.querySelector<HTMLElement>(FOCUS[field]) : null;
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  // What it takes from the series, said where it'd change
  const shown = $derived(toTournament(values));
  const place = $derived(tournamentPlace(shown)?.name);
  const after = $derived(tournamentAfter(shown));
  const afterText = $derived(after ? `${after.name}${after.time ? ` from ${clock(after.time)}` : ""}` : "");
  const placeText = $derived([place, afterText && `then ${afterText}`].filter(Boolean).join(", "));
  const fee = $derived(feePence(values.fee) || 0);
  const signupText = $derived(
    [
      fee ? `${pounds(fee)} to play` : "No fee",
      values.capacity ? `${values.capacity} places` : "No limit on places",
      values.public ? "on the website" : "members only",
    ].join(" · "),
  );

  // Captains: the whole club in a list the search narrows, an Add on each row; a pick shows as a chip above the
  // search. Already picked, the row says Added. They're a set: the pick order is drawn when the draft starts.
  let query = $state("");
  const found = $derived(findPeople(members, query, Infinity));
  const isCaptain = (id: number) => values.teams.some((t) => t.captainMemberId === id);
  const firstFree = $derived(found.find((m) => !isCaptain(m.id)));
  let chips = $state<HTMLElement | undefined>();
  function addCaptain(id: number) {
    if (isCaptain(id)) return;
    values.teams.push({ name: "", logo: null, captainMemberId: id, captainName: "", contact: "", players: [] });
    // The new chip into view at the end of the strip
    requestAnimationFrame(() => chips?.scrollTo({ left: chips.scrollWidth, behavior: "smooth" }));
  }
  function findKey(e: KeyboardEvent) {
    if (e.key === "Enter") {
      // Picks the first match; never goes on to the next step
      e.preventDefault();
      if (query.trim() && firstFree) {
        addCaptain(firstFree.id);
        query = "";
      }
    } else if (e.key === "Escape" && query) {
      // Empties the search, not the sheet
      e.preventDefault();
      query = "";
    }
  }
  // Teams that enter (Advanced): the editor's rows and sheets
  let teamOpen = $state<number | null>(null);
  let awardOpen = $state<number | null>(null);

  // How each answer reads on Check
  const dayText = (d: string) => `${formatDayDate(londonISO(d, "12:00"))} ${d.slice(0, 4)}`;
  const whenText = $derived(
    values.heldOn ? dayText(values.heldOn) : `${seasonLabel(values.season, formDay(values))}, day to be confirmed`,
  );
  const closesText = $derived(values.signupClosesOn ? `, closes ${dayText(values.signupClosesOn)}` : "");
  const rulesText = $derived(
    [
      `${values.pointsWin}–${values.pointsDraw}–${values.pointsLoss} points`,
      `${values.periods > 1 ? `${values.periods} × ` : ""}${values.gameMinutes} min`,
      values.playoffs.length ? values.playoffs.map((g) => g.name).join(", ") : "no playoffs",
      `${values.awards.filter((a) => a.name.trim()).length} awards`,
    ].join(" · "),
  );

  async function create() {
    failed = "";
    creating = true;
    const t = toTournament(values);
    // Over something already on (Friday Training)? Asked first; closing the question schedules nothing (ADR 0122)
    const window = tournamentWindow(t);
    const chosen = window ? await clashSheet?.ask(window, t.name) : [];
    if (chosen === null) return void (creating = false);
    const created = await createTournament(t);
    if (created) await cancelClashes(chosen ?? []);
    creating = false;
    if (created) oncreated(created.id);
    else failed = saving.message || "Couldn't schedule it. Try again?";
  }
  let clashSheet = $state<ClashSheet | undefined>();
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
    {#if name === "Details"}
      <TournamentWhenFields bind:form={values} id="quick" future />
      {#if advanced}
        <TournamentVenueFields bind:form={values} id="quick" {type} />
        <TournamentWhatFields bind:form={values} id="quick" placeholder={type.name} />
      {:else}
        {@render usual(placeText || "No place set", "venue")}
      {/if}
    {:else if name === "Sign-up"}
      <TournamentSignupFields bind:form={values} id="quick" more={advanced} required />
      {#if !advanced}
        {@render usual(signupText, "fee")}
      {/if}
    {:else if name === "Teams" && !draft}
      <FormSection
        title="Teams"
        description="Each team that's entered: its name, captain and players. Or leave it: teams can enter later."
      >
        <TeamsField
          bind:teams={values.teams}
          kind="teams"
          drawn={false}
          members={members.map(({ id, name }) => ({ id, name }))}
          bind:open={teamOpen}
        />
      </FormSection>
    {:else if name === "Teams"}
      <TournamentDraftDay bind:form={values} id="quick" future />
      <!-- The rest of the step: the captains so far as chips and the search stay put; the club's list scrolls under them -->
      <section class="captains-step" aria-labelledby="quick-captains">
        <h2 class="captains-title" id="quick-captains">Captains <span class="opt">· optional</span></h2>
        <!-- One line, the same height however many: it scrolls sideways rather than pushing the list down -->
        <ul class="chips" bind:this={chips} aria-label="Captains">
          {#each values.teams as team, i (team.captainMemberId)}
            <li class="chip">
              <span class="chip-name">{nameOf(team.captainMemberId)}</span>
              <button
                type="button"
                class="chip-btn"
                aria-label="Take {nameOf(team.captainMemberId)} off"
                onclick={() => values.teams.splice(i, 1)}><Icon name="x" size={14} /></button
              >
            </li>
          {:else}
            <li class="hint none">None yet: any order, the draft draws who picks first.</li>
          {/each}
        </ul>
        <label class="search">
          <Icon name="search" size={18} />
          <input
            class="input"
            type="search"
            placeholder="Find a player"
            aria-label="Find a player to add as a captain"
            bind:value={query}
            onkeydown={findKey}
          />
        </label>
        <div class="pane">
          {#if found.length}
            <div class="list tight" aria-label="Members">
              {#each found as m (m.id)}
                {@const added = isCaptain(m.id)}
                <button
                  type="button"
                  class="row"
                  aria-label={added ? `${m.name}, added` : `Add ${m.name} as a captain`}
                  disabled={added}
                  onclick={() => addCaptain(m.id)}
                >
                  <Person player={m.player} bare />
                  <span class="state">
                    {#if added}<span class="badge green">Added</span>
                    {:else}<span class="badge"><Icon name="plus" size={14} /> Add</span>{/if}
                  </span>
                </button>
              {/each}
            </div>
          {:else}
            <p class="hint none">Nobody called “{query.trim()}”.</p>
          {/if}
        </div>
      </section>
    {:else if name === "Rules"}
      <TournamentRulesFields bind:form={values} bind:award={awardOpen} />
    {:else}
      <section class="q">
        <h3 class="section-title">All set?</h3>
        <dl class="check">
          <div>
            <dt class="eyebrow">When</dt>
            <dd>
              {whenText}<span class="sub"
                >{clockRange(values.startTime, values.endTime)}{placeText ? ` · ${placeText}` : ""}</span
              >
              {#if advanced}<span class="sub">{values.name} · {kindLabel(values.kind)}</span>{/if}
            </dd>
            <button type="button" class="btn ghost sm" onclick={() => (step = at("Details"))}>Change</button>
          </div>
          <div>
            <dt class="eyebrow">Sign-up opens</dt>
            <dd>
              {values.signupOpensOn === londonToday() ? "Today" : dayText(values.signupOpensOn)}{advanced
                ? closesText
                : ""}
              <span class="sub">{signupText}</span>
            </dd>
            <button type="button" class="btn ghost sm" onclick={() => (step = at("Sign-up"))}>Change</button>
          </div>
          {#if at("Teams") >= 0}
            <div>
              <dt class="eyebrow">{draft ? "Captains" : "Teams"}</dt>
              <dd>
                {#if values.teams.length}
                  {values.teams.map((t) => (draft ? nameOf(t.captainMemberId) : t.name)).join(" · ")}
                {:else}
                  {draft ? "To be named" : "None yet: they can enter later"}
                {/if}
                {#if draft}<span class="sub">Draft: {values.draftOn ? dayText(values.draftOn) : "TBC"}</span>{/if}
              </dd>
              <button type="button" class="btn ghost sm" onclick={() => (step = at("Teams"))}>Change</button>
            </div>
          {/if}
          {#if advanced}
            <div>
              <dt class="eyebrow">Rules &amp; awards</dt>
              <dd>{rulesText}</dd>
              <button type="button" class="btn ghost sm" onclick={() => (step = at("Rules"))}>Change</button>
            </div>
          {/if}
        </dl>
        {#if !advanced}
          {@render usual("Rules, playoffs and awards as the series has them", "rules", "change them")}
        {/if}
      </section>
    {/if}
  {/snippet}
  {#snippet extra()}
    <button
      type="button"
      class="switch advanced"
      role="switch"
      aria-checked={advanced}
      disabled={creating}
      onclick={() => setAdvanced(!advanced)}
    >
      <span class="track" aria-hidden="true"></span>
      <span>Advanced</span>
    </button>
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

<!-- What a step takes from the series, and the way to change it for this one: Advanced, at that field -->
{#snippet usual(text: string, field: MoreField, words = "change it")}
  <p class="hint usual">
    {text} ·
    <button type="button" class="link" onclick={() => more(field)}>{words}</button>
    <span class="where">(the usual ones are in the series' settings)</span>
  </p>
{/snippet}

<ClashSheet bind:this={clashSheet} />

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
    font-weight: 400;
    letter-spacing: 0;
    text-transform: none;
  }
  .hint {
    margin: 0;
  }
  /* The series' values, and "change it": a quiet line under the fields, where the rest would come */
  .usual {
    margin-top: calc(-1 * var(--s-3));
  }
  .usual .where {
    color: var(--fg-subtle);
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--fg);
    font: inherit;
    font-weight: 500;
    text-decoration: underline;
    text-underline-offset: 0.2em;
    cursor: pointer;
  }

  /* Captains: the rest of the step. The search stays at the top; under it, one pane the same size whatever's in
     it, scrolling on its own */
  .captains-step {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--s-4);
    min-height: 0;
  }
  /* As FormSection's heading, so it reads as the editor's Captains */
  .captains-title {
    margin: 0;
    color: var(--fg);
    font-size: var(--text-md);
    font-weight: 600;
    line-height: 1.25;
  }
  /* The captains so far: chips on one line that scrolls sideways, so the list under them never moves */
  .chips {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: var(--s-2);
    height: 2.5rem;
    margin: 0;
    padding: 0;
    overflow-x: auto;
    list-style: none;
    scrollbar-width: none;
  }
  .chip {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: var(--s-2);
    height: 2.25rem;
    padding: 0 var(--s-1) 0 var(--s-3);
    border-radius: var(--r-md);
    background: var(--surface-2);
  }
  .chip-name {
    color: var(--fg);
    font-size: var(--text-sm);
    font-weight: 500;
    white-space: nowrap;
  }
  .chip-btn {
    display: grid;
    place-items: center;
    width: 1.75rem;
    height: 1.75rem;
    padding: 0;
    border: 0;
    border-radius: var(--r-sm);
    background: none;
    color: var(--fg-muted);
    cursor: pointer;
  }
  .chip-btn:hover {
    background: color-mix(in srgb, var(--fg) 7%, transparent);
    color: var(--fg);
  }
  /* The search, as Add player's */
  .search {
    position: relative;
    display: block;
    flex-shrink: 0;
    color: var(--fg-subtle);
  }
  .search :global(svg) {
    position: absolute;
    z-index: 1;
    pointer-events: none;
    left: var(--s-4);
    top: 50%;
    translate: 0 -50%;
  }
  .search input {
    padding-left: 2.75rem;
  }
  /* The club's list: the rest of the step, scrolling on its own */
  .pane {
    flex: 1;
    min-height: 12rem;
    overflow-y: auto;
    overscroll-behavior: contain;
    border-radius: var(--r-table);
  }
  .state {
    display: inline-flex;
    flex: none;
    justify-content: flex-end;
    min-width: 5.5rem;
  }
  .row:disabled {
    cursor: default;
  }
  /* One line a member, as on Friday's list: just the name, so more of the club fits */
  .tight .row {
    min-height: 2.75rem;
    padding-block: var(--s-2);
  }
  .tight .row :global(.avatar) {
    width: 1.75rem;
    height: 1.75rem;
    font-size: 0.625rem;
  }
  .none {
    margin: 0;
    padding: var(--s-2) 0;
    white-space: nowrap;
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
