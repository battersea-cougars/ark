<script lang="ts">
  // A tournament series' defaults (Settings → Tournament Series): a kind of tournament the club runs again and again
  // (The Cougars Kumite), set once. Its rules, the fee and location each new tournament in it starts with, its awards
  // and how it looks in the menu. Each tournament is edited on its own card (TournamentDateEditor). A new series gets
  // its own section in the menu.
  import TimeSelect from "./TimeSelect.svelte";
  import { tick, untrack } from "svelte";
  import PlayoffsField from "./PlayoffsField.svelte";
  import Choice from "./Choice.svelte";
  import { PENALTY_LENGTH_OPTIONS, PENALTY_RULE_OPTIONS } from "./penalties";
  import { PERIOD_OPTIONS } from "./periods";
  import { createTournamentType, updateTournamentType } from "../app/backend.svelte";
  import { TOURNAMENT_KINDS, type TournamentType } from "../demo/model";
  import { db } from "../demo/store.svelte";
  import StylePicker from "./StylePicker.svelte";
  import FormSection from "./FormSection.svelte";
  import PlacePicker from "./PlacePicker.svelte";
  import AfterFields from "./AfterFields.svelte";
  import AwardsField from "./AwardsField.svelte";
  import { withDecidedBy } from "./awards";
  import { HOUSE_RULES_MAX } from "./format-rules";
  import type { Edits } from "./dirty.svelte";

  let {
    typeId,
    edits,
    oncreated,
  }: {
    typeId?: number;
    /** Its unsaved changes and saves, for the panel's footer and its way out (lib/dirty.svelte.ts) */
    edits?: Edits;
    oncreated?: (id: number) => void;
  } = $props();

  const selected = $derived<number | "new">(typeId ?? "new");
  let form = $state<TournamentType | null>(null);

  const blank = (): TournamentType => ({
    id: 0,
    slug: "",
    name: "",
    shortName: "",
    icon: "trophy",
    tone: "violet",
    format: "round_robin",
    pointsWin: 3,
    pointsDraw: 1,
    pointsLoss: 0,
    gameMinutes: 12,
    penaltyRule: "power_play",
    periods: 1,
    defaultPenaltyMinutes: 2,
    breakMinutes: 2,
    kind: "teams",
    active: true,
    defaultFeePence: 1500,
    defaultStartTime: "11:00",
    defaultEndTime: "16:00",
    venueId: null,
    location: "",
    mapUrl: "",
    afterVenueId: null,
    afterTime: null,
    afterNote: "",
    houseRules: "",
    awards: [
      {
        name: "Champions",
        about: "Last team standing… barely.",
        decidedBy: { kind: "stat", stat: "table" },
      },
      { name: "Top scorer", about: "Most goals. Some on purpose.", decidedBy: { kind: "stat", stat: "goals" } },
    ],
    playoffs: [{ name: "Final", home: 1, away: 2 }],
  });

  // Follows the series and its saved values; the form it writes isn't followed (reading it back made the effect its
  // own cause, re-running till Svelte stopped it: seconds to open the editor)
  $effect(() => {
    const t = selected === "new" ? blank() : db.tournamentTypes.find((x) => x.id === selected);
    const loaded = t ? structuredClone($state.snapshot(t)) : null;
    untrack(() => {
      // Each award saying how it's decided (one saved before it said: the old guess from its name, ADR 0044)
      form = loaded && { ...loaded, awards: withDecidedBy(loaded.awards) };
      // Loaded (or loaded again, after a save): what's on screen now is what's saved
      edits?.reset();
    });
  });
  // svelte-ignore state_referenced_locally
  edits?.watch(() => form, { fresh: !typeId });

  // Two tabs: the series itself and its look, then the defaults each new tournament in it copies
  type Tab = "series" | "defaults";
  let tab = $state<Tab>("series");
  const TABS: { id: Tab; label: string }[] = [
    { id: "series", label: "Series" },
    { id: "defaults", label: "Defaults" },
  ];
  let formEl = $state<HTMLFormElement | undefined>();

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!form) return;
    if (!form.name) {
      // Saved from another tab without a name: go to it and say so
      tab = "series";
      await tick();
      return void formEl?.reportValidity();
    }
    if (!form.shortName) form.shortName = form.name.replace(/^The\s+/i, "").split(" ")[0];
    if (selected === "new") {
      const f = form;
      const created = await (edits ? edits.run(() => createTournamentType(f)) : createTournamentType(f));
      // The blank form gives way to the new series' defaults, in the same panel
      if (created) oncreated?.(created.id);
    } else {
      const f = form;
      await (edits ? edits.run(() => updateTournamentType(f)) : updateTournamentType(f));
    }
  }
