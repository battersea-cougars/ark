// Making teams as a bit of theatre (Training): every player's card flies into one deck, the deck is riffled twice, and
// the cards are dealt out to their rows on the new teams.
import { EASE_IN, EASE_OUT, prefersReducedMotion } from "../app/motion";

export interface Show {
  /** Settles when the last card has landed (or the show was skipped). */
  finished: Promise<void>;
  /** Straight to the end: the teams out, every row showing. */
  skip(): void;
}

export interface ShowOptions {
  /** The cards in the layer, absolutely placed with their centre on (0, 0) of the layer. */
  cards: HTMLElement[];
  /** Where each card's player is now (a row or a card on the page), or null if they aren't on screen. */
  from: (DOMRect | null)[];
  /** The order to deal in: indexes into `cards`. */
  order: number[];
  /** Where the pile sits, in window coordinates; the middle of the window if not given. */
  deck?: { x: number; y: number };
  /** After the shuffle: put the new teams on the page, their rows hidden. */
  reveal: () => Promise<void>;
  /** The row a card lands on, once revealed. */
  target: (i: number) => HTMLElement | null;
  /** A card has landed: show its row. */
  landed: (i: number) => void;
}

const GATHER_MS = 450;
const RIFFLE_MS = 260;
const DEAL_MS = 380;
const DEAL_GAP_MS = 70;

/**
 * Scripted Web Animations on cards in a layer over the page; the page only hides the new rows until their card lands. A
 * tap or Escape skips to the end, and with reduced motion there's no show at all.
 */
export function shuffleAndDeal(o: ShowOptions): Show {
  let skipped = false;
  let revealed = false;
  const running = new Set<Animation>();
  const deck = o.deck ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  for (const el of o.cards) {
    el.style.left = `${deck.x}px`;
    el.style.top = `${deck.y}px`;
  }
  // A loose pile: each card a little off square
  const rest = o.cards.map(() => ({ x: rand(-5, 5), y: rand(-4, 4), r: rand(-4, 4) }));
  const at = (i: number) => `translate(${rest[i].x}px, ${rest[i].y}px) rotate(${rest[i].r}deg)`;

  const play = (el: HTMLElement, frames: Keyframe[], opts: KeyframeAnimationOptions) => {
    const a = el.animate(frames, { fill: "both", ...opts });
    running.add(a);
    return a.finished.then(
      () => void running.delete(a),
      () => void running.delete(a),
    );
  };

  async function reveal() {
    if (revealed) return;
    revealed = true;
    await o.reveal();
  }

  async function run() {
    if (prefersReducedMotion) return;
    // Gather: from where each player is to the pile, staggered
    await Promise.all(
      o.cards.map((el, i) => {
        const f = o.from[i];
        const sx = f ? f.left + f.width / 2 - deck.x : rand(-80, 80);
        const sy = f ? f.top + f.height / 2 - deck.y : window.innerHeight / 2 + 80;
        return play(
          el,
          [
            // Seen players take off from where they are; the rest come in from below
            { transform: `translate(${sx}px, ${sy}px) scale(0.6)`, opacity: f ? 1 : 0 },
            { opacity: 1, offset: 0.35 },
            { transform: at(i), opacity: 1 },
          ],
          { duration: GATHER_MS, delay: Math.min(i * 15, 300), easing: EASE_OUT },
        );
      }),
    );
    if (skipped) return;
    // Riffle twice: the pile splits in two halves that slide apart, then fall back together, one at a time
    for (let pass = 0; pass < 2 && !skipped; pass++) {
      await Promise.all(
        o.cards.map((el, i) => {
          const side = i % 2 ? 1 : -1;
          const w = el.offsetWidth;
          return play(
            el,
            [
              { transform: at(i) },
              {
                transform: `translate(${rest[i].x + side * w * 0.62}px, ${rest[i].y - 6}px) rotate(${rest[i].r + side * 9}deg)`,
                offset: 0.45,
              },
              { transform: at(i) },
            ],
            { duration: RIFFLE_MS, delay: i * 6, easing: "ease-in-out" },
          );
        }),
      );
    }
    if (skipped) return;
    await reveal();
    if (skipped) return;
    // Deal: off the top of the pile onto each row, in turn
    await Promise.all(
      o.order.map((i, k) => {
        const el = o.cards[i];
        const t = o.target(i)?.getBoundingClientRect();
        el.style.zIndex = String(1000 - k);
        if (!t) return Promise.resolve(o.landed(i));
        const tx = t.left + t.width / 2 - deck.x;
        const ty = t.top + t.height / 2 - deck.y;
        const s = Math.max(0.3, Math.min(1, t.height / el.offsetHeight));
        return play(
          el,
          [
            { transform: at(i), opacity: 1 },
            { transform: `translate(${tx}px, ${ty}px) rotate(0deg) scale(${s})`, opacity: 1, offset: 0.85 },
            { transform: `translate(${tx}px, ${ty}px) scale(${s * 0.9})`, opacity: 0 },
          ],
          { duration: DEAL_MS, delay: k * DEAL_GAP_MS, easing: EASE_IN },
        ).then(() => {
          if (!skipped) o.landed(i);
        });
      }),
    );
  }

  let finish!: () => void;
  const finished = new Promise<void>((r) => (finish = r));
  void run().finally(async () => {
    await reveal();
    o.order.forEach((i) => o.landed(i));
    finish();
  });

  return {
    finished,
    skip() {
      if (skipped) return;
      skipped = true;
      for (const a of running) a.finish();
    },
  };
}

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}
