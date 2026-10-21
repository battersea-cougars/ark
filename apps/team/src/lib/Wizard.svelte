<script lang="ts">
  // A job in steps (ADR 0117), after Ledger's: the steps along the top (the one you're on with the red slash, done
  // ones solid, ones not open yet faded and shut), the step under them sliding in (back the other way going back) and
  // scrolling on its own, and the foot staying put: Cancel or Back, where you are, then Next · the step after, or the
  // job's own button on the last. Enter goes on when the step allows it; not from a button, nor from anything that
  // takes Enter itself (a search that picks, a combobox), nor from the last step, where the job is a tap.
  // While the job's under way (`working`) the foot says so and Back and the steps hold; what failed comes back in
  // `problem`, in place. It fills whatever holds it (an EditorPanel or Sheet with `fill`), so changing step never
  // changes its height.
  import type { Snippet } from "svelte";
  import { prefersReducedMotion } from "../app/motion";

  let {
    steps,
    step = $bindable(0),
    reachable,
    problem = "",
    ready = "",
    working = "",
    close,
    children,
    finish,
    extra,
  }: {
    steps: readonly string[];
    step?: number;
    /** The furthest step open: the first whose needs aren't met (lib/wizard.ts). */
    reachable: number;
    /** What stops the step in view, said at the foot. */
    problem?: string;
    /** What the job will do, said at the foot of the last step once nothing stops it. */
    ready?: string;
    /** What the job is doing while it's under way ("Scheduling…"); set, the wizard holds. */
    working?: string;
    /** Cancel, on the first step. */
    close: () => void;
    /** The step's content, by its name. */
    children: Snippet<[string]>;
    /** The last step's button: the job itself. */
    finish: Snippet;
    /** A quiet way out at the foot, opposite what's said (Advanced). */
    extra?: Snippet;
  } = $props();

  const busy = $derived(!!working);
  const last = $derived(step === steps.length - 1);

  // Which way it went, for the slide: forward from the right, back from the left. Nothing slides as it opens.
  let dir = $state<1 | -1>(1);
  let moved = $state(false);
  let shown = $state(step);
  let stage = $state<HTMLDivElement | undefined>();
  $effect.pre(() => {
    if (step === shown) return;
    dir = step > shown ? 1 : -1;
    moved = true;
    shown = step;
  });
  // The new step takes the focus, so a screen reader and the keyboard carry on from its top
  function arrive(node: HTMLElement) {
    if (moved) node.focus({ preventScroll: true });
  }

  function go(to: number) {
    if (busy || to === step || to < 0 || to >= steps.length || to > reachable) return;
    step = to;
  }

  function slide(_node: Element, { x }: { x: number }) {
    if (prefersReducedMotion || !moved) return { duration: 0 };
    return {
      duration: 280,
      easing: (t: number) => 1 - Math.pow(1 - t, 3.2),
      css: (t: number, u: number) => `transform: translateX(${(u * x).toFixed(1)}px); opacity: ${t.toFixed(3)}`,
    };
  }

  function enter(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (busy || e.key !== "Enter" || e.defaultPrevented || e.isComposing || !t || !stage?.contains(t)) return;
    if (t.closest("button, a, textarea, [role=combobox]")) return;
    if (!last && step + 1 <= reachable) {
      e.preventDefault();
      go(step + 1);
    }
  }
</script>

<svelte:window onkeydown={enter} />

