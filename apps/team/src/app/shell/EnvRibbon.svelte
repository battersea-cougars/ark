<script lang="ts">
  import type { Ribbon } from "@cougars/shared/ribbon";

  // Which copy of the app this is, in the bottom-right corner (ADR 0010): LOCAL or DEV, never in production (App.svelte
  // leaves it out). Taps go through it; on a phone it sits just above the tabs, under every sheet and drawer.
  let { label }: { label: Ribbon } = $props();
</script>

<div class="env-ribbon" aria-hidden="true"><span>{label}</span></div>

<style>
  .env-ribbon {
    position: fixed;
    right: env(safe-area-inset-right, 0px);
    bottom: env(safe-area-inset-bottom, 0px);
    z-index: 50;
    width: 5.5rem;
    height: 5.5rem;
    overflow: hidden;
    pointer-events: none;
  }
  span {
    /* Centred on the corner's diagonal, 2.1rem in from each edge; the box clips the band's ends */
    position: absolute;
    top: 100%;
    left: 100%;
    width: 8rem;
    padding: 0.2rem 0;
    transform: translate(calc(-50% - 2.1rem), calc(-50% - 2.1rem)) rotate(-45deg);
    background: var(--action);
    color: var(--on-action);
    font: 700 0.625rem/1 var(--font);
    letter-spacing: 0.14em;
    text-align: center;
    box-shadow: 0 1px 6px rgb(0 0 0 / 0.35);
  }
  @media (max-width: 900px) {
    .env-ribbon {
      bottom: var(--tab-h);
    }
  }
</style>
