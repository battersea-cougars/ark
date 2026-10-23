<script lang="ts">
  // When a tournament is (ADR 0030): its season, its day once that's known, its hours. One home for these fields, in
  // the wizard's Details step and the editor's Details tab alike.
  import FormSection from "./FormSection.svelte";
  import Select from "./Select.svelte";
  import DateField from "./DateField.svelte";
  import TimeSelect from "./TimeSelect.svelte";
  import { londonToday } from "./dates";
  import { setDay, setSeason, type TournamentForm } from "./tournament-form";
  import { seasonEnd, seasonLabel, seasonsFrom, type Season } from "@cougars/shared/seasons";

  let {
    form = $bindable(),
    id,
    future = false,
  }: {
    form: TournamentForm;
    /** The fields' ids start with it ("quick", "date") */
    id: string;
    /** A new one: its day can't be in the past */
    future?: boolean;
  } = $props();

  // The seasons a date can be in: this one and the next few, and the one it's in if that's further out or gone
  const SEASONS_AHEAD = 4;
  const seasonOptions = $derived(
    [...seasonsFrom(londonToday(), SEASONS_AHEAD), { season: form.season, year: form.seasonYear }]
      .map(({ season, year }) => ({ value: `${season} ${year}`, end: seasonEnd(season, year) }))
      .filter((o, i, all) => all.findIndex((x) => x.value === o.value) === i)
      .sort((a, b) => a.end.localeCompare(b.end))
      .map(({ value, end }) => ({ value, label: seasonLabel(value.split(" ")[0] as Season, end) })),
  );
  function pickSeason(v: string) {
    const [season, year] = v.split(" ");
    setSeason(form, season as Season, Number(year));
  }
</script>

<FormSection title="When" description="Not fixed yet? Leave the day: it shows as the season, date TBC.">
  <!-- Two to a row: the season and the day, then Starts and Ends together (on a phone too) -->
  <div class="fit">
    <div class="cols">
      <div class="field">
        Season
        <Select
          id="{id}-season"
          value={`${form.season} ${form.seasonYear}`}
          onchange={pickSeason}
          options={seasonOptions}
          aria-label="Season"
        />
      </div>
      <div class="field">
        <span>Day <span class="opt">· optional</span></span>
        <DateField
          id="{id}-day"
          aria-label="Day"
          placeholder="Not set: just the season"
          min={future ? londonToday() : undefined}
          bind:value={() => form.heldOn, (v) => setDay(form, v)}
        />
      </div>
      <div class="field">Starts <TimeSelect id="{id}-start" bind:value={form.startTime} aria-label="Starts" /></div>
      <div class="field">Ends <TimeSelect id="{id}-end" bind:value={form.endTime} aria-label="Ends" /></div>
    </div>
  </div>
</FormSection>

<style>
  .fit {
    container-type: inline-size;
  }
  .cols {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-5) var(--s-4);
    align-items: start;
  }
  @container (max-width: 30rem) {
    .cols > :nth-child(-n + 2) {
      grid-column: 1 / -1;
    }
  }
  .opt {
    color: var(--fg-subtle);
  }
</style>
