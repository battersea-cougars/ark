<script lang="ts">
  // Saying you're in for a tournament, on its own page: one line, not a card (the date's in the header). How many are
  // in, whether you are, and In / Out. The card itself is for the app's Home feed. Once the draft's on, just a line:
  // where you stand and the count, no buttons (ADR 0074).
  import type { Tournament } from "../demo/model";
  import { impersonating, me } from "../demo/session.svelte";
  import { answerFor } from "../app/backend.svelte";
  import { signupClosed } from "../demo/schedule.svelte";
  import { signupOpen } from "./signup";
  import { formatDayDate, londonISO, londonToday } from "./dates";

  let {
    tournament: t,
    canSignUp,
    line = false,
  }: {
    tournament: Tournament;
    canSignUp: boolean;
    /** One small line under the draft: where you stand and the count, no In / Out. */
    line?: boolean;
  } = $props();

  const id = $derived(me().id);
  const inIt = $derived(t.going.includes(id));
  const waiting = $derived(t.waitlist.includes(id));
  const out = $derived(t.out?.includes(id) ?? false);
  const open = $derived(signupOpen(t, londonToday()));
  const full = $derived(t.capacity != null && t.going.length >= t.capacity);
  const count = $derived(`${t.going.length}${t.capacity ? ` of ${t.capacity}` : ""} in`);
  // Not open yet: on its way (by itself on its day, or by an admin), not over
  const planned = $derived(t.status === "planned" && !signupClosed(t));
  const opens = $derived(t.signupOpensOn ? formatDayDate(londonISO(t.signupOpensOn, "12:00")) : "");
  const where = $derived(inIt ? "You're in" : waiting ? "You're on the waitlist" : out ? "You're out" : "Are you in?");
  let busy = $state(false);
  async function answer(going: boolean) {
    if (busy || impersonating() || (going && (inIt || waiting))) return;
    busy = true;
    try {
      // Out again, when you're out, takes it back: not answered (ADR 0131)
      await answerFor(`tournament:${t.id}`, going ? "in" : out ? "clear" : "out");
    } finally {
      busy = false;
    }
  }
</script>

{#if line}
  <p class="line hint">
    {inIt ? "You're in" : waiting ? "You're on the waitlist" : out ? "You're out" : "You didn't sign up"} · {t.going
      .length} signed up
  </p>
{:else if open || planned || t.going.length}
  <div class="signup">
    <span class="words">
      <strong
        >{open
          ? where
          : planned
            ? opens
              ? `Sign-up opens ${opens}`
              : "Sign-up opens nearer the day"
            : "Sign-up's closed"}</strong
      >
      <span class="hint"
        >{[
          t.going.length || !planned ? count : "",
          t.waitlist.length ? `${t.waitlist.length} waiting` : "",
          full ? "full" : "",
        ]
          .filter(Boolean)
          .join(" · ")}</span
      >
    </span>
    {#if open && canSignUp}
      <span class="answers">
        <button
          class="btn sm"
          class:primary={inIt || waiting}
          class:outline={!(inIt || waiting)}
          disabled={busy}
          onclick={() => answer(true)}>{full && !inIt ? "Waitlist" : "In"}</button
        >
        <button
          class="btn sm"
          class:primary={out}
          class:outline={!out}
          aria-pressed={out}
          title={out ? "Take back your Out" : undefined}
          aria-label={out ? "Take back your Out" : undefined}
          disabled={busy}
          onclick={() => answer(false)}>Out</button
        >
      </span>
    {/if}
  </div>
{/if}

<style>
  .line {
    margin: 0;
    font-size: var(--text-sm);
  }
  .signup {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
    padding-block: var(--s-3);
    border-block: 1px solid var(--border);
  }
  .words {
    display: grid;
    gap: 0.15rem;
  }
  .words strong {
    color: var(--fg);
    font-size: var(--text-md);
    font-weight: 600;
  }
  .answers {
    display: flex;
    gap: var(--s-2);
  }
  .answers .btn {
    min-width: 5rem;
  }
</style>
