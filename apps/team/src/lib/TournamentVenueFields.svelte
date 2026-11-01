<script lang="ts">
  // Where a tournament is and where everyone goes after (ADR 0030, 0074): one section, each field saying which. Left on
  // Usual, both are its series'. In the wizard's Details step (Advanced) and the editor's Details tab alike.
  import FormSection from "./FormSection.svelte";
  import PlacePicker from "./PlacePicker.svelte";
  import AfterFields from "./AfterFields.svelte";
  import type { TournamentType } from "../demo/model";
  import { typeAfter, typePlace } from "../demo/schedule.svelte";
  import type { TournamentForm } from "./tournament-form";

  let {
    form = $bindable(),
    id,
    type,
  }: {
    form: TournamentForm;
    /** The fields' ids start with it ("quick", "date") */
    id: string;
    /** Its series, whose place and afterwards Usual is */
    type?: TournamentType;
  } = $props();
</script>

<FormSection title="Venue">
  <PlacePicker
    id="{id}-place"
    bind:venueId={form.venueId}
    bind:name={form.location}
    bind:mapUrl={form.mapUrl}
    usual={type ? typePlace(type) : undefined}
  />
  <AfterFields
    id="{id}-after"
    bind:mode={form.afterMode}
    bind:venueId={form.afterVenueId}
    bind:time={form.afterTime}
    bind:note={form.afterNote}
    usual={type ? typeAfter(type) : null}
  />
</FormSection>
