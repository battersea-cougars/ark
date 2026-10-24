<script lang="ts">
  // A tournament's awards and who won them (ADR 0044), on its landing page: each award, its line, and the team or
  // player (or joint winners) who took it home. Once it's done, the data's picks show as provisional (lib/awards.ts)
  // until an admin confirms them (here, or in Manage: AwardsDrawer).
  import { goesByOf, nameOfTeam, teamNamesOf } from "./names";
  import { can } from "../access/actions";
  import { PLAYERS } from "../demo/data";
  import type { Tournament } from "../demo/model";
  import { granted } from "../demo/session.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import { enterAwards } from "./AwardsDrawer.svelte";
  import Kanji from "./Kanji.svelte";
  import { kanjiFor } from "./motif";
  import { typeById } from "../demo/schedule.svelte";
  import TeamCrest from "./TeamCrest.svelte";
  import { teamTone } from "./team-tones";
  import { awardFromData, decidedByOf } from "./awards";
  import { atAfters, editionState } from "./edition";
  import { revealOf } from "./afters";
  import { londonEvening } from "./dates";

  let { tournament }: { tournament: Tournament } = $props();

  const admin = $derived(can(granted(), "manage:Tournament"));
  const teams = $derived(tournament.teams);
  const awards = $derived(tournament.awards ?? []);
  const byId = (id: number | null) => PLAYERS.find((p) => p.id === id);
  const teamIndex = (id: number | null) => teams.findIndex((t) => t.id === id);
  const teamName = (id: number | null) => {
    const t = teams[teamIndex(id)];
    return nameOfTeam(t, teams, byId);
  };
  // Whose team a player's on
  const teamOf = (memberId: number) =>
    teams.find((t) => t.captainMemberId === memberId || t.players.some((p) => p.memberId === memberId))?.id ?? null;
  // Confirmed, else (once it's done) what the data says, provisionally
  const done = $derived(editionState(tournament) === "done");
  // Its evening, an award not yet revealed at the after-party is face down for everyone but whoever reveals it
  // (ADR 0129): no provisional pick in its place
  const tonight = $derived(atAfters(tournament, londonEvening()));
  const revealed = $derived(revealOf(tournament).awards);
  const faceDown = (award: string) => !admin && tonight && !revealed.find((a) => a.name === award)?.revealed;
  const winnersOf = (award: string) => {
    const saved = (tournament.winners ?? []).filter((w) => w.award === award);
    if (saved.length) return { list: saved, provisional: false };
    if (faceDown(award)) return { list: [], provisional: false, faceDown: true };
    const a = awards.find((x) => x.name === award);
    const data = done && a ? awardFromData(a, tournament, { positionOf: (id) => byId(id)?.position }) : null;
    return { list: data?.winners ?? [], provisional: !!data };
  };
  const anyProvisional = $derived(awards.some((a) => winnersOf(a.name).provisional));
  const unconfirmed = $derived(done && awards.length > 0 && !tournament.awardsConfirmedAt);
  // Still to come, for an award decided at the reveal: a vote's, or the admin's call
  const laterWords = (award: string) => {
    const a = awards.find((x) => x.name === award);
    const how = a && decidedByOf(a);
    return how?.kind === "vote"
      ? "Voted for at the after-party"
      : how?.kind === "live"
        ? "The judges' call"
        : "To be decided";
  };
  // The judges' call is named on the night: its name, with what it is under it
  const titleOf = (award: string) => tournament.titles?.find((w) => w.award === award)?.title;
  // The tournament's team names, which its crests are told apart among (logo.ts)
  const crestNames = $derived(teamNamesOf(teams, byId));
</script>

{#if awards.length}
  <section class="part">
    <div class="part-head">
      <h2 class="section-title">Awards<Kanji text={kanjiFor(typeById(tournament.typeId), "awards")} /></h2>
      {#if admin}<button class="btn ghost sm" onclick={() => enterAwards(tournament.id)}
          ><Icon name="medal" size={16} />{unconfirmed ? "Confirm the awards" : "Change the awards"}</button
        >{/if}
    </div>
    {#if anyProvisional}
      <p class="hint provisional">From the results so far: provisional until an admin confirms them.</p>
    {/if}
    <ol class="awards">
      {#each awards as a (a.name)}
        {@const w = winnersOf(a.name)}
        <li class="award">
          <span class="what">
            <span class="award-name">{titleOf(a.name) ?? a.name}</span>
            {#if titleOf(a.name)}<span class="hint">{a.name}</span>
            {:else if a.about}<span class="hint">{a.about}</span>{/if}
          </span>
          <span class="winners">
            {#if w.list.length > 2}
              <!-- A big tie: one line, not a stack of names -->
              <span class="won-text">
                <span class="won-name">Shared by {w.list.length}</span>
                <span class="hint shared"
                  >{w.list.map((x) => (x.teamId ? teamName(x.teamId) : goesByOf(byId(x.memberId)))).join(", ")}</span
                >
              </span>
            {:else}
              {#each w.list as x, i (i)}
                {#if x.teamId}
                  <span class="won">
                    <TeamCrest
                      among={crestNames}
                      name={teamName(x.teamId)}
                      logo={teams[teamIndex(x.teamId)]?.logo ?? null}
                      tone={teamTone(teamIndex(x.teamId))}
                      size="2.25rem"
                    />
                    <span class="won-name">{teamName(x.teamId)}</span>
                  </span>
                {:else if x.memberId}
                  <span class="won-text">
                    <span class="won-name">{goesByOf(byId(x.memberId))}</span>
                    {#if teamOf(x.memberId)}<span class="hint">{teamName(teamOf(x.memberId))}</span>{/if}
                  </span>
                {/if}
              {:else}
                <span class="hint">{"faceDown" in w ? "Still face down" : laterWords(a.name)}</span>
              {/each}
            {/if}
          </span>
        </li>
      {/each}
    </ol>
  </section>
{/if}

<style>
  .part {
    display: grid;
    gap: var(--s-3);
  }
  .part .section-title {
    margin: 0;
  }
  .part-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .part-head .btn {
    gap: var(--s-1);
  }
  .awards {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .award {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--s-4);
    min-height: 4rem;
    padding: var(--s-3) var(--s-1);
  }
  .award + .award {
    border-top: 1px solid var(--border);
  }
  .what,
  .won-text {
    display: grid;
    gap: 0.15rem;
    min-width: 0;
  }
  .award-name {
    color: var(--fg);
    font-weight: 600;
  }
  .won {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-width: 0;
    text-align: right;
  }
  .won-name {
    color: var(--fg);
    font-weight: 500;
  }
  .winners {
    display: grid;
    justify-items: end;
    gap: var(--s-2);
    flex-shrink: 0;
    max-width: 55%;
    text-align: right;
  }
  .shared {
    display: -webkit-box;
    overflow: hidden;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .provisional {
    margin: 0;
  }
</style>
