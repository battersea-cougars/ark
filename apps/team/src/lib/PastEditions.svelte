<script lang="ts">
  // A series' past ones (ADR 0074), newest first, each with how it ended: the day, the champions, the final's score.
  // Each opens its own page (lib/edition-address.ts), its track and every status it went through. On History, and on
  // the series' front page when nothing's on. Read a page at a time as the list's end comes into view (#175,
  // app/history.svelte.ts); tonight's, at its after-party, is still on, so it isn't here.
  import { nameOfTeam } from "./names";
  import { PLAYERS } from "../demo/data";
  import type { TournamentType } from "../demo/model";
  import Icon from "../app/shell/Icon.svelte";
  import TeamCrest from "./TeamCrest.svelte";
  import { atAfters, editionWhen } from "./edition";
  import { teamTone } from "./team-tones";
  import { editionPath } from "./edition-address";
  import { pastList, type EditionSummary } from "../app/history.svelte";
  import { loadMore } from "./load-more";
  import { db } from "../demo/store.svelte";
  import { londonEvening } from "./dates";

  let { type }: { type: TournamentType } = $props();

  const list = $derived(pastList(type.id));
  // Read (again) whenever the club's tournaments change: unchanged, an empty 304
  $effect(() => {
    void db.tournaments;
    void list.refresh().catch(() => {});
  });
  const evening = londonEvening();
  const past = $derived(
    list.editions.filter((e) => {
      const held = db.tournaments.find((t) => t.id === e.id);
      return !held || !atAfters(held, evening);
    }),
  );

  const nameOf = (t: EditionSummary, id: number | null) => {
    const team = t.teams.find((x) => x.id === id);
    return nameOfTeam(team, t.teams, (id) => PLAYERS.find((p) => p.id === id));
  };
  // How it ended, in a line: the final, else the top of the table
  const summary = (t: EditionSummary) => {
    const f = t.final;
    if (t.champion && f) {
      const home = f.homeTeamId === t.champion;
      const [us, them] = home ? [f.homeGoals, f.awayGoals] : [f.awayGoals, f.homeGoals];
      return `Beat ${nameOf(t, home ? f.awayTeamId : f.homeTeamId)} ${us}–${them} in the final`;
    }
    return t.champion ? "Top of the table" : `${t.games} matches`;
  };
</script>

<ol class="past" aria-busy={list.loading}>
  {#each past as t (t.id)}
    {@const ci = t.teams.findIndex((x) => x.id === t.champion)}
    {@const w = editionWhen(t)}
    <li>
      <a class="edition" href={editionPath(type.slug, t.id)}>
        {#if ci >= 0}
          <TeamCrest
            among={t.teams.map((x) => nameOf(t, x.id))}
            name={nameOf(t, t.champion)}
            logo={t.teams[ci].logo}
            tone={teamTone(ci)}
            size="3.5rem"
          />
        {:else}
          <span class="no-crest"><Icon name={type.icon} size={24} /></span>
        {/if}
        <span class="text">
          <span class="eyebrow">{w.day ?? w.season}</span>
          <span class="champ display">{t.champion ? `${nameOf(t, t.champion)} won it` : t.name}</span>
          <span class="hint">{summary(t)}</span>
        </span>
        <Icon name="chevronRight" size={20} />
      </a>
    </li>
  {/each}
  {#if !list.read}
    <!-- The first page on its way: a line's room, so nothing moves when it comes -->
    <li class="waiting" aria-hidden="true"></li>
  {/if}
</ol>
{#if list.next}<div class="more" use:loadMore={() => list.more()}></div>{/if}

<style>
  .past {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .past li + li {
    border-top: 1px solid var(--border);
  }
  .edition {
    display: flex;
    align-items: center;
    gap: var(--s-4);
    padding: var(--s-4) var(--s-1);
    color: var(--fg-muted);
  }
  .edition:hover .champ {
    color: var(--fg);
  }
  .no-crest {
    display: grid;
    place-items: center;
    width: 3.5rem;
    height: 3.5rem;
  }
  .text {
    display: grid;
    flex: 1;
    gap: 0.2rem;
    min-width: 0;
  }
  .waiting {
    height: calc(3.5rem + 2 * var(--s-4));
  }
  .more {
    height: 1px;
  }
  .champ {
    overflow: hidden;
    color: var(--fg);
    font-size: 1.5rem;
    line-height: 1.05;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
</style>
