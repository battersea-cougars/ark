<script lang="ts">
  // The draft room (ADR 0060): the draft, the whole screen, for its captains and whoever runs it while it's open. A
  // focus page, so the app's rail, dock and tabs go (Shell); no header or track either, just a slim bar: the mark,
  // Draft room, whose turn, Manage the draft for whoever runs it, and the way out. Out by ✕, Escape (the browser's
  // full screen ending, where it took it) or Back; shown out to the page once the draft closes (the teams set slide
  // in there) or steps back, or if it isn't yours. The draft itself is the page's own (Draft), live as it is there.
  import { onDestroy, untrack } from "svelte";
  import Draft from "./Draft.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import Kanji from "../lib/Kanji.svelte";
  import LiveNote from "../lib/LiveNote.svelte";
  import { kanjiFor } from "../lib/motif";
  import { nameOfTeam } from "../lib/names";
  import { canEnterRoom, leaveFullScreen, roomTurn } from "../lib/draft-room";
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
  const turn = $derived(
    tournament && inRoom ? roomTurn(tournament, me().id, (i) => nameOfTeam(teams[i], teams, byId)) : null,
  );
  const seal = $derived(kanjiFor(type, "fist"));

  // The draft's jobs, for whoever runs it: Draft hands up how to open them (a block, never its answer: effects.test.ts)
  let manage = $state<(() => void) | null>(null);

  // Out: once (✕, Escape and the full screen ending can come together), back where you came from
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

  // Escape: out of the room, unless a sheet or drawer is open over it (Escape's theirs then). In the browser's full
  // screen, Escape ends that first, which is out too
  function onkeydown(e: KeyboardEvent) {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    if (document.querySelector("dialog[open], .drawer[role='dialog']")) return;
    exit();
  }
  // Never sideways: the room, its body and the view under it only ever scroll down. A scroller can't be clipped on
  // one axis and scroll on the other, so a focus or a scroll into view could still shift one sideways and cut both
  // edges off; if one does, it goes straight back
  function onscrollcapture(e: Event) {
    const el = e.target;
    if (
      el instanceof HTMLElement &&
      el.scrollLeft &&
      (el.matches(".room, .room > .body") || el.querySelector(":scope > .room"))
    )
      el.scrollLeft = 0;
  }
  let wasFull = !!document.fullscreenElement;
  function onfullscreenchange() {
    if (document.fullscreenElement) wasFull = true;
    else if (wasFull) exit();
  }
</script>

<svelte:window {onkeydown} />
<svelte:document {onfullscreenchange} {onscrollcapture} />

<!-- The room is the window: the bar, then the draft filling the rest (its columns scroll inside themselves) -->
<div class="page full fit room">
  <header class="room-bar" style:--tone="var(--tone-{type.tone})">
    <span class="mark" aria-hidden="true"
      >{#if seal}<Kanji text={seal} seal />{:else}<Icon name={type.icon} size={18} />{/if}</span
    >
    <span class="titles">
      <span class="eyebrow">{type.shortName}</span>
      <strong class="display">Draft room</strong>
    </span>
    <!-- Whose turn: the one line that changes, in its own room, so nothing else in the bar moves on a pick -->
    <span class="turn" aria-live="polite">
      {#if turn}
        <span class="badge" class:red={turn.you}
          >{#if turn.you}<i class="dot"></i>{/if}{turn.said}{#if turn.inPicks !== null}<span class="num"
              >{` · you in ${turn.inPicks}`}</span
            >{/if}</span
        >
      {/if}
    </span>
    <span class="keys">
      <span class="live hint" title="Picks show up as they're made"><Icon name="live" size={14} /><LiveNote /></span>
      {#if manage}
        <button class="btn sm ghost icon" aria-haspopup="dialog" aria-label="Manage the draft" onclick={manage}
          ><Icon name="settings" size={18} /></button
        >
      {/if}
      <button class="btn sm ghost icon" aria-label="Leave the draft room" title="Leave (Esc)" onclick={exit}
        ><Icon name="x" size={20} /></button
      >
    </span>
  </header>
  {#if tournament && inRoom}
    <div class="body">
      <Draft
        {typeId}
        room
        onmanage={(open) => {
          manage = open;
        }}
      />
    </div>
  {/if}
</div>

<style>
  /* The whole window, past the page frame: it's a room */
  /* Never wider than the window, and never scrolled sideways: clip, not hidden, so nothing (a focus, a scroll into
     view) can shift it either way and cut both edges off */
  .room {
    overflow-x: clip;
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
    display: grid;
    flex-shrink: 0;
    line-height: 1.05;
  }
  .titles .eyebrow {
    font-size: var(--text-xs);
  }
  .titles strong {
    font-size: var(--text-lg);
    text-transform: uppercase;
    white-space: nowrap;
  }
  .turn {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    gap: var(--s-2);
    min-width: 0;
    overflow: hidden;
  }
  .turn .badge {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
    display: inline-block;
    width: 0.45rem;
    height: 0.45rem;
    margin-right: 0.35rem;
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
  /* The shell's view under the room: nothing sideways to scroll to */
  :global(.view:has(> .room)) {
    overflow-x: hidden;
  }
  @media (max-width: 640px) {
    .live,
    .titles .eyebrow {
      display: none;
    }
    .titles strong {
      font-size: var(--text-md);
    }
  }
  /* A phone: whose turn gets the room; the seal says where you are */
  @media (max-width: 480px) {
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
