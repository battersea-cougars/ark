<script lang="ts">
  // Settings → Email (ADR 0027, #101): whether the club's email works, and reconnecting it when Google has cancelled
  // its access (a password change on the sending account, its access removed, or 6 months unused). Then nobody gets a
  // sign-in code, so the admins hear on Home and on their phones, and fix it here: "Reconnect email" opens Google's
  // consent page in this browser and comes back to this page, which says how it went. It works at once, no deploy.
  // Busy or rate-limited Gmail (ADR 0055) is told apart: that one passes by itself. "Send a test email" sends one to the
  // admin who presses it, and nobody else, the way every email goes, and says how it went.
  import { api } from "../app/api";
  import { inApp } from "../app/native";
  import Icon from "../app/shell/Icon.svelte";
  import PageHeader from "../lib/PageHeader.svelte";
  import { formatDayDate, formatTime } from "../lib/dates";

  interface Status {
    account: string | null;
    from: string | null;
    source: "reconnected" | "deployed" | null;
    lastSentAt: string | null;
    failedAt: string | null;
    failure: "cancelled" | "paused" | "failed" | null;
    pausedUntil: string | null;
    reconnectedAt: string | null;
    reconnectedBy: { id: number; name: string } | null;
    canReconnect: boolean;
    /** How the last trip through Google ended, from the record: said here whatever this page's address says. */
    lastAttempt: { outcome: string; at: string; by: { id: number; name: string } | null } | null;
  }

  // How the trip through Google ended (/api/mail/callback lands here with ?email=)
  const BACK: Record<string, { ok: boolean; text: string }> = {
    reconnected: { ok: true, text: "Reconnected. Email sends again, from now on." },
    denied: { ok: false, text: "Nothing changed: Google's page was cancelled." },
    "no-send": {
      ok: false,
      text: "Nothing changed: \"Send email on your behalf\" wasn't ticked on Google's page. Try again and tick it.",
    },
    club: {
      ok: false,
      text: "Nothing changed: that's the club's own account. Sign in to Google as the sending account (the developer one) instead.",
    },
    expired: { ok: false, text: "That took too long, or came back to another browser. Press Reconnect email again." },
    failed: { ok: false, text: "Google didn't give the app a new token. Try again in a minute." },
  };
  const said = new URLSearchParams(location.search).get("email");
  const back = said ? BACK[said] : undefined;
  // Said once: a reload or a shared link doesn't say it again
  if (said) history.replaceState(history.state, "", location.pathname);

  let status = $state<Status | null>(null);
  let error = $state("");
  let going = $state(false);

  async function load() {
    error = "";
    try {
      status = await api<Status>("GET", "/api/mail");
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  void load();

  async function reconnect() {
    going = true;
    error = "";
    try {
      const { url } = await api<{ url: string }>("POST", "/api/mail/reconnect", {});
      location.assign(url);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      going = false;
    }
  }

  // "Send a test email": how it went, in words (POST /api/mail/test)
  type Tested = {
    result: "sent" | "logged" | "cancelled" | "paused" | "failed" | "refused";
    to: string[];
    refused?: string;
  };
  let testing = $state(false);
  let tested = $state<{ ok: boolean; text: string } | null>(null);

  function testSaid({ result, to, refused }: Tested) {
    switch (result) {
      case "sent":
        return { ok: true, text: `Sent to ${to.join(", ")}. Check your inbox.` };
      case "logged":
        return { ok: false, text: "No email is set up here: it was written to the log, not sent." };
      case "cancelled":
        return { ok: false, text: "It didn't go: Google has cancelled the app's access. Reconnect email, below." };
      case "paused":
        return { ok: false, text: "It didn't go: Gmail is busy. It passes by itself; try again later." };
      case "refused":
        return { ok: false, text: `It didn't go: ${refused ?? "the app wouldn't send it here."}` };
      default:
        return { ok: false, text: "It didn't go: Gmail didn't take it. Try again in a minute." };
    }
  }

  async function sendTest() {
    testing = true;
    tested = null;
    try {
      tested = testSaid(await api<Tested>("POST", "/api/mail/test", {}));
      await load();
    } catch (e) {
      tested = { ok: false, text: e instanceof Error ? e.message : String(e) };
    } finally {
      testing = false;
    }
  }

  const when = (iso: string) => `${formatDayDate(iso)}, ${formatTime(iso)}`;
  const stopped = $derived(status?.failure === "cancelled");
  // The last try, unless the address has just said it
  const lastTry = $derived.by(() => {
    const t = status?.lastAttempt;
    if (!t || (back && said === t.outcome)) return null;
    const by = t.by ? ` by ${t.by.name}` : "";
    return {
      ok: t.outcome === "reconnected",
      text: `Last try, ${when(t.at)}${by}: ${BACK[t.outcome]?.text ?? t.outcome}`,
    };
  });
</script>

<div class="page">
  <PageHeader title="Email" subtitle="Sign-in codes, invites and reminders all go out through one Gmail account." />

  {#if back}
    <p class="said" class:ok={back.ok} role="status">
      <Icon name={back.ok ? "check" : "alert"} size={18} />{back.text}
    </p>
  {/if}
  {#if error}<p class="error">{error}</p>{/if}

  {#if status === null}
    {#if !error}<p class="hint">Reading…</p>{/if}
  {:else}
    <section class="part">
      <h2 class="section-title">
        {#if stopped}
          <Icon name="alert" size={18} /> Email has stopped
        {:else if status.failure === "paused"}
          <Icon name="clock" size={18} /> Gmail is busy
        {:else if status.failure === "failed"}
          <Icon name="alert" size={18} /> The last email didn't go
        {:else if status.lastSentAt}
          <Icon name="check" size={18} /> Email works
        {:else}
          <Icon name="mail" size={18} /> Nothing sent yet
        {/if}
      </h2>
      <p class="hint">
        {#if stopped}
          Google cancelled the app's access{status.failedAt ? ` on ${when(status.failedAt)}` : ""}: the sending
          account's password changed, its access was removed, or it went unused for 6 months. Nobody gets a sign-in code
          until it's reconnected.
        {:else if status.failure === "paused"}
          Gmail is rate-limiting the account, so emails wait{status.pausedUntil
            ? ` until about ${formatTime(status.pausedUntil)}`
            : ""}. It passes by itself: there's nothing to reconnect.
        {:else if status.failure === "failed"}
          {status.failedAt ? `Since ${when(status.failedAt)}. ` : ""}Gmail didn't take it. If it goes on, try
          reconnecting.
        {:else if status.lastSentAt}
          Last sent {when(status.lastSentAt)}.
        {:else}
          No email has gone through Gmail here yet.
        {/if}
      </p>
    </section>

    <dl class="facts">
      <dt>Sends from</dt>
      <dd>{status.account ?? "Not known yet: it shows once an email has gone"}</dd>
      <dt>Members see it from</dt>
      <dd>{status.from ?? "The same address"}</dd>
      <dt>Connected</dt>
      <dd>
        {#if status.source === "reconnected" && status.reconnectedAt}
          Reconnected {when(status.reconnectedAt)}{status.reconnectedBy ? ` by ${status.reconnectedBy.name}` : ""}
        {:else if status.source === "deployed"}
          At set-up
        {:else}
          Not set up here: emails are written to the log
        {/if}
      </dd>
    </dl>

    <section class="part">
      <h2 class="section-title">Send a test email</h2>
      <p class="hint">
        One email to you, and only you, the way every email goes. It says which account sent it and with which token.
      </p>
      <div>
        <button class="btn" onclick={sendTest} disabled={testing}>
          <Icon name="mail" size={16} />{testing ? "Sending…" : "Send a test email"}
        </button>
      </div>
      <!-- Room kept for the answer, so nothing moves when it comes -->
      <p class="said tested" class:ok={tested?.ok} role="status">
        {#if tested}<Icon name={tested.ok ? "check" : "alert"} size={18} />{tested.text}{/if}
      </p>
    </section>

    <section class="part">
      <h2 class="section-title">Reconnect email</h2>
      <p class="hint">
        Google's page opens: sign in as the sending account ({status.account ?? "the developer one"}), never the club's
        own, choose "Advanced", then "Go to Battersea Cougars", and tick <strong>Send email on your behalf</strong>. You
        come back here.
      </p>
      {#if lastTry}
        <p class="said tried" class:ok={lastTry.ok}>
          <Icon name={lastTry.ok ? "check" : "alert"} size={18} />{lastTry.text}
        </p>
      {/if}
      {#if inApp}
        <p class="hint">Google doesn't sign in inside the app: do this from the team app in a browser.</p>
      {:else if !status.canReconnect}
        <p class="hint">Reconnecting isn't set up here yet (README, Gmail).</p>
      {/if}
      <div>
        <button
          class="btn"
          class:primary={stopped}
          onclick={reconnect}
          disabled={going || inApp || !status.canReconnect}
        >
          <Icon name="refresh" size={16} />{going ? "Opening Google…" : "Reconnect email"}
        </button>
      </div>
    </section>
  {/if}
</div>

<style>
  .part {
    display: grid;
    gap: var(--s-2);
    margin-bottom: var(--s-5);
  }
  .part .section-title,
  .part .hint {
    margin: 0;
  }
  .section-title {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  .facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--s-2) var(--s-4);
    margin: 0 0 var(--s-5);
  }
  .facts dt {
    color: var(--fg-muted);
  }
  .facts dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--fg);
  }
  .said {
    display: flex;
    align-items: flex-start;
    gap: var(--s-2);
    margin: 0 0 var(--s-4);
  }
  .said.ok {
    color: var(--fg);
  }
  .said.tried {
    margin: 0;
  }
  .said.tested {
    margin: 0;
    min-height: 3em;
  }
  .btn {
    gap: var(--s-1);
  }
  .error {
    color: var(--red-hot);
  }
  @media (max-width: 30rem) {
    .facts {
      grid-template-columns: 1fr;
      gap: var(--s-1);
    }
    .facts dd {
      margin-bottom: var(--s-2);
    }
  }
</style>
