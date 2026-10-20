<script lang="ts">
  // The top of every tournament page: the type as the eyebrow, the page, and the edition it's showing, big: its day
  // (or Date to be confirmed), its season, its hours and place, and where it stands, worked out from what's happened
  // (lib/edition.ts). Past ones are on History, each with a page of its own.
  // On the front page (The Kumite), an admin's Manage menu (ADR 0065): its settings and the awards, open over the page.
  // With nothing on, Next Kumite is the front page's own button, not here (ADR 0074).
  import type { Tournament, TournamentType } from "../demo/model";
  import { can } from "../access/actions";
  import { granted } from "../demo/session.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import PageHeader from "./PageHeader.svelte";
  import TournamentEditorPanel, { editTournament } from "./TournamentEditorPanel.svelte";
  import { tournamentPlace } from "../demo/schedule.svelte";
  import { EDITION_LABEL, editionState, editionWhen } from "./edition";
  import AwardsDrawer, { enterAwards } from "./AwardsDrawer.svelte";
  import Sheet from "./Sheet.svelte";
  import Drawer from "./Drawer.svelte";
  import { phone } from "./viewport.svelte";
  import { londonToday } from "./dates";
  import type { IconName } from "../app/shell/icons";

  let {
    type,
    tournament,
    title,
    manage: offer = false,
    note,
  }: {
    type: TournamentType;
    tournament?: Tournament;
    title: string;
    /** The series' front page (The Kumite): an admin's Manage menu goes here and nowhere else. */
    manage?: boolean;
    /** In place of the date line, for a page about the series rather than one of its dates (History). */
    note?: string;
  } = $props();

  const stage = $derived(tournament ? editionState(tournament) : null);
  const when = $derived(tournament ? editionWhen(tournament) : null);
  const place = $derived(tournament ? tournamentPlace(tournament)?.name : undefined);
  // How long till the day, beside it: today, tomorrow, in N days. Only for a fixed day that's still to come
  const countdown = $derived.by(() => {
    if (!tournament || !when?.day || stage === "done") return "";
    const days = Math.round((Date.parse(tournament.heldOn) - Date.parse(londonToday())) / 86_400_000);
    return days < 0 ? "" : days === 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${days} days`;
  });
  const admin = $derived(offer && can(granted(), "manage:Tournament"));
  interface Tool {
    icon: IconName;
    label: string;
    sub: string;
    run: () => void;
  }
  let menuOpen = $state(false);
  // What an admin does to this edition that has no tab of its own (ADR 0074): its settings (day, sign-up, captains,
  // draft day, rules), then the awards. The draft and the fight card are run on their own tabs, not from here. A bottom
  // sheet on a phone (where it's mostly done, at the rink), a side drawer on a desktop. The next one isn't here: it's
  // the front page's own button once nothing's on (ADR 0074)
  const tools = $derived.by(() => {
    if (!tournament) return [] as Tool[];
    const t = tournament;
    const list: Tool[] = [
      {
        icon: "settings",
        label: `${type.shortName} settings`,
        sub:
          t.kind === "draft"
            ? "Day, sign-up, captains and draft day, rules, awards"
            : "Day, sign-up, teams, rules, awards",
        run: () => editTournament(t.id),
      },
    ];
    if (t.awards.length)
      list.push({
        icon: "medal",
        label: "Confirm the awards",
        sub: "From the results; the Dim Mak's a draw",
        run: () => enterAwards(t.id),
      });
    return list;
  });
  function go(action: () => void) {
    menuOpen = false;
    action();
  }
</script>

<div class="tone" style:--tone="var(--tone-{type.tone})">
  <PageHeader {title} eyebrow={type.name} eyebrowIcon={type.icon}>
    {#snippet badge()}
      {#if stage}
        <!-- Where it stands, as a stamp (the Kumite's hanko, in the club's display face): cream done, red on, green open -->
        <span class="stamp {stage}">
          {EDITION_LABEL[stage]}
        </span>
      {/if}
    {/snippet}
    {#snippet sub()}
      <!-- Always the same two lines, on every page of the series, so the tabs under it never move: the day big (or
           that it's to be confirmed), then the season, hours and place -->
      <span class="when-box">
        {#if note}
          <span class="day-line"><span class="aside">{note}</span></span>
          <span class="where">&nbsp;</span>
        {:else if tournament && when}
          <span class="day-line"
            ><span class="day display">{when.day ?? when.season}</span>{#if countdown}<span
                class="countdown display"
                class:today={countdown === "Today"}>{countdown}</span
              >{/if}</span
          >
          <span class="where">{[when.day ? when.season : "", when.hours, place].filter(Boolean).join(" · ")}</span>
        {:else}
          <span class="day-line"><span class="aside">No {type.shortName} scheduled yet.</span></span>
          <span class="where">&nbsp;</span>
        {/if}
      </span>
    {/snippet}
    {#snippet actions()}
      {#if admin && tools.length}
        <!-- One quiet button on the series' front page (ADR 0065): what an admin does to the series, kept out of the
             way of everyone else's view -->
        <div class="manage">
          <button
            class="btn sm ghost icon"
            aria-haspopup="dialog"
            aria-label="Manage the {type.shortName}"
            title="Manage"
            onclick={() => (menuOpen = true)}><Icon name="settings" size={18} /></button
          >
        </div>
      {/if}
    {/snippet}
  </PageHeader>
</div>

{#snippet toolList()}
  <div class="tools">
    {#each tools as tool (tool.label)}
      <button class="tool" onclick={() => go(tool.run)}>
        <Icon name={tool.icon} size={22} />
        <span class="tool-text"><strong>{tool.label}</strong><span>{tool.sub}</span></span>
        <Icon name="chevronRight" size={18} />
      </button>
    {/each}
  </div>
{/snippet}

{#if admin}
  <!-- Every admin job for this one, thumb-sized: up from the bottom on a phone, a side drawer on a desktop -->
  {#if phone.current}
    <Sheet bind:open={menuOpen} title="Manage the {type.shortName}">{@render toolList()}</Sheet>
  {:else}
    <Drawer bind:open={menuOpen} title="Manage the {type.shortName}" sub={tournament?.name}>{@render toolList()}</Drawer
    >
  {/if}
{/if}
{#if can(granted(), "manage:Tournament")}<AwardsDrawer />{/if}

{#if can(granted(), "manage:Tournament")}<TournamentEditorPanel />{/if}

<style>
  .tone {
    display: contents;
  }
  .manage {
    position: relative;
    display: flex;
    gap: var(--s-2);
  }
  .stamp {
    display: inline-flex;
    align-items: center;
    align-self: center;
    padding: 0.2rem 0.6rem 0.15rem;
    border: 2.5px solid currentColor;
    border-radius: 0.3rem;
    color: var(--fg-muted);
    font-family: var(--font-display);
    font-size: 1.35rem;
    line-height: 1;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    white-space: nowrap;
    transform: rotate(-4deg);
  }
  .stamp.done {
    color: var(--primary);
  }
  .stamp.live {
    color: var(--red-hot);
  }
  .stamp.open {
    color: var(--green-ink);
  }
  /* On a phone it sits in the eyebrow line: no taller than the line, so the header's height never changes */
  @media (max-width: 900px) {
    .stamp {
      padding: 0.05rem 0.4rem 0;
      border-width: 1.5px;
      font-size: 0.85rem;
    }
  }
  /* Two fixed lines: the same height whatever's in them, so nothing below moves from page to page */
  .when-box {
    display: grid;
    grid-template-rows: 2.2rem 1.5rem;
    gap: var(--s-1);
  }
  .day-line,
  .where {
    display: flex;
    align-items: flex-end;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .day {
    overflow: hidden;
    color: var(--fg);
    font-size: clamp(1.4rem, 3.5vw, 1.9rem);
    line-height: 1.1;
    text-overflow: ellipsis;
  }
  /* The countdown: the day's own size down a step, quieter; on the day itself, the club's red */
  .countdown {
    margin-left: var(--s-3);
    color: var(--fg-muted);
    font-size: clamp(1rem, 2.4vw, 1.3rem);
    line-height: 1.1;
  }
  .countdown.today {
    color: var(--red-hot);
  }
  .aside {
    color: var(--fg-muted);
  }
  .where {
    align-items: center;
    color: var(--fg-muted);
  }
  .tools {
    display: grid;
    gap: var(--s-2);
  }
  .tool {
    display: flex;
    align-items: center;
    gap: var(--s-4);
    min-height: 4.25rem;
    padding: var(--s-3) var(--s-4);
    border: 0;
    border-radius: var(--r-lg);
    background: var(--surface-2);
    color: var(--fg-muted);
    font: inherit;
    text-align: left;
  }
  .tool:active {
    background: var(--surface-3);
  }
  .tool-text {
    display: grid;
    flex: 1;
    gap: 0.15rem;
    min-width: 0;
  }
  .tool-text strong {
    color: var(--fg);
    font-size: var(--text-md);
    font-weight: 600;
  }
  .tool-text span {
    font-size: var(--text-sm);
  }
</style>
