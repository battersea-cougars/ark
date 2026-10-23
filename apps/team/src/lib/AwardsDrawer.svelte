<script module lang="ts">
  // Which tournament's awards are being confirmed, if any: opened from the Awards section or the Manage sheet
  import { goesBy, nameOfTeam, teamNamesOf } from "./names";
  let editing = $state<{ id: number | null }>({ id: null });
  /** Open the awards for this tournament, to confirm. */
  export const enterAwards = (tournamentId: number) => (editing.id = tournamentId);
</script>

<script lang="ts">
  // Confirming a tournament's awards (ADR 0044), the after-party's first step, before the reveal: usually on a phone
  // straight after the final. Each is decided as it says (lib/awards.ts): a stat's from the results (the champions,
  // the top scorer), a draw at random (Draw again for another), for the admin to check (or choose someone else); a
  // vote's counted by the Worker as they confirm (how many have voted shows here, never who for), and where it's
  // level after its tie-break, the reply says who's level and the admin chooses; the judges' call they make here,
  // naming it tonight and choosing who. Confirming closes voting and sets every winner; then it's the reveal.
  import { PLAYERS } from "../demo/data";
  import { db } from "../demo/store.svelte";
  import { setWinners } from "../app/backend.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import Drawer from "./Drawer.svelte";
  import TeamCrest from "./TeamCrest.svelte";
  import AwardCallSheet from "./AwardCallSheet.svelte";
  import { awardFromData, decidedByOf, playersOf, votersOf, type Award, type AwardWinner } from "./awards";
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

  // Each award's winners as they'll be confirmed: what's saved, else what the data says. A vote's is the count's
  // (none here) unless it came back level (`tied`) and the admin chose; the judges' call is the admin's, with its name
  type Draft = { winners: AwardWinner[]; why: string; random?: boolean; seed: number; title?: string; tied?: number[] };
  let draft = $state<Record<string, Draft>>({});
  let choosing = $state<string | null>(null);
  let filledFor = $state<number | null>(null);
  const positionOf = (id: number) => byId(id)?.position;
  const kindOf = (a: Award) => decidedByOf(a).kind;
  const fromData = (award: string, seed: number) => {
    const a = awards.find((x) => x.name === award);
    return tournament && a ? awardFromData(a, tournament, { positionOf, seed }) : null;
  };
  // A vote: how many are in, of how many can (never who for)
  const votedWords = (a: Award) => {
    const cast = tournament?.votes?.find((v) => v.award === a.name)?.cast ?? 0;
    const can = tournament ? votersOf(a, tournament, { positionOf }).length : 0;
    return `${cast} of ${can} voted · counted when you confirm`;
  };
  $effect(() => {
    if (!tournament || filledFor === tournament.id) return;
    filledFor = tournament.id;
    draft = Object.fromEntries(
      awards.map((a) => {
        const saved = (tournament.winners ?? []).filter((w) => w.award === a.name);
        const data = fromData(a.name, tournament.id);
        const title = saved.find((w) => w.title)?.title ?? undefined;
        return [
          a.name,
          saved.length
            ? {
                winners: saved.map(({ teamId, memberId }) => ({ teamId, memberId })),
                why: "Confirmed",
                random: data?.random,
                seed: tournament.id,
                title,
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
    draft[award] = { ...draft[award], winners: [{ teamId: null, memberId }], why: "Your choice" };
    choosing = null;
  }
  // The judges' call, or a vote that's level: made in a sheet over the drawer
  let calling = $state<Award | null>(null);
  const callNames = (a: Award) => {
    const how = decidedByOf(a);
    return how.kind === "live" ? how.options : [];
  };
  async function called(c: { title?: string; memberId: number }) {
    if (!calling) return;
    const d = draft[calling.name];
    draft[calling.name] = {
      ...d,
      winners: [{ teamId: null, memberId: c.memberId }],
      title: c.title,
      why: d.tied ? "Level on votes: your call" : "Your call",
    };
  }
  // What's still to be chosen before it can be confirmed: a vote that came back level. The judges' call is the
  // admin's to make or not: one not made is left out of the reveal
  const pending = $derived(
    awards.filter((a) => kindOf(a) === "vote" && draft[a.name]?.tied && !draft[a.name].winners.length),
  );
  const uncalled = $derived(awards.filter((a) => kindOf(a) === "live" && !draft[a.name]?.winners.length));
  function clearCall(award: string) {
    draft[award] = { ...draft[award], winners: [], title: undefined, why: "" };
  }
  function close() {
    editing.id = null;
    filledFor = null;
    choosing = null;
    calling = null;
  }
  let busy = $state(false);
  async function confirm() {
    if (!tournament || busy || pending.length) return;
    // A vote's winner is the Worker's count: only one the admin settled goes with the rest
    const winners = awards
      .filter((a) => kindOf(a) !== "vote" || draft[a.name]?.tied)
      .flatMap((a) =>
        (draft[a.name]?.winners ?? []).map((w) => ({ award: a.name, ...w, title: draft[a.name]?.title })),
      );
    busy = true;
    try {
      const r = await setWinners(tournament.id, winners);
      if (!r) return;
      if (!r.tied) return close();
      // Level after the tie-break: who's level, for the admin to choose among
      for (const [name, ids] of Object.entries(r.tied))
        draft[name] = { ...draft[name], winners: [], tied: ids, why: "Level on votes" };
    } finally {
      busy = false;
    }
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
  title="Confirm the awards"
  sub="Check the stats, make the judges' call. Confirming counts the votes and closes voting; then the reveal."
>
  {#if tournament}
    <ol class="awards">
      {#each awards as a (a.name)}
        {@const d = draft[a.name]}
        {@const kind = kindOf(a)}
        <li class="award">
          <div class="head">
            <span class="award-name">{a.name}</span>
            {#if d?.why}<span class="hint">{d.why}</span>{/if}
          </div>
          {#if d?.title}<p class="called">Tonight: <b>{d.title}</b></p>{/if}
          {#if kind === "vote" && !d?.winners.length}
            <p class="hint">
              {d?.tied ? `Level between ${d.tied.length} after the tie-break: you choose.` : votedWords(a)}
            </p>
          {:else if d?.winners.length}
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
          {:else if kind === "live"}
            <p class="hint">
              The judges' call, if you want one: name it tonight and choose who. Not made, it's left out.
            </p>
          {:else}
            <p class="hint">The results don't decide this one.</p>
          {/if}
          <div class="row-actions">
            {#if kind === "live"}
              <button class="btn sm outline" onclick={() => (calling = a)}
                ><Icon name="medal" size={15} />{d?.winners.length ? "Change the call" : "Make the call"}</button
              >
              {#if d?.winners.length}<button class="btn sm ghost" onclick={() => clearCall(a.name)}>Leave it out</button
                >{/if}
            {:else if kind === "vote"}
              {#if d?.tied}
                <button
                  class="btn sm"
                  class:primary={!d.winners.length}
                  class:outline={!!d.winners.length}
                  onclick={() => (calling = a)}>{d.winners.length ? "Change" : "Choose among them"}</button
                >
              {/if}
            {:else if d?.random}
              <button class="btn outline sm" onclick={() => again(a.name)}
                ><Icon name="undo" size={15} />Draw again</button
              >
            {:else}
              <button class="btn ghost sm" onclick={() => (choosing = choosing === a.name ? null : a.name)}
                >{d?.winners.length ? "Someone else" : "Choose someone"}</button
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
    {#if calling}
      <AwardCallSheet
        bind:open={() => !!calling, (v) => !v && (calling = null)}
        {tournament}
        award={calling.name}
        names={draft[calling.name]?.tied ? [] : callNames(calling)}
        people={draft[calling.name]?.tied ?? playersOf(tournament)}
        tie={!!draft[calling.name]?.tied}
        onchoose={called}
      />
    {/if}
  {/if}
  {#snippet footer()}
    <!-- Room for the line kept, so the button doesn't move as the calls are made -->
    <p class="still hint" aria-live="polite">
      {pending.length
        ? `Still to choose: ${pending.map((a) => a.name).join(", ")}`
        : uncalled.length
          ? `Voting closes as you confirm. No call made: ${uncalled.map((a) => a.name).join(", ")} is left out.`
          : "Voting closes as you confirm."}
    </p>
    <button class="btn primary confirm" disabled={busy || !!pending.length} onclick={confirm}
      ><Icon name="check" size={18} />Confirm the awards</button
    >
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
  .called {
    margin: 0;
    color: var(--fg-muted);
  }
  .called b {
    color: var(--fg);
  }
  .still {
    min-height: 1.4rem;
    margin: 0 0 var(--s-2);
    text-align: center;
  }
  .confirm {
    width: 100%;
    height: 3.5rem;
    gap: var(--s-2);
    font-size: var(--text-md);
  }
</style>
