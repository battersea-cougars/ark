<script lang="ts">
  // Signing in (ADR 0023): your email, then the 6-digit code from the email, typed here, where you asked for it.
  // Someone new asks to join instead, and an admin lets them in. Shown by main.ts whenever nobody's signed in; it
  // reloads the app once they are. It reads nothing of the club's.
  import Icon from "../app/shell/Icon.svelte";
  import { POSITION_ICONS } from "../demo/data";
  import { api } from "../app/api";
  import mark from "../assets/cougars-mark.webp";
  import PrivacyNotice from "../lib/PrivacyNotice.svelte";
  import { humanCheck } from "../lib/turnstile";

  // The app's privacy notice is readable before signing in too (#30): at /privacy, or from the link at the foot
  type Step = "email" | "code" | "join" | "asked" | "privacy";
  let step = $state<Step>(location.pathname === "/privacy" ? "privacy" : "email");
  // The link in a new member's welcome email fills in their address (ADR 0069)
  let email = $state(new URLSearchParams(location.search).get("email") ?? "");
  let code = $state("");
  let busy = $state(false);
  let error = $state("");
  let note = $state("");
  // A person asking, not a script (#13): Turnstile's token goes with each, unseen unless Cloudflare wants a tap
  const signInCheck = humanCheck("sign-in");
  const joinCheck = humanCheck("join");
  // On your own machine nothing is emailed, so the server hands the code back
  let devCode = $state("");
  let join = $state({ name: "", email: "", phone: "", position: "F" });

  async function run(task: () => Promise<void>) {
    busy = true;
    error = "";
    try {
      await task();
    } catch (e) {
      error = e instanceof Error ? e.message : "Something went wrong.";
    } finally {
      busy = false;
    }
  }

  const send = () =>
    run(async () => {
      const turnstile = await signInCheck.token();
      const r = await api<{ message: string; devCode?: string }>("POST", "/api/auth/start", {
        email,
        turnstile,
      }).finally(signInCheck.reset);
      note = r.message;
      devCode = r.devCode ?? "";
      code = devCode;
      step = "code";
    });

  const verify = () =>
    run(async () => {
      await api("POST", "/api/auth/verify", { code });
      location.replace("/");
    });

  const ask = () =>
    run(async () => {
      const turnstile = await joinCheck.token();
      const r = await api<{ message: string }>("POST", "/api/auth/request", { ...join, turnstile }).finally(
        joinCheck.reset,
      );
      note = r.message;
      step = "asked";
    });

  function go(to: Step) {
    error = "";
    step = to;
    const path = to === "privacy" ? "/privacy" : "/";
    if (location.pathname !== path) history.replaceState(null, "", path);
  }
</script>

