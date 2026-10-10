<script lang="ts">
  // A player as a physical trading card: printed card stock with a border round the photo, a deep red name plate and
  // the position printed large under it, and a shadow as if it's lying on the table. Flat colour, no sheen.
  // The photo slot shows the club mark until members add photos. The corner number is the sign-up order; your own
  // card carries a "You" sticker in the other corner and a ring round it. Ratings
  // only show for admins (read:Rating). With `onopen` it's a button: the page flips it over (PlayerCardZoom), and
  // hides this one meanwhile, as if it's been picked up.
  import { goesBy, shortName } from "./names";
  import { POSITIONS, type Player } from "../demo/data";
  import mark from "../assets/cougars-mark.webp";

  let {
    player,
    n,
    you = false,
    quarterly = false,
    showRating = false,
    onopen,
    lifted = false,
  }: {
    player: Player;
    n?: number;
    you?: boolean;
    /** A Quarterly Member waiting for a place: they go ahead (ADR 0030), tagged so the queue's order reads */
    quarterly?: boolean;
    showRating?: boolean;
    /** Tapped: given the card, so the zoom can start where it lies. */
    onopen?: (card: HTMLElement) => void;
    /** Picked up (open in the zoom): its place stays, the card doesn't show. */
    lifted?: boolean;
  } = $props();

  const first = $derived(shortName(player));
  // Long names print smaller so the whole name fits the plate (see .plate strong)
  const len = $derived(Math.max(first.length, 5));
</script>

