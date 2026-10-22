<script lang="ts">
  // Where a tournament is on its way (ADR 0074): its statuses along one line, like a progress bar. The line is filled
  // from the start to the status it's at and faint after it, so how far along it is shows at a glance. Each status a
  // node on it: done ones filled with a tick, the one it's at a bigger solid bright node with a NOW stamp over it and
  // its name bright, those ahead hollow and faint. Shape and fill say it without the colour. Sign-up open, Draft
  // open, Teams set, Fixtures set, KUMITE! (teams that enter skip the draft); which and where: lib/tournament-front.ts.
  // It's the tournament page's navigation too: a status it's reached opens its view (the one it's at, the page
  // itself), and the one being looked at (`viewing`) gets a solid red bar under it, as a lit tab, that slides to the
  // next one looked at. Red bar: what you're looking at; node and NOW stamp: where it is. Always the same height.
  import type { Tournament, TournamentType } from "../demo/model";
  import Icon from "../app/shell/Icon.svelte";
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
  // The Kumite running, on its day from its start (or the first match started) till the last match is played: the NOW
  // node pulses in the club's red, as the Live dot does, between matches too
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
        aria-current={s.state === "now" ? "step" : undefined}
      >
        {#snippet inside()}
          {#if s.state === "now"}<span class="stamp" aria-hidden="true">Now</span>{/if}
          <span class="node" aria-hidden="true"
            >{#if s.state === "done"}<Icon name="check" size={10} />{/if}</span
          >
          <span class="label"
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
  {#if here >= 0}<span class="lit" aria-hidden="true"></span>{/if}
</div>

<style>
  /* One fixed height: the NOW stamp's room, the nodes on the line, a line of label, the viewing bar */
  .track {
    --node: 0.75rem;
    --gap: var(--s-1);
    /* Where the line runs: through the nodes' middles */
    --line-y: calc(1.1rem + var(--node) / 2);
    position: relative;
    max-width: 44rem;
    height: 4.6rem;
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
    color: var(--fg-subtle);
  }
  .go {
    display: grid;
    grid-template-rows: 1.1rem var(--node) auto;
    justify-items: center;
    align-content: start;
    row-gap: 0;
    min-height: 2.75rem;
    color: inherit;
    text-align: center;
    text-decoration: none;
  }
  a.go:hover .label {
    color: var(--fg);
  }
  /* The line, from the first node's middle to the last's, filled to the one it's at */
  .rail {
    position: absolute;
    top: calc(var(--line-y) - 1.5px);
    left: calc(100% / var(--n) / 2);
    right: calc(100% / var(--n) / 2);
    height: 3px;
    border-radius: 2px;
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
  /* A node a status: hollow ahead, filled with a tick done, solid and bigger where it's at */
  .node {
    position: relative;
    z-index: 1;
    display: grid;
    place-items: center;
    grid-row: 2;
    width: var(--node);
    height: var(--node);
    border: 2px solid var(--surface-3);
    border-radius: 50%;
    background: var(--bg);
    color: var(--bg);
    transition:
      background-color var(--t-slow) var(--ease-in-out),
      border-color var(--t-slow) var(--ease-in-out),
      transform var(--t-slow) var(--ease-in-out);
  }
  .done .node {
    border-color: var(--fg-muted);
    background: var(--fg-muted);
  }
  .now .node {
    border-color: var(--fg);
    background: var(--fg);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--fg) 25%, transparent);
    transform: scale(1.45);
  }
  /* A match on: the node pulses in the club's red */
  .live .node {
    border-color: var(--red-hot);
    background: var(--red-hot);
    animation: pulse 1.4s var(--ease-in-out) infinite;
  }
  /* NOW, stamped over where it is, in the club's red */
  .stamp {
    grid-row: 1;
    align-self: start;
    padding: 0 0.3rem;
    border: 1.5px solid currentColor;
    border-radius: 0.2rem;
    color: var(--red-hot);
    font-family: var(--font-display);
    font-size: 0.62rem;
    line-height: 1.2;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    transform: rotate(-4deg);
  }
  .label {
    grid-row: 3;
    margin-top: var(--s-2);
    font-family: var(--font-display);
    font-size: 0.9rem;
    line-height: 1.1;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    transition: color var(--t-slow) var(--ease-in-out);
  }
  .done {
    color: var(--fg-muted);
  }
  /* Where it is: its name bright and the club's italic */
  .now {
    color: var(--fg);
  }
  .now .label {
    font-style: italic;
  }
  .short {
    display: none;
  }
  /* The one being looked at: a solid bar in the club's red under it, as a lit tab, sliding to the next one looked at.
     Where it is stays the node and the NOW stamp, so the two never look alike */
  .lit {
    position: absolute;
    bottom: 0;
    left: 0;
    width: calc((100% - (var(--n) - 1) * var(--gap)) / var(--n));
    height: 4px;
    border-radius: 2px;
    background: var(--red-hot);
    transform: translateX(calc(var(--i) * (100% + var(--gap))));
    transition: transform var(--t-slow) var(--ease-in-out);
  }
  .here .label {
    color: var(--fg);
  }
  @media (prefers-reduced-motion: reduce) {
    .live .node {
      animation: none;
    }
    .fill,
    .node,
    .label,
    .lit {
      transition: none;
    }
  }
  /* A phone: the short names, so five fit 320px */
  @media (max-width: 440px) {
    .label {
      font-size: 0.8rem;
    }
    .label .full {
      display: none;
    }
    .short {
      display: inline;
    }
  }
</style>
