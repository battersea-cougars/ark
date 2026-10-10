<script lang="ts">
  // Settings → Tournaments: the schedule as a grid, what an admin comes here to scan and change: each one's series,
  // when and where, its fee, sign-up, captains or teams, and where it stands (lib/edition.ts). A row opens that
  // tournament's editor; "New tournament" opens a blank one, which can start from a series' defaults.
  import Icon from "../app/shell/Icon.svelte";
  import PageHeader from "../lib/PageHeader.svelte";
  import TournamentEditorPanel, { editTournament } from "../lib/TournamentEditorPanel.svelte";
  import { tournamentPlace, typeById } from "../demo/schedule.svelte";
  import { db } from "../demo/store.svelte";
  import { londonToday, pounds } from "../lib/dates";
  import { EDITION_LABEL, editionState, editionWhen } from "../lib/edition";
  import type { Tournament } from "../demo/model";
  import SearchField from "../lib/SearchField.svelte";
  import { listScroll } from "../lib/list-scroll";
  import { flip } from "svelte/animate";
  import { cardMoveMs, easeOut, sift } from "../app/motion";

  // Dates still to come first, soonest first; then the finished ones, latest first
  const done = (t: Tournament) => editionState(t) === "done" || t.heldOn < londonToday();
  const dates = $derived(
    [...db.tournaments].sort((a, b) => {
      if (done(a) !== done(b)) return done(a) ? 1 : -1;
      return done(a) ? b.heldOn.localeCompare(a.heldOn) : a.heldOn.localeCompare(b.heldOn);
    }),
  );
  const when = (t: Tournament) => {
    const w = editionWhen(t);
    return { day: w.day ?? w.season, season: w.day ? w.season : "" };
  };
  // The search finds one by its name, its series, where it is, or where it stands
  let query = $state("");
  const shown = $derived.by(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return dates.filter((t) => {
      const text = [t.name, typeById(t.typeId)?.name, tournamentPlace(t)?.name, EDITION_LABEL[editionState(t)]]
        .join(" ")
        .toLowerCase();
      return words.every((w) => text.includes(w));
    });
  });
  // A draft: members say they're in, then captains pick; otherwise teams enter
  const signUp = (t: Tournament) =>
    t.kind === "draft" ? `${t.going.length}${t.capacity ? ` / ${t.capacity}` : ""}` : "—";
  const teams = (t: Tournament) =>
    t.kind === "draft"
      ? t.teams.length
        ? `${t.teams.length} captains`
        : "None yet"
      : `${t.teams.length} ${t.teams.length === 1 ? "team" : "teams"}`;
</script>

<div class="page full">
  <PageHeader title="Tournaments" subtitle="The schedule. Open one to set its day, sign-up, draft and captains.">
    {#snippet actions()}
      <button class="btn primary sm" onclick={() => editTournament("new")}
        ><Icon name="plus" size={16} />New tournament</button
      >
    {/snippet}
  </PageHeader>

  {#if !dates.length}
    <p class="note">No tournaments yet. Add one, on its own or in a series to start from its defaults.</p>
  {:else}
    <!-- The page scrolls until the table's header reaches the top, then on through the rows, the box under it
         showing them pass (lib/list-scroll.ts), as on Friday's Who's coming -->
    <div class="hybrid" use:listScroll>
      <div class="stuck">
        <div class="table-head list-tabs">
          <span>Tournament</span>
          <span>When</span>
          <span class="wide-only">Where</span>
          <span class="r wide-only">Fee</span>
          <span class="r">In</span>
          <span class="wide-only">Teams</span>
          <span>Stands</span>
          <!-- Find one: a magnifier at the end of the row that widens into the field when you tap it -->
          <div class="finder">
            <SearchField bind:value={query} placeholder="Search tournaments" label="Search tournaments" collapsible />
          </div>
        </div>
        <div class="list-box">
          <!-- A search sifts rows; the rest glide to their places (as on Friday) -->
          <div class="list">
            {#each shown as t (t.id)}
              {@const type = typeById(t.typeId)}
              {@const w = when(t)}
              {@const stage = editionState(t)}
              <div
                class="slot"
                animate:flip={{ duration: cardMoveMs, easing: easeOut }}
                in:sift
                out:sift={{ out: true }}
              >
                <button class="table-row" class:past={done(t)} onclick={() => editTournament(t.id)}>
                  <span class="name">
                    <span class="ico tone" style:--tone="var(--tone-{type?.tone ?? 'red'})"
                      ><Icon name={type?.icon ?? "trophy"} size={18} /></span
                    >
                    <span class="txt">
                      <strong>{t.name}</strong>
                      <span class="sub">{type?.name ?? "On its own"}</span>
                    </span>
                  </span>
                  <span class="txt"
                    ><span>{w.day}</span>{#if w.season}<span class="sub">{w.season}</span>{/if}</span
                  >
                  <span class="wide-only muted">{tournamentPlace(t)?.name ?? "No place yet"}</span>
                  <span class="r wide-only num">{t.feePence ? pounds(t.feePence) : "Free"}</span>
                  <span class="r num">{signUp(t)}</span>
                  <span class="wide-only muted">{teams(t)}</span>
                  <span class="stage {stage}">{EDITION_LABEL[stage]}</span>
                  <span class="go"><Icon name="chevronRight" size={18} /></span>
                </button>
              </div>
            {:else}
              <p class="hint none">No tournaments match “{query.trim()}”.</p>
            {/each}
          </div>
        </div>
      </div>
      <div class="list-spacer"></div>
    </div>
  {/if}
</div>

<TournamentEditorPanel />

<style>
  /* The tournament, when, where, its fee, how many are in, its teams, where it stands, and the chevron's room */
  .hybrid {
    --cols: minmax(12rem, 1.6fr) minmax(7rem, 1fr) minmax(7rem, 1fr) 4rem 4rem minmax(6rem, 0.8fr) 6rem 18px;
  }
  .table-row > span {
    min-width: 0;
  }
  .name {
    display: flex;
    align-items: center;
    gap: var(--s-3);
  }
  .ico {
    display: grid;
    place-items: center;
    width: 2.25rem;
    height: 2.25rem;
    flex-shrink: 0;
    border-radius: var(--r-md);
    background: color-mix(in srgb, var(--tone) 18%, transparent);
    color: var(--tone);
  }
  .txt {
    display: grid;
    gap: 0.1rem;
    min-width: 0;
  }
  .txt > * {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .txt strong {
    color: var(--fg);
    font-weight: 600;
  }
  .sub,
  .muted {
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  .r {
    text-align: right;
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  .stage {
    color: var(--fg-muted);
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .stage.live {
    color: var(--red-hot);
  }
  .stage.open {
    color: var(--green-ink);
  }
  .go {
    display: flex;
    color: var(--fg-subtle);
  }
  .past {
    color: var(--fg-muted);
  }
  .none {
    margin: 0;
    padding: var(--s-4);
  }
  /* A phone: the tournament, when, how many are in, where it stands */
  @media (max-width: 900px) {
    .hybrid {
      --cols: minmax(0, 1.4fr) minmax(0, 1fr) 2.5rem auto 18px;
    }
    .table-head,
    .table-row {
      gap: var(--s-3);
    }
    .wide-only {
      display: none;
    }
  }
</style>
