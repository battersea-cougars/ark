// One easing for the whole app (matches --ease in app.css). Reduced motion zeroes every duration.
import { flushSync } from "svelte";
import { cubicOut } from "svelte/easing";

export const prefersReducedMotion =
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The app's curve (--ease in app.css) for scripted animations: things arriving. */
export const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
/** Its mirror, for things leaving. */
export const EASE_IN = "cubic-bezier(0.7, 0, 0.84, 0)";

export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3.2);
export const fadeMs = prefersReducedMotion ? 0 : 160;
export const flyMs = prefersReducedMotion ? 0 : 320;

/** Full-screen pages (the game clock) zoom in from blurred to sharp, and drop back out. */
export function zoom(_node: Element, { out = false } = {}) {
  if (prefersReducedMotion) return { duration: 0 };
  return {
    duration: out ? 220 : 420,
    easing: out ? (t: number) => t * t * t : (t: number) => 1 - Math.pow(1 - t, 5),
    css: (t: number, u: number) =>
      `transform: scale(${(0.92 + 0.08 * t).toFixed(4)}); transform-origin: 50% 40%;` +
      ` filter: blur(${(8 * u).toFixed(2)}px); opacity: ${Math.min(1, t * 1.6).toFixed(3)};`,
  };
}

/**
 * Desktop settings list: slides out from behind the dock, blurred to sharp. `delay` staggers its
 * rows. Leaving, it's gone at once: the next page is already there, and the list sliding back lay over it.
 */
export function eject(_node: Element, { delay = 0, out = false, x = 28 } = {}) {
  if (prefersReducedMotion || out) return { duration: 0 };
  return {
    delay,
    duration: 460,
    easing: (t: number) => 1 - Math.pow(1 - t, 4),
    css: (t: number, u: number) =>
      `transform: translateX(${(-x * u).toFixed(2)}px); filter: blur(${(3 * u).toFixed(2)}px);` +
      ` opacity: ${Math.min(1, t * 1.4).toFixed(3)};`,
  };
}

export { cubicOut };

/**
 * Trading cards dealt in and folded away, as a filter or search changes which show (Teammates): one arriving tilts a
 * little and settles, one leaving shrinks and fades. Short on the way out, so the rest can glide into place
 * (`animate:flip` with `cardMoveMs`).
 */
export function deal(_node: Element, { out = false } = {}) {
  if (prefersReducedMotion) return { duration: 0 };
  return out
    ? {
        duration: 150,
        easing: (t: number) => t * t,
        css: (t: number) => `transform: scale(${(0.86 + 0.14 * t).toFixed(4)}); opacity: ${t.toFixed(3)};`,
      }
    : {
        delay: 120,
        duration: 340,
        easing: easeOut,
        css: (t: number, u: number) =>
          `transform: translateY(${(10 * u).toFixed(2)}px) rotate(${(-4 * u).toFixed(2)}deg) scale(${(0.88 + 0.12 * t).toFixed(4)}); opacity: ${Math.min(1, t * 1.5).toFixed(3)};`,
      };
}
export const cardMoveMs = prefersReducedMotion ? 0 : 360;

/**
 * Rows in a list, as a search or filter changes which show (a training's Who's coming): the rows' version of `deal`.
 * One arriving drops in a little and fades up, one leaving fades and shrinks a touch; the rest glide into place
 * (`animate:flip` with `cardMoveMs`). What a filter hides moves, it never just vanishes.
 */
export function sift(_node: Element, { out = false } = {}) {
  if (prefersReducedMotion) return { duration: 0 };
  return out
    ? {
        duration: 150,
        easing: (t: number) => t * t,
        css: (t: number) => `transform: scale(${(0.97 + 0.03 * t).toFixed(4)}); opacity: ${t.toFixed(3)};`,
      }
    : {
        delay: 120,
        duration: 300,
        easing: easeOut,
        css: (t: number, u: number) =>
          `transform: translateY(${(-6 * u).toFixed(2)}px); opacity: ${Math.min(1, t * 1.4).toFixed(3)};`,
      };
}

/**
 * Switching between your everyday role and your full one changes the whole app at once (nav, Manage, pages): the
 * old view blurs away as the new one sharpens in (the "mode-switch" view transition in app.css). Without View
 * Transitions, or with reduced motion, it just switches.
 */
export function switchView(update: () => void) {
  if (prefersReducedMotion || typeof document === "undefined" || !document.startViewTransition) return update();
  document.documentElement.classList.add("mode-switch");
  const t = document.startViewTransition(() => flushSync(update));
  t.finished.finally(() => document.documentElement.classList.remove("mode-switch"));
}
