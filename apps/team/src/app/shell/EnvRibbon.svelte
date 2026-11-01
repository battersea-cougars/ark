<script lang="ts">
  import { ribbonHead, type Ribbon } from "@cougars/shared/ribbon";

  // Which copy of the app this is, in the bottom-right corner (ADR 0010): LOCAL (and below it the checkout's branch) or
  // DEV, never in production (App.svelte leaves it out). Taps go through it; on a phone it sits just above the tabs,
  // clear of their labels, under every sheet and drawer.
  let { ribbon }: { ribbon: Ribbon } = $props();
</script>

<div class="env-ribbon" aria-hidden="true">
  <span
    ><b>{ribbonHead(ribbon)}</b>{#if ribbon.branch}<i>{ribbon.branch}</i>{/if}</span
  >
</div>

<style>
  .env-ribbon {
    /* --in: the band's middle sits --in in from each edge, so it meets the edges 2 × --in from the corner and is 2√2 ×
       --in long across it: enough for "LOCAL · own data" (about 7.5rem). --box, the corner it's clipped to, reaches
       past where the band meets the edges, so its ends are cut by the screen's edges, not the box's */
    --in: 4rem;
    --box: calc(var(--in) * 2 + 1.5rem);
    position: fixed;
    right: env(safe-area-inset-right, 0px);
    bottom: env(safe-area-inset-bottom, 0px);
    z-index: 50;
    width: var(--box);
    height: var(--box);
    overflow: hidden;
    pointer-events: none;
  }
  span {
    /* Centred on the corner's diagonal, longer than the corner is across there, its ends clipped */
    position: absolute;
    top: 100%;
    left: 100%;
    display: grid;
    gap: 0.2rem;
    box-sizing: border-box;
    width: calc(var(--in) * 4);
    padding: 0.3rem 0.6rem;
    transform: translate(calc(-50% - var(--in)), calc(-50% - var(--in))) rotate(-45deg);
    background: var(--action);
    color: var(--on-action);
    text-align: center;
    box-shadow: 0 1px 6px rgb(0 0 0 / 0.35);
  }
  b,
  i {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-style: normal;
  }
  b {
    font: 700 0.625rem/1 var(--font);
    letter-spacing: 0.14em;
  }
  /* The branch, nearer the corner where the band is shorter */
  i {
    padding-inline: 0.3rem;
    font: 600 0.6rem/1 var(--font);
    letter-spacing: 0.02em;
  }
  @media (max-width: 900px) {
    .env-ribbon {
      --in: 3.6rem;
      bottom: var(--tab-h);
    }
    b {
      letter-spacing: 0.06em;
    }
  }
</style>