<div class="wizard" aria-busy={busy}>
  <ol class="steps" style:--steps={steps.length} aria-label="Steps">
    {#each steps as s, i (s)}
      <li>
        <button
          type="button"
          class:done={i < step}
          aria-current={i === step ? "step" : undefined}
          aria-label={`${i + 1}. ${s}`}
          disabled={i > reachable || busy}
          onclick={() => go(i)}
        >
          <span class="n num">{i + 1}</span><span class="label">{s}</span>
        </button>
      </li>
    {/each}
  </ol>

  <div class="stage" bind:this={stage}>
    {#key step}
      <div class="step" tabindex="-1" use:arrive in:slide={{ x: dir * 32 }} out:slide={{ x: dir * -32 }}>
        {@render children(steps[step]!)}
      </div>
    {/key}
  </div>

  <footer class="foot">
    <div class="say">
      {#if busy}
        <p class="note working" role="status">{working}</p>
      {:else}
        <p class="note" class:warn={!!problem} role="alert">{problem || (last ? ready : "")}</p>
      {/if}
      {@render extra?.()}
    </div>
    <div class="keys">
      <button type="button" class="btn ghost" disabled={busy} onclick={() => (step ? go(step - 1) : close())}
        >{step ? "Back" : "Cancel"}</button
      >
      <span class="where">Step <span class="num">{step + 1}</span> of {steps.length}</span>
      {#if last}
        {@render finish()}
      {:else}
        <button type="button" class="btn primary next" disabled={step + 1 > reachable} onclick={() => go(step + 1)}
          >Next · {steps[step + 1]}</button
        >
      {/if}
    </div>
  </footer>
</div>

<style>
  /* The steps stay put; the step under them takes the rest and scrolls on its own; the foot stays at the bottom */
  .wizard {
    --pad: var(--s-6);
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    height: 100%;
  }
  @media (max-width: 900px) {
    .wizard {
      --pad: var(--gutter);
    }
  }

  /* The steps: Tabs' italic capitals, a bar under each. The one you're on has the red slash; done ones a solid bar;
     ones not open yet fade */
  .steps {
    display: grid;
    flex-shrink: 0;
    grid-template-columns: repeat(var(--steps), minmax(0, 1fr));
    gap: var(--s-2);
    margin: 0;
    padding: var(--s-4) var(--pad) 0;
    list-style: none;
  }
  .steps button {
    position: relative;
    display: flex;
    align-items: baseline;
    gap: var(--s-2);
    width: 100%;
    height: 2.75rem;
    padding: 0 0 var(--s-2);
    border: 0;
    background: none;
    color: var(--fg-muted);
    font-family: var(--font-display);
    font-size: 1.1rem;
    font-style: italic;
    font-weight: 400;
    letter-spacing: 0.03em;
    line-height: 1;
    text-align: left;
    text-transform: uppercase;
    white-space: nowrap;
    cursor: pointer;
    transition:
      color var(--t-fast) var(--ease-in-out),
      opacity var(--t-fast) var(--ease-in-out);
  }
  .steps button::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 3px;
    border-radius: 2px;
    background: var(--surface-3);
    transition: background-color var(--t) var(--ease);
  }
  /* Room for the italic's lean past the box, or the last letter is clipped */
  .steps .label {
    overflow: hidden;
    text-overflow: ellipsis;
    padding-inline-end: 0.2em;
  }
  .steps .n {
    color: var(--fg-subtle);
  }
  .steps button:hover:not(:disabled) {
    color: var(--fg-body);
  }
  .steps button.done {
    color: var(--fg-body);
  }
  .steps button.done::after {
    background: var(--fg-muted);
  }
  .steps button[aria-current="step"] {
    color: var(--fg);
  }
  .steps button[aria-current="step"] .n {
    color: var(--red-hot);
  }
  .steps button[aria-current="step"]::after {
    height: 4px;
    border-radius: 0;
    transform: skewX(-24deg);
    background: var(--red);
    animation: charge var(--t-slow) var(--ease) both;
    transform-origin: left;
  }
  @keyframes charge {
    from {
      transform: skewX(-24deg) scaleX(0);
    }
  }
  .steps button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  /* One step at a time; going on, the old one leaves as the new one comes, in the same place */
  .stage {
    position: relative;
    display: grid;
    flex: 1;
    grid-template-rows: minmax(0, 1fr);
    grid-template-columns: minmax(0, 1fr);
    min-height: 0;
    overflow: hidden;
  }
  .step {
    display: flex;
    flex-direction: column;
    gap: var(--s-6);
    grid-area: 1 / 1;
    min-height: 0;
    padding: var(--s-6) var(--pad) var(--s-6);
    overflow-y: auto;
    overscroll-behavior: contain;
    outline: none;
  }

  /* The foot: what's said (what stops it, what it'll do, what it's doing) on one line kept for it, then the buttons */
  .foot {
    display: grid;
    flex-shrink: 0;
    gap: var(--s-2);
    padding: var(--s-3) var(--pad);
    padding-bottom: max(var(--s-3), env(safe-area-inset-bottom));
    border-top: 1px solid var(--border);
  }
  .say {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 1.75rem;
  }
  .note {
    flex: 1;
    min-width: 0;
    margin: 0;
    color: var(--fg-muted);
    font-size: var(--text-sm);
    line-height: 1.3;
  }
  .note.warn {
    color: var(--tone-amber);
  }
  .note.working {
    color: var(--fg);
    animation: breathe 1.2s var(--ease-in-out) infinite alternate;
  }
  @keyframes breathe {
    to {
      opacity: 0.55;
    }
  }
  .keys {
    display: flex;
    align-items: center;
    gap: var(--s-3);
  }
  .where {
    margin-left: auto;
    color: var(--fg-subtle);
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    white-space: nowrap;
  }
  .where .num {
    color: var(--fg-body);
  }
  @media (max-width: 600px) {
    /* A phone: just the numbers along the top; the step says its own name */
    .steps {
      padding-top: var(--s-1);
    }
    .steps button {
      justify-content: center;
      height: 2.25rem;
    }
    .steps .label {
      display: none;
    }
    .keys > :global(.btn:last-child) {
      flex: 1;
    }
    .keys > .btn.ghost {
      padding-inline: var(--s-3);
    }
    .where {
      margin-left: 0;
    }
  }
  @media (max-width: 360px) {
    .where {
      display: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .steps button[aria-current="step"]::after,
    .note.working {
      animation: none;
    }
  }
</style>
