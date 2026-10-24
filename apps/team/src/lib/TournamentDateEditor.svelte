<script lang="ts" module>
  import { goesBy } from "./names";

  /** A sheet the editor's rows open: a team's or an award's, by its place in the list. */
  export type EditorSheet = { team: number } | { award: number };
  /** Its tabs, in the order they're set: the tournament, sign-up, its teams, then how it's played. */
  export type EditorTab = "details" | "signup" | "teams" | "rules";
</script>

<script lang="ts">
  // One tournament's editor, in the panel its card opens (Settings → Tournaments): what an admin comes here
  // for. When and where it is, sign-up, its teams (ADR 0030): teams that entered, or a draft's captains (in no order:
  // it's drawn as the draft opens) and the draft night, and its rules and awards, on tabs as the training editor lays
  // out its fields. The tabs are the wizard's steps, by the same names, and each group of fields is the one the wizard
  // shows (lib/Tournament*Fields), so scheduling one and editing it read as one form (#163). Picking a series copies
  // its defaults in (ADR 0030); they can then change for this one. The series' look (icon, colour) stays the series'.
  // Not here: its stage (Coming up, Sign-up open, …), moved on from its own page (Manage, ADR 0074), and a team's
  // name and logo, edited on the team's page (Edit the team).
  import { tick } from "svelte";
  import { cancelClashes, createTournament, updateTournament } from "../app/backend.svelte";
  import ClashSheet from "./ClashSheet.svelte";
  import { tournamentWindow } from "./clashes";
  import type { TournamentTeam } from "../demo/model";
  import { db } from "../demo/store.svelte";
  import { readCollected, type Collected } from "../app/ledger.svelte";
  import { reportUnexpected } from "../app/errors.early";
  import Icon from "../app/shell/Icon.svelte";
  import { teamsForPlayoffs } from "./fixtures";
  import Select from "./Select.svelte";
  import FormSection from "./FormSection.svelte";
  import TeamsField from "./TeamsField.svelte";
  import TournamentWhatFields from "./TournamentWhatFields.svelte";
  import TournamentWhenFields from "./TournamentWhenFields.svelte";
  import TournamentVenueFields from "./TournamentVenueFields.svelte";
  import TournamentSignupFields from "./TournamentSignupFields.svelte";
  import TournamentDraftDay from "./TournamentDraftDay.svelte";
  import TournamentRulesFields from "./TournamentRulesFields.svelte";
  import { broughtTeams, type BroughtTeam } from "./brought-team";
  import { navigate } from "../app/router.svelte";
  import { teamHref } from "./team-tones";
  import { seriesToOpen } from "../pages/TournamentSeries.svelte";
  import type { Edits } from "./dirty.svelte";
  import { blankForm, formDay, formOf, toTournament, withSeries, type TournamentForm } from "./tournament-form";

  let {
    dateId,
    typeId,
    startTab = "details",
    edits,
    oncreated,
    leave,
    sheet = $bindable(null),
  }: {
    dateId?: number;
    /** A new date in this series, its defaults copied in (from the series' own page) */
    typeId?: number;
    /** The tab it opens on: "teams" to add the captains */
    startTab?: EditorTab;
    /** Its unsaved changes and saves, for the panel's footer and its way out (lib/dirty.svelte.ts) */
    edits?: Edits;
    oncreated?: (id: number) => void;
    /** Off to another page (a team's, to edit it there): the panel closes first, asking if anything's unsaved. */
    leave?: (path: string) => void;
    /** The row's sheet open over the editor, if any: a team or an award, by its place in the list. One value, so a
     *  page address could open it. */
    sheet?: EditorSheet | null;
  } = $props();

  // The panel mounts a fresh editor for each date, so the form takes its starting values once
  const starting = (): TournamentForm => {
    const t = dateId ? db.tournaments.find((x) => x.id === dateId) : undefined;
    return t ? formOf($state.snapshot(t)) : blankForm();
  };
  let date = $state<TournamentForm>(starting());

  const type = $derived(db.tournamentTypes.find((t) => t.id === date.typeId));
  /** Already charged: the fee is fixed. */
  // What it's collected, read from the server (#177): how many were charged fixes its fee; the money, for who sees dues
  let collected = $state<Collected | null>(null);
  $effect(() => {
    void db.dues;
    const id = date.id;
    if (!id) return void (collected = null);
    readCollected({ tournaments: [id] })
      .then((r) => (collected = r.tournaments[0] ?? null))
      .catch((e) => reportUnexpected(e, "Couldn't read what it collected"));
  });
  const charged = $derived((collected?.people ?? 0) > 0);

  function pickType(id: string) {
    const t = db.tournamentTypes.find((x) => x.id === Number(id));
    if (t) withSeries(date, t, { charged });
    else date.typeId = null;
  }

  // Started from a series' page: in that series from the off (the panel mounts a fresh editor for each, as above)
  // svelte-ignore state_referenced_locally
  if (!dateId && typeId) pickType(String(typeId));
  // What it starts as is what's saved: changes from here are unsaved until Save
  // svelte-ignore state_referenced_locally
  edits?.watch(() => date, { fresh: !dateId });

  /** Off to the series' own page, its defaults open. */
  function editSeries() {
    if (!type) return;
    seriesToOpen.id = type.id;
    navigate("/settings/tournament-series");
  }
  // The running series, and this one's even if it's paused
  const seriesOptions = $derived([
    { value: "", label: "No series" },
    ...db.tournamentTypes
      .filter((t) => t.active || t.id === date.typeId)
      .map((t) => ({ value: String(t.id), label: t.name })),
  ]);

  const members = $derived(
    db.members.filter((m) => m.status === "active").sort((a, b) => goesBy(a.player).localeCompare(goesBy(b.player))),
  );
  // A draft's captains bring their team from the series' last edition they captained in (brought-team.ts)
  const edition = $derived({ id: date.id || undefined, typeId: date.typeId, heldOn: formDay(date) });
  // ...read from the server (#177), for a draft in a series, again as its series or day changes
  let brought = $state<Record<number, BroughtTeam>>({});
  $effect(() => {
    const wanted = { ...edition };
    if (date.kind !== "draft" || wanted.typeId == null) return;
    broughtTeams(wanted)
      .then((m) => (brought = m))
      .catch((e) => reportUnexpected(e, "Couldn't read what the captains bring"));
  });
  const memberList = $derived(
    members.map((m) => ({
      id: m.player.id,
      name: goesBy(m.player),
      brings: date.kind === "draft" ? (brought[m.player.id] ?? null) : null,
    })),
  );

  const stored = $derived(dateId ? db.tournaments.find((x) => x.id === dateId) : undefined);
  // Its type is how its teams are made: once it has any saved, it stays (the server says so too)
  const kindFixed = $derived((stored?.teams.length ?? 0) > 0);
  const drawn = $derived(stored?.draftState === "open" || stored?.draftState === "closed");

  // Four tabs, in the order they're set: the tournament itself, sign-up, its teams (and a draft's night), then how
  // it's played (a series' edition copies its rules and awards, so they're rarely changed). Shorter on a phone, so all
  // four fit, and those are the wizard's steps; the full name is still what a screen reader hears
  type Tab = EditorTab;
  // svelte-ignore state_referenced_locally
  let tab = $state<Tab>(startTab);
  const tabs = $derived<{ id: Tab; label: string; short: string }[]>([
    { id: "details", label: "Details", short: "Details" },
    { id: "signup", label: "Sign-up", short: "Sign-up" },
    { id: "teams", label: date.kind === "draft" ? "Draft & teams" : "Teams", short: "Teams" },
    { id: "rules", label: "Rules & awards", short: "Rules" },
  ]);
  let formEl = $state<HTMLFormElement | undefined>();

  /** Save from another tab with something missing: go to its tab and say what. */
  async function showMissing(on: Tab) {
    tab = on;
    await tick();
    formEl?.reportValidity();
  }

  /** A saved team's own page, in a series (a tournament on its own has no pages): its name and logo are edited there. */
  const teamPage = (team: TournamentTeam) => (type && team.id ? teamHref(type.slug, team.id) : null);

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!date.name) return showMissing("details");
    // A team that entered needs a name: its sheet opens on it
    const unnamed = date.kind === "teams" ? date.teams.findIndex((t) => !t.name.trim()) : -1;
    if (unnamed >= 0) return void ((tab = "teams"), (sheet = { team: unnamed }));
    const t = toTournament(date, stored?.status);
    // Over something already on (Friday Training)? Asked first; closing the question saves nothing (ADR 0122)
    const window = tournamentWindow(t, stored);
    const chosen = window ? await clashSheet?.ask(window, t.name) : [];
    if (chosen === null) return;
    if (date.id) {
      if ((await (edits ? edits.run(() => updateTournament(t)) : updateTournament(t))) !== null)
        await cancelClashes(chosen ?? []);
      return;
    }
    const created = await (edits ? edits.run(() => createTournament(t)) : createTournament(t));
    if (!created) return;
    await cancelClashes(chosen ?? []);
    // The blank form gives way to the new date's editor, in the same panel
    oncreated?.(created.id);
  }
  let clashSheet = $state<ClashSheet | undefined>();
