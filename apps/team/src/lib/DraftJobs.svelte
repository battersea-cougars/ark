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
  import Drawer from "./Drawer.svelte";
  import Confirm from "./Confirm.svelte";
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

<Drawer bind:open short {title} sub={`${type.shortName}: ${tournament.name}`}>
  {#if asking === "reset"}
    <Confirm
      cancel="Keep it"
      confirm="Reset the draft"
      kind="danger"
      {busy}
      oncancel={() => (open = false)}
      onconfirm={() => job(() => resetDraft(tournament.id))}
      ><p>Start again? Every pick comes off, and the order's drawn again.</p></Confirm
    >
  {:else}
    <Confirm cancel="Keep picking" confirm="Close it" {busy} oncancel={() => (open = false)} onconfirm={closeEarly}
      ><p>{left} still to pick. Close it and leave them out? They stay signed up.</p></Confirm
    >
  {/if}
</Drawer>
<TournamentPlayersDrawer
  tournamentId={tournament.id}
  going={tournament.going ?? []}
  {captains}
  sub="{tournament.name}{when ? ` · draft ${when}` : ''}"
  bind:open={adding}
/>
