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
  import AnswerMenu from "./AnswerMenu.svelte";
  import { goesByOf, nameOfTeam } from "./names";
  import { PLAYERS } from "../demo/data";
  import Icon from "../app/shell/Icon.svelte";
  import PageHeader from "./PageHeader.svelte";
  import TournamentEditorPanel, { editTournament } from "./TournamentEditorPanel.svelte";
  import { tournamentAfter, tournamentPlace } from "../demo/schedule.svelte";
  import { countdownOf, editionState, editionWhen } from "./edition";
  import { stageBadge, statusOf, type Status } from "./tournament-front";
  import { invitationOnly, kanjiFor, type MotifKey } from "./motif";
  import { fighterLabel, fighterOf } from "./fighters";
  import Kanji from "./Kanji.svelte";
  import type { IconName } from "../app/shell/icons";
  import type { RulesTopic } from "./format-rules";
  import { signupOpen } from "./signup";
  import { prefersReducedMotion } from "../app/motion";
  import { cubicOut } from "svelte/easing";
  import { makeFixtures } from "../app/backend.svelte";
  import { formatAndRules } from "./format-rules";
  import StageTrack from "./StageTrack.svelte";
  import AwardsDrawer, { enterAwards } from "./AwardsDrawer.svelte";
  import Sheet from "./Sheet.svelte";
  import Drawer from "./Drawer.svelte";
  import { phone } from "./viewport.svelte";
  import { londonToday } from "./dates";
  import StepBack from "./StepBack.svelte";
  import SimulateRest from "./SimulateRest.svelte";
  import { SIMULATOR } from "../demo/data";
  import { simulating } from "../app/backend.svelte";
  import DraftJobs from "./DraftJobs.svelte";
  import ManageList, { type ManageItem } from "./ManageList.svelte";
  import { draftJobsOf } from "./draft-jobs";
  import { BACK_SAYS, backFrom, backTo } from "./step-back";
  import InkStamp, { type InkTone } from "./InkStamp.svelte";

  let {
    type,
    tournament,
    title,
    manage: offer = false,
    note,
    compact = false,
    track = false,
    viewing = null,
    back,
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
    /** A page under the series' front page (a team, a match, History): the eyebrow is the way back, "‹ The Cougars
     *  Kumite", top left over the title on every screen. Its label when it isn't the series (an edition's page). */
    back?: { href: string; label?: string };
  } = $props();

  const when = $derived(tournament ? editionWhen(tournament) : null);
  // Where everyone goes afterwards (ADR 0074), beside the place: the Kumite's The Anchor
  const after = $derived(tournament ? tournamentAfter(tournament) : null);
  // Where it's got to, as the stamp says it (lib/tournament-front.ts): the status, as the track names it, with its
  // kanji on the Kumite (lib/motif.ts): Sign-up open, Draft open, Teams set, Fixtures set, KUMITE!, The Anchor
  const stage = $derived(tournament ? stageBadge(tournament, type, londonToday(), after?.name) : null);
  const mark = $derived(stage ? kanjiFor(type, stage.mark) : "");
  // The status's ink (lib/InkStamp): the club's red, Coming up faint, KUMITE! a block of red, the after-party and Done bone
  const INK = { on: "red", quiet: "faint", live: "live", done: "bone" } as const satisfies Record<string, InkTone>;
  // Where it is, opening the map (its venue's link, else a search for its name)
  const place = $derived(tournament ? tournamentPlace(tournament) : null);
  // How far off the day is (lib/edition.ts countdownOf): within a week it leads the line, big, in the club's red
  // (Tomorrow · Fri 23 Oct · 7 to 9:30pm); further off, quiet after the date. Only for a fixed day still to come
  const countdown = $derived(
    tournament && when?.day && stage?.tone !== "done" ? countdownOf(tournament.heldOn, londonToday()) : null,
  );
  const lead = $derived(countdown && "lead" in countdown ? countdown.lead : "");
  const quiet = $derived(countdown && "quiet" in countdown ? countdown.quiet : "");
  const admin = $derived(offer && can(granted(), "manage:Tournament"));
  // Whoever runs the draft takes back the draft's own steps too (the drawn order, the picks): from here, the one
  // Back on the page (lib/StepBack), not one of the draft's as well
  const runner = $derived(offer && can(granted(), "run:Draft"));
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
  let menuOpen = $state(false);
  let rulesOpen = $state(false);
  // Your answer once you've given it (ADR 0074): in, waiting or out, as the Friday card's answer says it (a tick, a
  // cross), never like the status's stamp; it opens a small sheet to change it. Not while the sign-up card is on the
  // page under it, where you answer (pages/Games)
  const signingUp = $derived(
    !!tournament &&
      viewing === "signup" &&
      statusOf(tournament, londonToday()) === "signup" &&
      signupOpen(tournament, londonToday()),
  );
  const answered = $derived.by(() => {
    if (!tournament || !track || signingUp) return null;
    const id = me().id;
    // The Kumite's by invitation: your fighter's number, a reserve's, or Declined (lib/fighters.ts)
    const f = invitationOnly(type) ? fighterOf(tournament, id) : null;
    if (f?.is === "fighter")
      return { label: fighterLabel(f), short: `No. ${f.no}`, tone: "in", icon: "check" as const };
    if (f?.is === "reserve")
      return { label: fighterLabel(f), short: `Res. ${f.no}`, tone: "wait", icon: "clock" as const };
    if (f) return { label: "Declined", short: "Declined", tone: "out", icon: "x" as const };
    if (tournament.going.includes(id)) return { label: "You're in", short: "In", tone: "in", icon: "check" as const };
    if (tournament.waitlist.includes(id))
      return { label: "Waiting", short: "Waiting", tone: "wait", icon: "clock" as const };
    if (tournament.out?.includes(id)) return { label: "You're out", short: "Out", tone: "out", icon: "x" as const };
    return null;
  });
  let answerOpen = $state(false);
  let answerAt = $state<HTMLElement | undefined>();
  // Rules, a topic a page (ADR 0074): the tabs change the page, which slides in the way you went; on a phone a swipe
  // does too. It opens on the topic for the status it's at, and keeps to the one you're on while it's open
  const rules = $derived(tournament ? formatAndRules(tournament, type.houseRules) : []);
  const TOPIC_FOR: Record<Status, RulesTopic[]> = {
    signup: ["signup"],
    draft: ["draft", "signup"],
    teams: ["format"],
    fixtures: ["format"],
    day: ["points"],
    afters: ["points"],
  };
  const TOPIC_LOOK: Record<RulesTopic, { mark: MotifKey; icon: IconName }> = {
    signup: { mark: "open", icon: "userPlus" },
    draft: { mark: "draw", icon: "draft" },
    format: { mark: "fights", icon: "swords" },
    points: { mark: "results", icon: "medal" },
    penalties: { mark: "blood", icon: "whistle" },
    house: { mark: "martial", icon: "rules" },
  };
  let topic = $state<RulesTopic>("signup");
  let topicDir = $state(1);
  const topicAt = $derived(
    Math.max(
      0,
      rules.findIndex((x) => x.id === topic),
    ),
  );
  function openRules() {
    const at = tournament ? statusOf(tournament, londonToday()) : "signup";
    topic = TOPIC_FOR[at].find((id) => rules.some((x) => x.id === id)) ?? rules[0]?.id ?? "signup";
    rulesOpen = true;
  }
  function toTopic(i: number) {
    const next = rules[i];
    if (!next || i === topicAt) return;
    topicDir = i > topicAt ? 1 : -1;
    topic = next.id;
  }
  // A swipe across the page (not down it) turns it
  let swipeFrom: { x: number; y: number } | null = null;
  function swipeEnd(e: TouchEvent) {
    const t = e.changedTouches[0];
    if (!swipeFrom || !t) return;
    const dx = t.clientX - swipeFrom.x;
    const dy = t.clientY - swipeFrom.y;
    swipeFrom = null;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) toTopic(topicAt + (dx < 0 ? 1 : -1));
  }
  const topicIn = (_node: Element) => ({
    duration: prefersReducedMotion ? 0 : 280,
    easing: cubicOut,
    css: (t: number, u: number) => `transform: translateX(${u * 40 * topicDir}px); opacity: ${t}`,
  });
  const topicOut = (_node: Element) => ({
    duration: prefersReducedMotion ? 0 : 180,
    css: (t: number, u: number) => `transform: translateX(${-u * 28 * topicDir}px); opacity: ${t}`,
  });
  // A rule's figures stand out (places, £, minutes, points): split into words and figures, a figure every other part
  const figures = (text: string) =>
    text.split(/(£?\d+(?:[.:]\d+)?(?:am|pm|st|nd|rd|th)?(?:-minute)?(?: × \d+-minute)?)/);
  let stepper = $state<ReturnType<typeof StepBack>>();
  let simulator = $state<ReturnType<typeof SimulateRest>>();
  // What an admin does to this edition that has no tab of its own (ADR 0074): its settings (day, sign-up, captains,
  // draft day, rules), then the awards. The draft and the fight card are run on their own tabs, not from here. A bottom
  // sheet on a phone (where it's mostly done, at the rink), a side drawer on a desktop. The next one isn't here: it's
  // the front page's own button once nothing's on (ADR 0074)
  // The draft's own jobs (lib/draft-jobs.ts): items here, not a menu inside the menu
  const adds = $derived(offer && can(granted(), "update:Event"));
  let drafter = $state<ReturnType<typeof DraftJobs>>();
  const byId = (id: number | null) => (id ? PLAYERS.find((p) => p.id === id) : undefined);
  const tools = $derived.by(() => {
    if (!tournament) return [] as ManageItem[];
    const t = tournament;
    // What the step it's at needs, first: the draft's jobs; the fixtures made again (none played); the awards, once
    // there are results
    const now: ManageItem[] = draftJobsOf(
      t,
      { runs: runner, adds },
      {
        player: (id, name) => goesByOf(byId(id)) || name || "",
        team: (i) => nameOfTeam(t.teams[i], t.teams, byId),
      },
    ).map((j) => ({ ...j, run: () => drafter?.run(j.job) }));
    const games = t.games ?? [];
    if (admin && games.length && !games.some((g) => g.status !== "next" || g.homeGoals !== null))
      now.push({
        icon: "refresh",
        label: "Make the fixtures again",
        sub: "A new order of play, the same teams",
        run: () => void makeFixtures(t.id),
      });
    if (admin && t.awards.length && games.some((g) => g.homeGoals !== null))
      now.push({
        icon: "medal",
        label: "Confirm the awards",
        sub: "From the results; the Dim Mak's a draw",
        run: () => enterAwards(t.id),
      });
    // Dev only (ADR 0123): the rest played out at random, to the after-party, while there's something left to play
    if (admin && SIMULATOR && editionState(t) !== "done" && simulating.id !== t.id)
      now.push({
        icon: "play",
        label: `Play out the ${type.shortName}`,
        sub: "Dev only: the rest at random, to the after-party",
        run: () => simulator?.start(),
      });
    // Then back a step (ADR 0074): one item, whatever step it's at, while there's one before it; the draft's own
    // steps for whoever runs it too
    const from = backFrom(t, londonToday());
    const back: ManageItem[] =
      from && (admin || (runner && (from === "draft" || from === "order")))
        ? [{ icon: "undo", label: backTo(from, t.kind), sub: BACK_SAYS[from], run: () => stepper?.start() }]
        : [];
    // Then yours: your team, the pick log; the settings last
    const yours: ManageItem[] = [
      ...(myTeam
        ? [{ icon: "teams" as const, label: "Your team", sub: "Its name and crest", run: () => (lookOpen = true) }]
        : []),
      ...(picksSeen
        ? [{ icon: "list" as const, label: "Pick log", sub: "Every pick, round by round", run: () => (logOpen = true) }]
        : []),
    ];
    const settings: ManageItem[] = admin
      ? [
          {
            icon: "settings",
            label: `${type.shortName} settings`,
            sub:
              t.kind === "draft"
                ? "Day, sign-up, captains and draft day, rules, awards"
                : "Day, sign-up, teams, rules, awards",
            run: () => editTournament(t.id),
          },
        ]
      : [];
    return [...now, ...back, ...yours, ...settings];
  });
  function go(action: () => void) {
    menuOpen = false;
    action();
  }