<main class="signin">
  <div class="panel rise" class:wide={step === "privacy"}>
    <img class="mark" src={mark} alt="" width="72" height="72" />
    <p class="eyebrow">Battersea Cougars</p>

    {#if step === "email"}
      <h1 class="display">Sign in</h1>
      <form
        class="form"
        onsubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <label class="field">
          Your email
          <input class="input" type="email" autocomplete="email" required bind:value={email} />
        </label>
        <!-- Turnstile: empty unless Cloudflare wants a tap -->
        <div class="human" {@attach signInCheck.attach}></div>
        <button class="btn primary block" disabled={busy}>Send me a code</button>
      </form>
      <p class="hint">New to the club? <button class="link" onclick={() => go("join")}>Ask to join</button></p>
    {:else if step === "code"}
      {#if devCode}
        <h1 class="display">Your code</h1>
        <p class="flag">On this machine nothing is emailed. Your code is <b class="num">{devCode}</b>.</p>
      {:else}
        <h1 class="display">Check your email</h1>
        <p class="hint">{note}</p>
      {/if}
      <form
        class="form"
        onsubmit={(e) => {
          e.preventDefault();
          verify();
        }}
      >
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
        <button class="btn primary block" disabled={busy}>Sign in</button>
      </form>
      {#if devCode}
        <p class="hint">Not you? <button class="link" onclick={() => go("email")}>Use another email</button></p>
      {:else}
        <p class="hint">
          Nothing came? <button class="link" onclick={() => go("email")}>Try again</button> or check your spam.
        </p>
      {/if}
    {:else if step === "join"}
      <h1 class="display">Ask to join</h1>
      <p class="hint">An admin lets you in; then you sign in with this email.</p>
      <form
        class="form"
        onsubmit={(e) => {
          e.preventDefault();
          ask();
        }}
      >
        <label class="field">
          Your name
          <input class="input" autocomplete="name" required maxlength="80" bind:value={join.name} />
        </label>
        <label class="field">
          Email
          <input class="input" type="email" autocomplete="email" required bind:value={join.email} />
        </label>
        <label class="field">
          Phone (optional)
          <input class="input" type="tel" autocomplete="tel" maxlength="30" bind:value={join.phone} />
        </label>
        <div class="field">
          <span id="join-position">Position</span>
          <div class="seg block" role="group" aria-labelledby="join-position">
            {#each [["F", "Forward"], ["D", "Defence"], ["G", "Keeper"]] as [v, label] (v)}
              <button type="button" aria-pressed={join.position === v} onclick={() => (join.position = v)}>
                <Icon name={POSITION_ICONS[v as "F" | "D" | "G"]} size={18} />{label}
              </button>
            {/each}
          </div>
        </div>
        <div class="human" {@attach joinCheck.attach}></div>
        <button class="btn primary block" disabled={busy}>Ask to join</button>
      </form>
      <p class="hint">Already a member? <button class="link" onclick={() => go("email")}>Sign in</button></p>
    {:else if step === "privacy"}
      <h1 class="display">Privacy</h1>
      <PrivacyNotice />
      <button class="btn outline block" onclick={() => go("email")}>Back to sign in</button>
    {:else}
      <h1 class="display">Asked</h1>
      <p class="hint">{note}</p>
      <button class="btn outline block" onclick={() => go("email")}>Back to sign in</button>
    {/if}

    <!-- Room for one line, kept, so an error doesn't push the page about -->
    <p class="error" role="alert">{error}</p>
    {#if step !== "privacy"}
      <p class="hint small"><button class="link" onclick={() => go("privacy")}>Privacy</button></p>
    {/if}
  </div>
</main>

<style>
  /* Next to no room (its gap given back; Turnstile's own empty box stays) until Cloudflare puts its tap there */
  .human {
    display: flex;
    justify-content: center;
    margin-top: calc(-1 * var(--s-4));
  }
  .signin {
    display: grid;
    place-items: center;
    min-height: 100dvh;
    padding: var(--s-6) var(--gutter);
  }
  .panel {
    display: grid;
    gap: var(--s-4);
    width: min(24rem, 100%);
    padding: var(--s-8) var(--s-6) var(--s-5);
    border-radius: var(--r-xl);
    background: var(--surface-1);
    box-shadow: 0 30px 80px -30px rgb(0 0 0 / 0.8);
  }
  /* The privacy notice reads at a comfortable measure */
  .panel.wide {
    width: min(42rem, 100%);
  }
  .mark {
    justify-self: center;
    width: 4.5rem;
    height: auto;
  }
  .eyebrow {
    margin-bottom: calc(-1 * var(--s-3));
    text-align: center;
  }
  h1 {
    color: var(--fg);
    font-size: 2.25rem;
    font-style: italic;
    text-align: center;
  }
  .hint {
    text-align: center;
  }
  .flag {
    padding: var(--s-3);
    border-radius: var(--r-md);
    background: var(--surface-2);
    color: var(--fg-body);
    font-size: var(--text-sm);
  }
  .flag b {
    color: var(--fg);
    letter-spacing: 0.1em;
  }
  .code {
    font-size: 1.5rem;
    letter-spacing: 0.3em;
    text-align: center;
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--fg);
    font: inherit;
    text-decoration: underline;
    text-underline-offset: 0.2em;
    cursor: pointer;
  }
  .error {
    min-height: 1.45em;
    margin: 0;
    color: var(--red-hot);
    font-size: var(--text-sm);
    text-align: center;
  }
</style>
