<script lang="ts">
  // The club's bank details (ADR 0007): where members pay by transfer. On every member's Dues page and in every
  // reminder, so no reminder goes without them. For whoever sets fees. A short form that never grows: a sheet.
  import Sheet from "./Sheet.svelte";
  import { saveBank } from "../app/backend.svelte";
  import { db } from "../demo/store.svelte";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  let name = $state("");
  let sortCode = $state("");
  let account = $state("");
  // Each time it opens: what's saved now
  $effect(() => {
    if (!open) return;
    const b = db.settings.bank;
    name = b?.name ?? "";
    sortCode = b?.sortCode ?? "";
    account = b?.account ?? "";
  });

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (await saveBank({ name, sortCode, account })) open = false;
  }
</script>

<Sheet bind:open title="The club's bank details">
  <form class="form" onsubmit={save}>
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
    <button class="btn primary">Save</button>
  </form>
</Sheet>
