<script lang="ts">
  // A team's name and logo, the fields (ADR 0030): the name (none: "Team Dan", after its captain) and the crest, its
  // logo or its initials, with a way to change it. In the team's own sheet (lib/TeamLookSheet, its captain or an
  // admin, saving at once) and in a tournament editor's team sheet (lib/TeamSheet, saved with the editor).
  import TeamCrest from "./TeamCrest.svelte";
  import { shrinkLogo } from "./logo";

  let {
    name = $bindable(),
    logo = $bindable(),
    fallback,
    brings = false,
    autofocus = false,
    required = false,
  }: {
    name: string;
    logo: string | null;
    /** What it's called with no name of its own: "Team Dan", or the team its captain brings. */
    fallback: string;
    /** A draft in a series: its captain's next team in it starts with this name and logo (ADR 0060). */
    brings?: boolean;
    autofocus?: boolean;
    /** A team that entered: it must have a name of its own (ADR 0030), so there's no fallback to fall back on. */
    required?: boolean;
  } = $props();

  let error = $state("");
  let file = $state<HTMLInputElement | undefined>();
  async function pick(chosen: File | undefined) {
    error = "";
    if (!chosen) return;
    try {
      logo = await shrinkLogo(chosen);
    } catch {
      error = "That image couldn't be read. Try a PNG or JPEG.";
    }
  }
</script>

<label class="field">
  <span>Team name</span>
  <!-- svelte-ignore a11y_autofocus -->
  <input
    class="input"
    maxlength="40"
    placeholder={required ? "e.g. Clapham Crushers" : fallback}
    {autofocus}
    {required}
    bind:value={name}
  />
  {#if !required}
    <span class="hint">
      Left empty, it's {fallback}.{brings ? " The captain's next team in this series starts with it." : ""}
    </span>
  {/if}
</label>
<div class="look">
  <TeamCrest name={name.trim() || fallback || "Team"} {logo} size="6rem" onclick={() => file?.click()} />
  <div class="run">
    <button type="button" class="btn sm outline" onclick={() => file?.click()}
      >{logo ? "Change the logo" : "Add a logo"}</button
    >
    {#if logo}
      <button type="button" class="btn sm ghost" onclick={() => (logo = null)}>Use the initials</button>
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
  .error {
    margin: 0;
    color: var(--red-hot);
  }
</style>
