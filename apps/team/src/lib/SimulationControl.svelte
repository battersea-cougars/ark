<script lang="ts">
  // Dev only (ADR 0123): the Kumite simulation's control while it runs, floating over whatever page you're on (its
  // views, the draft room), so you can follow it along: what it just did, Watch or Quick, Pause/Resume and Stop. The
  // run is a store (app/backend.svelte.ts simulating), so the control comes and goes with it, not with a page. Bottom
  // right on a desktop; on a phone, a bar above the tabs, the save note lifted over it. Its size never changes with
  // what it says: the words swap in a fixed line.
  import { simulating, simulation } from "../app/backend.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import type { Speed } from "./simulation";

  let { focus = false }: { focus?: boolean } = $props();

  const on = $derived(simulating.status !== "idle");
  const paused = $derived(simulating.status === "paused");
  const SPEEDS: { value: Speed; label: string; title: string }[] = [
    { value: "watch", label: "Watch", title: "Each move plays out before the next" },
    { value: "quick", label: "Quick", title: "As quick as a member's changes may go" },
  ];

  // The save note sits above this bar on a phone (app/shell/Shell.svelte reads --above-tabs)
  $effect(() => {
    if (!on) return;
    document.body.style.setProperty("--above-tabs", "4rem");
    return () => document.body.style.removeProperty("--above-tabs");
  });
</script>

{#if on}
  <div class="sim" class:focus role="region" aria-label="Simulation">
    <span class="dot" class:paused aria-hidden="true"></span>
    <p class="what" aria-live="polite">
      <strong>{paused ? "Paused" : "Simulating"}</strong>
      <span class="said">{simulating.said || "Starting…"}</span>
    </p>
    <div class="speeds" role="group" aria-label="Speed">
      {#each SPEEDS as s (s.value)}
        <button
          class="speed"
          class:chosen={simulating.speed === s.value}
          aria-pressed={simulating.speed === s.value}
          title={s.title}
          onclick={() => simulation.speed(s.value)}>{s.label}</button
        >
      {/each}
    </div>
    {#if paused}
      <button class="btn icon go" aria-label="Resume" title="Resume" onclick={() => simulation.resume()}>
        <Icon name="play" size={18} />
      </button>
    {:else}
      <button class="btn icon go" aria-label="Pause" title="Pause after this move" onclick={() => simulation.pause()}>
        <Icon name="pause" size={18} />
      </button>
    {/if}
    <button class="btn icon" aria-label="Stop" title="Stop" onclick={() => simulation.stop()}>
      <Icon name="x" size={18} />
    </button>
  </div>
{/if}

<style>
  .sim {
    position: fixed;
    right: var(--s-5);
    bottom: calc(var(--s-5) + env(safe-area-inset-bottom, 0px));
    /* Over sheets, drawers and an editor panel (70–80), under the save note (85) and menus (90) */
    z-index: 84;
    display: flex;
    align-items: center;
    gap: var(--s-2);
    width: 26rem;
    padding: var(--s-2) var(--s-2) var(--s-2) var(--s-4);
    border-radius: var(--r-xl);
    background: var(--surface-3);
    box-shadow: var(--shadow-pop);
  }
  .dot {
    flex-shrink: 0;
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--red-hot);
    animation: beat 1.4s var(--ease-in-out) infinite;
  }
  .dot.paused {
    background: var(--fg-subtle);
    animation: none;
  }
  @keyframes beat {
    50% {
      opacity: 0.3;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .dot {
      animation: none;
    }
  }
  .what {
    display: grid;
    flex: 1;
    min-width: 0;
    margin: 0;
    line-height: 1.25;
  }
  .what strong {
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .said {
    overflow: hidden;
    color: var(--fg-muted);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .speeds {
    display: flex;
    flex-shrink: 0;
  }
  .speed {
    height: var(--control-h-sm);
    padding: 0 var(--s-2);
    border: 0;
    background: none;
    color: var(--fg-muted);
    font-size: var(--text-sm);
    font-weight: 500;
    cursor: pointer;
  }
  .speed:hover {
    color: var(--fg);
  }
  .speed.chosen {
    color: var(--red-hot);
    font-weight: 600;
  }
  .go {
    color: var(--fg);
  }

  @media (max-width: 900px) {
    .sim {
      right: var(--gutter);
      left: var(--gutter);
      bottom: calc(var(--tab-h) + var(--s-3));
      width: auto;
    }
    /* No tabs on a page of its own (the draft room) */
    .sim.focus {
      bottom: calc(var(--s-4) + env(safe-area-inset-bottom, 0px));
    }
  }
</style>
