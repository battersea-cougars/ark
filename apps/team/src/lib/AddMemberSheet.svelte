<script lang="ts">
  // An admin adds someone to the club, in a sheet over Teammates (ADR 0065, 0069): name, email, position. They're in
  // straight away, and the app emails them a link to itself unless the switch is off (#164: told in person, or later
  // from their card); they sign in with that email either way.
  import Icon from "../app/shell/Icon.svelte";
  import Sheet from "./Sheet.svelte";
  import { POSITIONS, POSITION_ICONS, type Position } from "../demo/data";
  import { addMember } from "../app/backend.svelte";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  // The switch starts on: emailing them is the usual add, a quiet one the exception (#164)
  const blank = () => ({ name: "", email: "", position: "F" as Position, emailThem: true });
  let form = $state(blank());
  let busy = $state(false);

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;
    busy = true;
    try {
      if (await addMember(form.name.trim(), form.email.trim(), form.position, form.emailThem)) {
        form = blank();
        open = false;
      }
    } finally {
      busy = false;
    }
  }
</script>

<Sheet bind:open title="Add a member">
  <form id="add-member" class="form" onsubmit={save}>
    <label class="field">
      <span>Name</span>
      <input class="input" required maxlength="80" autocomplete="off" bind:value={form.name} />
    </label>
    <label class="field">
      <span>Email</span>
      <input class="input" type="email" required autocomplete="off" bind:value={form.email} />
    </label>
    <div class="field">
      <span id="add-member-position">Position</span>
      <div class="seg block" role="group" aria-labelledby="add-member-position">
        {#each Object.entries(POSITIONS) as [v, label] (v)}
          <button type="button" aria-pressed={form.position === v} onclick={() => (form.position = v as Position)}
            ><Icon name={POSITION_ICONS[v as Position]} size={18} />{label}</button
          >
        {/each}
      </div>
    </div>
    <div class="field">
      <span id="add-member-email-them">Email them a link to the app</span>
      <!-- On or off: a switch, with what it means beside it -->
      <button
        type="button"
        class="switch"
        role="switch"
        aria-checked={form.emailThem}
        aria-labelledby="add-member-email-them"
        onclick={() => (form.emailThem = !form.emailThem)}
      >
        <span class="track" aria-hidden="true"></span>
        <span>{form.emailThem ? "Yes, when they're added" : "Not now"}</span>
      </button>
    </div>
    <!-- Two lines whichever it says, so the switch never moves the footer -->
    <p class="hint">
      {form.emailThem
        ? "They're in straight away, and we'll email them a link to the app; they sign in with this email."
        : "They're in straight away, and nothing's sent. They sign in with this email; send the link from their card later."}
    </p>
  </form>
  {#snippet footer()}
    <button class="btn primary" type="submit" form="add-member" disabled={busy}
      >{form.emailThem ? "Add and email them" : "Add"}</button
    >
  {/snippet}
</Sheet>

<style>
  .hint {
    margin: 0;
    min-height: 2lh;
  }
</style>
