<script lang="ts">
  // The draft room (ADR 0060): the draft, the whole screen, for its captains and whoever runs it while it's open. A
  // focus page, so the app's rail, dock and tabs go (Shell); no header or track either, just a slim bar: the mark,
  // Draft room, whose turn, Manage the draft for whoever runs it, full screen on and off, and the way out. Out by ✕
  // or Back (Escape only leaves full screen); shown out to the page once the draft closes (the teams set slide
  // in there) or steps back, or if it isn't yours. The draft itself is the page's own (Draft), live as it is there.
  import { onDestroy, untrack } from "svelte";
  import Draft from "./Draft.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import Kanji from "../lib/Kanji.svelte";
  import LiveNote from "../lib/LiveNote.svelte";
  import { kanjiFor } from "../lib/motif";
  import { liveFeed } from "../lib/live-updates.svelte";
  import { goesByOf, nameOfTeam, teamNamesOf } from "../lib/names";
  import TeamCrest from "../lib/TeamCrest.svelte";
  import { teamTone } from "../lib/team-tones";
  import { draftJobsOf } from "../lib/draft-jobs";
  import { BACK_SAYS, backFrom, backTo } from "../lib/step-back";
  import { londonToday } from "../lib/dates";
  import { phone } from "../lib/viewport.svelte";
  import DraftJobs from "../lib/DraftJobs.svelte";
  import StepBack from "../lib/StepBack.svelte";
  import ManageList, { type ManageItem } from "../lib/ManageList.svelte";
  import Sheet from "../lib/Sheet.svelte";
  import Drawer from "../lib/Drawer.svelte";
  import { canEnterRoom, canFullScreen, leaveFullScreen, roomTurn, toggleFullScreen } from "../lib/draft-room";
  import { can } from "../access/actions";
  import { granted, me } from "../demo/session.svelte";
  import { PLAYERS } from "../demo/data";
  import { currentTournament, typeById } from "../demo/schedule.svelte";
  import { goBack, navigate } from "../app/router.svelte";

  let { typeId }: { typeId: number } = $props();

  const type = $derived(typeById(typeId)!);
  const tournament = $derived(currentTournament(typeId));
  const base = $derived(`/tournaments/${type.slug}`);
  const inRoom = $derived(canEnterRoom(tournament, me().id, can(granted(), "run:Draft")));
  const teams = $derived(tournament?.teams ?? []);
  const byId = (id: number | null) => (id ? PLAYERS.find((p) => p.id === id) : undefined);
  const nameOf = (i: number) => nameOfTeam(teams[i], teams, byId);
  const dataTurn = $derived(tournament && inRoom ? roomTurn(tournament, me().id, nameOf) : null);
  // The team the light's on, as the draft's timeline shows it (lib/draft-sequence.ts): the bar changes with the light,
  // after the glide, not when the data does
  let shownClock = $state(-1);
  const myIndex = $derived(teams.findIndex((t) => t.captainMemberId === me().id));
  const turn = $derived(
    dataTurn && dataTurn.team !== null && shownClock >= 0
      ? {
          ...dataTurn,
          team: shownClock,
          you: shownClock === myIndex,
          said: shownClock === myIndex ? "Your choice" : `${nameOf(shownClock)} is choosing`,
        }
      : dataTurn,
  );
  // A phone's: the name without its "Team", and just "picking" (CHARLIE B PICKING), so it's never cut
  // The team picking, as the bar says it: on a phone without its "Team"
  const teamShown = $derived(
    turn && turn.team !== null && !turn.you
      ? phone.current
        ? nameOf(turn.team).replace(/^team\s+/i, "")
        : nameOf(turn.team)
      : "",
  );
  /** A line of text sized down until it fits its line (an ellipsis only past the smallest), as the name or the room
   * changes. */
  function fitLine(node: HTMLElement, _text: string) {
    const MAX = 1.75;
    const MIN = 0.95;
    const fit = () => {
      let size = MAX;
      node.style.fontSize = `${size}rem`;
      while (size > MIN && node.scrollWidth > node.clientWidth + 0.5) {
        size = Math.max(MIN, size - 0.05);
        node.style.fontSize = `${size}rem`;
      }
    };
    const ro = new ResizeObserver(fit);
    ro.observe(node.parentElement ?? node);
    fit();
    return { update: () => requestAnimationFrame(fit), destroy: () => ro.disconnect() };
  }
  // The tournament's team names, which its crests are told apart among (logo.ts)
  const crestNames = $derived(teamNamesOf(teams, byId));
  const seal = $derived(kanjiFor(type, "fist"));
  const choose = $derived(kanjiFor(type, "choose"));

  // Manage: the same items as the page's gear, for the draft (lib/draft-jobs.ts) and a step back, a row each
  const runs = $derived(can(granted(), "run:Draft"));
  const adds = $derived(can(granted(), "update:Event"));
  let drafter = $state<ReturnType<typeof DraftJobs>>();
  let stepper = $state<ReturnType<typeof StepBack>>();
  let menuOpen = $state(false);
  const items = $derived.by((): ManageItem[] => {
    if (!tournament) return [];
    const t = tournament;
    const jobs: ManageItem[] = draftJobsOf(
      t,
      { runs, adds },
      { player: (id, name) => goesByOf(byId(id)) || name || "", team: (i) => nameOfTeam(t.teams[i], t.teams, byId) },
    ).map((j) => ({ ...j, run: () => drafter?.run(j.job) }));
    const from = backFrom(t, londonToday());
    const admin = can(granted(), "manage:Tournament");
    if (from && (admin || (runs && (from === "draft" || from === "order"))))
      jobs.push({ icon: "undo", label: backTo(from, t.kind), sub: BACK_SAYS[from], run: () => stepper?.start() });
    return jobs;
  });
  function go(run: () => void) {
    menuOpen = false;
    run();
  }

  // Out: once (✕ and Back can come together), back where you came from
  let leaving = false;
  function exit() {
    if (leaving) return;
    leaving = true;
    leaveFullScreen();
    goBack(base);
  }
  // Shown out: the draft closed (the page slides on to the teams set) or stepped back, or it was never yours
  $effect(() => {
    if (inRoom) return;
    untrack(() => {
      if (leaving) return;
      leaving = true;
      leaveFullScreen();
      navigate(base, { replace: true });
    });
  });
  onDestroy(leaveFullScreen);

  // Never sideways: the room, its body and the view under it only ever scroll down. A scroller can't be clipped on
  // one axis and scroll on the other, so a focus or a scroll into view could still shift one sideways and cut both
  // edges off; if one does, it goes straight back
  function onscrollcapture(e: Event) {
    const el = e.target;
    // The window itself: never sideways
    if (el === document || el === document.documentElement || el === document.body) {
      if (window.scrollX) window.scrollTo(0, window.scrollY);
      return;
    }
    if (!(el instanceof HTMLElement)) return;
    // (The room is the page's .page.room: the draft inside it is a .room too, and the body under the bar, its parent,
    // is the one thing here that scrolls down)
    if (el.scrollLeft && (el.matches(".page.room, .page.room > .body") || el.querySelector(":scope > .page.room")))
      el.scrollLeft = 0;
    // The view and the room are the window: only the body under the bar scrolls, so neither moves up either
    if (el.scrollTop && (el.matches(".page.room") || el.querySelector(":scope > .page.room"))) el.scrollTop = 0;
  }
  // Full screen is the room's own button, on and off (Escape leaves it too, and you stay in the room); ✕ and Back
  // leave the room. Where the browser has none (an iPhone's Safari), no button: the room's the whole page anyway
  const fullScreenable = canFullScreen();
  let full = $state(!!document.fullscreenElement);
  const onfullscreenchange = () => (full = !!document.fullscreenElement);
