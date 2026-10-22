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
          said: shownClock === myIndex ? "Your pick" : `${nameOf(shownClock)} is picking`,
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
    if (el.scrollLeft && (el.matches(".room, .room > .body") || el.querySelector(":scope > .room"))) el.scrollLeft = 0;
    // The view and the room are the window: only the body under the bar scrolls, so neither moves up either
    if (el.scrollTop && (el.matches(".room") || el.querySelector(":scope > .room"))) el.scrollTop = 0;
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
    <!-- Where you are, small beside the seal: the bar's words are whose pick it is -->
    <span class="titles eyebrow">{type.shortName} · Draft room</span>
    <!-- Whose pick, big and plain: the team picking with its crest, or YOUR PICK in red with its light; then quietly
         how long till yours. The one line that changes, in its own room, so nothing else in the bar moves on a pick -->
    <span class="turn" aria-live="polite">
      {#if turn}
        {#if turn.team !== null && !turn.you}
          <TeamCrest
            among={crestNames}
            name={nameOf(turn.team)}
            logo={teams[turn.team].logo}
            tone={teamTone(turn.team)}
            size="2rem"
          />
        {/if}
        {#if turn.you}
          <!-- Yours: the one red, a badge with its light (colour's an accent, ADR 0084) -->
          <span class="said"><span class="badge red yours"><i class="dot"></i>{turn.said}</span></span>
        {:else}
          <!-- Two lines, never more, the bar one height whatever the name: the team in the display face, sized down
               to fit its line; under it, small, that they're picking and how long till you -->
          <span class="said">
            <strong class="name display" use:fitLine={teamShown}>{teamShown}</strong>
            <span class="sub"
              >picking{#if turn.inPicks !== null}<span class="num"> · you're in {turn.inPicks}</span>{/if}</span
            >
          </span>
        {/if}
      {/if}
    </span>
    <span class="keys">
      <span class="live hint" title="Picks show up as they're made"><Icon name="live" size={14} /><LiveNote /></span>
      {#if items.length}
        <button
          class="btn sm ghost icon"
          aria-haspopup="dialog"
          aria-label="Manage the draft"
          onclick={() => (menuOpen = true)}><Icon name="settings" size={18} /></button
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
  .titles {
    flex-shrink: 0;
    white-space: nowrap;
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
  .said:has(.yours) {
    grid-template-rows: 1fr;
    justify-items: start;
  }
  .yours {
    flex: none;
    gap: 0.35rem;
    padding: 0.35rem 0.75rem;
    font-size: var(--text-md);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .dot {
    display: inline-block;
    width: 0.55rem;
    height: 0.55rem;
    margin-right: 0.5rem;
    vertical-align: 0.2em;
    border-radius: 50%;
    background: currentColor;
    animation: pulse 1.4s var(--ease-in-out) infinite;
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
  .live {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    padding-inline: var(--s-2);
    font-size: var(--text-xs);
    white-space: nowrap;
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
  @media (max-width: 640px) {
    .live {
      display: none;
    }
  }
  /* A phone: whose pick gets the room; the seal says where you are */
  @media (max-width: 560px) {
    .titles {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .dot {
      animation: none;
    }
  }
</style>
