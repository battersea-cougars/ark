<script lang="ts">
  // Changing your answer to a tournament, from the badge in its header (ADR 0074): your answer as the badge itself, a
  // line in the club's voice (Settings → Quips, your answer's), and the one choice as a row: Can't make it, in red
  // words, or I'm in while sign-up's open. Saying you're out is allowed till it's started (worker/entries answer);
  // what it means for your team, if you're on one, is said under it. Once it's started, who's in is an admin's to
  // change: a line in the row's place, as tall as it, instead. A small popover under the badge on a desktop, a short bottom
  // sheet on a phone (TournamentHead).
  import type { Tournament } from "../demo/model";
  import { impersonating, me } from "../demo/session.svelte";
  import { db } from "../demo/store.svelte";
  import { PLAYERS } from "../demo/data";
  import { answerFor } from "../app/backend.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import { signupOpen } from "./signup";
  import { londonToday } from "./dates";
  import { nameOfTeam } from "./names";
  import { pick } from "./quips";
  import { untrack } from "svelte";
  import { invitationOnly } from "./motif";
  import { fighterLabel, fighterOf } from "./fighters";
  import { typeById } from "../demo/schedule.svelte";
  import { hasStarted } from "./edition";

  let {
    tournament: t,
    canSignUp,
    ondone,
  }: { tournament: Tournament; canSignUp: boolean; ondone?: () => void } = $props();

  const id = $derived(me().id);
  const inIt = $derived(t.going.includes(id) || t.waitlist.includes(id));
  const open = $derived(signupOpen(t, londonToday()));
  const full = $derived(t.capacity != null && t.going.length >= t.capacity);
  const started = $derived(hasStarted(t));
  const series = $derived(typeById(t.typeId)?.shortName);
  // The Kumite's by invitation: your fighter's number, a reserve's, or Declined, as the header's badge says it
  const fighter = $derived(invitationOnly(typeById(t.typeId)) ? fighterOf(t, id) : null);
  const label = $derived(
    fighter
      ? fighterLabel(fighter)
      : t.going.includes(id)
        ? "You're in"
        : t.waitlist.includes(id)
          ? "Waiting"
          : "You're out",
  );
  // A line for it, picked once (Settings → Quips: In or Out)
  const quip = untrack(() => pick(db.quips.filter((q) => q.kind === (inIt ? "in" : "out") && q.text.trim()))?.text);
  // Your team, if you're on one: off it while the draft's open; after that (or a captain), it's an admin's to change
  const team = $derived(t.teams.find((x) => x.captainMemberId === id || x.players.some((p) => p.memberId === id)));
  const teamName = $derived(
    team ? nameOfTeam(team, t.teams, (pid) => (pid ? PLAYERS.find((p) => p.id === pid) : undefined)) : "",
  );
  const consequence = $derived.by(() => {
    if (!team) return "";
    if (team.captainMemberId !== id && t.draftState === "open") return `You'll come off ${teamName}`;
    return `You stay on ${teamName} till an admin changes it`;
  });
  let busy = $state(false);
  async function answer(going: boolean) {
    if (busy || impersonating()) return;
    busy = true;
    try {
      await answerFor(`tournament:${t.id}`, going ? "in" : "out");
      ondone?.();
    } finally {
      busy = false;
    }
  }
</script>

<div class="answer-menu">
  <span class="said {t.going.includes(id) ? 'in' : t.waitlist.includes(id) ? 'wait' : 'out'}">{label}</span>
  {#if quip}<p class="quip">{quip}</p>{/if}
  {#if canSignUp && started}
    <p class="row settled">
      <Icon name="key" size={20} />
      <span class="text"
        ><strong>{series ? `The ${series}'s started` : "It's started"}</strong><span>Ask an admin to change it</span
        ></span
      >
    </p>
  {:else if canSignUp && inIt}
    <button class="row" disabled={busy} onclick={() => answer(false)}>
      <Icon name="userMinus" size={20} />
      <span class="text"
        ><strong class="leave">Can't make it</strong>{#if consequence}<span>{consequence}</span>{/if}</span
      >
    </button>
  {:else if canSignUp && open}
    <button class="row" disabled={busy} onclick={() => answer(true)}>
      <Icon name="userPlus" size={20} />
      <span class="text"><strong>{full ? "Join the waitlist" : "I'm in"}</strong></span>
    </button>
  {:else if !open}
    <p class="hint">Sign-up's closed.</p>
  {/if}
</div>

<style>
  .answer-menu {
    display: grid;
    justify-items: start;
    gap: var(--s-3);
  }
  .said {
    padding: 0.2rem 0.55rem 0.12rem;
    border-radius: 0.3rem;
    font-family: var(--font-display);
    font-size: 1rem;
    letter-spacing: 0.04em;
    line-height: 1;
    text-transform: uppercase;
    transform: rotate(-3deg);
  }
  .said.in {
    background: color-mix(in srgb, var(--green-ink) 22%, transparent);
    color: var(--green-ink);
  }
  .said.wait {
    background: color-mix(in srgb, var(--tone-amber) 20%, transparent);
    color: var(--tone-amber);
  }
  .said.out {
    background: var(--surface-2);
    color: var(--fg-muted);
  }
  .quip {
    margin: 0;
    color: var(--fg-muted);
    font-style: italic;
  }
  /* The choice, a row like Manage's: an icon and its words, red for leaving */
  .row {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    width: 100%;
    min-height: 3.25rem;
    padding: var(--s-2) var(--s-3);
    border: 0;
    border-radius: var(--r-lg);
    background: var(--surface-2);
    color: var(--fg-muted);
    font: inherit;
    text-align: left;
  }
  .row.settled {
    margin: 0;
    background: none;
  }
  .row:not(.settled):hover {
    background: var(--surface-3);
  }
  .text {
    display: grid;
    gap: 0.1rem;
  }
  .text strong {
    color: var(--fg);
    font-weight: 600;
  }
  .text strong.leave {
    color: var(--red-hot);
  }
  .text span {
    font-size: var(--text-sm);
  }
  .hint {
    margin: 0;
  }
</style>
