<script lang="ts">
  // A player's card, picked up: it lifts from where it lies, turns over sideways and comes up to the middle of the
  // screen, showing its dark back: who they are, their number tonight, and a line or two about them. (An admin on
  // Teammates gets MemberSheet instead.) Closing is the same turn back, in one move. Its actions sit as icons in the card's top band. Someone who runs events can take
  // the player off the session from here (two taps, so a stray one can't). Without motion it just appears. Once it lands it drops its 3D turn, so fields and
  // menus on the back behave like any others.
  import { goesBy, shortName } from "./names";
  import { onMount, tick } from "svelte";
  import { POSITIONS, POSITION_ICONS, type Player } from "../demo/data";
  import mark from "../assets/cougars-mark.webp";
  import { EASE_OUT, prefersReducedMotion } from "../app/motion";
  import Icon from "../app/shell/Icon.svelte";
  import PlayerCard from "./PlayerCard.svelte";
  import Avatar from "./Avatar.svelte";
  import { portal } from "./portal";

  let {
    player,
    source,
    n,
    you = false,
    showRating = false,
    bio = "",
    removeLabel,
    onremove,
    detailsHref,
    actionLabel,
    onaction,
    onclose,
  }: {
    player: Player;
    /** The card on the page, where this one starts and ends; none (a link straight to it) and it grows in place. */
    source?: HTMLElement;
    n?: number;
    you?: boolean;
    showRating?: boolean;
    bio?: string;
    /** "Remove from Friday", when the viewer may. */
    removeLabel?: string;
    onremove?: () => void;
    /** A link to the full card, for an admin looking at the small one. */
    detailsHref?: string;
    /** The card's own big button along its foot ("Pick Alex" on draft night): does it, and puts the card down. */
    actionLabel?: string;
    onaction?: () => void;
    onclose: () => void;
  } = $props();

  let flipper = $state<HTMLElement | undefined>();
  let closeBtn = $state<HTMLButtonElement | undefined>();
  let closing = $state(false);
  let settled = $state(false);
  let sure = $state(false);
  const first = $derived(shortName(player));
  const DURATION = 520;
  const EASE = EASE_OUT;

  // The turn, as two keyframes with the same transform functions in the same order, so the browser interpolates
  // each (travel, size, turn) together. With different lists it goes through matrices, and the card turned first,
  // then flew: two moves instead of one
  const UP = "translate(0px, 0px) scale(1) rotateY(180deg)";
  // Where the page's card is, as a transform from the zoomed card's own place, facing front
  function fromSource(el: HTMLElement) {
    if (!source?.isConnected) return "translate(0px, 0px) scale(0.6) rotateY(0deg)";
    const a = source.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    const dx = a.left + a.width / 2 - (b.left + b.width / 2);
    const dy = a.top + a.height / 2 - (b.top + b.height / 2);
    return `translate(${dx}px, ${dy}px) scale(${a.width / b.width}) rotateY(0deg)`;
  }

  let opening: Animation | undefined;
  onMount(async () => {
    closeBtn?.focus({ preventScroll: true });
    if (!flipper || prefersReducedMotion) return void (settled = true);
    // After the portal has moved the card to <body> (the same flush; before anything's painted): measured in the
    // page, under a transformed ancestor, its start was off in a corner
    await tick();
    opening = flipper.animate([{ transform: fromSource(flipper) }, { transform: UP }], {
      duration: DURATION,
      easing: EASE,
    });
    opening.onfinish = () => (settled = true);
  });

  // Closing: the opening turn in reverse, as one move: it turns back to its front as it shrinks home. A card on
  // the page hides itself while this one's up (PlayerCard), and takes over the moment this one lands on it. A
  // name in a list (the draft's pool) stays as it is: there's nothing to land on, and the soft-landing ease run
  // backwards would park the card by the row for the last stretch, so it fades out over that instead
  async function close() {
    if (closing) return;
    closing = true;
    opening?.cancel();
    settled = false;
    await tick();
    if (!flipper || prefersReducedMotion) return onclose();
    const lands = !!source?.isConnected && getComputedStyle(source).visibility === "hidden";
    const back = flipper.animate(
      lands
        ? [{ transform: UP }, { transform: fromSource(flipper) }]
        : [
            { transform: UP, opacity: 1, offset: 0 },
            { opacity: 1, offset: 0.45 },
            { transform: fromSource(flipper), opacity: 0, offset: 1 },
          ],
      { duration: DURATION - 80, easing: EASE, fill: "forwards" },
    );
    back.onfinish = () => onclose();
  }

  function remove() {
    if (!sure) {
      sure = true;
      return;
    }
    onremove?.();
    close();
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }
</script>

