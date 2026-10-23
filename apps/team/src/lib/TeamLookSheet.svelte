<script lang="ts">
  // A team's name and logo, in a sheet over the page (its captain or an admin, ADR 0065). No name: "Team Dan", after
  // its captain. No logo: its initials.
  import Sheet from "./Sheet.svelte";
  import TeamCrest from "./TeamCrest.svelte";
  import { shrinkLogo } from "./logo";
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
  // A Kumite team's name is its captain's to carry to the next one (ADR 0060): saved on their profile too
  const kumite = $derived(
    db.tournamentTypes.find((ty) => ty.id === db.tournaments.find((x) => x.id === tournamentId)?.typeId)?.slug ===
      "kumite",
  );
  let error = $state("");
  let file = $state<HTMLInputElement | undefined>();

  async function pick(f: File | undefined) {
    error = "";
    if (!f) return;
    try {
      form.logo = await shrinkLogo(f);
    } catch {
      error = "That image couldn't be read. Try a PNG or JPEG.";
    }
  }
  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (await edits.run(() => setTeamLook(tournamentId, teamId, form.name.trim(), form.logo))) open = false;
  }
</script>

<Sheet bind:open title="Name and logo" {edits}>
  <form id="team-look" class="form" onsubmit={save}>
    <label class="field">
      <span>Team name</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input class="input" maxlength="40" placeholder={fallback} autofocus={focus === "name"} bind:value={form.name} />
      <span class="hint"
        >Leave it empty and you're {fallback}.{#if kumite}
          Saved as the captain's team name for next time.{/if}</span
      >
    </label>
    <div class="look">
      <TeamCrest name={form.name.trim() || fallback} logo={form.logo} size="6rem" onclick={() => file?.click()} />
      <div class="run">
        <button type="button" class="btn sm outline" onclick={() => file?.click()}
          >{form.logo ? "Change the logo" : "Add a logo"}</button
        >
        {#if form.logo}
          <button type="button" class="btn sm ghost" onclick={() => (form.logo = null)}>Use the initials</button>
        {/if}
      </div>
      <input
        class="file"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        bind:this={file}
        onchange={(e) => pick(e.currentTarget.files?.[0])}
      />
    </div>
    {#if error}<p class="error small">{error}</p>{/if}
  </form>
  {#snippet footer()}
    <SaveBar {edits} form="team-look" />
  {/snippet}
</Sheet>

<style>
  .look {
    display: flex;
    align-items: center;
    gap: var(--s-4);
  }
  .run {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .file {
    display: none;
  }
</style>