</script>

<svelte:document {onfullscreenchange} {onscrollcapture} />

<!-- The room is the window: the bar, then the draft filling the rest (its columns scroll inside themselves) -->
<div class="page full fit room">
  <header class="room-bar" style:--tone="var(--tone-{type.tone})">
    <span class="mark" aria-hidden="true"
      >{#if seal}<Kanji text={seal} seal />{:else}<Icon name={type.icon} size={18} />{/if}</span
    >
    <!-- Where you are, small beside the seal, and on the same line whether the picks come live: a red light, softly
         pulsing, while the hub's stream is open; else a grey one and how often it checks (both laid in one place, so
         the swap moves nothing) -->
    <span class="titles">
      <span class="eyebrow">{type.shortName} · Draft room</span>
      <span
        class="live-status"
        class:on={liveFeed.on}
        title={liveFeed.on ? "Choices show up as they're made" : "Choices show up on the club's beat"}
        ><i class="ldot" aria-hidden="true"></i><span class="lw"><LiveNote what="Updates" /></span></span
      >
    </span>
    <!-- Whose turn, big and plain, in one fixed box (a mark, then two lines): the team choosing with its crest and
         "choosing · you're in 3"; yours, the red 選 seal and YOUR CHOICE in the italic caps; everyone chosen, nothing.
         The one thing in the bar that changes, so nothing else moves on a choice -->
    <span class="turn" aria-live="polite">
      {#if turn && turn.team !== null}
        <span class="turn-mark">
          {#if turn.you}
            {#if choose}<Kanji text={choose} seal />{:else}<Icon name="user" size={20} />{/if}
          {:else}
            <TeamCrest
              among={crestNames}
              name={nameOf(turn.team)}
              logo={teams[turn.team].logo}
              tone={teamTone(turn.team)}
              size="2rem"
            />
          {/if}
        </span>
        {#if turn.you}
          <span class="said yours">
            <strong class="name display" use:fitLine={turn.said}>{turn.said}</strong>
            <span class="sub">Choose your champion</span>
          </span>
        {:else}
          <!-- Two lines, never more, the bar one height whatever the name: the team in the display face, sized down
               to fit its line; under it, small, that they're choosing and how long till you -->
          <span class="said">
            <strong class="name display" use:fitLine={teamShown}>{teamShown}</strong>
            <span class="sub"
              >choosing{#if turn.inPicks !== null}<span class="num">&nbsp;· you're in {turn.inPicks}</span>{/if}</span
            >
          </span>
        {/if}
      {/if}
    </span>
    <span class="keys">
      {#if items.length}
        <!-- Manage: the room's quieter action, the italic caps with the red slash (just the gear on a phone) -->
        <button class="manage" aria-haspopup="dialog" aria-label="Manage the draft" onclick={() => (menuOpen = true)}
          ><Icon name="settings" size={18} /><span class="mw">Manage</span></button
        >
      {/if}
      {#if fullScreenable}
        <button
          class="btn sm ghost icon"
          aria-label={full ? "Leave full screen" : "Full screen"}
          aria-pressed={full}
          title={full ? "Leave full screen" : "Full screen"}
          onclick={toggleFullScreen}><Icon name={full ? "shrink" : "expand"} size={18} /></button
        >
      {/if}
      <button class="btn sm ghost icon" aria-label="Leave the draft room" title="Leave the draft room" onclick={exit}
        ><Icon name="x" size={20} /></button
      >
    </span>
  </header>
  {#if tournament && inRoom}
    <div class="body">
      <Draft
        {typeId}
        room
        onshown={(c) => {
          shownClock = c;
        }}
      />
    </div>
  {/if}
</div>
{#if tournament && items.length}
  {#if phone.current}
    <Sheet bind:open={menuOpen} title="Manage the draft"><ManageList {items} {go} /></Sheet>
  {:else}
    <Drawer bind:open={menuOpen} title="Manage the draft" sub={tournament.name}><ManageList {items} {go} /></Drawer>
  {/if}
{/if}
{#if tournament && (runs || adds)}<DraftJobs bind:this={drafter} {type} {tournament} />{/if}
{#if tournament && runs}<StepBack bind:this={stepper} {type} {tournament} />{/if}

<style>
  /* The whole window, past the page frame: it's a room */
  /* Never wider than the window, and never scrolled sideways: clip, not hidden, so nothing (a focus, a scroll into
     view) can shift it either way and cut both edges off */
  .room {
    overflow: clip;
    max-width: none;
    gap: var(--s-3);
    padding-top: max(var(--s-3), env(safe-area-inset-top));
  }
  /* Slim: one row, the way out at its end, where a thumb or a pointer expects it */
  .room-bar {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 2.75rem;
    min-width: 0;
  }
  .mark {
    display: grid;
    flex-shrink: 0;
    place-items: center;
    color: var(--tone, var(--red));
  }
  /* The eyebrow and the live light on one line, centred on the seal */
  .titles {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: var(--s-3);
    white-space: nowrap;
  }
  .live-status {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    color: var(--fg-subtle);
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }
  .live-status.on {
    color: var(--fg-muted);
  }
  .ldot {
    flex-shrink: 0;
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    background: var(--fg-subtle);
  }
  .live-status.on .ldot {
    background: var(--red-hot);
    animation: pulse 2.4s var(--ease-in-out) infinite;
  }
  .turn-mark {
    display: grid;
    flex-shrink: 0;
    place-items: center;
    width: 2.25rem;
    height: 2.25rem;
  }
  .turn-mark :global(.seal) {
    width: 2.1rem;
    height: 2.1rem;
    font-size: 1.25rem;
    box-shadow: none;
  }
  .said.yours .name {
    color: var(--red-hot);
    font-style: italic;
    letter-spacing: 0.03em;
  }
  /* Manage: italic caps and the red slash under the word, no box */
  .manage {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    height: var(--control-h-sm);
    padding: 0 var(--s-2);
    border: 0;
    background: none;
    color: var(--fg-muted);
    font-family: var(--font-display);
    font-size: 1.05rem;
    font-style: italic;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    cursor: pointer;
  }
  .manage:hover {
    color: var(--fg);
  }
  .mw {
    position: relative;
    padding-bottom: 0.25rem;
  }
  .mw::after {
    content: "";
    position: absolute;
    left: 0.05em;
    bottom: 0;
    width: 1.25rem;
    height: 3px;
    transform: skewX(-24deg);
    transform-origin: left;
    background: var(--red);
  }
  .turn {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    gap: var(--s-3);
    min-width: 0;
    overflow: hidden;
  }
  .turn :global(.crest) {
    flex-shrink: 0;
  }
  /* The bar's words: two lines, always the same height, whatever the name */
  .said {
    display: grid;
    flex: 1 1 auto;
    grid-template-rows: 1.85rem 1rem;
    align-content: center;
    min-width: 0;
    height: 2.85rem;
  }
  .said .name {
    min-width: 0;
    overflow: hidden;
    color: var(--fg);
    font-size: 1.75rem;
    line-height: 1.85rem;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .said .sub {
    overflow: hidden;
    color: var(--fg-muted);
    font-size: var(--text-xs);
    line-height: 1rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }
  .keys {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: var(--s-1);
  }
  /* The rest of the window: the draft fills it, and scrolls here only when it isn't being picked (the seal) */
  .room > .body {
    display: grid;
    flex: 1 1 auto;
    /* Never wider than the window: a grid column's own minimum is its content (the ticker, the chips) */
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    /* Out to the window's edges, the draft inset back by the gutter: the ticker's arrows sit in the gutter, as on the
       page, inside this scroller rather than past it */
    margin-inline: calc(-1 * var(--gutter));
    padding-inline: var(--gutter);
    overflow-x: hidden;
    overflow-y: auto;
  }
  /* The shell's view under the room: not a scroller at all (the room is its height; the body under the bar scrolls) */
  :global(.view:has(> .room)) {
    overflow: clip;
  }
  /* And the page itself, while the room's open (the browser's full screen too) */
  :global(html:has(.room)),
  :global(body:has(.room)) {
    overflow-x: clip;
  }
  @media (max-width: 760px) {
    .mw {
      display: none;
    }
  }
  /* A phone: whose turn gets the room; the seal says where you are, and the light alone (no words) whether it's
     live */
  @media (max-width: 560px) {
    .titles .eyebrow,
    .live-status .lw {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .live-status.on .ldot {
      animation: none;
    }
  }
</style>
