<script lang="ts">
  // Move to… (ADR 0127, lib/move-to.ts): an admin moves a captains' draft to any of its statuses at once. First the
  // statuses, the one it's at marked, each saying what moving there will do (or why it can't); tap one and it asks,
  // listing every step: back, what's undone, with the one red fill as the tap that does it; forward, what'll be
  // done, on the main button. A sheet on a phone, a side drawer on a desktop.
  import type { Tournament, TournamentType } from "../demo/model";
  import { moveTournament } from "../app/backend.svelte";
  import { planMove, planWords, type Counts, type MovePlan } from "./move-to";
  import { STATUS_MARK, statusesOf } from "./tournament-front";
  import { kanjiFor } from "./motif";
  import { londonToday } from "./dates";
  import Icon from "../app/shell/Icon.svelte";
  import Drawer from "./Drawer.svelte";
  import Confirm from "./Confirm.svelte";

  let {
    type,
    tournament,
    afterName = null,
  }: { type: TournamentType; tournament: Tournament; afterName?: string | null } = $props();

  const today = $derived(londonToday());
  const counts = $derived.by((): Counts => {
    const t = tournament;
    const games = t.games ?? [];
    const captains = new Set(t.teams.map((x) => x.captainMemberId));
    const picked = new Set(t.teams.flatMap((x) => x.players.map((p) => p.memberId)));
    return {
      picks: t.teams.reduce((n, x) => n + x.players.length, 0),
      results: games.filter((g) => g.homeGoals !== null).length,
      goals: games.reduce((n, g) => n + (g.goals?.length ?? 0), 0),
      pool: t.going.filter((id) => !captains.has(id) && !picked.has(id)).length,
    };
  });
  const rows = $derived(
    statusesOf(tournament, type, today, afterName).map((s) => ({
      ...s,
      mark: kanjiFor(type, STATUS_MARK[s.status]),
      plan: s.state === "now" ? null : planMove(tournament, today, s.status, counts),
    })),
  );

  let open = $state(false);
  let busy = $state(false);
  // The move it's asking about, kept while it's open and closing: once it lands the tournament's somewhere else, and
  // the question mustn't turn into another as it leaves
  let asked = $state<{ plan: MovePlan; label: string } | null>(null);

  /** Manage's tap: the statuses. */
  export function start() {
    asked = null;
    open = true;
  }

  function choose(row: (typeof rows)[number]) {
    if (!row.plan || typeof row.plan === "string") return;
    asked = { plan: row.plan, label: row.label };
  }

  async function go() {
    if (!asked || busy) return;
    busy = true;
    try {
      const { plan, label } = asked;
      if (await moveTournament(tournament.id, plan.from, plan.to, `Moved to ${label}`)) open = false;
    } finally {
      busy = false;
    }
  }

  const title = $derived(
    asked ? (asked.plan.back ? `Back to ${asked.label}` : `On to ${asked.label}`) : `Move the ${type.shortName} to…`,
  );
</script>

<Drawer bind:open short {title} sub={`${type.shortName}: ${tournament.name}`}>
  {#if asked}
    <Confirm
      cancel="Not that one"
      confirm={asked.plan.back ? "Move back" : "Move on"}
      kind={asked.plan.back ? "danger" : "primary"}
      {busy}
      oncancel={() => (asked = null)}
      onconfirm={go}
    >
      <p class="lead">
        {asked.plan.back ? "Moving back undoes, in this order:" : "Moving on does, in this order:"}
      </p>
      <ol class="steps">
        {#each asked.plan.steps as s (s.step)}
          <li>{s.said[0].toUpperCase()}{s.said.slice(1)}</li>
        {/each}
      </ol>
      {#if !asked.plan.back && asked.plan.steps.some((s) => s.step === "setTeams")}
        <p class="note">The captains hear that the rest were chosen at random.</p>
      {/if}
    </Confirm>
  {:else}
    <ol class="stages" aria-label="Its statuses">
      {#each rows as row (row.status)}
        {@const can = !!row.plan && typeof row.plan !== "string"}
        <li>
          <button
            class="stage {row.state}"
            disabled={!can}
            aria-current={row.state === "now" ? "step" : undefined}
            onclick={() => choose(row)}
          >
            <span class="mark" lang="ja" aria-hidden="true">{row.mark}</span>
            <span class="text">
              <strong
                >{row.label}{#if row.state === "now"}<span class="here">Now</span>{/if}</strong
              >
              <span class="sub">
                {#if row.state === "now"}
                  Where it is
                {:else if typeof row.plan === "string"}
                  {row.plan}
                {:else if row.plan}
                  {planWords(row.plan)}
                {/if}
              </span>
            </span>
            {#if can}<Icon name={row.state === "done" ? "undo" : "chevronRight"} size={18} />{/if}
          </button>
        </li>
      {/each}
    </ol>
  {/if}
</Drawer>

<style>
  .stages {
    display: grid;
    gap: var(--s-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .stage {
    display: flex;
    align-items: center;
    gap: var(--s-4);
    width: 100%;
    min-height: 4.25rem;
    padding: var(--s-3) var(--s-4);
    border: 0;
    border-radius: var(--r-lg);
    background: var(--surface-2);
    color: var(--fg-muted);
    font: inherit;
    text-align: left;
  }
  .stage:active:not(:disabled) {
    background: var(--surface-3);
  }
  .stage:disabled {
    cursor: default;
  }
  /* Where it is: the one lit, as the track lights it */
  .stage.now {
    background: var(--surface-3);
  }
  .stage:disabled:not(.now) .text {
    opacity: 0.6;
  }
  /* The status's kanji (the Kumite's), one line whether it's one character or two */
  .mark {
    flex: none;
    width: 2.5rem;
    color: var(--fg-muted);
    font-size: 1.125rem;
    text-align: center;
    white-space: nowrap;
  }
  .stage.now .mark {
    color: var(--red-hot);
  }
  .text {
    display: grid;
    flex: 1;
    gap: 0.15rem;
    min-width: 0;
  }
  .text strong {
    display: flex;
    align-items: baseline;
    gap: var(--s-2);
    color: var(--fg);
    font-size: var(--text-md);
    font-weight: 600;
  }
  .here {
    color: var(--red-hot);
    font-size: var(--text-xs);
    font-style: italic;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .sub {
    font-size: var(--text-sm);
  }
  .steps {
    display: grid;
    gap: var(--s-2);
    margin: 0;
    padding-left: 1.25rem;
    color: var(--fg);
  }
  .note {
    font-size: var(--text-sm);
  }
</style>
