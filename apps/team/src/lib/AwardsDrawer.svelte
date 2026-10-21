<script module lang="ts">
  // Which tournament's awards are being confirmed, if any: opened from the Awards section or the Manage sheet
  import { goesBy, nameOfTeam, teamNamesOf } from "./names";
  let editing = $state<{ id: number | null }>({ id: null });
  /** Open the awards for this tournament, to confirm. */
  export const enterAwards = (tournamentId: number) => (editing.id = tournamentId);
</script>

<script lang="ts">
  // Confirming a tournament's awards (ADR 0044), usually on a phone straight after the final. The data decides them
  // (lib/awards.ts): the champions, the top scorer, the best goalie; the Dim Mak is drawn at random (Draw again for
  // another). The admin checks and confirms; only an award the data can't decide asks them to pick someone.
  import { PLAYERS } from "../demo/data";
  import { db } from "../demo/store.svelte";
  import { setWinners } from "../app/backend.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import Drawer from "./Drawer.svelte";
  import TeamCrest from "./TeamCrest.svelte";
  import { awardFromData, type AwardWinner } from "./awards";
  import { teamTone } from "./team-tones";

  const tournament = $derived(db.tournaments.find((t) => t.id === editing.id));
  const teams = $derived(tournament?.teams ?? []);
  const awards = $derived(tournament?.awards ?? []);
  const byId = (id: number | null) => PLAYERS.find((p) => p.id === id);
  const teamIndex = (id: number | null) => teams.findIndex((t) => t.id === id);
  const teamName = (id: number | null) => {
    const t = teams[teamIndex(id)];
    return nameOfTeam(t, teams, byId);
  };
  const teamOf = (memberId: number | null) =>
    teams.find((t) => t.captainMemberId === memberId || t.players.some((p) => p.memberId === memberId))?.id ?? null;
  const players = $derived(
    teams
      .flatMap((t) => [t.captainMemberId, ...t.players.map((p) => p.memberId)])
      .flatMap((id) => byId(id) ?? [])
      .sort((a, b) => goesBy(a).localeCompare(goesBy(b))),
  );

  // Each award's winners as they'll be confirmed: what's saved, else what the data says
  let draft = $state<Record<string, { winners: AwardWinner[]; why: string; random?: boolean; seed: number }>>({});
  let choosing = $state<string | null>(null);
  let filledFor = $state<number | null>(null);
  const fromData = (award: string, seed: number) =>
    tournament ? awardFromData(award, tournament, { positionOf: (id) => byId(id)?.position, seed }) : null;
  $effect(() => {
    if (!tournament || filledFor === tournament.id) return;
    filledFor = tournament.id;
    draft = Object.fromEntries(
      awards.map((a) => {
        const saved = (tournament.winners ?? []).filter((w) => w.award === a.name);
        const data = fromData(a.name, tournament.id);
        return [
          a.name,
          saved.length
            ? {
                winners: saved.map(({ teamId, memberId }) => ({ teamId, memberId })),
                why: "Confirmed",
                random: data?.random,
                seed: tournament.id,
              }
            : { winners: data?.winners ?? [], why: data?.why ?? "", random: data?.random, seed: tournament.id },
        ];
      }),
    );
  });
  function again(award: string) {
    const seed = draft[award].seed + 1;
    const data = fromData(award, seed);
    if (data) draft[award] = { ...data, seed };
  }
  function pick(award: string, memberId: number) {
    draft[award] = { ...draft[award], winners: [{ teamId: null, memberId }], why: "Picked" };
    choosing = null;
  }
  function close() {
    editing.id = null;
    filledFor = null;
    choosing = null;
  }
  async function confirm() {
    if (!tournament) return;
    const winners = awards.flatMap((a) => (draft[a.name]?.winners ?? []).map((w) => ({ award: a.name, ...w })));
    if (await setWinners(tournament.id, winners)) close();
  }
  // The tournament's team names, which its crests are told apart among (logo.ts)
  const crestNames = $derived(teamNamesOf(teams, byId));
</script>

