<script lang="ts">
  // Your sign-in email (ADR 0023), a row in the You page's Account tab: shown, and changed by you in a sheet. A code
  // goes to the new address; typed here, the address is yours from then on, everything you've done stays yours, and
  // your other devices sign in again with it (worker/members/members.email.ts). The sheet's buttons sit in its footer,
  // like every sheet's (ADR 0065).
  import Icon from "../app/shell/Icon.svelte";
  import Sheet from "./Sheet.svelte";
  import { askEmailCode, confirmEmailCode } from "../app/backend.svelte";

  let { email, disabled = false }: { email: string; disabled?: boolean } = $props();

  type Step = "address" | "code";
  let open = $state(false);
  let step = $state<Step>("address");
  // What the server last said it is: the page's copy of the club catches up on its own
  let changed = $state<string | null>(null);
  const shown = $derived(changed ?? email);
  let address = $state("");
  let code = $state("");
  let sent = $state("");
  let devCode = $state("");
  let busy = $state(false);

  function start() {
    step = "address";
    address = "";
    code = "";
    open = true;
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
    open = false;
  }
</script>

<button class="row" type="button" {disabled} onclick={start}>
  <span class="glyph"><Icon name="mail" /></span>
  <span class="grow"><span class="title">Email</span><span class="sub">{shown} · you sign in with it</span></span>
  <span class="change">Change</span>
</button>

<Sheet bind:open title="Change your email">
  {#if step === "address"}
    <form id="email-address" class="form" onsubmit={send}>
      <label class="field">
        <span>New email <span class="hint">· we'll send a code there to check it's yours</span></span>
        <input class="input" type="email" autocomplete="email" maxlength="254" required bind:value={address} />
      </label>
    </form>
  {:else}
    <form id="email-code" class="form" onsubmit={confirm}>
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
    </form>
  {/if}
  {#snippet footer()}
    {#if step === "address"}
      <button class="btn ghost" type="button" onclick={() => (open = false)}>Cancel</button>
      <button class="btn primary" type="submit" form="email-address" disabled={busy}>Send code</button>
    {:else}
      <button class="btn ghost" type="button" onclick={() => (step = "address")}>Use another email</button>
      <button class="btn primary" type="submit" form="email-code" disabled={busy}>Change my email</button>
    {/if}
  {/snippet}
</Sheet>

<style>
  .sub {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .change {
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  .row:disabled {
    cursor: default;
    opacity: 0.55;
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