</script>

<div class="editor">
  {#if form}
    <div class="tablist" role="tablist" aria-label="Series defaults">
      {#each TABS as t (t.id)}
        <button
          type="button"
          role="tab"
          id="tournament-tab-{t.id}"
          aria-selected={tab === t.id}
          aria-controls="tournament-panel"
          onclick={() => (tab = t.id)}
        >
          {t.label}
        </button>
      {/each}
    </div>
    <!-- Saved from the panel's footer (form="tournament-form"), whichever tab is showing -->
    <form class="form" id="tournament-form" onsubmit={save} bind:this={formEl}>
      {#key tab}
        <div class="panel-tab rise" id="tournament-panel" role="tabpanel" aria-labelledby="tournament-tab-{tab}">
          {#if tab === "series"}
            <FormSection title="Series">
              <div class="cols">
                <label class="field span-2"
                  >Name <input class="input" bind:value={form.name} placeholder="e.g. Summer Cup" required /></label
                >
                <label class="field">
                  Short name <input class="input" bind:value={form.shortName} placeholder="e.g. Cup" maxlength="12" />
                </label>
              </div>
              <!-- How its tournaments make teams (ADR 0030); each tournament copies it -->
              <div class="field">
                <span id="series-kind">Type</span>
                <div class="seg kind" role="group" aria-labelledby="series-kind">
                  {#each TOURNAMENT_KINDS as k (k.id)}
                    <button type="button" aria-pressed={form.kind === k.id} onclick={() => form && (form.kind = k.id)}>
                      {k.label}
                    </button>
                  {/each}
                </div>
                <span class="hint small">{TOURNAMENT_KINDS.find((k) => k.id === form?.kind)?.hint}</span>
              </div>
              <label class="check"><input type="checkbox" bind:checked={form.active} /> Running</label>
              <span class="hint small">Untick Running to hide it from the menu.</span>
            </FormSection>
            <FormSection title="Look" description="How it shows in the menu and on the calendar.">
              <div class="style"><StylePicker bind:icon={form.icon} bind:tone={form.tone} /></div>
            </FormSection>
          {:else}
            <FormSection title="When, where and fee" description="Each new tournament in the series starts with these.">
              <PlacePicker
                id="series-place"
                bind:venueId={form.venueId}
                bind:name={form.location}
                bind:mapUrl={form.mapUrl}
              />
              <div class="cols">
                <div class="field">
                  Usual start <TimeSelect
                    id="series-start"
                    bind:value={form.defaultStartTime}
                    aria-label="Usual start"
                  />
                </div>
                <div class="field">
                  Usual end <TimeSelect id="series-end" bind:value={form.defaultEndTime} aria-label="Usual end" />
                </div>
                <label class="field">
                  Fee (£)
                  <input
                    class="input num"
                    inputmode="decimal"
                    value={form.defaultFeePence / 100}
                    onchange={(e) =>
                      form && (form.defaultFeePence = Math.round(Number(e.currentTarget.value || 0) * 100))}
                  />
                </label>
              </div>
            </FormSection>
            <!-- Where everyone goes after (ADR 0074): every one in the series gets it without retyping -->
            <FormSection title="Afterwards" description="Where everyone goes after, on every one in the series.">
              <AfterFields
                id="series-after"
                bind:venueId={form.afterVenueId}
                bind:time={form.afterTime}
                bind:note={form.afterNote}
              />
            </FormSection>
            <!-- The series' own rules, as written (ADR 0074): everyone reads them under Format & rules -->
            <FormSection title="House rules" description="A rule a line. Everyone sees them under Format & rules.">
              <label class="field">
                <span class="sr-only">House rules</span>
                <textarea
                  class="input"
                  rows="5"
                  maxlength={HOUSE_RULES_MAX}
                  bind:value={form.houseRules}
                  placeholder="e.g. No slapshots. Helmets on."></textarea>
              </label>
            </FormSection>
            <FormSection title="Rules" description="Round robin: every team plays every other once.">
              <div class="cols">
                <label class="field"
                  >Points for a win <input class="input num" type="number" min="0" bind:value={form.pointsWin} /></label
                >
                <label class="field"
                  >A draw <input class="input num" type="number" min="0" bind:value={form.pointsDraw} /></label
                >
                <label class="field"
                  >A loss <input class="input num" type="number" min="0" bind:value={form.pointsLoss} /></label
                >
                <label class="field">
                  Minutes a period
                  <input class="input num" type="number" min="1" max="90" bind:value={form.gameMinutes} />
                </label>
                <!-- Between periods (ADR 0061): the scorekeeper's screen counts it down; it's in each game's slot -->
                <label class="field">
                  Break between periods
                  <input class="input num" type="number" min="0" max="15" bind:value={form.breakMinutes} />
                </label>
              </div>
              <!-- A game's periods (ADR 0061): the clock runs per period, the slot on the day is all of them -->
              <div class="field">
                Periods
                <Choice
                  bind:value={() => String(form?.periods ?? 1), (v) => form && (form.periods = Number(v))}
                  options={PERIOD_OPTIONS}
                  aria-label="Periods"
                />
              </div>
              <!-- How a penalty's served (ADR 0061): each new tournament copies it -->
              <div class="field">
                Penalties
                <Choice bind:value={form.penaltyRule} options={PENALTY_RULE_OPTIONS} aria-label="Penalties" />
              </div>
              <!-- The length the penalty sheet starts on (ADR 0061); too many players and a bench minor stay 2 -->
              <div class="field">
                Usual penalty
                <Choice
                  bind:value={
                    () => String(form?.defaultPenaltyMinutes ?? 2),
                    (v) => form && (form.defaultPenaltyMinutes = Number(v))
                  }
                  options={PENALTY_LENGTH_OPTIONS}
                  aria-label="Usual penalty"
                />
              </div>
            </FormSection>
            <FormSection title="Playoffs" description="After the round robin, by place in the table.">
              <PlayoffsField bind:playoffs={form.playoffs} />
            </FormSection>
            <!-- What's handed out on the day, shown on the website. A fun one is half the point. -->
            <FormSection title="Awards" description="Handed out on the day, and shown on the website.">
              <AwardsField bind:awards={form.awards} />
            </FormSection>
          {/if}
        </div>
      {/key}
    </form>
  {/if}
</div>

<style>
  /* The tabs, then the tab showing. Its grid answers to the panel's width, not the screen's */
  .editor {
    display: grid;
    gap: var(--s-5);
    container-type: inline-size;
  }
  /* Fields three to a row, wrapping on, so every field lines up with the ones above it; span-2 takes two */
  .cols {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--s-5) var(--s-4);
    align-items: start;
  }
  .kind {
    justify-self: start;
  }
  .span-2 {
    grid-column: span 2;
  }
  @container (max-width: 30rem) {
    .cols {
      grid-template-columns: minmax(0, 1fr);
    }
    .span-2 {
      grid-column: auto;
    }
  }
  /* Icon and colour on one line while they fit */
  .style {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-5) var(--s-8);
  }
</style>