{#snippet card()}
  <article class="pc" class:you aria-label={goesBy(player)}>
    <span class="photo">
      <img class="ghost" src={mark} alt="" loading="lazy" />
      {#if n !== undefined}<span class="no">{n}</span>{/if}
      {#if you}<span class="you-tag">You</span>{/if}
      {#if player.cougar}<span class="cougar-tag">Cougar</span>{/if}
      {#if quarterly}<span class="plan-tag">Quarterly</span>{/if}
    </span>
    <span class="plate"><strong style:--len={len}>{first}</strong></span>
    <span class="foot">
      <span class="pos">{POSITIONS[player.position]}</span>
      {#if showRating}<span class="num">{player.rating}</span>{/if}
    </span>
  </article>
{/snippet}

{#if onopen}
  <button
    class="slot tap"
    style:visibility={lifted ? "hidden" : undefined}
    aria-haspopup="dialog"
    aria-label="{goesBy(player)}: turn the card over"
    onclick={(e) => onopen(e.currentTarget)}>{@render card()}</button
  >
{:else}
  <div class="slot">{@render card()}</div>
{/if}

<style>
  .slot {
    container-type: inline-size;
  }
  .tap {
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    text-align: inherit;
  }
  .tap:focus-visible {
    outline: none;
  }
  .tap:focus-visible .pc {
    outline: 2px solid var(--ring);
    outline-offset: 3px;
  }
  /* Card stock: an aged off-white, dimmed so it doesn't glare on the dark page; small rounded corners, a hairline
     edge and a table shadow */
  .pc {
    position: relative;
    display: flex;
    flex-direction: column;
    aspect-ratio: 5 / 7;
    padding: 5cqw 5cqw 3.5cqw;
    overflow: hidden;
    border-radius: 3cqw;
    color: var(--card-ink);
    background: var(--card-stock);
    box-shadow:
      inset 0 0 0 1px rgb(0 0 0 / 0.12),
      0 1px 1px rgb(0 0 0 / 0.35),
      0 8px 18px -6px rgb(0 0 0 / 0.6);
    transition:
      translate var(--t) var(--ease),
      box-shadow var(--t) var(--ease);
  }
  .pc:hover {
    translate: 0 -3px;
    box-shadow:
      inset 0 0 0 1px rgb(0 0 0 / 0.12),
      0 2px 2px rgb(0 0 0 / 0.3),
      0 16px 28px -8px rgb(0 0 0 / 0.65);
  }
  /* Yours: a ring with a gap, so it reads as "this one" against the table, not as a coloured edge */
  .pc.you,
  .pc.you:hover {
    box-shadow:
      inset 0 0 0 1px rgb(0 0 0 / 0.12),
      0 0 0 3px var(--bg),
      0 0 0 5px var(--green),
      0 8px 18px -6px rgb(0 0 0 / 0.6);
  }
  /* The photo, inset in the stock with a thin printed keyline */
  .photo {
    position: relative;
    flex: 1;
    display: grid;
    place-items: center;
    overflow: hidden;
    border-radius: 1cqw;
    background: var(--card-well);
    box-shadow: 0 0 0 0.6cqw var(--card-ink);
  }
  /* No photo yet: the club mark, its red turned down, so the name, tags and rating are what you read */
  .ghost {
    width: 62%;
    height: auto;
    filter: saturate(0.35);
    opacity: 0.4;
  }
  .no {
    position: absolute;
    top: 3cqw;
    left: 3cqw;
    display: grid;
    place-items: center;
    width: 14cqw;
    height: 14cqw;
    border-radius: 50%;
    background: var(--card-stock);
    color: var(--card-ink);
    font-family: var(--font-display);
    font-size: 8cqw;
    line-height: 1;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.4);
  }
  .you-tag {
    position: absolute;
    top: 3cqw;
    right: 3cqw;
    padding: 1.6cqw 3cqw 1.2cqw;
    border-radius: 1.2cqw;
    background: var(--green);
    color: var(--card-you-ink);
    font-family: var(--font-display);
    font-size: 7cqw;
    line-height: 1;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.4);
  }
  /* The plate overlaps the bottom of the photo, as printed, and is as long as the name */
  .plate {
    position: relative;
    z-index: 1;
    align-self: start;
    max-width: 100%;
    margin: -6cqw 0 0 -5cqw;
    padding: 2.6cqw 7cqw 2.2cqw 5cqw;
    /* A deep red, not the logo's bright one: white on it reads at about 7:1 where the bright red managed 4.5 */
    background: var(--card-band);
    color: var(--on-red);
    clip-path: polygon(0 0, 100% 0, calc(100% - 4cqw) 100%, 0 100%);
  }
  /* Upright: Anton has no italic, so a slant is a faked oblique and smears at this size. As big as the name allows:
     the plate holds at most about 78cqw of capitals at roughly 0.5em each, so long names step down rather than get cut off */
  .plate strong {
    display: block;
    overflow: hidden;
    font-family: var(--font-display);
    font-size: min(17cqw, 132cqw / var(--len));
    font-weight: 400;
    line-height: 1.05;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .foot {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 2cqw;
    padding: 3cqw 0.5cqw 0;
    font-size: 5.4cqw;
    font-weight: 700;
    letter-spacing: 0.08em;
    line-height: 1;
    text-transform: uppercase;
    white-space: nowrap;
  }
  /* The position is the first thing a captain looks for, so it's printed big, in ink */
  .pos {
    color: var(--card-ink);
    font-family: var(--font-display);
    font-size: 9cqw;
    font-weight: 400;
    letter-spacing: 0.03em;
  }
  /* On the Cougars team: a red tag in the photo's top right corner; your own "You" tag drops under it */
  .cougar-tag {
    position: absolute;
    top: 3cqw;
    right: 3cqw;
    padding: 1.6cqw 3cqw 1.2cqw;
    border-radius: 1.2cqw;
    background: var(--card-band);
    color: var(--on-red);
    font-family: var(--font-display);
    font-size: 7cqw;
    line-height: 1;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.4);
  }
  /* A Quarterly Member on the waitlist: a quiet tag in the photo's bottom right, printed on the card's dark well */
  .plan-tag {
    position: absolute;
    right: 3cqw;
    bottom: 3cqw;
    padding: 1.6cqw 3cqw 1.2cqw;
    border-radius: 1.2cqw;
    background: rgb(0 0 0 / 0.55);
    color: var(--card-stock);
    font-family: var(--font-display);
    font-size: 7cqw;
    line-height: 1;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .photo:has(.cougar-tag) .you-tag {
    top: 15cqw;
  }
  /* The rating, big in the display face: the number an admin reads the card for */
  .foot .num {
    color: var(--card-ink);
    font-family: var(--font-display);
    font-size: 12cqw;
    font-weight: 400;
    line-height: 1;
    letter-spacing: 0.02em;
  }
</style>
