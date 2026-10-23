<script lang="ts">
  // The draft's own jobs (ADR 0060, lib/draft-jobs.ts), done from the page's one Manage: undo the last pick at once,
  // add a player in the add sheet, and the two that can't be taken back (closing early, leaving the rest out, and
  // starting again) asked first, saying what goes. A sheet on a phone, a side drawer on a desktop.
  import { editionPath } from "./edition-address";
  import type { Tournament, TournamentType } from "../demo/model";
  import { closeDraft, finishDraft, resetDraft, undoDraftPick } from "../app/backend.svelte";
  import { navigate, router } from "../app/router.svelte";
  import { draftTurn } from "./draft";
  import type { DraftJob } from "./draft-jobs";
  import { teamsForPlayoffs } from "./fixtures";
  import { formatDayDate, londonISO } from "./dates";
  import { phone } from "./viewport.svelte";
  import Sheet from "./Sheet.svelte";
  import Drawer from "./Drawer.svelte";
  import TournamentPlayersDrawer from "./TournamentPlayersDrawer.svelte";

  let { type, tournament }: { type: TournamentType; tournament: Tournament } = $props();

  let adding = $state(false);
  let asking = $state<"leaveOut" | "reset" | null>(null);
  let open = $state(false);
  let busy = $state(false);

  const left = $derived(draftTurn(tournament).left);
  const captains = $derived(new Set(tournament.teams.map((t) => t.captainMemberId)));
  const when = $derived(tournament.draftOn ? formatDayDate(londonISO(tournament.draftOn, "12:00")) : "");
  // Closing makes the fixtures when it can (enough teams for the playoffs, none made yet), as the Seal card does
  const games = $derived(tournament.games ?? []);
  const tooFew = $derived(tournament.teams.length < teamsForPlayoffs(tournament.playoffs ?? []));
  const home = $derived(editionPath(type.slug, tournament.id));

  async function job(run: () => Promise<unknown>) {
    if (busy) return;
    busy = true;
    try {
      await run();
      open = false;
    } finally {
      busy = false;
    }
  }
  const closeEarly = () =>
    job(async () => {
      const making = !games.length && !tooFew;
      const done = await (games.length || !tooFew ? finishDraft(tournament.id, true) : closeDraft(tournament.id, true));
      if (done !== null && making && router.path !== home) navigate(home);
    });

  /** Manage's tap. */
  export function run(what: DraftJob) {
    if (what === "undo") void undoDraftPick(tournament.id);
    else if (what === "add") adding = true;
    else {
      asking = what;
      open = true;
    }
  }
  const title = $derived(asking === "reset" ? "Reset the draft" : "Close it now");
</script>

{#snippet ask()}
  <div class="confirm" role="alert">
    <p>
      {#if asking === "reset"}Start again? Every pick comes off, and the order's drawn again.
      {:else}{left} still to pick. Close it and leave them out? They stay signed up.{/if}
    </p>
    <div class="keys">
      <button class="btn ghost" onclick={() => (open = false)}>{asking === "reset" ? "Keep it" : "Keep picking"}</button
      >
      {#if asking === "reset"}
        <button class="btn delete" disabled={busy} onclick={() => job(() => resetDraft(tournament.id))}
          >Reset the draft</button
        >
      {:else}
        <button class="btn primary" disabled={busy} onclick={closeEarly}>Close it</button>
      {/if}
    </div>
  </div>
{/snippet}

{#if phone.current}
  <Sheet bind:open {title}>{@render ask()}</Sheet>
{:else}
  <Drawer bind:open {title} sub={`${type.shortName}: ${tournament.name}`}>{@render ask()}</Drawer>
{/if}
<TournamentPlayersDrawer
  tournamentId={tournament.id}
  going={tournament.going ?? []}
  {captains}
  sub="{tournament.name}{when ? ` · draft ${when}` : ''}"
  bind:open={adding}
/>

<style>
  .confirm {
    display: grid;
    gap: var(--s-4);
  }
  .confirm p {
    margin: 0;
    color: var(--fg-body);
  }
  .keys {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--s-3);
  }
  /* What's gone for good: the one red fill is the tap that does it */
  .delete {
    background: var(--red);
    color: var(--on-red);
  }
  .delete:hover:not(:disabled) {
    background: var(--red-hot);
  }
</style>