</script>

<div class="editor">
  <div class="tablist" role="tablist" aria-label="Tournament date">
    {#each tabs as t (t.id)}
      <button
        type="button"
        role="tab"
        id="date-tab-{t.id}"
        aria-selected={tab === t.id}
        aria-controls="date-panel"
        aria-label={t.label}
        onclick={() => (tab = t.id)}
      >
        <span class="long">{t.label}</span><span class="short" aria-hidden="true">{t.short}</span>
      </button>
    {/each}
  </div>
  <!-- Saved from the panel's footer (form="date-form"), whichever tab is showing -->
  <form class="form" id="date-form" onsubmit={save} bind:this={formEl}>
    {#key tab}
      <div class="panel-tab rise" id="date-panel" role="tabpanel" aria-labelledby="date-tab-{tab}">
        {#if tab === "details"}
          <TournamentWhatFields
            bind:form={date}
            id="date"
            {kindFixed}
            placeholder="e.g. Winter {type?.shortName ?? 'Cup'}"
          >
            {#snippet series()}
              <div class="field">
                <span>Series <span class="hint">· optional</span></span>
                <Select
                  id="date-type"
                  value={date.typeId ? String(date.typeId) : ""}
                  onchange={pickType}
                  options={seriesOptions}
                  aria-label="Series"
                />
                <span class="hint small">
                  {#if type}
                    Its fee, location, rules and awards were copied from the series; change them here for this one.
                    <button type="button" class="link" onclick={editSeries}>Edit the series' defaults</button>
                  {:else}
                    One on its own, or choose a series to copy in its rules, awards, location and fee.
                  {/if}
                </span>
              </div>
            {/snippet}
          </TournamentWhatFields>
          <TournamentWhenFields bind:form={date} id="date" />
          <TournamentVenueFields bind:form={date} id="date" {type} />
        {:else if tab === "rules"}
          <TournamentRulesFields
            bind:form={date}
            bind:award={
              () => (sheet && "award" in sheet ? sheet.award : null), (i) => (sheet = i === null ? null : { award: i })
            }
          />
        {:else if tab === "signup"}
          <TournamentSignupFields bind:form={date} id="date" {charged} {collected} />
        {:else}
          {#if date.kind === "draft"}
            <TournamentDraftDay bind:form={date} id="date" />
          {/if}
          <FormSection
            title={date.kind === "draft" ? "Captains" : "Teams"}
            description={date.kind === "draft"
              ? "Any order: the draft draws who picks first."
              : "Each team that's entered: its name, captain and players. Once it's saved, its name and logo change on its page."}
            stacked={date.kind === "draft"}
          >
            <TeamsField
              bind:teams={date.teams}
              kind={date.kind}
              {drawn}
              members={memberList}
              pageOf={teamPage}
              ongo={leave}
              bind:open={
                () => (sheet && "team" in sheet ? sheet.team : null), (i) => (sheet = i === null ? null : { team: i })
              }
            />
            {#if date.teams.length && date.teams.length < teamsForPlayoffs(date.playoffs)}
              <p class="hint warn">
                <Icon name="alert" size={16} />The playoffs need {teamsForPlayoffs(date.playoffs)} teams: add {date.kind ===
                "draft"
                  ? "captains"
                  : "teams"}, or choose fewer playoffs on Rules &amp; awards.
              </p>
            {/if}
          </FormSection>
        {/if}
      </div>
    {/key}
  </form>
  <ClashSheet bind:this={clashSheet} />
</div>

<style>
  /* The tabs, then the tab showing. Its grid answers to the panel's width, not the screen's */
  .editor {
    display: grid;
    gap: var(--s-5);
    container-type: inline-size;
  }
  /* A tab's name: in full, or shorter where four in full don't fit (a phone) */
  .tablist .short {
    display: none;
  }
  @container (max-width: 34rem) {
    .tablist .long {
      display: none;
    }
    .tablist .short {
      display: inline;
    }
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
</style>
