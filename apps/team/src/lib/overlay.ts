// One close contract for every overlay (ADR 0065): lib/Drawer (the side drawer, desktop and tablet) and lib/Sheet
// (the bottom sheet, phone; a centred modal on desktop). Both are native modal dialogs, so the browser keeps focus in
// the top one, makes the page under it inert and sends Escape (and Android's back) to the top one only. What's here
// is the rest, kept apart to be tested:
// - every way out (×, Escape, the backdrop, a swipe, the back gesture) asks `requestClose`, which a guard may hold
//   (unsaved changes: "Discard your changes?", lib/dirty.svelte.ts);
// - a click on the backdrop closes only when it was pressed there and let go there: a drag that starts inside (selecting
//   a field's text) and ends outside doesn't;
// - the page under it doesn't scroll while one is open, and nothing moves when that starts;
// - focus goes back to whatever opened it.

/** Something that may hold a close: asks first and returns true, then calls `leave` itself if the answer is yes. */
export type CloseGuard = (leave: () => void) => boolean;

/** The one way out: closes, unless the guard holds it to ask. Returns whether it closed now. */
export function requestClose(close: () => void, guard?: CloseGuard | null): boolean {
  if (guard?.(close)) return false;
  close();
  return true;
}

/** A pointer at (x, y), outside the box (the overlay's own rectangle): on the backdrop. */
export function outside(box: { left: number; top: number; right: number; bottom: number }, x: number, y: number) {
  return x < box.left || x > box.right || y < box.top || y > box.bottom;
}

/**
 * A full click on the backdrop: `press` on pointerdown, `release` on the click that ends it; true only when both were
 * on the backdrop. A keyboard's click (Enter on a button) is never one.
 */
export function backdropClicks() {
  let pressed = false;
  return {
    press(onBackdrop: boolean) {
      pressed = onBackdrop;
    },
    release(onBackdrop: boolean): boolean {
      const full = pressed && onBackdrop;
      pressed = false;
      return full;
    },
  };
}

interface Root {
  style: { overflow: string; scrollbarGutter: string };
  clientWidth: number;
}
let locks = 0;
let was: { overflow: string; scrollbarGutter: string } | null = null;

/**
 * The page stays put under an open overlay: its scroller (the document) stops scrolling. Counted, so a sheet opened
 * from a drawer and closed again leaves the drawer's lock in place. A desktop's scrollbar keeps its room
 * (scrollbar-gutter), so nothing moves sideways. Returns the unlock, which only counts once.
 */
export function lockScroll(root: Root = document.documentElement, windowWidth = innerWidth): () => void {
  if (locks++ === 0) {
    was = { overflow: root.style.overflow, scrollbarGutter: root.style.scrollbarGutter };
    const hasBar = windowWidth > root.clientWidth;
    root.style.overflow = "hidden";
    if (hasBar) root.style.scrollbarGutter = "stable";
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    if (--locks === 0 && was) {
      root.style.overflow = was.overflow;
      root.style.scrollbarGutter = was.scrollbarGutter;
      was = null;
    }
  };
}

/** Where focus was as it opened; the returned function puts it back there (if that's still on the page). */
export function rememberFocus(active: Element | null = document.activeElement): () => void {
  const opener = active as (Element & { focus?: (o?: FocusOptions) => void; isConnected?: boolean }) | null;
  return () => {
    if (opener?.isConnected !== false) opener?.focus?.({ preventScroll: true });
  };
}
