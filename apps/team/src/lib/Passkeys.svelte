<script lang="ts">
  // Your passkeys (ADR 0023), on the You page: "Use Face ID next time" adds one on this device, and each you have is a
  // row, by device and the day you added it, with Remove. Signing in with one needs no email, so it works while Gmail's
  // down; the emailed code is still there for a new phone. Removing asks first, in a sheet.
  import Icon from "../app/shell/Icon.svelte";
  import Sheet from "./Sheet.svelte";
  import { addPasskey, checkName, myPasskeys, passkeysWork, removePasskey, type Passkey } from "../app/passkeys";
  import { formatDayDate } from "./dates";

  let { disabled = false }: { disabled?: boolean } = $props();

  const works = passkeysWork();
  const check = checkName();
  let list = $state<Passkey[] | null>(null);
  let busy = $state(false);
  let note = $state("");
  let failed = $state(false);
  let removing = $state<Passkey | null>(null);
  let sheetOpen = $state(false);

  myPasskeys()
    .then((p) => (list = p))
    .catch(() => (list = []));

  async function add() {
    busy = true;
    note = "";
    failed = false;
    try {
      const added = await addPasskey();
      if (added) {
        list = added;
        note = `Done. Next time it's ${check}, not your inbox.`;
      }
    } catch (e) {
      failed = true;
      note = e instanceof Error ? e.message : "Your device couldn't add one. Try again.";
    } finally {
      busy = false;
    }
  }
  function askRemove(p: Passkey) {
    removing = p;
    sheetOpen = true;
  }
  async function remove() {
    if (!removing) return;
    busy = true;
    try {
      await removePasskey(removing.id);
      list = (list ?? []).filter((p) => p.id !== removing!.id);
      note = "Removed. That device signs in with a code now.";
      failed = false;
      sheetOpen = false;
    } catch (e) {
      failed = true;
      note = e instanceof Error ? e.message : "Couldn't remove it.";
    } finally {
      busy = false;
    }
  }
  const day = (iso: string) => formatDayDate(iso);
</script>

<section class="passkeys" aria-labelledby="passkeys-title">
  <h2 class="section-title" id="passkeys-title">Passkeys</h2>
  <p class="hint">
    {works
      ? "Sign in with your face, finger or PIN. No code, no inbox, works when Gmail doesn't."
      : "This browser can't use passkeys. Sign in with a code here, or add one from your phone."}
  </p>
  <div class="list">
    {#each list ?? [] as p (p.id)}
      <div class="row">
        <span class="glyph"><Icon name="key" /></span>
        <span class="grow">
          <span class="title">{p.name}</span>
          <span class="sub">Added {day(p.createdAt)}{p.lastUsedAt ? ` · last used ${day(p.lastUsedAt)}` : ""}</span>
        </span>
        <button class="btn ghost sm" type="button" {disabled} onclick={() => askRemove(p)}>Remove</button>
      </div>
    {/each}
    {#if works}
      <button class="row" type="button" disabled={disabled || busy} onclick={add}>
        <span class="glyph"><Icon name="plus" /></span>
        <span class="grow">
          <span class="title">Use {check} next time</span>
          <span class="sub"
            >{list?.length
              ? "For this device, if it hasn't one yet"
              : "Skip the six digits. Your face is your ticket."}</span
          >
        </span>
      </button>
    {/if}
  </div>
  <!-- One line kept, so a note never pushes the page about -->
  <p class="hint note" class:failed role="status">{note}</p>
</section>

<Sheet bind:open={sheetOpen} title="Remove this passkey?">
  <p class="hint">
    {removing?.name} won't sign you in any more. You stay signed in where you are; next time there, it's a code.
  </p>
  {#snippet footer()}
    <button class="btn ghost" type="button" onclick={() => (sheetOpen = false)}>Keep it</button>
    <button class="btn delete" type="button" disabled={busy} onclick={remove}>Remove it</button>
  {/snippet}
</Sheet>

<style>
  .passkeys {
    display: grid;
    gap: var(--s-3);
  }
  .section-title {
    margin: var(--s-4) 0 0;
  }
  .hint {
    margin: 0;
  }
  .sub {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .note {
    min-height: 1.45em;
    font-size: var(--text-sm);
  }
  .note.failed {
    color: var(--red-hot);
  }
  .row:disabled {
    cursor: default;
    opacity: 0.55;
  }
</style>
