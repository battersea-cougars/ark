<script lang="ts">
  // Where a tournament is on its way (ADR 0074): its statuses along one line, like a progress bar, the line filled
  // from the start to the status it's at and faint after it. Each status a node on it (done: a tick; where it is: lit,
  // pulsing while the Kumite runs; ahead: hollow) with its name under it as a badge (done quiet, ahead faint). Fill,
  // tick and size say it without the colour. Sign-up open, Draft
  // open, Teams set, Fixtures set, KUMITE! (teams that enter skip the draft); which and where: lib/tournament-front.ts.
  // It's the tournament page's navigation too: a status it's reached opens its view (the one it's at, the page
  // itself), and the one being looked at (`viewing`) has its badge brought forward, the header stamp's red, bigger
  // (transform only). Badge forward: what you're looking at; lit node and fill: where it is. Always the same size.
  import type { Tournament, TournamentType } from "../demo/model";
  import Icon from "../app/shell/Icon.svelte";
  import { untrack } from "svelte";
  import { statusHref, statusesOf, type Status } from "./tournament-front";
  import { editionState } from "./edition";
  import { londonISO } from "./dates";

  let {
    type,
    tournament: t,
    today,
    viewing = null,
    links = true,
  }: {
    type: TournamentType;
    tournament: Tournament;
    today: string;
    /** The status whose view is showing; none on a page that isn't one (the board). */
    viewing?: Status | null;
    /** Whether a status it's reached opens its view. */
    links?: boolean;
  } = $props();

  const steps = $derived(statusesOf(t, type, today));
  const at = $derived.by(() => {
    const i = steps.findIndex((s) => s.state === "now");
    return i >= 0 ? i : steps.every((s) => s.state === "done") ? steps.length - 1 : 0;
  });
  const here = $derived(viewing ? steps.findIndex((s) => s.status === viewing) : -1);
  // The status moving on while you watch (the fixtures made, the draft opened): its badge stamps in, like a hanko.
  // Opened later, it's just lit
  let stamped = $state<Status | null>(null);
  let lastNow: Status | undefined;
  $effect.pre(() => {
    const at = steps.find((s) => s.state === "now")?.status;
    untrack(() => {
      if (lastNow !== undefined && at && at !== lastNow) {
        stamped = at;
        setTimeout(() => (stamped = null), 700);
      }
      lastNow = at;
    });
  });
  // The Kumite running, on its day from its start (or the first match started) till the last match is played: its node
  // pulses, as the Live dot does, between matches too
  const live = $derived(
    steps.some((s) => s.status === "day" && s.state === "now") &&
      (editionState(t) === "live" || Date.now() >= Date.parse(londonISO(t.heldOn, t.startTime))),
  );
</script>

