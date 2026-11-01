<script lang="ts">
  // One step back in a tournament's workflow (ADR 0127, lib/step-back.ts), from whichever Manage offers it: the
  // tournament's own, or the Draft page's for the draft's steps. How much it asks follows what's lost: nothing (the
  // draft reopened, sign-up open again, a draft with no picks yet) goes at once; what can be done again (the fixtures,
  // the drawn order) is a quiet question; what's gone for good (results and goals, captains' picks) says what, counted,
  // with the one red fill as the tap that does it. A sheet on a phone, a side drawer on a desktop.
  import { londonToday, plural } from "./dates";
  import type { Tournament, TournamentType } from "../demo/model";
  import { stepBack } from "../app/backend.svelte";
  import { backFrom, backTo, type BackFrom } from "./step-back";
  import Drawer from "./Drawer.svelte";
  import Confirm from "./Confirm.svelte";

  let { type, tournament }: { type: TournamentType; tournament: Tournament } = $props();

  const now = $derived(backFrom(tournament, londonToday()));
  // The step it asked about, kept while it's open and closing: the step back lands before the sheet's gone, and its
  // title and words mustn't turn into the next step's as it leaves
  let asked = $state<BackFrom | null>(null);
  const from = $derived(asked ?? now);
  const games = $derived(tournament.games ?? []);
  const picks = $derived(tournament.teams.reduce((n, t) => n + t.players.length, 0));

  /** What it'll cost: nothing (go at once), something that can be done again (quiet), or gone for good (red). */
  const cost = $derived.by((): { level: "none" | "quiet" | "lost"; said: string } => {
    switch (from) {
      case "results": {
        const results = games.filter((g) => g.homeGoals !== null).length;
        const goals = games.reduce((n, g) => n + (g.goals?.length ?? 0), 0);
        const counts = [results && plural(results, "result"), goals && plural(goals, "goal")].filter(Boolean);
        return {
          level: "lost",
          said: `${counts.length ? `${counts.join(" and ")} will be deleted.` : "The match under way will be deleted, with its scoresheet."} Every match goes back to not started.`,
        };
      }
      case "fixtures":
        return {
          level: "quiet",
          said: `The fight card comes off: ${plural(games.length, "match", "matches")}. Make it again from the teams.`,
        };
      case "draft":
        return picks
          ? {
              level: "lost",
              said: `${plural(picks, "pick")} will come off the teams. The order stays, and the captains hear it's paused.`,
            }
          : { level: "none", said: "" };
      case "order":
        return { level: "quiet", said: "The order comes off. The next draw is a new one." };
      default:
        return { level: "none", said: "" };
    }
  });

  let open = $state(false);
  let busy = $state(false);
  // What it said it'd do, as the toast
  const DONE: Record<BackFrom, string> = {
    awards: "Every award's face down again",
    results: "Back to the fight card",
    fixtures: "Back to the teams",
    teams: "The draft is open again",
    draft: "Back to the drawn order",
    order: "Back to before the draw",
    signup: "Sign-up is open again",
  };
  async function go(f: BackFrom) {
    if (busy) return;
    busy = true;
    try {
      await stepBack(tournament.id, f, DONE[f]);
      open = false;
    } finally {
      busy = false;
    }
  }

  /** Manage's tap: at once when nothing's lost, else the question. */
  export function start() {
    asked = now;
    if (!asked) return;
    if (cost.level === "none") void go(asked);
    else open = true;
  }
</script>

<Drawer bind:open short title={from ? backTo(from, tournament.kind) : ""} sub={`${type.shortName}: ${tournament.name}`}>
  {#if from}
    <Confirm
      cancel="Not now"
      confirm={backTo(from, tournament.kind)}
      kind={cost.level === "lost" ? "danger" : "outline"}
      {busy}
      oncancel={() => (open = false)}
      onconfirm={() => from && go(from)}><p>{cost.said}</p></Confirm
    >
  {/if}
</Drawer>
