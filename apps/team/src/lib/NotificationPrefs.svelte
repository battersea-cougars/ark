<script lang="ts">
  // Notifications (ADR 0108, #24), on your profile: a switch for each kind, every one on until you turn it off. The
  // choice is yours, not a device's: whichever phone or browser you sign in on follows it. A switch answers at once;
  // the server's reply puts it right if it failed (backend.svelte.ts save). In a browser, first, this device's own
  // switch (Web Push, app/web-push.ts): permission only ever from its tap; on an iPhone in a Safari tab, the way to
  // them instead (the app on the Home Screen).
  import { chooseNotification } from "../app/backend.svelte";
  import { inApp } from "../app/native";
  import { turnOff, turnOn, webPush, webPushHere } from "../app/web-push";
  import { db } from "../demo/store.svelte";
  import { TOPICS, type Topic } from "./notification-topics";
  import { can } from "../access/actions";
  import { realGranted } from "../demo/session.svelte";

  let { disabled = false }: { disabled?: boolean } = $props();

  // A topic for one job (the email stopping, for whoever looks after it) is only theirs to switch
  const topics = $derived(TOPICS.filter((t) => !("action" in t) || can(realGranted(), t.action)));

  function flip(topic: Topic) {
    const on = !db.notifications[topic];
    db.notifications[topic] = on;
    void chooseNotification(topic, on);
  }

  // This browser: what it can do is known at once; whether it's subscribed a moment later (the switch only flips)
  const atFirst = inApp ? "unsupported" : webPushHere();
  let here = $state(atFirst);
  let deviceOn = $state(false);
  let busy = $state(false);
  let failed = $state(false);
  if (atFirst === "maybe") void webPush().then((s) => (deviceOn = s === "on"));
  const canSwitch = $derived(here === "ask" || here === "maybe" || here === "blocked");
  async function flipDevice() {
    busy = true;
    failed = false;
    try {
      if (deviceOn) {
        await turnOff();
        deviceOn = false;
      } else {
        deviceOn = await turnOn();
        here = webPushHere();
      }
    } catch {
      failed = true;
      deviceOn = (await webPush().catch(() => "off")) === "on";
    } finally {
      busy = false;
    }
  }
  const deviceHint = $derived(
    here === "blocked"
      ? "Blocked for this site in your browser's settings."
      : failed
        ? "This browser couldn't turn them on. Try again later."
        : "Shown by this browser, even with the app closed.",
  );
</script>

<section class="notifications">
  <h2 class="section-title">Notifications</h2>
  <p class="hint">
    {inApp
      ? "What this phone tells you, signed in as you."
      : here === "homeScreen"
        ? "On iPhone, add the app to your Home Screen (Share, then Add to Home Screen) and turn them on there."
        : here === "unsupported"
          ? "This browser can't show notifications. What you choose here goes with you."
          : "What you choose here goes with you, on every device."}
  </p>
  <ul>
    {#if canSwitch}
      <li>
        <button
          type="button"
          class="switch"
          role="switch"
          aria-checked={deviceOn}
          aria-describedby="notify-device"
          disabled={disabled || busy || here === "blocked"}
          onclick={flipDevice}
        >
          <span class="track" aria-hidden="true"></span>
          <span>On this device</span>
        </button>
        <p class="hint" id="notify-device">{deviceHint}</p>
      </li>
    {/if}
    {#each topics as t (t.topic)}
      <li>
        <button
          type="button"
          class="switch"
          role="switch"
          aria-checked={db.notifications[t.topic]}
          aria-describedby="notify-{t.topic}"
          {disabled}
          onclick={() => flip(t.topic)}
        >
          <span class="track" aria-hidden="true"></span>
          <span>{t.label}</span>
        </button>
        <p class="hint" id="notify-{t.topic}">{t.hint}</p>
      </li>
    {/each}
  </ul>
</section>

<style>
  .notifications {
    display: grid;
    gap: var(--s-3);
  }
  .notifications .section-title {
    margin: var(--s-6) 0 0;
  }
  .notifications p {
    margin: 0;
  }
  ul {
    display: grid;
    gap: var(--s-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: grid;
  }
  /* The hint sits close under the switch's words, not under its track */
  li .hint {
    margin-top: calc(-1 * var(--s-2));
    padding-left: calc(2.9rem + var(--s-3));
    font-size: var(--text-sm);
  }
  .switch:disabled {
    cursor: default;
    opacity: 0.55;
  }
</style>
