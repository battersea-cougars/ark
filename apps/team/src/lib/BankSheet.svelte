<script lang="ts">
  // The club's bank details (ADR 0007): where members pay by transfer. On every member's Dues page and in every
  // reminder, so no reminder goes without them. For whoever sets fees. A short form that never grows: a sheet.
  import Sheet from "./Sheet.svelte";
  import { saveBank } from "../app/backend.svelte";
  import { db } from "../demo/store.svelte";
  import { Edits } from "./dirty.svelte";
  import SaveBar from "./SaveBar.svelte";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  let name = $state("");
  let sortCode = $state("");
  let account = $state("");
  // Unsaved changes: Save lights up, and closing asks first (lib/dirty.svelte.ts)
  const edits = new Edits();
  edits.watch(() => ({ name, sortCode, account }));
  // Each time it opens: what's saved now
  $effect(() => {
    if (!open) return;
    const b = db.settings.bank;
    name = b?.name ?? "";
    sortCode = b?.sortCode ?? "";
    account = b?.account ?? "";
    edits.reset();
  });

  // Saved, it closes; the shell says so
  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (await edits.run(() => saveBank({ name, sortCode, account }))) open = false;
  }
</script>

<Sheet bind:open title="The club's bank details" {edits}>
  <form class="form" id="bank-form" onsubmit={save}>
    <label class="field">
      Account name
      <input
        class="input"
        required
        maxlength="60"
        autocomplete="off"
        placeholder="As the bank has it"
        bind:value={name}
      />
    </label>
    <div class="two">
      <label class="field">
        Sort code
        <input
          class="input num"
          required
          inputmode="numeric"
          autocomplete="off"
          pattern="\d\d-?\d\d-?\d\d"
          placeholder="12-34-56"
          bind:value={sortCode}
        />
      </label>
      <label class="field">
        Account number
        <input
          class="input num"
          required
          inputmode="numeric"
          autocomplete="off"
          pattern="\d{8}"
          placeholder="8 digits"
          bind:value={account}
        />
      </label>
    </div>
    <p class="hint">
      Every member sees these on their Dues page, with their own reference, and every reminder says them. It's on the
      record when they change.
    </p>
  </form>
  {#snippet footer()}<SaveBar {edits} form="bank-form" />{/snippet}
</Sheet>
