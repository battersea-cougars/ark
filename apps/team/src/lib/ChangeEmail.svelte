<script lang="ts">
  // Your sign-in email (ADR 0023), at the top of your details on the You page: shown, and changed by you. A code goes
  // to the new address; typed here, the address is yours from then on, everything you've done stays yours, and your
  // other devices sign in again with it (worker/members/members.email.ts). Its own form: the details' form is beside it.
  import { askEmailCode, confirmEmailCode } from "../app/backend.svelte";

  let { email, disabled = false }: { email: string; disabled?: boolean } = $props();

  type Step = "show" | "address" | "code";
  let step = $state<Step>("show");
  // What the server last said it is: the page's copy of the club catches up on its own
  let changed = $state<string | null>(null);
  const shown = $derived(changed ?? email);
  let address = $state("");
  let code = $state("");
  let sent = $state("");
  let devCode = $state("");
  let busy = $state(false);

  function go(to: Step) {
    step = to;
    if (to === "show") address = "";
    code = "";
  }
  async function send(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    const r = await askEmailCode(address.trim());
    busy = false;
    if (!r) return;
    sent = r.message;
    // On your own machine nothing is emailed: the code comes back here
    devCode = r.devCode ?? "";
    code = devCode;
    step = "code";
  }
  async function confirm(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    const r = await confirmEmailCode(code);
    busy = false;
    if (!r) return;
    changed = r.email;
    go("show");
  }
</script>

{#if step === "show"}
  <div class="field">
    <span id="email-label">Email <span class="hint">· you sign in with it</span></span>
    <div class="line">
      <input class="input" type="email" value={shown} readonly aria-labelledby="email-label" />
      <button class="btn ghost" type="button" {disabled} onclick={() => go("address")}>Change</button>
    </div>
  </div>
{:else if step === "address"}
  <form class="form" onsubmit={send}>
    <label class="field">
      <span>New email <span class="hint">· we'll send a code there to check it's yours</span></span>
      <input class="input" type="email" autocomplete="email" maxlength="254" required bind:value={address} />
    </label>
    <div class="line">
      <button class="btn primary" disabled={busy}>Send code</button>
      <button class="btn ghost" type="button" onclick={() => go("show")}>Cancel</button>
    </div>
  </form>
{:else}
  <form class="form" onsubmit={confirm}>
    <p class="hint">
      {sent}
      {#if devCode}On this machine nothing is emailed: it's <b class="num">{devCode}</b>.{/if}
    </p>
    <label class="field">
      The 6-digit code
      <input
        class="input num code"
        inputmode="numeric"
        autocomplete="one-time-code"
        pattern="[0-9 ]*"
        maxlength="7"
        required
        bind:value={code}
      />
    </label>
    <div class="line">
      <button class="btn primary" disabled={busy}>Change my email</button>
      <button class="btn ghost" type="button" onclick={() => go("address")}>Use another email</button>
    </div>
  </form>
{/if}

<style>
  .line {
    display: flex;
    gap: var(--s-2);
    align-items: center;
  }
  .line .input {
    flex: 1;
    min-width: 0;
  }
  .form .hint {
    margin: 0;
  }
  .code {
    font-size: 1.5rem;
    letter-spacing: 0.3em;
    text-align: center;
  }
</style>
