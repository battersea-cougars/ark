// Back closes what's open (ADR 0065): Android's back gesture or button, the browser's Back, iPhone Safari's swipe from
// the edge, and the Android app's back (Capacitor goes back in the web view's history). Each overlay that opens
// (lib/Sheet, lib/Drawer, MemberSheet, PlayerCardZoom) puts an entry of its own on the history, at the same address,
// so Back takes that entry off and closes the overlay on top, instead of leaving the page under it. Closed any other
// way (×, Escape, a swipe, the backdrop), it takes its own entry off again, so the next Back is a real one.
// The router asks here first on every popstate (app/router.svelte.ts): a Back that closed an overlay isn't a move.

/** What an overlay does when Back reaches it: closes, or returns false when it's holding to ask (unsaved changes). */
export type CloseOnBack = () => boolean | void;

interface HistoryLike {
  readonly state: unknown;
  pushState(data: unknown, unused: string): void;
  back(): void;
}

const LAYER = "layer";
const layerOf = (state: unknown) =>
  state && typeof state === "object" && LAYER in state ? (state as Record<string, unknown>)[LAYER] : undefined;

/** The open overlays, bottom first, each with its history entry. Exported to be tested with a fake history. */
export function backStack(history: HistoryLike) {
  const layers: { id: number; close: CloseOnBack }[] = [];
  let nextId = 1;
  // Our own history.back()s, taking an entry off for an overlay closed some other way: not Back from the person
  let ownPops = 0;

  const push = (id: number) => {
    const state = history.state && typeof history.state === "object" ? history.state : {};
    history.pushState({ ...state, [LAYER]: id }, "");
  };

  return {
    /** An overlay opened: Back closes it. The returned function is for when it's closed another way. */
    open(close: CloseOnBack): () => void {
      const id = nextId++;
      layers.push({ id, close });
      push(id);
      return () => {
        const at = layers.findIndex((l) => l.id === id);
        if (at < 0) return; // Back closed it already
        layers.splice(at, 1);
        // Its entry is on top unless the page moved on under it (a link inside it): then that page has taken it
        if (layerOf(history.state) === id) {
          ownPops++;
          history.back();
        }
      };
    },
    /** On popstate: true when this Back was an overlay's (closed now, or our own), so it isn't a move between pages. */
    popped(): boolean {
      if (ownPops > 0) return (ownPops--, true);
      const top = layers.at(-1);
      if (!top || layerOf(history.state) === top.id) return false;
      layers.pop();
      // Holding to ask (unsaved changes): it stays open, with its entry back, and Discard takes it off
      if (top.close() === false) {
        layers.push(top);
        push(top.id);
      }
      return true;
    },
    /** Whether the entry on top is an overlay's: a move to another page from inside one replaces it, not adds to it. */
    onOverlay: () => layerOf(history.state) !== undefined && layers.length > 0,
  };
}

const app = typeof history === "undefined" ? null : backStack(history);

/** An overlay opened: Back closes it (`close`). Call the returned function when it's closed any other way. */
export const closeOnBack = (close: CloseOnBack): (() => void) => app?.open(close) ?? (() => {});
/** For the router's popstate: whether this Back was taken by an overlay. */
export const backClosedOverlay = () => app?.popped() ?? false;
/** For the router's navigate: whether the history's top entry is an open overlay's. */
export const onOverlay = () => app?.onOverlay() ?? false;
