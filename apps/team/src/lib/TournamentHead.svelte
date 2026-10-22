<script lang="ts">
  // The top of every tournament page: the type as the eyebrow, the page, and the edition it's showing, big: its day
  // (or Date to be confirmed), its season, its hours and place, and where it stands, worked out from what's happened
  // (lib/edition.ts). Past ones are on History, each with a page of its own.
  // On the front page (The Kumite), an admin's Manage menu (ADR 0065): its settings and the awards, open over the page.
  // With nothing on, Next Kumite is the front page's own button, not here (ADR 0074).
  import type { Tournament, TournamentType } from "../demo/model";
  import { can } from "../access/actions";
  import { granted, me } from "../demo/session.svelte";
  import TeamLookSheet from "./TeamLookSheet.svelte";
  import PickLog from "./PickLog.svelte";
  import { nameOfTeam } from "./names";
  import { PLAYERS } from "../demo/data";
  import Icon from "../app/shell/Icon.svelte";
  import PageHeader from "./PageHeader.svelte";
  import TournamentEditorPanel, { editTournament } from "./TournamentEditorPanel.svelte";
  import { tournamentAfter, tournamentPlace } from "../demo/schedule.svelte";
  import { countdownOf, editionWhen } from "./edition";
  import { stageBadge, type Status } from "./tournament-front";
  import { makeFixtures } from "../app/backend.svelte";
  import { formatAndRules } from "./format-rules";
  import StageTrack from "./StageTrack.svelte";
  import AwardsDrawer, { enterAwards } from "./AwardsDrawer.svelte";
  import Sheet from "./Sheet.svelte";
  import Drawer from "./Drawer.svelte";
  import { phone } from "./viewport.svelte";
  import { londonToday } from "./dates";
  import type { IconName } from "../app/shell/icons";
  import StepBack from "./StepBack.svelte";
  import { BACK_SAYS, backFrom, backTo } from "./step-back";

  let {
    type,
    tournament,
    title,
    manage: offer = false,
    note,
    compact = false,
    track = false,
    viewing = null,
    extra = [],
  }: {
    type: TournamentType;
    tournament?: Tournament;
    title: string;
    /** The series' front page (The Kumite): an admin's Manage menu goes here and nowhere else. */
    manage?: boolean;
    /** In place of the date line, for a page about the series rather than one of its dates (History). */
    note?: string;
    /** A phone view that needs its room (the draft, while it's picked): no header, just the track to say where. */
    compact?: boolean;
    /** The track of its statuses under the header, the tournament page's navigation (ADR 0074). */
    track?: boolean;
    /** The status whose view the page is showing (the track's lit one); none on a page that isn't one (the board). */
    viewing?: Status | null;
    /** More jobs for Manage from the view showing (the draft's own, for whoever runs it). */
    extra?: { icon: IconName; label: string; sub: string; run: () => void }[];
  } = $props();

  // Where it's got to, as the stamp says it (lib/tournament-front.ts): sign-up open, the draft live, the teams set,
  // the fixtures out, KUMITE! on the day, done
  const stage = $derived(tournament ? stageBadge(tournament, type, londonToday()) : null);
  const when = $derived(tournament ? editionWhen(tournament) : null);
  // Where it is, opening the map (its venue's link, else a search for its name)
  const place = $derived(tournament ? tournamentPlace(tournament) : null);
  // How far off the day is (lib/edition.ts countdownOf): within a week it leads the line, big, in the club's red
  // (Tomorrow · Fri 23 Oct · 7 to 9:30pm); further off, quiet after the date. Only for a fixed day still to come
  const countdown = $derived(
    tournament && when?.day && stage?.tone !== "done" ? countdownOf(tournament.heldOn, londonToday()) : null,
  );
  const lead = $derived(countdown && "lead" in countdown ? countdown.lead : "");
  const quiet = $derived(countdown && "quiet" in countdown ? countdown.quiet : "");
  // Where everyone goes afterwards (ADR 0074), beside the place: the Kumite's The Anchor
  const after = $derived(tournament ? tournamentAfter(tournament) : null);
  const admin = $derived(offer && can(granted(), "manage:Tournament"));
  // A captain looks after their own team from here (ADR 0060): its name and crest, as on its page (TeamLookSheet)
  const myTeam = $derived(
    offer && tournament ? tournament.teams.find((x) => x.id && x.captainMemberId === me().id) : undefined,
  );
  let lookOpen = $state(false);
  // The pick log: its captains' and whoever runs the draft's, from the draft opening (ADR 0060)
  const picksSeen = $derived(
    offer &&
      !!tournament &&
      tournament.kind === "draft" &&
      (tournament.draftState === "open" || tournament.draftState === "closed") &&
      (can(granted(), "run:Draft") || tournament.teams.some((x) => x.captainMemberId === me().id)),
  );
  let logOpen = $state(false);
  interface Tool {
    icon: IconName;
    label: string;
    sub: string;
    run: () => void;
  }
  let menuOpen = $state(false);
  let rulesOpen = $state(false);
  function jump(topic: string) {
    document
      .querySelector(`[data-topic="${CSS.escape(topic)}"]`)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  const rules = $derived(tournament ? formatAndRules(tournament, type.houseRules) : []);
  let stepper = $state<ReturnType<typeof StepBack>>();
  // What an admin does to this edition that has no tab of its own (ADR 0074): its settings (day, sign-up, captains,
  // draft day, rules), then the awards. The draft and the fight card are run on their own tabs, not from here. A bottom
  // sheet on a phone (where it's mostly done, at the rink), a side drawer on a desktop. The next one isn't here: it's
  // the front page's own button once nothing's on (ADR 0074)
  const tools = $derived.by(() => {
    if (!tournament) return [] as Tool[];
    const t = tournament;
    const yours: Tool[] = [
      ...(myTeam
        ? [{ icon: "teams" as const, label: "Your team", sub: "Its name and crest", run: () => (lookOpen = true) }]
        : []),
      ...(picksSeen
        ? [{ icon: "list" as const, label: "Pick log", sub: "Every pick, round by round", run: () => (logOpen = true) }]
        : []),
    ];
    if (!admin) return [...yours, ...extra];
    const list: Tool[] = [
      ...yours,
      ...extra,
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
    // Back a step (ADR 0074): one item, whatever step it's at, while there's one before it
    const from = backFrom(t, londonToday());
    if (from)
      list.push({
        icon: "undo",
        label: backTo(from, tournament.kind),
        sub: BACK_SAYS[from],
        run: () => stepper?.start(),
      });
    // The fixtures made, no match played: made again (a new order of play), here, not a button on the page
    const games = t.games ?? [];
    if (games.length && !games.some((g) => g.status !== "next" || g.homeGoals !== null))
      list.push({
        icon: "refresh",
        label: "Make the fixtures again",
        sub: "A new order of play, the same teams",
        run: () => void makeFixtures(t.id),
      });
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

<!-- Compact (a phone page that needs its room): no header at all; the page's tabs say where you are -->
{#if !compact}<div class="tone" style:--tone="var(--tone-{type.tone})">
    <!-- A phone's eyebrow is the series' short name, so it and its stamp and buttons stay one line -->
    <PageHeader {title} eyebrow={phone.current ? type.shortName : type.name} eyebrowIcon={type.icon}>
      {#snippet badge()}
        {#if stage}
          <!-- Where it stands, as a stamp (the Kumite's hanko, in the club's display face): cream done, red live (the
               draft, the day), green open, the teams and fixtures set plain -->
          <span class="stamp {stage.tone}">
            {stage.label}
          </span>
        {/if}
        {#if tournament && track}
          <!-- Format & rules, for everyone (ADR 0074): how the day runs, the points, the penalties, the house rules -->
          <button
            class="btn sm ghost icon rules"
            aria-haspopup="dialog"
            aria-label="Rules"
            title="Rules"
            onclick={() => (rulesOpen = true)}><Icon name="rules" size={18} /></button
          >
        {/if}
        {#if tools.length}
          <!-- One quiet button on the series' front page (ADR 0065): what an admin does to the series, kept out of the
               way of everyone else's view. At the end of the stamp's line, not a toolbar row of its own, so the header
               and the track under it sit where they do on the series' other pages (ADR 0074) -->
          <button
            class="btn sm ghost icon manage"
            aria-haspopup="dialog"
            aria-label="Manage the {type.shortName}"
            title="Manage"
            onclick={() => (menuOpen = true)}><Icon name="settings" size={18} /></button
          >
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
            <!-- The date leads: the day, its hours and how far off (Sat 14 Nov · 7 to 9:30pm · in 24 days), the
                 season and the place under it. Just a season: the season, its day to be set -->
            {#if lead}
              <span class="day-line"
                ><span class="day lead display">{lead}</span><span class="more display"
                  ><span class="dot" aria-hidden="true">·</span>{when.day}</span
                >{#if when.hours}<span class="more display hours"
                    ><span class="dot" aria-hidden="true">·</span>{when.hours}</span
                  >{/if}</span
              >
            {:else}
              <span class="day-line"
                ><span class="day display">{when.day ?? when.season}</span>{#if when.hours}<span class="more display"
                    ><span class="dot" aria-hidden="true">·</span>{when.hours}</span
                  >{/if}{#if quiet}<span class="more display"><span class="dot" aria-hidden="true">·</span>{quiet}</span
                  >{/if}</span
              >
            {/if}
            <!-- The place, on the map. With a day set the season goes without saying; just a season, the day's to set -->
            <span class="where"
              >{#if !when.day}<span class="season">Day to be set</span>{/if}{#if place}{#if !when.day}<span
                    class="dot"
                    aria-hidden="true">·</span
                  >{/if}{#if place.mapUrl}<a
                    class="place"
                    href={place.mapUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="{place.name}, on the map"><Icon name="pin" size={14} /><span>{place.name}</span></a
                  >{:else}<span class="place"><span>{place.name}</span></span>{/if}{/if}{#if after}<span
                  class="dot"
                  aria-hidden="true">·</span
                ><a
                  class="place after"
                  href={after.mapUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Afterwards: {after.name}{after.note ? `, ${after.note.toLowerCase()}` : ''}"
                  aria-label="Afterwards: {after.name}{after.note ? `, ${after.note.toLowerCase()}` : ''}, on the map"
                  ><Icon name="glass" size={14} /><span>{after.name}</span></a
                >{/if}</span
            >
          {:else}
            <span class="day-line"><span class="aside">No {type.shortName} scheduled yet.</span></span>
            <span class="where">&nbsp;</span>
          {/if}
        </span>
      {/snippet}
    </PageHeader>
  </div>{/if}
<!-- The track stays when the header makes room (compact): it's the way back out of the view -->
{#if track && tournament && !note}<StageTrack {type} {tournament} today={londonToday()} {viewing} />{/if}

{#snippet rulesList()}
  <div class="rules-list">
    <!-- One Rules, a topic each (ADR 0074): a jump to each, then the topics -->
    <nav class="topics" aria-label="Topics">
      {#each rules as section (section.title)}
        <button type="button" class="btn sm ghost" onclick={() => jump(section.title)}>{section.title}</button>
      {/each}
    </nav>
    {#each rules as section (section.title)}
      <section data-topic={section.title}>
        <h3 class="eyebrow">{section.title}</h3>
        <ul>
          {#each section.lines as line, i (i)}<li>{line}</li>{/each}
        </ul>
      </section>
    {/each}
  </div>
{/snippet}
{#if tournament && track}
  {#if phone.current}
    <Sheet bind:open={rulesOpen} title="Rules">{@render rulesList()}</Sheet>
  {:else}
    <Drawer bind:open={rulesOpen} title="Rules" sub={tournament.name}>{@render rulesList()}</Drawer>
  {/if}
{/if}

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

{#if tournament && myTeam?.id}
  <TeamLookSheet
    tournamentId={tournament.id}
    teamId={myTeam.id}
    name={myTeam.name}
    logo={myTeam.logo}
    fallback={nameOfTeam({ ...myTeam, name: "" }, tournament.teams, (id) =>
      id ? PLAYERS.find((p) => p.id === id) : undefined,
    )}
    bind:open={lookOpen}
  />
{/if}
{#if picksSeen && tournament}<PickLog {tournament} bind:open={logOpen} />{/if}
{#if tools.length}
  <!-- Every admin job for this one, thumb-sized: up from the bottom on a phone, a side drawer on a desktop -->
  {#if phone.current}
    <Sheet bind:open={menuOpen} title="Manage the {type.shortName}">{@render toolList()}</Sheet>
  {:else}
    <Drawer bind:open={menuOpen} title="Manage the {type.shortName}" sub={tournament?.name}>{@render toolList()}</Drawer
    >
  {/if}
{/if}
{#if admin && tournament}<StepBack bind:this={stepper} {type} {tournament} />{/if}
{#if can(granted(), "manage:Tournament")}<AwardsDrawer />{/if}

{#if can(granted(), "manage:Tournament")}<TournamentEditorPanel />{/if}

<style>
  .tone {
    display: contents;
  }
  /* The Manage gear: at the far end of the stamp's line, taking no more height than the line has */
  .manage,
  .rules {
    margin-block: -0.5rem;
  }
  /* The first of the two buttons goes to the far end of the line */
  .rules {
    margin-left: auto;
  }
  .rules-list {
    display: grid;
    gap: var(--s-5);
  }
  .topics {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1);
  }
  .rules-list section {
    scroll-margin-top: var(--s-4);
    display: grid;
    gap: var(--s-2);
  }
  .rules-list h3 {
    margin: 0;
  }
  .rules-list ul {
    display: grid;
    gap: var(--s-2);
    margin: 0;
    padding-left: 1.1rem;
    color: var(--fg-body, var(--fg));
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
  .stamp.set {
    color: var(--fg);
  }
  /* On a phone it sits in the eyebrow line: no taller than the line, so the header's height never changes */
  @media (max-width: 900px) {
    .stamp {
      padding: 0.05rem 0.4rem 0;
      border-width: 1.5px;
      font-size: 0.85rem;
    }
  }
  /* The header's line clamps to two lines on a phone, and WebKit's clamp cuts the countdown short ("TOD…") on one
     line with room to spare: these two lines have their own fixed height, so no clamp */
  :global(p.line:has(> .when-box)) {
    display: block;
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
    flex: none;
    overflow: hidden;
    color: var(--fg);
    font-size: clamp(1.4rem, 3.5vw, 1.9rem);
    line-height: 1.1;
    text-overflow: ellipsis;
  }
  /* After the day, its hours and the countdown: the day's own face down a step, quieter; on the day itself, Today in
     the club's red. A narrow phone keeps them on the one line by a smaller step still */
  .more {
    flex: none;
    color: var(--fg-muted);
    font-size: clamp(1rem, 2.4vw, 1.3rem);
    line-height: 1.1;
  }
  .dot {
    margin-inline: 0.4em;
    color: var(--fg-subtle);
  }
  /* Within a week, how far off leads: big, in the club's red */
  .lead {
    color: var(--red-hot);
  }
  /* The afterwards keeps its name whole; the place gives way first */
  .place.after {
    flex: none;
  }
  @media (max-width: 380px) {
    .day {
      font-size: 1.25rem;
    }
    .more {
      font-size: 0.95rem;
    }
    .dot {
      margin-inline: 0.3em;
    }
  }
  /* A phone, with how far off leading: the hours go, so the line stays one row (they're in the Fixtures set view) */
  @media (max-width: 440px) {
    .hours {
      display: none;
    }
  }
  .aside {
    color: var(--fg-muted);
  }
  .where {
    align-items: center;
    color: var(--fg-muted);
  }
  .where .dot {
    margin-inline: 0.45em;
  }
  .season {
    flex: none;
  }
  /* The place, a quiet link to the map: a pin and its name, cut short before it ever wraps (the line's height is
     fixed) */
  .place {
    display: inline-flex;
    align-items: center;
    gap: 0.3em;
    min-width: 0;
    color: inherit;
    text-decoration: none;
  }
  .place span {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  a.place:hover {
    color: var(--fg);
  }
  .place :global(svg) {
    flex: none;
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
