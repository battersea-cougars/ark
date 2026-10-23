<script lang="ts" module>
  import { goesBy } from "./names";
  import type { TournamentStatus } from "../demo/model";
  import type { QuickValues } from "./TournamentQuickCreate.svelte";

  export const STATUSES: { id: TournamentStatus; label: string }[] = [
    { id: "planned", label: "Coming up" },
    { id: "open", label: "Sign-up open" },
    { id: "live", label: "Live" },
    { id: "finished", label: "Finished" },
  ];
</script>

<script lang="ts">
  // One tournament's editor, in the panel its card opens (Settings → Tournaments): what an admin comes here
  // for. When and where it is, its rules and awards, sign-up, and its teams (ADR 0030): teams that entered, or a
  // draft's captains (in no order: it's drawn as the draft opens) and the draft night, on tabs as the training editor lays out its fields. Picking a series copies its defaults in (ADR 0030); they can
  // then change for this one. The series' look (icon, colour) stays the series'.
  import TimeSelect from "./TimeSelect.svelte";
  import { tick } from "svelte";
  import { cancelClashes, createTournament, updateTournament } from "../app/backend.svelte";
  import ClashSheet from "./ClashSheet.svelte";
  import { tournamentWindow } from "./clashes";
  import {
    TOURNAMENT_KINDS,
    type Playoff,
    type Tournament,
    type TournamentKind,
    type TournamentTeam,
  } from "../demo/model";
  import { db } from "../demo/store.svelte";
  import { collectedFor } from "../demo/dues.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import { teamsForPlayoffs } from "./fixtures";
  import Select from "./Select.svelte";
  import FormSection from "./FormSection.svelte";
  import PlacePicker from "./PlacePicker.svelte";
  import AfterFields from "./AfterFields.svelte";
  import type { AfterMode } from "@cougars/shared/places";
  import PersonPicker from "./PersonPicker.svelte";
  import PlayoffsField from "./PlayoffsField.svelte";
  import Choice from "./Choice.svelte";
  import { PENALTY_LENGTH_OPTIONS, PENALTY_RULE_OPTIONS, type PenaltyRule } from "./penalties";
  import { PERIOD_OPTIONS } from "./periods";
  import DateField from "../lib/DateField.svelte";
  import TeamCard from "./TeamCard.svelte";
  import { broughtTeam } from "./brought-team";
  import { typeAfter, typePlace } from "../demo/schedule.svelte";
  import { londonToday, pounds } from "./dates";
  import { navigate } from "../app/router.svelte";
  import { seriesToOpen } from "../pages/TournamentSeries.svelte";
  import { seasonEnd, seasonLabel, seasonOf, seasonsFrom, seasonYear, type Season } from "@cougars/shared/seasons";
  import type { Edits } from "./dirty.svelte";
  import AwardsField from "./AwardsField.svelte";
  import { withDecidedBy, type Award } from "./awards";

  let {
    dateId,
    typeId,
    startTab = "details",
    start = $bindable(),
    edits,
    oncreated,
  }: {
    dateId?: number;
    /** A new date in this series, its defaults copied in (from the series' own page) */
    typeId?: number;
    /** The tab it opens on: "teams" to add the captains */
    startTab?: "details" | "rules" | "signup" | "teams";
    /** A new date's answers from the quick questions (Advanced): its day, draft and captains, kept up to date here so
     *  going back to the questions keeps what was changed */
    start?: QuickValues;
    /** Its unsaved changes and saves, for the panel's footer and its way out (lib/dirty.svelte.ts) */
    edits?: Edits;
    oncreated?: (id: number) => void;
  } = $props();

  interface DateForm {
    id: number;
    /** Its series, or none: a tournament can stand on its own */
    typeId: number | null;
    name: string;
    /** Optional: empty while it's just a season (ADR 0030) */
    heldOn: string;
    /** Always: the season it's in, which a day sets */
    season: Season;
    seasonYear: number;
    startTime: string;
    endTime: string;
    /** Its place (ADR 0030); none set: its series' */
    venueId: number | null;
    location: string;
    mapUrl: string;
    /** Where everyone goes afterwards (ADR 0074): its series' (usual), its own, or none this time */
    afterMode: AfterMode;
    afterVenueId: number | null;
    afterTime: string | null;
    afterNote: string;
    capacity: number | null;
    fee: string;
    status: TournamentStatus;
    public: boolean;
    signupOpensOn: string;
    signupClosesOn: string;
    draftOn: string;
    pointsWin: number;
    pointsDraw: number;
    pointsLoss: number;
    gameMinutes: number;
    penaltyRule: PenaltyRule;
    periods: number;
    defaultPenaltyMinutes: number;
    breakMinutes: number;
    kind: TournamentKind;
    awards: Award[];
    playoffs: Playoff[];
    teams: TournamentTeam[];
  }

  // A new date's season: next summer, unless this one is still to come
  const thisYear = Number(londonToday().slice(0, 4));
  const nextSummer = londonToday() <= seasonEnd("summer", thisYear) ? thisYear : thisYear + 1;
  // The seasons a date can be in: this one and the next few
  const SEASONS_AHEAD = 4;

  function formOf(t: Tournament | undefined): DateForm {
    if (t)
      return {
        id: t.id,
        typeId: t.typeId,
        name: t.name,
        // A season's day is only its stand-in, never shown
        heldOn: t.season ? "" : t.heldOn,
        season: t.season ?? seasonOf(t.heldOn).season,
        seasonYear: t.season ? seasonYear(t.season, t.heldOn) : seasonOf(t.heldOn).year,
        startTime: t.startTime,
        endTime: t.endTime,
        venueId: t.venueId,
        location: t.location,
        mapUrl: t.mapUrl,
        afterMode: t.afterMode ?? "usual",
        afterVenueId: t.afterVenueId ?? null,
        afterTime: t.afterTime ?? null,
        afterNote: t.afterNote ?? "",
        capacity: t.capacity,
        fee: String(t.feePence / 100),
        status: t.status,
        public: t.public,
        signupOpensOn: t.signupOpensOn ?? "",
        signupClosesOn: t.signupClosesOn ?? "",
        draftOn: t.draftOn ?? "",
        pointsWin: t.pointsWin,
        pointsDraw: t.pointsDraw,
        pointsLoss: t.pointsLoss,
        gameMinutes: t.gameMinutes,
        penaltyRule: t.penaltyRule ?? "power_play",
        periods: t.periods ?? 1,
        defaultPenaltyMinutes: t.defaultPenaltyMinutes ?? 2,
        breakMinutes: t.breakMinutes ?? 2,
        kind: t.kind,
        awards: withDecidedBy(t.awards),
        playoffs: (t.playoffs ?? []).map((g) => ({ ...g })),
        teams: t.teams.map((team) => ({ ...team, players: team.players.map((p) => ({ ...p })) })),
      };
    // A new one stands on its own until a series is picked
    return {
      id: 0,
      typeId: null,
      name: "",
      heldOn: "",
      season: "summer",
      seasonYear: nextSummer,
      startTime: "11:00",
      endTime: "16:00",
      venueId: null,
      location: "",
      mapUrl: "",
      afterMode: "usual",
      afterVenueId: null,
      afterTime: null,
      afterNote: "",
      capacity: 24,
      fee: "0",
      status: "planned",
      public: true,
      // Sign-up opens the day it's scheduled, unless said otherwise
      signupOpensOn: londonToday(),
      signupClosesOn: "",
      draftOn: "",
      // The usual round robin until a series says otherwise
      pointsWin: 3,
      pointsDraw: 1,
      pointsLoss: 0,
      gameMinutes: 12,
      penaltyRule: "power_play",
      periods: 1,
      defaultPenaltyMinutes: 2,
      breakMinutes: 2,
      kind: "teams",
      awards: [],
      playoffs: [],
      teams: [],
    };
  }

  // The panel mounts a fresh editor for each date, so the form takes its starting values once
  const starting = () => {
    const t = dateId ? db.tournaments.find((x) => x.id === dateId) : undefined;
    return formOf(t ? $state.snapshot(t) : undefined);
  };
  let date = $state<DateForm>(starting());

  const type = $derived(db.tournamentTypes.find((t) => t.id === date.typeId));
  /** Already charged: the fee is fixed. */
  const charged = $derived(date.id ? collectedFor("tournament", date.id).people > 0 : false);
  const collected = $derived(date.id ? collectedFor("tournament", date.id) : null);

  /**
   * Picking a series copies its defaults in: its rules, awards and location, its name if there's none yet, and its
   * fee unless anyone's paid. They can then change for this one.
   */
  function pickType(id: string) {
    date.typeId = id ? Number(id) : null;
    const t = db.tournamentTypes.find((x) => x.id === date.typeId);
    if (!t) return;
    if (!date.name) date.name = t.name;
    if (!charged) date.fee = String(t.defaultFeePence / 100);
    // Its usual hours (ADR 0074)
    date.startTime = t.defaultStartTime;
    date.endTime = t.defaultEndTime;
    date.venueId = t.venueId;
    date.location = t.location;
    date.mapUrl = t.mapUrl;
    date.pointsWin = t.pointsWin;
    date.pointsDraw = t.pointsDraw;
    date.pointsLoss = t.pointsLoss;
    date.gameMinutes = t.gameMinutes;
    date.penaltyRule = t.penaltyRule;
    date.periods = t.periods;
    date.defaultPenaltyMinutes = t.defaultPenaltyMinutes;
    date.breakMinutes = t.breakMinutes;
    date.kind = t.kind;
    date.awards = withDecidedBy(t.awards);
    date.playoffs = (t.playoffs ?? []).map((g) => ({ ...g }));
  }

  // Started from a series' page: in that series from the off (the panel mounts a fresh editor for each, as above)
  // svelte-ignore state_referenced_locally
  if (!dateId && typeId) pickType(String(typeId));
  // Come from the quick questions: their answers, filled in
  // svelte-ignore state_referenced_locally
  if (!dateId && start) {
    pickSeason(start.season, start.seasonYear);
    if (start.heldOn) pickDay(start.heldOn);
    date.startTime = start.startTime;
    date.endTime = start.endTime;
    date.draftOn = start.draftOn;
    date.signupOpensOn = start.signupOpensOn;
    date.teams = start.captains.map((captainMemberId) => ({
      name: "",
      logo: null,
      captainMemberId,
      captainName: "",
      contact: "",
      players: [],
    }));
  }
  // What it starts as is what's saved: changes from here are unsaved until Save
  // svelte-ignore state_referenced_locally
  edits?.watch(() => date, { fresh: !dateId });
  // …and changes here go back to them, for Back to the questions
  $effect(() => {
    if (dateId || !start) return;
    start.heldOn = date.heldOn;
    start.season = date.season;
    start.seasonYear = date.seasonYear;
    start.startTime = date.startTime;
    start.endTime = date.endTime;
    start.draftOn = date.draftOn;
    start.signupOpensOn = date.signupOpensOn;
    start.captains = date.teams.map((t) => t.captainMemberId).filter((m): m is number => m !== null);
  });

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

  /** The day a date sorts by: its own, or its season's last. */
  const dayOf = (d: DateForm) => d.heldOn || seasonEnd(d.season, d.seasonYear);

  // A day sets the season it's in; a season the day isn't in clears the day
  function pickDay(day: string) {
    date.heldOn = day;
    if (day) ({ season: date.season, year: date.seasonYear } = seasonOf(day));
  }
  function pickSeason(season: Season, year: number) {
    date.season = season;
    date.seasonYear = year;
    if (date.heldOn) {
      const s = seasonOf(date.heldOn);
      if (s.season !== season || s.year !== year) date.heldOn = "";
    }
  }
  // "Summer 2027": this season and the next few, and the one it's in if that's further out or gone
  const seasonOptions = $derived(
    [...seasonsFrom(londonToday(), SEASONS_AHEAD), { season: date.season, year: date.seasonYear }]
      .map(({ season, year }) => ({ value: `${season} ${year}`, label: seasonLabel(season, seasonEnd(season, year)) }))
      .filter((o, i, all) => all.findIndex((x) => x.value === o.value) === i)
      .sort((a, b) => seasonEndOf(a.value).localeCompare(seasonEndOf(b.value))),
  );
  function seasonEndOf(value: string) {
    const [season, year] = value.split(" ");
    return seasonEnd(season as Season, Number(year));
  }

  const members = $derived(
    db.members.filter((m) => m.status === "active").sort((a, b) => goesBy(a.player).localeCompare(goesBy(b.player))),
  );
  // A draft's captains bring their team from the series' last edition they captained in (brought-team.ts)
  const edition = $derived({ id: date.id || undefined, typeId: date.typeId, heldOn: dayOf(date) });
  const memberList = $derived(
    members.map((m) => ({
      id: m.player.id,
      name: goesBy(m.player),
      brings: date.kind === "draft" ? broughtTeam(db.tournaments, edition, m.player.id) : null,
    })),
  );

  // Teams (ADR 0030): nobody on two of them. A draft's are in no order till it opens and draws one (ADR 0060), and
  // then they're shown in it
  const MAX_TEAMS = 16;
  const taken = $derived(
    new Set(
      date.teams.flatMap((t) => [t.captainMemberId, ...t.players.map((p) => p.memberId)]).filter((m) => m !== null),
    ),
  );
  function addTeam() {
    date.teams.push({ name: "", logo: null, captainMemberId: null, captainName: "", contact: "", players: [] });
  }
  function addCaptain(memberId: number) {
    date.teams.push({ name: "", logo: null, captainMemberId: memberId, captainName: "", contact: "", players: [] });
  }
  const drawn = $derived.by(() => {
    const state = dateId ? db.tournaments.find((x) => x.id === dateId)?.draftState : undefined;
    return state === "open" || state === "closed";
  });

  // Four tabs: the tournament itself, how it's played, sign-up, then its teams (and a draft's night)
  type Tab = "details" | "rules" | "signup" | "teams";
  // svelte-ignore state_referenced_locally
  let tab = $state<Tab>(startTab);
  const tabs = $derived<{ id: Tab; label: string }[]>([
    { id: "details", label: "Details" },
    { id: "rules", label: "Rules & awards" },
    { id: "signup", label: "Sign-up" },
    { id: "teams", label: date.kind === "draft" ? "Draft & teams" : "Teams" },
  ]);
  let formEl = $state<HTMLFormElement | undefined>();

  /** Save from another tab with something missing: go to its tab and say what. */
  async function showMissing(on: Tab) {
    tab = on;
    await tick();
    formEl?.reportValidity();
  }

  const toTournament = (d: DateForm): Tournament => ({
    id: d.id,
    typeId: d.typeId,
    name: d.name,
    venueId: d.venueId,
    location: d.venueId ? "" : d.location.trim(),
    mapUrl: d.venueId ? "" : d.mapUrl.trim(),
    afterMode: d.afterMode,
    afterVenueId: d.afterMode === "own" ? d.afterVenueId : null,
    afterTime: d.afterMode === "own" ? d.afterTime : null,
    afterNote: d.afterMode === "own" ? d.afterNote.trim() : "",
    heldOn: dayOf(d),
    season: d.heldOn ? null : d.season,
    startTime: d.startTime,
    endTime: d.endTime,
    capacity: d.capacity || null,
    status: d.status,
    feePence: Math.round(Number(d.fee || 0) * 100),
    public: d.public,
    signupOpensOn: d.signupOpensOn || null,
    signupClosesOn: d.signupClosesOn || null,
    draftOn: d.kind === "draft" && d.draftOn ? d.draftOn : null,
    pointsWin: d.pointsWin,
    pointsDraw: d.pointsDraw,
    pointsLoss: d.pointsLoss,
    gameMinutes: d.gameMinutes,
    penaltyRule: d.penaltyRule,
    periods: d.periods,
    defaultPenaltyMinutes: d.defaultPenaltyMinutes,
    breakMinutes: d.breakMinutes,
    kind: d.kind,
    awards: d.awards.filter((a) => a.name.trim()),
    playoffs: d.playoffs.filter((g) => g.name.trim()),
    teams: d.teams,
    going: [],
    waitlist: [],
  });

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!date.name) return showMissing("details");
    if (date.kind === "teams" && date.teams.some((t) => !t.name.trim())) return showMissing("teams");
    const t = toTournament(date);
    // Over something already on (Friday Training)? Asked first; closing the question saves nothing (ADR 0122)
    const window = tournamentWindow(
      t,
      db.tournaments.find((x) => x.id === t.id),
    );
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
        onclick={() => (tab = t.id)}
      >
        {t.label}
      </button>
    {/each}
  </div>
  <!-- Saved from the panel's footer (form="date-form"), whichever tab is showing -->
  <form class="form" id="date-form" onsubmit={save} bind:this={formEl}>
    {#key tab}
      <div class="panel-tab rise" id="date-panel" role="tabpanel" aria-labelledby="date-tab-{tab}">
        {#if tab === "details"}
          <FormSection title="What">
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
            <label class="field"
              >Name <input
                class="input"
                bind:value={date.name}
                placeholder="e.g. Winter {type?.shortName ?? 'Cup'}"
                required
              /></label
            >
            <div class="field">
              <span id="date-kind">Type</span>
              <div class="seg kind" role="group" aria-labelledby="date-kind">
                {#each TOURNAMENT_KINDS as k (k.id)}
                  <button type="button" aria-pressed={date.kind === k.id} onclick={() => (date.kind = k.id)}>
                    {k.label}
                  </button>
                {/each}
              </div>
              <span class="hint small">{TOURNAMENT_KINDS.find((k) => k.id === date.kind)?.hint}</span>
            </div>
          </FormSection>
          <FormSection title="When" description="A season is enough until the day is known.">
            <div class="cols">
              <div class="field">
                Season
                <Select
                  id="date-season"
                  value={`${date.season} ${date.seasonYear}`}
                  onchange={(v) => {
                    const [season, year] = v.split(" ");
                    pickSeason(season as Season, Number(year));
                  }}
                  options={seasonOptions}
                  aria-label="Season"
                />
              </div>
              <!-- The day, once it's known; until then it's just the season -->
              <div class="field">
                <label for="date-day">Date <span class="hint">· optional</span></label>
                <DateField
                  id="date-day"
                  placeholder="Not set: just the season"
                  bind:value={() => date.heldOn, (v) => pickDay(v)}
                />
              </div>
              <div class="field">
                Starts <TimeSelect id="date-start" bind:value={date.startTime} aria-label="Starts" />
              </div>
              <div class="field">Ends <TimeSelect id="date-end" bind:value={date.endTime} aria-label="Ends" /></div>
            </div>
          </FormSection>
          <FormSection title="Where">
            <PlacePicker
              id="date-place"
              bind:venueId={date.venueId}
              bind:name={date.location}
              bind:mapUrl={date.mapUrl}
              usual={type ? typePlace(type) : undefined}
            />
          </FormSection>
          <!-- Where everyone goes after (ADR 0074): its series' unless this one says otherwise -->
          <FormSection title="Afterwards">
            <AfterFields
              id="date-after"
              bind:mode={date.afterMode}
              bind:venueId={date.afterVenueId}
              bind:time={date.afterTime}
              bind:note={date.afterNote}
              usual={type ? typeAfter(type) : null}
            />
          </FormSection>
        {:else if tab === "rules"}
          <FormSection title="Rules" description="Round robin: every team plays every other once.">
            <div class="cols">
              <label class="field"
                >Points for a win <input class="input num" type="number" min="0" bind:value={date.pointsWin} /></label
              >
              <label class="field"
                >A draw <input class="input num" type="number" min="0" bind:value={date.pointsDraw} /></label
              >
              <label class="field"
                >A loss <input class="input num" type="number" min="0" bind:value={date.pointsLoss} /></label
              >
              <label class="field">
                Minutes a period
                <input class="input num" type="number" min="1" max="90" bind:value={date.gameMinutes} />
              </label>
              <label class="field">
                Break between periods
                <input class="input num" type="number" min="0" max="15" bind:value={date.breakMinutes} />
              </label>
            </div>
            <div class="field">
              Periods
              <Choice
                bind:value={() => String(date.periods), (v) => (date.periods = Number(v))}
                options={PERIOD_OPTIONS}
                aria-label="Periods"
              />
            </div>
            <div class="field">
              Penalties
              <Choice bind:value={date.penaltyRule} options={PENALTY_RULE_OPTIONS} aria-label="Penalties" />
            </div>
            <div class="field">
              Usual penalty
              <Choice
                bind:value={() => String(date.defaultPenaltyMinutes), (v) => (date.defaultPenaltyMinutes = Number(v))}
                options={PENALTY_LENGTH_OPTIONS}
                aria-label="Usual penalty"
              />
            </div>
          </FormSection>
          <FormSection title="Playoffs" description="After the round robin, by place in the table.">
            <PlayoffsField bind:playoffs={date.playoffs} teams={date.teams.length} />
          </FormSection>
          <FormSection title="Awards" description="Handed out on the day, and shown on the website.">
            <AwardsField bind:awards={date.awards} />
          </FormSection>
        {:else if tab === "signup"}
          <FormSection
            title="Sign-up"
            description="Members say they're in from the day sign-up opens (or once it's set to Sign-up open), until it closes (empty: up to the day)."
          >
            <div class="cols">
              <div class="field">
                Status
                <Select
                  id="date-status"
                  bind:value={date.status}
                  options={STATUSES.map((s) => ({ value: s.id, label: s.label }))}
                  aria-label="Status"
                />
              </div>
              <div class="field">
                Website
                <Select
                  id="date-public"
                  value={date.public ? "yes" : "no"}
                  onchange={(v) => (date.public = v === "yes")}
                  options={[
                    { value: "yes", label: "On the website" },
                    { value: "no", label: "Members only" },
                  ]}
                  aria-label="Website"
                />
              </div>
              <div class="field">
                Sign-up opens
                <DateField
                  id="date-signup-opens"
                  aria-label="Sign-up opens"
                  placeholder="Not set"
                  bind:value={date.signupOpensOn}
                  max={dayOf(date) || undefined}
                />
              </div>
              <div class="field">
                Sign-up closes
                <DateField
                  id="date-signup-closes"
                  aria-label="Sign-up closes"
                  placeholder="Not set"
                  bind:value={date.signupClosesOn}
                  max={dayOf(date) || undefined}
                />
              </div>
              <label class="field"
                >Places <input class="input num" type="number" min="0" bind:value={date.capacity} /></label
              >
              <label class="field"
                >Fee (£) <input
                  class="input num"
                  inputmode="decimal"
                  bind:value={date.fee}
                  disabled={charged}
                  title={charged ? "Already charged: the fee is fixed" : undefined}
                /></label
              >
            </div>
            {#if collected?.people}
              <p class="num">Collected {pounds(collected.paid)} of {pounds(collected.due)}</p>
            {/if}
          </FormSection>
        {:else}
          {#if date.kind === "draft"}
            <FormSection
              title="Draft"
              description="Captains pick members in snake order, on the Draft page. The day is a reminder for them; you say when it opens."
            >
              <div class="cols">
                <div class="field">
                  Draft day <DateField
                    id="date-draft"
                    aria-label="Draft day"
                    placeholder="TBC"
                    bind:value={date.draftOn}
                    max={dayOf(date) || undefined}
                  />
                </div>
              </div>
            </FormSection>
          {/if}
          <FormSection
            title={date.kind === "draft" ? "Captains" : "Teams"}
            description={date.kind === "draft"
              ? "Any order: the draft draws who picks first."
              : "Each team that's entered: its name, logo, captain and players."}
            stacked={date.kind === "draft"}
          >
            <div class="teams" class:draft={date.kind === "draft"}>
              {#each date.teams as _, i (i)}
                <TeamCard
                  bind:team={date.teams[i]}
                  kind={date.kind}
                  place={i + 1}
                  pick={drawn ? i + 1 : null}
                  members={memberList}
                  {taken}
                  onremove={() => date.teams.splice(i, 1)}
                />
              {:else}
                {#if date.kind !== "draft"}<p class="hint">No teams yet.</p>{/if}
              {/each}
              {#if date.kind === "draft" && date.teams.length < MAX_TEAMS}
                <!-- The next captain's row, lined up with theirs: find a member and they're one -->
                <div class="add-captain" class:drawn>
                  {#if drawn}<span aria-hidden="true"></span>{/if}
                  <span class="slot" aria-hidden="true"><Icon name="plus" size={18} /></span>
                  <PersonPicker
                    id="add-captain"
                    members={memberList}
                    exclude={taken}
                    clearOnPick
                    quiet
                    placeholder="Add a captain…"
                    aria-label="Add a captain"
                    onpick={addCaptain}
                  />
                </div>
              {/if}
            </div>
            {#if date.kind !== "draft" && date.teams.length < MAX_TEAMS}
              <button type="button" class="btn sm add-award" onclick={addTeam}>
                <Icon name="plus" size={16} />Team
              </button>
            {/if}
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
  /* Fields three to a row, wrapping on, so every field lines up with the ones above it */
  .cols {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--s-5) var(--s-4);
    align-items: start;
  }
  @container (max-width: 30rem) {
    .cols {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .add-award {
    justify-self: start;
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
  .kind {
    justify-self: start;
  }
  .teams {
    display: grid;
    gap: var(--s-3);
  }
  .teams.draft {
    gap: var(--s-2);
  }
  /* A row like the captains' above: the crest's square (and the pick's column once drawn), then the search where
     their names are */
  .add-captain {
    display: grid;
    grid-template-columns: var(--control-h) minmax(0, 1fr);
    gap: var(--s-3);
    align-items: center;
    height: var(--control-h);
    /* Ends where the captains' names do, before their ✕ */
    max-width: calc(30rem - var(--control-h-sm) - var(--s-3));
  }
  .add-captain.drawn {
    grid-template-columns: 1.5rem var(--control-h) minmax(0, 1fr);
  }
  .add-captain .slot {
    display: grid;
    place-items: center;
    height: var(--control-h);
    border-radius: var(--r-md);
    background: var(--field-bg);
    color: var(--fg-muted);
  }
</style>
