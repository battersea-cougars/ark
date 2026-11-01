<script lang="ts">
  // A team's name and logo, in a sheet over the page (its captain or an admin, ADR 0065). No name: "Team Dan", after
  // its captain. No logo: its initials.
  import Sheet from "./Sheet.svelte";
  import TeamLookFields from "./TeamLookFields.svelte";
  import { setTeamLook } from "../app/backend.svelte";
  import { db } from "../demo/store.svelte";
  import { Edits } from "./dirty.svelte";
  import SaveBar from "./SaveBar.svelte";

  let {
    tournamentId,
    teamId,
    name,
    logo,
    fallback,
    focus = "logo",
    open = $bindable(false),
  }: {
    tournamentId: number;
    teamId: number;
    name: string;
    logo: string | null;
    /** What it's called with no name of its own: "Team Dan". */
    fallback: string;
    /** What it opened for: renaming puts you in the name. */
    focus?: "name" | "logo";
    open?: boolean;
  } = $props();

  // svelte-ignore state_referenced_locally
  let form = $state({ name, logo });
  // Unsaved changes: Save lights up, and closing asks first (lib/dirty.svelte.ts)
  const edits = new Edits();
  edits.watch(() => form);
  // A draft in a series: its captain brings this team's name and logo to the next edition they captain (ADR 0060)
  const brings = $derived.by(() => {
    const t = db.tournaments.find((x) => x.id === tournamentId);
    return t?.kind === "draft" && t.typeId != null;
  });
  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (await edits.run(() => setTeamLook(tournamentId, teamId, form.name.trim(), form.logo))) open = false;
  }
</script>

<Sheet bind:open title="Name and logo" {edits}>
  <form id="team-look" class="form" onsubmit={save}>
    <TeamLookFields bind:name={form.name} bind:logo={form.logo} {fallback} {brings} autofocus={focus === "name"} />
  </form>
  {#snippet footer()}
    <SaveBar {edits} form="team-look" />
  {/snippet}
</Sheet>