<svelte:window {onkeydown} />

<div class="zoom" class:closing use:portal>
  <button class="scrim" aria-label="Close" tabindex="-1" onclick={close}></button>
  <div class="stage" role="dialog" aria-modal="true" aria-label={goesBy(player)}>
    <div class="flipper" class:settled bind:this={flipper}>
      <div class="face front" aria-hidden="true"><PlayerCard {player} {n} {you} {showRating} /></div>
      <div class="face back">
        <article class="cb">
          <header class="band">
            <img src={mark} alt="" width="40" height="40" />
            <span class="club">Battersea<br />Cougars</span>
            <div class="actions">
              {#if removeLabel && onremove}
                {@const label = sure ? `Sure? Take ${first} off` : removeLabel}
                <button class="act remove" class:sure aria-label={label} title={label} onclick={remove}>
                  <Icon name={sure ? "check" : "userMinus"} size={18} />
                </button>
              {/if}
              {#if detailsHref}<a class="act" href={detailsHref} aria-label="Full details" title="Full details"
                  ><Icon name="open" size={18} /></a
                >{/if}
              <button class="act" aria-label="Close" title="Close" bind:this={closeBtn} onclick={close}>
                <Icon name="x" size={18} />
              </button>
            </div>
          </header>
          <div class="who">
            <Avatar {player} />
            <div>
              <h2>{goesBy(player)}</h2>
              <p class="pos">
                <Icon name={POSITION_ICONS[player.position]} size={16} />{POSITIONS[
                  player.position
                ]}{#if player.cougar}<span class="cougar"> · Cougar</span>{/if}
              </p>
            </div>
          </div>
          <dl class="stats">
            {#if n !== undefined}<div>
                <dt>Tonight</dt>
                <dd class="num">No. {n}</dd>
              </div>{/if}
            {#if showRating}<div>
                <dt>Rating</dt>
                <dd class="num">{player.rating}</dd>
              </div>{/if}
            <div>
              <dt>Played</dt>
              <dd class="num">{player.played ?? 0}</dd>
            </div>
          </dl>
          <p class="bio" class:empty={!bio.trim()}>
            {bio.trim() || (you ? "No bio yet. Add one on your profile." : `No bio yet. ${first} is a mystery.`)}
          </p>
          {#if actionLabel && onaction}
            <div class="cb-action">
              <button class="btn primary block" onclick={() => (onaction(), close())}>{actionLabel}</button>
            </div>
          {/if}
        </article>
      </div>
    </div>
  </div>
</div>

<style>
  .zoom {
    position: fixed;
    inset: 0;
    z-index: 80;
    display: grid;
    place-items: center;
    padding: var(--s-5);
  }
  .scrim {
    position: absolute;
    inset: 0;
    border: 0;
    padding: 0;
    background: color-mix(in srgb, var(--bg) 72%, transparent);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    animation: fade-in 260ms var(--ease) both;
  }
  .closing .scrim {
    animation: fade-out 380ms var(--ease) both;
  }
  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }
  @keyframes fade-out {
    to {
      opacity: 0;
    }
  }
  .stage {
    position: relative;
    display: grid;
    justify-items: center;
    width: min(21rem, 86vw, 60svh);
    perspective: 1600px;
  }
  /* Both faces in one turning card: the front faces you first, the back once it has turned */
  .flipper {
    position: relative;
    width: 100%;
    transform-style: preserve-3d;
    transform: rotateY(180deg);
  }
  /* Landed: no 3D turn at all, so the back is a plain box (fixed menus, focus, crisp text) */
  .flipper.settled {
    transform: none;
  }
  .settled .face.front {
    visibility: hidden;
  }
  .settled .face.back {
    transform: none;
  }
  .face {
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
  }
  .face.front :global(.pc) {
    box-shadow:
      inset 0 0 0 1px rgb(0 0 0 / 0.12),
      0 30px 60px -20px rgb(0 0 0 / 0.8);
  }
  .face.back {
    position: absolute;
    inset: 0;
    container-type: inline-size;
    transform: rotateY(180deg);
  }

  /* The back: dark card stock (fronts are cream; backs match the app), cream ink, the club's red. The band is
     painted as the card's own top layer, not a box inside it, so no lighter rim shows round the corners. */
  .cb {
    --band-h: 19cqw;
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    border-radius: 3cqw;
    color: var(--fg);
    background:
      linear-gradient(var(--surface-3), var(--surface-3)) top / 100% var(--band-h) no-repeat,
      var(--surface-1);
    box-shadow:
      inset 0 0 0 1px rgb(255 255 255 / 0.08),
      0 30px 60px -20px rgb(0 0 0 / 0.85);
  }
  .band {
    display: flex;
    align-items: center;
    gap: 3cqw;
    height: var(--band-h);
    padding: 0 5cqw;
    color: var(--fg);
    font-family: var(--font-display);
    font-size: 6.5cqw;
    font-style: italic;
    text-transform: uppercase;
  }
  .band img {
    width: 11cqw;
    height: auto;
  }
  /* Stacked, so the name keeps its room beside up to three buttons */
  .club {
    flex: 1;
    min-width: 0;
    font-size: 5.4cqw;
    line-height: 1;
  }
  .who {
    display: flex;
    align-items: center;
    gap: 4cqw;
    padding: 5cqw 5cqw 3cqw;
  }
  .who :global(.avatar) {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 20cqw;
    height: 20cqw;
    border-radius: 50%;
    background: var(--red);
    color: var(--on-red);
    font-family: var(--font-display);
    font-size: 9cqw;
    font-style: italic;
    line-height: 1;
    /* Italic capitals lean right: this pulls their ink back to the middle of the disc (measured) */
    padding-right: 0.21em;
  }
  h2 {
    color: inherit;
    font-family: var(--font-display);
    font-size: 8.5cqw;
    font-style: italic;
    font-weight: 400;
    line-height: 1;
    text-transform: uppercase;
  }
  /* The position with its icon (stick, shield, net), so it reads at a glance */
  .pos {
    display: flex;
    align-items: center;
    gap: 0.4em;
    margin-top: 1.5cqw;
    color: var(--fg-muted);
    font-size: 4.4cqw;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .pos :global(svg) {
    width: 1.1em;
    height: 1.1em;
  }
  .cougar {
    color: var(--red-hot);
  }
  .stats {
    display: flex;
    gap: 2cqw;
    margin: 0 5cqw;
    padding: 3cqw 0;
    border-block: 0.5cqw solid color-mix(in srgb, var(--fg) 25%, transparent);
  }
  .stats div {
    flex: 1;
  }
  dt {
    color: var(--fg-muted);
    font-size: 3.6cqw;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  dd {
    margin: 0.5cqw 0 0;
    font-family: var(--font-display);
    font-size: 7cqw;
  }
  .bio {
    flex: 1;
    margin: 0;
    padding: 4cqw 5cqw 5cqw;
    overflow: hidden;
    font-size: 4.8cqw;
    line-height: 1.4;
  }
  .bio.empty {
    color: var(--fg-muted);
    font-style: italic;
  }

  /* Icon buttons on the band: filled, not outlined, and one size whatever they show */
  .actions {
    display: flex;
    flex-shrink: 0;
    gap: 1.5cqw;
  }
  .act {
    display: grid;
    place-items: center;
    width: 10cqw;
    height: 10cqw;
    padding: 0;
    border: 0;
    border-radius: 2cqw;
    background: color-mix(in srgb, var(--fg) 10%, transparent);
    color: var(--fg);
    font: inherit;
    cursor: pointer;
    transition: background-color 150ms var(--ease);
  }
  .act:hover {
    background: color-mix(in srgb, var(--fg) 18%, transparent);
  }
  .act.remove {
    background: var(--red-wash);
    color: var(--red-hot);
  }
  .act.remove:hover {
    background: var(--red-wash-strong);
  }
  .act.remove.sure {
    background: var(--red);
    color: var(--on-red);
  }
  /* The card's own action, along its foot */
  .cb-action {
    margin-top: auto;
    padding: 0 5cqw 5cqw;
  }
</style>
