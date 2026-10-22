<script lang="ts" module>
  const count = { n: 0 };
</script>

<script lang="ts">
  // A pick landing burns in (ADR 0060): its row starts under a sheet of charcoal and a flame front sweeps it left to
  // right, burning the sheet away to the name beneath: a ragged, flickering edge (the sheet and its ember rim bent by
  // noise, an SVG filter on one small row), the rim glowing orange to red-hot to char, a few sparks rising and going
  // out. The row's text glows hot and cools (the parent's .burning). About 1.2s, transforms and opacity only; the
  // parent drops it once it's done. Laid over the row it's in, which is position: relative.
  const id = `burn-${++count.n}`;
  // Sparks, where along the row and when the front reaches them
  const sparks = [12, 27, 41, 58, 73, 88];
</script>

<span class="burn" aria-hidden="true">
  <svg class="sheet" viewBox="0 0 200 20" preserveAspectRatio="none">
    <defs>
      <filter {id} x="-20%" y="-60%" width="140%" height="220%">
        <feTurbulence type="fractalNoise" baseFrequency="0.09 0.5" numOctaves="2" seed="2" result="noise">
          <animate attributeName="seed" values="2;5;9;4;7" dur="0.35s" repeatCount="indefinite" />
        </feTurbulence>
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="16" xChannelSelector="R" yChannelSelector="G" />
      </filter>
      <linearGradient id="{id}-rim" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stop-color="#1a0a05" stop-opacity="0" />
        <stop offset="0.35" stop-color="#4a1206" stop-opacity="0.85" />
        <stop offset="0.7" stop-color="#ff3b1f" />
        <stop offset="1" stop-color="#ffb347" />
      </linearGradient>
    </defs>
    <g filter="url(#{id})">
      <g class="front">
        <rect x="-22" y="-10" width="22" height="40" fill="url(#{id}-rim)" />
        <rect x="0" y="-10" width="420" height="40" class="char" />
      </g>
    </g>
  </svg>
  {#each sparks as x, k (x)}
    <i class="spark" style:--x="{x}%" style:--d="{(x / 100) * 1.05}s" style:--drift="{k % 2 ? 6 : -5}px"></i>
  {/each}
</span>

<style>
  .burn {
    position: absolute;
    inset: 0;
    z-index: 1;
    pointer-events: none;
  }
  .sheet {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border-radius: inherit;
    /* The sheet is the row's, never past it (the sparks, outside it, rise above) */
    overflow: hidden;
  }
  /* The charcoal sheet: the card's ground, a little darker, so the row reads as covered */
  .char {
    fill: color-mix(in srgb, #0d0b0a 70%, var(--panel-bg, #1b1917));
  }
  .front {
    animation: sweep 1.15s cubic-bezier(0.45, 0.05, 0.4, 1) both;
  }
  @keyframes sweep {
    from {
      transform: translateX(0);
    }
    to {
      transform: translateX(230px);
    }
  }
  .spark {
    position: absolute;
    bottom: 40%;
    left: var(--x);
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: #ffb347;
    box-shadow: 0 0 6px 1px #ff7a18;
    opacity: 0;
    animation: rise 0.7s var(--d) ease-out both;
  }
  @keyframes rise {
    0% {
      opacity: 0;
      transform: translate(0, 0) scale(1);
    }
    15% {
      opacity: 1;
    }
    100% {
      opacity: 0;
      transform: translate(var(--drift), -22px) scale(0.4);
    }
  }
</style>
