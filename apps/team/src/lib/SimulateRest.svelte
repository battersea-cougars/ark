<script lang="ts">
  // Dev only (apps/team/worker/settings/README.md): the rest of a tournament played out at random (lib/simulation.ts),
  // from Manage, to try its after-party; paced to watch, from its floating control (lib/SimulationControl). Only where
  // the bootstrap says (`simulator`): never in production.
  import type { Tournament, TournamentType } from "../demo/model";
  import { simulation } from "../app/simulation.svelte";
  import { formatDayDate, londonEvening, londonISO } from "./dates";
  import Drawer from "./Drawer.svelte";
  import Confirm from "./Confirm.svelte";

  let { type, tournament }: { type: TournamentType; tournament: Tournament } = $props();

  let open = $state(false);
  // The after-party is on its evening only (lib/edition.ts atAfters)
  const notTonight = $derived(!tournament.season && tournament.heldOn !== londonEvening());
  const title = $derived(`Play out the ${type.shortName}`);

  export function start() {
    open = true;
  }
  function go() {
    open = false;
    void simulation.start(tournament.id);
  }
</script>

<Drawer bind:open short {title} sub={`${type.shortName}: ${tournament.name}`}>
  <Confirm cancel="Not now" confirm="Play it out" kind="outline" oncancel={() => (open = false)} onconfirm={go}>
    <p>
      Whatever's left, at random and by the rules: the order drawn and every pick made, then each match scored on the
      clock, goals and the odd penalty, the playoffs too. It stops at the after-party, the awards for you to confirm and
      reveal.
    </p>
    <p>A move at a time, slow enough to follow: pause it, speed it up or stop it from the bar it shows.</p>
    {#if notTonight}
      <p>
        Its after-party shows on its own evening, {formatDayDate(londonISO(tournament.heldOn, "12:00"))}: set its day to
        today first to see it now.
      </p>
    {/if}
    <p class="dev">Dev only. Never in production.</p>
  </Confirm>
</Drawer>

<style>
  :global(.confirm) .dev {
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
</style>