{#snippet winner(w: AwardWinner)}
  {#if w.teamId}
    <span class="who">
      <TeamCrest
        among={crestNames}
        name={teamName(w.teamId)}
        logo={teams[teamIndex(w.teamId)]?.logo ?? null}
        tone={teamTone(teamIndex(w.teamId))}
        size="2.5rem"
      />
      <span class="who-name">{teamName(w.teamId)}</span>
    </span>
  {:else if w.memberId}
    <span class="who">
      <span class="who-text"
        ><span class="who-name">{byId(w.memberId)?.name ?? ""}</span><span class="hint"
          >{teamName(teamOf(w.memberId))}</span
        ></span
      >
    </span>
  {/if}
{/snippet}

<Drawer
  bind:open={() => !!tournament, (v) => !v && close()}
  title="The awards"
  sub="From the results: check them, then confirm."
>
  {#if tournament}
    <ol class="awards">
      {#each awards as a (a.name)}
        {@const d = draft[a.name]}
        <li class="award">
          <div class="head">
            <span class="award-name">{a.name}</span>
            {#if d?.why}<span class="hint">{d.why}</span>{/if}
          </div>
          {#if d?.winners.length}
            {#if d.winners.length > 2}
              <!-- A big tie: one line; "Someone else" settles it -->
              <span class="who-text"
                ><span class="who-name">Shared by {d.winners.length}</span><span class="hint"
                  >{d.winners
                    .map((w) => (w.teamId ? teamName(w.teamId) : (byId(w.memberId)?.name ?? "")))
                    .join(", ")}</span
                ></span
              >
            {:else}
              {#each d.winners as w, i (i)}{@render winner(w)}{/each}
            {/if}
          {:else}
            <p class="hint">The results don't decide this one.</p>
          {/if}
          <div class="row-actions">
            {#if d?.random}
              <button class="btn outline sm" onclick={() => again(a.name)}
                ><Icon name="undo" size={15} />Draw again</button
              >
            {/if}
            {#if !d?.random}
              <button class="btn ghost sm" onclick={() => (choosing = choosing === a.name ? null : a.name)}
                >{d?.winners.length ? "Someone else" : "Pick someone"}</button
              >
            {/if}
          </div>
          {#if choosing === a.name}
            <!-- Big rows, one tap: everyone who played -->
            <div class="pick">
              {#each players as p (p.id)}
                <button class="pick-row" onclick={() => pick(a.name, p.id)}
                  ><span>{p.name}</span><span class="hint">{teamName(teamOf(p.id))}</span></button
                >
              {/each}
            </div>
          {/if}
        </li>
      {/each}
    </ol>
    {#if !awards.length}<p class="hint">This one has no awards. Add them under Edit this tournament.</p>{/if}
  {/if}
  {#snippet footer()}
    <button class="btn primary confirm" onclick={confirm}><Icon name="check" size={18} />Confirm the awards</button>
  {/snippet}
</Drawer>

<style>
  .awards {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .award {
    display: grid;
    gap: var(--s-2);
    padding-block: var(--s-4);
  }
  .award + .award {
    border-top: 1px solid var(--border);
  }
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--s-3);
  }
  .award-name {
    color: var(--fg-muted);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }
  .who {
    display: flex;
    align-items: center;
    gap: var(--s-3);
  }
  .who-text {
    display: grid;
    gap: 0.1rem;
  }
  .who-name {
    color: var(--fg);
    font-size: var(--text-lg, 1.2rem);
    font-weight: 600;
  }
  .row-actions {
    display: flex;
    gap: var(--s-2);
  }
  .row-actions .btn {
    gap: var(--s-1);
  }
  .pick {
    display: grid;
    gap: var(--s-1);
    max-height: 18rem;
    overflow-y: auto;
  }
  .pick-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 3.25rem;
    padding: 0 var(--s-3);
    border: 0;
    border-radius: var(--r-md);
    background: none;
    color: var(--fg);
    font: inherit;
    text-align: left;
  }
  .pick-row:hover {
    background: var(--surface-2);
  }
  .confirm {
    width: 100%;
    height: 3.5rem;
    gap: var(--s-2);
    font-size: var(--text-md);
  }
</style>