<!-- stage-track: the shell keeps it in place between the series' pages, as it does the header -->
<div class="track stage-track" style:--n={steps.length} style:--at={at} style:--i={here}>
  <!-- The line: faint the whole way, filled up to where it's at -->
  <span class="rail" aria-hidden="true"><span class="fill"></span></span>
  <ol class="steps" aria-label="Where the {type.shortName} has got to">
    {#each steps as s (s.status)}
      {@const open = links && s.state !== "ahead"}
      <li
        class="step {s.state}"
        class:live={live && s.state === "now"}
        class:here={here >= 0 && steps[here] === s}
        class:stamped={stamped === s.status}
        aria-current={s.state === "now" ? "step" : undefined}
      >
        {#snippet inside()}
          <!-- A node on the line (done: a tick; where it is: lit, pulsing while the Kumite runs; ahead: hollow), and
               the status's name under it as a badge (done quiet, ahead faint, the one looked at brought forward) -->
          <span class="node" aria-hidden="true"
            >{#if s.state === "done"}<Icon name="check" size={12} />{/if}</span
          >
          <span class="badge-s"
            ><span class="full">{s.label}</span><span class="short" aria-hidden="true">{s.short}</span
            >{#if s.state === "done"}<span class="sr-only">, done</span>{:else if s.state === "now"}<span
                class="sr-only">, where it is now</span
              >{/if}</span
          >
        {/snippet}
        {#if open}
          <a
            class="go"
            href={statusHref(type.slug, t, today, s.status)}
            aria-current={viewing === s.status ? "page" : undefined}>{@render inside()}</a
          >
        {:else}
          <span class="go">{@render inside()}</span>
        {/if}
      </li>
    {/each}
  </ol>
</div>

<style>
  /* One fixed size whatever's viewed or current: equal columns, the nodes on the line, the badges under them */
  .track {
    --gap: var(--s-1);
    --node: 1.15rem;
    position: relative;
    max-width: 44rem;
    height: 3.9rem;
  }
  /* The same width on every view, whether the page is the usual frame or the draft's full one (app.css .page) */
  :global(.page) > .track.stage-track {
    width: 100%;
    max-width: 44rem;
  }
  .steps {
    display: grid;
    grid-auto-columns: minmax(0, 1fr);
    grid-auto-flow: column;
    gap: var(--gap);
    height: 100%;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .step {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    min-width: 0;
  }
  .go {
    display: grid;
    justify-items: center;
    align-content: start;
    gap: var(--s-2);
    min-height: 2.75rem;
    padding-top: 0.2rem;
    color: inherit;
    text-decoration: none;
  }
  /* A node a status: hollow ahead; done, bone with a carbon tick, crisp at any density; where it is, lit red */
  .node {
    position: relative;
    z-index: 1;
    display: grid;
    place-items: center;
    width: var(--node);
    height: var(--node);
    border: 2px solid var(--surface-3);
    border-radius: 50%;
    background: var(--bg);
    color: var(--bg);
    transition:
      background-color var(--t-slow) var(--ease-in-out),
      border-color var(--t-slow) var(--ease-in-out);
  }
  .node :global(svg) {
    display: block;
  }
  .node :global(svg path) {
    stroke-width: 3.4;
  }
  .done .node {
    border-color: var(--fg-muted);
    background: var(--fg-muted);
  }
  .now .node {
    border-color: var(--red-hot);
    background: var(--red-hot);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--red-hot) 25%, transparent);
  }
  /* The Kumite running on its day: the node pulses, as the Live dot does */
  .live .node {
    animation: pulse 1.4s var(--ease-in-out) infinite;
  }
  /* The line, from the first badge's middle to the last's, through them, filled to where it is */
  .rail {
    position: absolute;
    top: calc(0.2rem + var(--node) / 2 - 1px);
    left: calc(100% / var(--n) / 2);
    right: calc(100% / var(--n) / 2);
    height: 2px;
    border-radius: 1px;
    background: var(--surface-3);
  }
  .fill {
    display: block;
    width: calc(100% * var(--at) / (var(--n) - 1));
    height: 100%;
    border-radius: inherit;
    background: var(--fg-muted);
    transition: width var(--t-slow) var(--ease-in-out);
  }
  /* A status's name, as a badge: italic display caps */
  .badge-s {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    max-width: 100%;
    height: 1.6rem;
    padding: 0 0.55rem;
    border: 2px solid var(--surface-3);
    border-radius: 0.3rem;
    background: var(--bg);
    color: var(--fg-subtle);
    font-family: var(--font-display);
    font-size: 0.85rem;
    font-style: italic;
    letter-spacing: 0.03em;
    line-height: 1;
    text-transform: uppercase;
    white-space: nowrap;
    transition:
      color var(--t-slow) var(--ease-in-out),
      border-color var(--t-slow) var(--ease-in-out),
      transform var(--t-slow) var(--ease-in-out);
  }
  /* Done: quiet */
  .done .badge-s {
    border-color: transparent;
    background: var(--surface-2);
    color: var(--fg-muted);
  }
  /* The one being looked at, brought forward: the header stamp's red outline, bigger and a little askew (transform
     only, so nothing moves). Where the Kumite is stays the line's: its lit node and the fill reaching it */
  .here .badge-s {
    border-color: currentColor;
    background: var(--bg);
    color: var(--red-hot);
    transform: scale(1.12) rotate(-3deg);
  }
  a.go:hover .badge-s {
    color: var(--fg);
  }
  .here a.go:hover .badge-s {
    color: var(--red-hot);
  }
  .short {
    display: none;
  }
  /* Stamped in: down from big and askew onto its place, as a hanko comes down */
  .stamped .badge-s {
    animation: stamp 0.45s cubic-bezier(0.3, 1.4, 0.5, 1) 0.15s both;
  }
  @keyframes stamp {
    from {
      opacity: 0;
      transform: scale(1.8) rotate(-10deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .stamped .badge-s {
      animation: none;
    }
    .live .node {
      animation: none;
    }
    .fill,
    .node,
    .badge-s {
      transition: none;
    }
  }
  /* A phone: the short names, a size down, so five fit 320px */
  @media (max-width: 440px) {
    .badge-s {
      gap: 0.2rem;
      padding: 0 0.3rem;
      font-size: 0.72rem;
    }
    .full {
      display: none;
    }
    .short {
      display: inline;
    }
  }
</style>
