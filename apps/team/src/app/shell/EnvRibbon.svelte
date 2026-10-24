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
    /* --box: the corner it clips to; --in: how far in from each edge the band's middle crosses them */
    --box: 8rem;
    --in: 3rem;
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
    /* Centred on the corner's diagonal; as wide as the box is across there (2√2 × --in), its ends clipped */
    position: absolute;
    top: 100%;
    left: 100%;
    display: grid;
    gap: 0.15rem;
    box-sizing: border-box;
    width: calc(var(--in) * 2.83);
    padding: 0.25rem 0.6rem;
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
      --box: 7rem;
      --in: 2.65rem;
      bottom: var(--tab-h);
    }
    b {
      letter-spacing: 0.06em;
    }
  }
</style>