</script>

<!-- Compact (a phone page that needs its room): no header at all; the page's tabs say where you are -->
{#if !compact}<div class="tone" style:--tone="var(--tone-{type.tone})">
    <!-- A phone's eyebrow is the series' short name, so it and its stamp and buttons stay one line -->
    <PageHeader
      {title}
      eyebrow={back?.label ?? (phone.current ? type.shortName : type.name)}
      eyebrowIcon={type.icon}
      eyebrowHref={back?.href}
    >
      {#snippet badge()}
        {#if stage}
          <!-- Where it stands, as an ink stamp in the club's red (the Kumite's hanko: its kanji pressed in a block,
               the word beside it, the ink a little patchy, the edge uneven, askew). Every status the same stamp;
               Coming up faint; KUMITE! the loudest, the block of ink filled; the evening's after-party and Done
               in bone -->
          <InkStamp text={stage.label} kanji={mark} tone={INK[stage.tone]} label="Status: {stage.label}" />
        {/if}
        {#if answered}
          <!-- Your answer, once you've given it (ADR 0074): a sticker that opens a small sheet to change it -->
          <span class="answer-at" bind:this={answerAt}>
            <button
              class="answered {answered.tone}"
              aria-haspopup="dialog"
              aria-expanded={answerOpen}
              aria-label="{answered.label}: change it"
              onclick={() => (answerOpen = !answerOpen)}
              ><span class="said"><Icon name={answered.icon} size={14} /></span><span class="long"
                >{answered.label}</span
              ><span class="short">{answered.short}</span><span class="caret"
                ><Icon name="chevronDown" size={14} /></span
              ></button
            >
            {#if answerOpen && !phone.current && tournament}
              <!-- A desktop: a small popover under the badge, pointing at it -->
              <div class="popover" role="dialog" aria-label="Your answer">
                <AnswerMenu
                  {tournament}
                  canSignUp={can(granted(), "signup:Event")}
                  ondone={() => (answerOpen = false)}
                />
              </div>
            {/if}
          </span>
        {/if}
        {#if tournament && track}
          <!-- Format & rules, for everyone (ADR 0074): how the day runs, the points, the penalties, the house rules -->
          <button
            class="btn sm ghost icon rules"
            aria-haspopup="dialog"
            aria-label="Rules"
            title="Rules"
            onclick={openRules}><Icon name="rules" size={18} /></button
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

{#if answered && tournament && phone.current}
  <!-- A phone: a short bottom sheet, the same as the desktop's popover -->
  <Sheet bind:open={answerOpen} title="Your answer">
    <AnswerMenu {tournament} canSignUp={can(granted(), "signup:Event")} ondone={() => (answerOpen = false)} />
  </Sheet>
{/if}
<svelte:window
  onclick={(e) => {
    if (answerOpen && !phone.current && answerAt && !answerAt.contains(e.target as Node)) answerOpen = false;
  }}
  onkeydown={(e) => {
    if (e.key === "Escape" && answerOpen && !phone.current) answerOpen = false;
  }}
/>

{#snippet topicTabs()}
  <!-- One topic a page (ADR 0074): the app's tabs, one row, scrolling sideways when they don't fit -->
  <div class="tablist rules-tabs" role="tablist" aria-label="Topics">
    {#each rules as section, i (section.id)}
      <button
        type="button"
        role="tab"
        id="rules-tab-{section.id}"
        aria-selected={section.id === topic}
        aria-controls="rules-page"
        onclick={() => toTopic(i)}>{section.title}</button
      >
    {/each}
  </div>
{/snippet}
{#snippet topicSteps()}
  <!-- The topics either side, small, at the foot: back and on, the way a swipe goes -->
  <nav class="topic-steps" aria-label="Other topics">
    {#if rules[topicAt - 1]}<button type="button" class="step-to" onclick={() => toTopic(topicAt - 1)}
        ><Icon name="chevronLeft" size={16} />{rules[topicAt - 1].title}</button
      >{:else}<span></span>{/if}
    {#if rules[topicAt + 1]}<button type="button" class="step-to on" onclick={() => toTopic(topicAt + 1)}
        >{rules[topicAt + 1].title}<Icon name="chevronRight" size={16} /></button
      >{/if}
  </nav>
{/snippet}
{#snippet rulesList()}
  <!-- The topic showing, from its top: its heading (the kanji on the Kumite, else its icon), then its rules, each
       its fact first in bold, the figures standing out. A swipe across turns the page -->
  <div
    class="rules-pages"
    id="rules-page"
    role="tabpanel"
    tabindex="-1"
    aria-labelledby="rules-tab-{topic}"
    ontouchstart={(e) => (swipeFrom = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
    ontouchend={swipeEnd}
  >
    {#key topic}
      {@const section = rules[topicAt]}
      {#if section}
        <section class="rules-page" in:topicIn out:topicOut>
          <h3 class="topic-title">
            {#if kanjiFor(type, TOPIC_LOOK[section.id].mark)}<Kanji
                text={kanjiFor(type, TOPIC_LOOK[section.id].mark)}
              />
            {:else}<Icon name={TOPIC_LOOK[section.id].icon} size={20} />{/if}<span>{section.title}</span>
          </h3>
          <ol class="rules-items">
            {#each section.lines as l, i (i)}
              <li>
                {#if l.key}<strong
                    >{#each figures(l.key) as part, j (j)}{#if j % 2}<span class="fig">{part}</span
                        >{:else}{part}{/if}{/each}</strong
                  >{/if}{#each figures(l.rest) as part, j (j)}{#if j % 2}<span class="fig">{part}</span
                    >{:else}{part}{/if}{/each}
              </li>
            {/each}
          </ol>
        </section>
      {/if}
    {/key}
  </div>
{/snippet}
{#if tournament && track}
  {#if phone.current}
    <Sheet bind:open={rulesOpen} title="Rules" top={topicTabs} footer={topicSteps} tall>{@render rulesList()}</Sheet>
  {:else}
    <Drawer bind:open={rulesOpen} title="Rules" sub={tournament.name} top={topicTabs} footer={topicSteps}
      >{@render rulesList()}</Drawer
    >
  {/if}
{/if}

{#snippet toolList()}<ManageList items={tools} {go} />{/snippet}

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
<!-- The page's one way back a step (ADR 0074): the draft's Manage doesn't have one of its own -->
{#if (admin || runner) && tournament}<StepBack bind:this={stepper} {type} {tournament} />{/if}
{#if admin && SIMULATOR && tournament}<SimulateRest bind:this={simulator} {type} {tournament} />{/if}
{#if (runner || adds) && tournament?.kind === "draft"}<DraftJobs bind:this={drafter} {type} {tournament} />{/if}
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
  /* ─── Rules: one topic a page ─── */
  /* The tabs, outside the sheet's scroll (its top): one row, sideways when they don't fit */
  .rules-tabs {
    min-width: 0;
    margin-inline: calc(var(--s-1) * -1);
  }
  /* The page: one cell, so the topic leaving and the one coming overlap as they slide; never wider than the sheet */
  .rules-pages {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    min-width: 0;
    overflow-x: clip;
    touch-action: pan-y;
  }
  .rules-page {
    grid-area: 1 / 1;
    display: grid;
    align-content: start;
    gap: var(--s-4);
    min-width: 0;
    max-width: 38rem;
    padding-top: var(--s-2);
  }
  .topic-title {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    margin: 0;
    color: var(--fg);
    font-family: var(--font-display);
    font-size: 1.6rem;
    font-style: italic;
    font-weight: 400;
    line-height: 1;
    text-transform: uppercase;
  }
  .topic-title :global(.kanji) {
    margin: 0;
    color: var(--red-hot);
    font-size: 1.35rem;
    font-style: normal;
  }
  .topic-title :global(svg) {
    flex: none;
    color: var(--red-hot);
  }
  /* The rules: a mark each (the tabs' red slash, small), the fact first in bold, the figures in bone */
  .rules-items {
    display: grid;
    gap: var(--s-3);
    margin: 0;
    padding: 0;
    list-style: none;
    color: var(--fg-muted);
    font-size: var(--text-sm);
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .rules-items li {
    position: relative;
    padding-left: var(--s-5);
  }
  .rules-items li::before {
    content: "";
    position: absolute;
    left: 0.2rem;
    top: 0.45em;
    width: 3px;
    height: 0.75em;
    background: var(--red);
    transform: skewX(-24deg);
  }
  .rules-items strong {
    color: var(--fg);
    font-weight: 600;
  }
  .fig {
    color: var(--fg);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  /* The topics either side, at the foot: small, quiet, the next one on the right */
  .topic-steps {
    display: flex;
    justify-content: space-between;
    gap: var(--s-3);
  }
  .step-to {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    min-height: 2.75rem;
    padding: 0 var(--s-2);
    border: 0;
    background: none;
    color: var(--fg-muted);
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .step-to:hover {
    color: var(--fg);
  }
  .step-to.on {
    margin-left: auto;
  }

  .answer-at {
    position: relative;
    display: inline-flex;
    flex: none;
  }
  /* The desktop's popover: under the badge, an arrow at it, a panel like Manage's */
  .popover {
    position: absolute;
    top: calc(100% + 0.75rem);
    left: -0.5rem;
    z-index: 20;
    width: 18rem;
    padding: var(--s-4);
    border-radius: var(--r-lg);
    background: var(--surface-1);
    box-shadow: 0 18px 40px -12px rgb(0 0 0 / 0.75);
    text-transform: none;
    letter-spacing: normal;
    font-weight: 400;
  }
  .popover::before {
    content: "";
    position: absolute;
    top: -0.4rem;
    left: 1.6rem;
    width: 0.8rem;
    height: 0.8rem;
    background: var(--surface-1);
    transform: rotate(45deg);
  }
  /* Your answer: your choice, not a status, said as the Friday card says it: a tick (in the club's red) or a cross,
     the word in plain type, a caret saying it opens. No fill, no stamp; under the pointer, a faint one */
  .answered {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    min-height: 1.75rem;
    padding: 0 0.4rem;
    border: 0;
    border-radius: var(--r-sm);
    background: none;
    color: var(--fg);
    font-family: var(--font);
    font-size: var(--text-sm);
    font-weight: 600;
    letter-spacing: normal;
    line-height: 1;
    text-transform: none;
    white-space: nowrap;
    transition: background-color var(--t-fast) var(--ease-in-out);
  }
  .answered:hover,
  .answered[aria-expanded="true"] {
    background: var(--row-hover);
  }
  .answered .said {
    display: inline-flex;
    color: var(--red-hot);
  }
  .answered.wait .said,
  .answered.out .said {
    color: var(--fg-muted);
  }
  .answered.out {
    color: var(--fg-muted);
  }
  .answered .caret {
    display: inline-flex;
    color: var(--fg-subtle);
  }
  .answered .short {
    display: none;
  }
  /* On a phone the stamp sits in the eyebrow line: no taller than the line, so the header's height never changes,
     and your answer says it in a word */
  @media (max-width: 900px) {
    .answered {
      min-height: 1.5rem;
      font-size: var(--text-xs);
    }
  }
  @media (max-width: 600px) {
    .answered .long {
      display: none;
    }
    .answered .short {
      display: inline;
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
</style>
