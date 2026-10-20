<script lang="ts">
  // Your data (#30, ADR 0029), rows near the foot of your You page: download everything the app holds about you, the
  // privacy notice, or delete your account. Deleting asks first, in a sheet that says what goes and what the club keeps; then you're signed out
  // everywhere and the app goes back to its sign-in screen.
  import { api } from "../app/api";
  import Icon from "../app/shell/Icon.svelte";
  import Sheet from "./Sheet.svelte";

  import type { Snippet } from "svelte";

  /** `children`: rows after these (Sign out). */
  let { disabled = false, children }: { disabled?: boolean; children?: Snippet } = $props();

  let asking = $state(false);
  let busy = $state(false);
  let error = $state("");

  // A file to keep, named for the day: the browser downloads it
  function download() {
    const a = document.createElement("a");
    a.href = "/api/me/data";
    a.download = "";
    a.click();
  }

  async function remove() {
    busy = true;
    error = "";
    try {
      await api("DELETE", "/api/me");
      location.replace("/");
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      busy = false;
    }
  }
</script>

<section class="data" aria-labelledby="your-data">
  <h2 class="section-title" id="your-data">Your account</h2>
  <div class="list">
    <button class="row" type="button" {disabled} onclick={download}>
      <span class="glyph"><Icon name="download" /></span>
      <span class="grow"
        ><span class="title">Download my data</span><span class="sub">Details, sign-ups, payments, devices</span></span
      >
    </button>
    <a class="row" href="/privacy">
      <span class="glyph"><Icon name="shield" /></span>
      <span class="grow"
        ><span class="title">Privacy</span><span class="sub">What the club keeps, and for how long</span></span
      >
      <Icon name="chevronRight" size={18} />
    </a>
    <button class="row danger" type="button" {disabled} onclick={() => (asking = true)}>
      <span class="glyph"><Icon name="userMinus" /></span>
      <span class="grow"><span class="title">Delete my account</span></span>
    </button>
    {@render children?.()}
  </div>
</section>

<Sheet bind:open={asking} title="Delete your account?">
  <div class="ask">
    <p>
      Your name, email, phone, bio and roles go now, and you're signed out on every device. You can't sign in again with
      this email; to come back, ask an admin to add you.
    </p>
    <p class="hint">
      What the club must keep stays, about a "Former member" nobody can name: that someone played a Friday, and payments
      in its accounts. Places you'd taken for what's still to come are given up.
    </p>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </div>
  {#snippet footer()}
    <button class="btn ghost" type="button" onclick={() => (asking = false)}>Keep my account</button>
    <button class="btn delete" type="button" disabled={busy} onclick={remove}>Delete my account</button>
  {/snippet}
</Sheet>

<style>
  .data {
    display: grid;
    gap: var(--s-3);
  }
  .sub {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Delete in red words; asked, the one red fill is the tap that does it */
  .danger .title,
  .danger .glyph {
    color: var(--red-hot);
  }
  .row:disabled {
    cursor: default;
    opacity: 0.55;
  }
  .ask {
    display: grid;
    gap: var(--s-3);
  }
  .ask p {
    margin: 0;
  }
  .delete {
    background: var(--red);
    color: var(--on-red);
  }
  .delete:hover:not(:disabled) {
    background: var(--red-hot);
  }
  .error {
    color: var(--red-hot);
  }
</style>
