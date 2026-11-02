<script lang="ts">
  // Your sign-in email (ADR 0023), at the top of your details on the You page: shown, and changed by you in a sheet over
  // the page. Two codes go out: one to the new address and one to the address you have now, so someone with your phone
  // alone can't move your account. Both typed here (the current address's first), the new address is yours from then
  // on, everything you've done stays yours, and your other devices sign in again with it (worker/members/members.email.ts).
  // With no address yet, only the new one's code. Lost your old inbox? An admin changes it on your member page.
  import Sheet from "./Sheet.svelte";
  import { askEmailCode, confirmEmailCode } from "../app/backend.svelte";

  let { email, disabled = false }: { email: string; disabled?: boolean } = $props();

  type Step = "address" | "codes";
  let open = $state(false);
  let step = $state<Step>("address");
  // What the server last said it is: the page's copy of the club catches up on its own
  let changed = $state<string | null>(null);
  const shown = $derived(changed ?? email);
  let address = $state("");
  let code = $state("");
  let currentCode = $state("");
  let sent = $state("");
  let devCode = $state("");
  let devCurrentCode = $state("");
  let busy = $state(false);

  function start() {
    address = "";
    go("address");
    open = true;
  }
  function go(to: Step) {
    step = to;
    code = "";
    currentCode = "";
  }
  async function send(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    const r = await askEmailCode(address.trim());
    busy = false;
    if (!r) return;
    sent = r.message;
    go("codes");
    // On your own machine nothing is emailed: the codes come back here
    devCode = r.devCode ?? "";
    devCurrentCode = r.devCurrentCode ?? "";
    code = devCode;
    currentCode = devCurrentCode;
  }
  async function confirm(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    const r = await confirmEmailCode(code, currentCode);
    busy = false;
    if (!r) return;
    changed = r.email;
    open = false;
  }
</script>

<div class="field">
  <span id="email-label">Email <span class="hint">· you sign in with it</span></span>
  <div class="line">
    <input class="input" type="email" value={shown} readonly aria-labelledby="email-label" />
    <button class="btn ghost" type="button" {disabled} onclick={start}>Change</button>
  </div>
</div>

<Sheet bind:open title="Change your email" sub={shown ? `You sign in with ${shown} now` : undefined}>
  {#if step === "address"}
    <form class="form" id="change-email" onsubmit={send}>
      <label class="field">
        <span
          >New email <span class="hint"
            >· {shown
              ? "we'll send a code there, and one to the address you have now"
              : "we'll send a code there to check it's yours"}</span
          ></span
        >
        <input class="input" type="email" autocomplete="email" maxlength="254" required bind:value={address} />
      </label>
    </form>
  {:else}
    <form class="form" id="change-email" onsubmit={confirm}>
      <p class="hint">
        {sent}
        {#if devCode || devCurrentCode}On this machine nothing is emailed: they're filled in.{/if}
      </p>
      {#if shown}
        <label class="field">
          <span>The code sent to <b>{shown}</b></span>
          <input
            class="input num code"
            inputmode="numeric"
            autocomplete="one-time-code"
            pattern="[0-9 ]*"
            maxlength="7"
            required
            bind:value={currentCode}
          />
        </label>
      {/if}
      <label class="field">
        <span>The code sent to <b>{address.trim()}</b></span>
        <input
          class="input num code"
          inputmode="numeric"
          autocomplete={shown ? "off" : "one-time-code"}
          pattern="[0-9 ]*"
          maxlength="7"
          required
          bind:value={code}
        />
      </label>
      {#if shown}
        <p class="hint small">Can't get into {shown} any more? Ask an admin to change it for you.</p>
      {/if}
    </form>
  {/if}
  {#snippet footer()}
    {#if step === "address"}
      <button class="btn ghost" type="button" onclick={() => (open = false)}>Cancel</button>
      <button class="btn primary" form="change-email" disabled={busy}>Send {shown ? "codes" : "code"}</button>
    {:else}
      <button class="btn ghost" type="button" onclick={() => go("address")}>Use another email</button>
      <button class="btn primary" form="change-email" disabled={busy}>Change my email</button>
    {/if}
  {/snippet}
</Sheet>

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
  .field b {
    overflow-wrap: anywhere;
  }
  .code {
    font-size: 1.5rem;
    letter-spacing: 0.3em;
    text-align: center;
  }
</style>
