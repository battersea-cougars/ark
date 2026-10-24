<script lang="ts">
  // Dev only (ADR 0123): a Kumite on a past day, from History's Manage, to try what a past one shows. One question,
  // the day, then it's made, signed up for and played out on that evening by the simulator, the draft, every match
  // and every award, under the floating control (lib/SimulationControl), at Spin kick unless another speed's chosen.
  // It shows in Past Kumites once its matches are played. The bootstrap says whether it's here (`simulator`).
  import type { TournamentType } from "../demo/model";
  import { playOnAPastDay, simulating } from "../app/simulation.svelte";
  import { londonToday } from "./dates";
  import Drawer from "./Drawer.svelte";
  import DateField from "./DateField.svelte";

  let { type }: { type: TournamentType } = $props();

  let open = $state(false);
  let heldOn = $state("");
  let going = $state(false);
  // Yesterday: the latest day that's gone by
  const latest = new Date(Date.parse(`${londonToday()}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

  export function start() {
    heldOn ||= latest;
    open = true;
  }
  async function go() {
    going = true;
    const made = await playOnAPastDay(type.id, heldOn);
    going = false;
    if (made) open = false;
  }
</script>

<Drawer bind:open title="A {type.shortName} on a past day" sub="Dev only: a whole evening, played at random">
  <div class="confirm">
    <div class="field">
      Day <DateField id="past-day-play" aria-label="The day it's played" max={latest} bind:value={heldOn} />
    </div>
    <p>
      A {type.shortName} on that day, signed up for by enough of the club, its captains named; then played out on that evening
      by the rules: the draft, every match on the clock, the awards confirmed and every one revealed. It's history straight
      away, in Past {type.shortName}s.
    </p>
    {#if simulating.id}<p class="dev">Another's playing out: stop it first.</p>{/if}
    <p class="dev">Dev only. Never in production.</p>
    <div class="keys">
      <button class="btn ghost" onclick={() => (open = false)}>Not now</button>
      <button class="btn outline" disabled={!heldOn || going || !!simulating.id} onclick={go}>Play it</button>
    </div>
  </div>
</Drawer>

<style>
  .confirm {
    display: grid;
    gap: var(--s-4);
  }
  .confirm p {
    margin: 0;
    color: var(--fg-body);
  }
  .confirm .dev {
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  .field {
    max-width: 14rem;
  }
  .keys {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--s-3);
  }
</style>
