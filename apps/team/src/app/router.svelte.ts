// Client-side history routing. Links are plain <a href>; the shell intercepts same-origin clicks.
import { untrack } from "svelte";
import { movedTo, type TabId } from "./nav-routes";
import { walk, type Move } from "./trail";

const LAST_KEY = "team.mobile.last";

function readLast(): Partial<Record<TabId, string>> {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY) ?? "{}");
  } catch {
    return {};
  }
}

/**
 * `from`: the page this one was opened from, in the app, along the trail (#86); null after a reload, or once Back has
 * walked the trail to its start. `back`: this page was reached by going back, so it opens where you left it.
 */
// An old link (Teammates is the club now) opens where its page lives, as if it had always been there
const arrived = movedTo(location.pathname);
if (arrived) history.replaceState({}, "", arrived);
export const router = $state({ path: location.pathname, last: readLast(), from: null as string | null, back: false });

let trail: string[] = [];
function moved(move: Move) {
  const next = walk(trail, move);
  trail = next.trail;
  router.from = trail.at(-1) ?? null;
  router.back = next.back;
}

/**
 * Something open with unsaved changes (lib/dirty.svelte.ts) may hold a move to another page: it asks first, returns
 * true, and makes the move itself if the answer is to discard them.
 */
let holding: ((go: () => void) => boolean) | null = null;
export function holdLeaving(hold: (go: () => void) => boolean) {
  holding = hold;
}

export function navigate(to: string, { replace = false } = {}) {
  const path = movedTo(to) ?? to;
  if (path === router.path) return;
  if (holding?.(() => navigate(to, { replace }))) return;
  if (replace) {
    history.replaceState({}, "", path);
    moved({ kind: "replace" });
  } else {
    history.pushState({}, "", path);
    moved({ kind: "open", from: router.path });
  }
  router.path = path;
}

/** Back where you came from, in the app; else to `fallback` (a reload, a link from outside). */
export function goBack(fallback: string) {
  if (router.from) history.back();
  else navigate(fallback, { replace: true });
}

/** Called from an effect: untracked, so writing `last` doesn't re-run the effect that called it. */
export function remember(tab: TabId, path: string) {
  untrack(() => {
    if (router.last[tab] === path) return;
    router.last = { ...router.last, [tab]: path };
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify(router.last));
    } catch {
      // Private mode: tabs just start at their first page.
    }
  });
}

addEventListener("popstate", () => {
  // Back (the browser's, a phone's swipe) with unsaved changes: back on this page while it asks; Discard goes back again
  if (location.pathname !== router.path && holding?.(() => history.back())) {
    history.pushState({}, "", router.path);
    return;
  }
  moved({ kind: "pop", to: location.pathname, from: router.path });
  router.path = location.pathname;
});

/** Delegated click handler: route same-origin links without a reload. */
export function interceptLinks(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
  const a = (event.target as Element).closest("a");
  if (!a || a.target || a.hasAttribute("download") || a.origin !== location.origin) return;
  event.preventDefault();
  navigate(a.pathname);
}
