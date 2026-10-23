<script lang="ts">
  // A past Kumite recorded (ADR 0126), from History's Manage: one the club played before the app, put in after the
  // fact, as a wizard (lib/Wizard, ADR 0117) over the page, a side drawer on a desktop, a tall sheet on a phone. When
  // (a day gone by), Teams (each its name, captain and players, found by name), Matches (each team against every other
  // in the fair order, a score each, a final between the top two if it had one, and who scored where anyone
  // remembers), Awards (the champions and the top scorer filled in from the results, the rest chosen), then Check and
  // Record it. It goes straight into Past Kumites, done, its awards out (worker/tournaments/past.ts). The rules and
  // awards are the series'; the logic is lib/past-kumite.ts.
  import type { TournamentType } from "../demo/model";
  import { db } from "../demo/store.svelte";
  import { recordPastKumite, saving } from "../app/backend.svelte";
  import Drawer from "./Drawer.svelte";
  import Wizard from "./Wizard.svelte";
  import DateField from "./DateField.svelte";
  import PersonPicker from "./PersonPicker.svelte";
  import Select from "./Select.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import { reachableStep } from "./wizard";
  import { goesBy } from "./names";
  import { decidedByOf, LIVE_OPTIONS } from "./awards";
  import { formatDayDate, londonISO, londonToday } from "./dates";
  import { seasonLabel, seasonOf } from "@cougars/shared/seasons";
  import {
    PAST_STEPS,
    blankPast,
    blankTeam,
    championsOf,
    finalOf,
    forATeam,
    pastBody,
    pastProblem,
    rosterOf,
    suggestedWinners,
    withMatches,
    type PastMatch,
  } from "./past-kumite";

  let { type }: { type: TournamentType } = $props();

  let open = $state(false);
  let step = $state(0);
  let values = $state(blankPast());
  // Its series has a final: the record asks for one, and it can be taken off
  let withFinal = $state(false);
  let working = $state(false);
  let failed = $state("");

  export function start() {
    values = blankPast();
    withFinal = (type.playoffs ?? []).length > 0;
    step = 0;
    failed = "";
    open = true;
  }

  const today = londonToday();
  const members = $derived(
    db.members
      .filter((m) => m.status !== "pending")
      .map((m) => ({ id: m.player.id, name: goesBy(m.player), position: m.player.position }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
  const nameOf = (id: number | null) => members.find((m) => m.id === id)?.name ?? "";
  const positionOf = (id: number) => members.find((m) => m.id === id)?.position;
  const teamName = (i: number) => {
    const t = values.teams[i];
    return t?.name.trim() || (t?.captain ? `Team ${nameOf(t.captain).split(" ")[0]}` : `Team ${i + 1}`);
  };
  // Nobody plays for two teams: whoever's on one is off the others' lists
  const taken = $derived(new Set(values.teams.flatMap(rosterOf)));
  const name = $derived(
    values.heldOn ? `${type.shortName} ${seasonLabel(seasonOf(values.heldOn).season, values.heldOn)}` : type.shortName,
  );

  const problems = $derived(PAST_STEPS.map((s) => pastProblem(s, values, today)));
  const reachable = $derived(reachableStep(problems.map((p) => !p)));
  const problem = $derived(failed || problems[step]);

  // Arriving at Matches: the round robin for the teams there are (scores kept); at Awards, the results' winners
  let shown = 0;
  $effect(() => {
    if (step === shown) return;
    shown = step;
    if (PAST_STEPS[step] === "Matches") Object.assign(values, withMatches(values, withFinal));
    if (PAST_STEPS[step] === "Awards") values.winners = suggestedWinners(values, type.awards, positionOf);
  });
  function toggleFinal() {
    withFinal = !withFinal;
    Object.assign(values, withMatches(values, withFinal));
  }

  /** A side's score up or down; its scorers kept to its goals. The final follows the table. */
  function score(m: PastMatch, side: "home" | "away", by: number) {
    const key = side === "home" ? "homeGoals" : "awayGoals";
    m[key] = Math.max(0, Math.min(99, m[key] + by));
    m.scorers[side] = m.scorers[side].slice(0, m[key]);
    if (values.final && m !== values.final) values.final = finalOf(values);
  }
  const scorerOptions = (team: number) => [
    { value: "", label: "Not known" },
    ...rosterOf(values.teams[team]).map((id) => ({ value: String(id), label: nameOf(id) })),
  ];
  const playerOptions = $derived([
    { value: "", label: "Nobody" },
    ...[...taken]
      .map((id) => ({ value: String(id), label: nameOf(id) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ]);
  const teamOptions = $derived([
    { value: "", label: "Nobody" },
    ...values.teams.map((_, i) => ({ value: String(i), label: teamName(i) })),
  ]);
  // Every award has its answer from Awards on (lib/past-kumite.ts suggestedWinners: Nobody, unless the results say)
  const NOBODY = { team: null, memberId: null, title: "" };
  const winnerOf = (award: string) => values.winners[award] ?? NOBODY;

  const champions = $derived(championsOf(values));
  const played = $derived(values.matches.length + (values.final ? 1 : 0));
  const goals = $derived(
    [...values.matches, ...(values.final ? [values.final] : [])].reduce((n, m) => n + m.homeGoals + m.awayGoals, 0),
  );
  const named = $derived(
    [...values.matches, ...(values.final ? [values.final] : [])].reduce(
      (n, m) => n + [...m.scorers.home, ...m.scorers.away].filter((s) => s).length,
      0,
    ),
  );
  const given = $derived(
    type.awards.filter((a) => values.winners[a.name]?.team != null || values.winners[a.name]?.memberId),
  );

  async function record() {
    failed = "";
    working = true;
    const made = await recordPastKumite(pastBody(type.id, name, values, type.awards));
    working = false;
    if (made) open = false;
    else failed = saving.message || "Couldn't record it. Try again?";
  }
</script>

<Drawer bind:open title="Record a past {type.shortName}" sub="One from before the app" wide fill>
  <Wizard
    steps={PAST_STEPS}
    bind:step
    {reachable}
    {problem}
    ready="It goes straight into Past {type.shortName}s, done, its awards out. Nobody's charged for it."
    working={working ? "Recording…" : ""}
    close={() => (open = false)}
  >
    {#snippet children(stepName)}
      {#if stepName === "When"}
        <section class="q">
          <h3 class="section-title">When was it?</h3>
          <div class="field day">
            Day <DateField id="past-day" aria-label="The day it was" max={today} bind:value={values.heldOn} />
          </div>
          <p class="hint">
            Its rules and awards are the {type.shortName}'s as they are now. It's called {name}.
          </p>
        </section>
      {:else if stepName === "Teams"}
        <section class="q">
          <h3 class="section-title">Who played?</h3>
          {#each values.teams as team, i (i)}
            <div class="team">
              <div class="team-head">
                <input
                  class="input"
                  aria-label="Team {i + 1}'s name"
                  placeholder={teamName(i)}
                  maxlength="40"
                  bind:value={team.name}
                />
                {#if values.teams.length > 2}
                  <button
                    type="button"
                    class="btn ghost sm icon"
                    aria-label="Take {teamName(i)} off"
                    onclick={() => values.teams.splice(i, 1)}><Icon name="x" size={16} /></button
                  >
                {/if}
              </div>
              <div class="field">
                Captain
                <PersonPicker
                  id="past-captain-{i}"
                  aria-label="{teamName(i)}'s captain"
                  {members}
                  value={team.captain}
                  exclude={taken}
                  onpick={(id) => (team.captain = id)}
                />
              </div>
              <ul class="chips" aria-label="{teamName(i)}'s players">
                {#each team.players as id, p (id)}
                  <li class="chip">
                    <span>{nameOf(id)}</span>
                    <button
                      type="button"
                      class="chip-btn"
                      aria-label="Take {nameOf(id)} off"
                      onclick={() => team.players.splice(p, 1)}><Icon name="x" size={14} /></button
                    >
                  </li>
                {/each}
              </ul>
              <PersonPicker
                id="past-players-{i}"
                aria-label="Add a player to {teamName(i)}"
                placeholder="Add a player…"
                clearOnPick
                {members}
                exclude={taken}
                onpick={(id) => team.players.push(id)}
              />
            </div>
          {/each}
          {#if values.teams.length < 16}
            <button type="button" class="btn ghost add" onclick={() => values.teams.push(blankTeam())}
              ><Icon name="plus" size={16} /> Another team</button
            >
          {/if}
        </section>
      {:else if stepName === "Matches"}
        <section class="q">
          <h3 class="section-title">The results</h3>
          <p class="hint">
            Each team played every other once. Who scored, if anyone remembers: the all-time leaders count those.
          </p>
          {#each values.matches as m, i (`${m.home}-${m.away}`)}
            {@render match(m, `Match ${i + 1}`)}
          {/each}
          <div class="final-head">
            <h3 class="section-title">The final</h3>
            <button type="button" class="btn ghost sm" onclick={toggleFinal}
              >{withFinal ? "There wasn't one" : "There was one"}</button
            >
          </div>
          {#if values.final}
            <p class="hint">Between the top two of the table.</p>
            {@render match(values.final, "Final")}
          {/if}
        </section>
      {:else if stepName === "Awards"}
        <section class="q">
          <h3 class="section-title">Who won what?</h3>
          <p class="hint">Filled in from the results where they say; any you don't know, leave as Nobody.</p>
          {#each type.awards as award (award.name)}
            {@const w = winnerOf(award.name)}
            {@const how = decidedByOf(award)}
            <div class="award">
              <span class="award-name">{award.name}</span>
              {#if forATeam(award)}
                <Select
                  id="past-award-{award.name}"
                  aria-label={award.name}
                  options={teamOptions}
                  value={w.team === null ? "" : String(w.team)}
                  onchange={(v) => (w.team = v === "" ? null : Number(v))}
                />
              {:else}
                {#if how.kind === "live"}
                  <Select
                    id="past-title-{award.name}"
                    aria-label="{award.name}: its name that night"
                    options={[
                      { value: "", label: "Its name that night" },
                      ...(how.options.length ? how.options : LIVE_OPTIONS).map((o) => ({ value: o, label: o })),
                    ]}
                    value={w.title}
                    onchange={(v) => (w.title = v)}
                  />
                {/if}
                <Select
                  id="past-award-{award.name}"
                  aria-label={award.name}
                  options={playerOptions}
                  value={w.memberId === null ? "" : String(w.memberId)}
                  onchange={(v) => (w.memberId = v === "" ? null : Number(v))}
                />
              {/if}
            </div>
          {/each}
        </section>
      {:else}
        <section class="q">
          <h3 class="section-title">All set?</h3>
          <dl class="check">
            <div>
              <dt class="eyebrow">When</dt>
              <dd>
                {values.heldOn ? formatDayDate(londonISO(values.heldOn, "12:00")) : ""}
                {values.heldOn.slice(0, 4)}<span class="sub">{name}</span>
              </dd>
              <button type="button" class="btn ghost sm" onclick={() => (step = 0)}>Change</button>
            </div>
            <div>
              <dt class="eyebrow">Teams</dt>
              <dd>
                {values.teams.map((_, i) => teamName(i)).join(" · ")}<span class="sub">{taken.size} players</span>
              </dd>
              <button type="button" class="btn ghost sm" onclick={() => (step = 1)}>Change</button>
            </div>
            <div>
              <dt class="eyebrow">Results</dt>
              <dd>
                {played} matches, {goals} goals{champions !== null ? ` · Champions: ${teamName(champions)}` : ""}<span
                  class="sub">{named ? `${named} with a scorer` : "Scores only"}</span
                >
              </dd>
              <button type="button" class="btn ghost sm" onclick={() => (step = 2)}>Change</button>
            </div>
            <div>
              <dt class="eyebrow">Awards</dt>
              <dd>
                {given.length ? given.map((a) => a.name).join(" · ") : "None given"}<span class="sub"
                  >{given.length} of {type.awards.length}</span
                >
              </dd>
              <button type="button" class="btn ghost sm" onclick={() => (step = 3)}>Change</button>
            </div>
          </dl>
        </section>
      {/if}
    {/snippet}
    {#snippet finish()}
      <button
        type="button"
        class="btn primary"
        disabled={working || saving.busy > 0 || problems.some((p) => p)}
        onclick={record}>Record it</button
      >
    {/snippet}
  </Wizard>
</Drawer>

{#snippet match(m: PastMatch, label: string)}
  <div class="match" role="group" aria-label={label}>
    <span class="eyebrow">{label}</span>
    {#each ["home", "away"] as const as side (side)}
      {@const team = side === "home" ? m.home : m.away}
      {@const n = side === "home" ? m.homeGoals : m.awayGoals}
      <div class="side">
        <span class="side-name">{teamName(team)}</span>
        <span class="stepper">
          <button
            type="button"
            class="btn ghost sm icon"
            aria-label="{teamName(team)}: one goal fewer"
            disabled={n === 0}
            onclick={() => score(m, side, -1)}><Icon name="minus" size={16} /></button
          >
          <span class="goals" aria-label="{teamName(team)}: {n} goals">{n}</span>
          <button
            type="button"
            class="btn ghost sm icon"
            aria-label="{teamName(team)}: one goal more"
            onclick={() => score(m, side, 1)}><Icon name="plus" size={16} /></button
          >
        </span>
      </div>
      {#if n}
        <div class="scorers">
          {#each Array.from({ length: n }, (_, k) => k) as k (k)}
            <Select
              size="sm"
              id="past-scorer-{label}-{side}-{k}"
              aria-label="{teamName(team)}'s goal {k + 1}: who scored"
              options={scorerOptions(team)}
              value={String(m.scorers[side][k] ?? "")}
              onchange={(v) => (m.scorers[side][k] = v === "" ? null : Number(v))}
            />
          {/each}
        </div>
      {/if}
    {/each}
  </div>
{/snippet}

<style>
  .q {
    display: grid;
    gap: var(--s-4);
  }
  .section-title {
    margin: 0;
  }
  .hint {
    margin: 0;
  }
  .field.day {
    max-width: 14rem;
  }
  .team {
    display: grid;
    gap: var(--s-3);
    padding: var(--s-4);
    border-radius: var(--r-md);
    background: var(--surface-2);
  }
  .team-head,
  .final-head {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  .final-head {
    justify-content: space-between;
  }
  .team-head .input {
    flex: 1;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    height: 2rem;
    padding: 0 var(--s-1) 0 var(--s-3);
    border-radius: var(--r-md);
    background: var(--surface-3, var(--surface-2));
    color: var(--fg);
    font-size: var(--text-sm);
  }
  .chip-btn {
    display: grid;
    place-items: center;
    width: 1.5rem;
    height: 1.5rem;
    padding: 0;
    border: 0;
    border-radius: var(--r-sm);
    background: none;
    color: var(--fg-muted);
    cursor: pointer;
  }
  .add {
    justify-self: start;
  }
  .match {
    display: grid;
    gap: var(--s-2);
    padding: var(--s-3) var(--s-4);
    border-radius: var(--r-md);
    background: var(--surface-2);
  }
  .side {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
  }
  .side-name {
    overflow: hidden;
    color: var(--fg);
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .stepper {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: var(--s-1);
  }
  .goals {
    min-width: 2ch;
    color: var(--fg);
    font-size: var(--text-lg);
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    text-align: center;
  }
  .scorers {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .award {
    display: grid;
    gap: var(--s-2);
  }
  .award-name {
    color: var(--fg);
    font-weight: 500;
  }
  .check {
    display: grid;
    gap: var(--s-5);
    margin: 0;
  }
  .check > div {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--s-1) var(--s-3);
  }
  .check dd {
    display: grid;
    grid-column: 1;
    gap: 2px;
    margin: 0;
    color: var(--fg);
    font-weight: 500;
  }
  .check .sub {
    color: var(--fg-muted);
    font-size: var(--text-sm);
    font-weight: 400;
  }
  .check .btn {
    grid-column: 2;
    grid-row: 1 / span 2;
  }
</style>
