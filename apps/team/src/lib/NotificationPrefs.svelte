<script lang="ts">
  // Notifications (ADR 0108, #24), on your profile: a switch for each kind, every one on until you turn it off. The
  // choice is yours, not a phone's, so it's here in a browser too: notifications come through the club's app, and
  // whichever phone you sign in on follows it. A switch answers at once; the server's reply puts it right if it
  // failed (backend.svelte.ts save).
  import { chooseNotification } from "../app/backend.svelte";
  import { inApp } from "../app/native";
  import { db } from "../demo/store.svelte";
  import { TOPICS, type Topic } from "./notification-topics";

  let { disabled = false }: { disabled?: boolean } = $props();

  function flip(topic: Topic) {
    const on = !db.notifications[topic];
    db.notifications[topic] = on;
    void chooseNotification(topic, on);
  }
</script>

<section class="notifications">
  <h2 class="section-title">Notifications</h2>
  <p class="hint">
    {inApp
      ? "What this phone tells you, signed in as you."
      : "Notifications come through the Cougars app on your phone. What you choose here goes with you."}
  </p>
  <ul>
    {#each TOPICS as t (t.topic)}
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
