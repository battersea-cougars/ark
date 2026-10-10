// A long list under a page's header, with one scroller, the page. The page scrolls until the list's tabs and search
// reach the top; from there it keeps scrolling, by the height of the rows that don't fit, and the list's box, stuck
// under the tabs and exactly the height left, shows the rows passing by. A wheel anywhere on the page, or one
// swipe, does the lot: nothing hands over to a second scroller, and the tabs never let go.
//
// - `.stuck` (the tabs, `.list-tabs`, and the box, `.list-box`) is `position: sticky` (the page's CSS). The box is
//   the height left under the tabs (`--list-h`) and clips its list.
// - `.list-spacer` after it is as tall as the rows that don't fit (`--list-extra`): the page's scroll past the stick
//   point. On each scroll, the box scrolls by how far the stuck block has been pushed down its wrapper, which is
//   exactly that.
//
// Use: <div class="hybrid" use:listScroll>
//        <div class="stuck"> <div class="list-tabs"/> <div class="list-box"> the list </div> </div>
//        <div class="list-spacer"></div>
//      </div>

/** Room the docked toolbar row takes on a desktop page that has one (PageHeader: its sticky top, it, and a gap). */
function dockedRow(page: Element | null): number {
  const row = page?.querySelector<HTMLElement>(":scope > .page-toolbar");
  if (!row || getComputedStyle(row).position !== "sticky") return 0;
  return (parseFloat(getComputedStyle(row).top) || 0) * 2 + row.offsetHeight;
}

export function listScroll(node: HTMLElement) {
  const view = node.closest<HTMLElement>(".view");
  const page = node.closest<HTMLElement>(".page");
  const stuck = node.querySelector<HTMLElement>(":scope > .stuck");
  const box = node.querySelector<HTMLElement>(".list-box");
  if (!view || !page || !stuck || !box) return {};

  let extraNow = -1;
  /** The spacer: the rows that don't fit the box */
  const extra = () => {
    const now = Math.max(0, box.scrollHeight - box.clientHeight);
    if (now !== extraNow) node.style.setProperty("--list-extra", `${(extraNow = now)}px`);
  };

  /** The rows scroll by as much as the page has pushed the stuck block down its wrapper */
  const sync = () => {
    extra(); // (rows settle after they're dealt in: a scroll is the moment to catch up)
    box.scrollTop = Math.max(0, stuck.getBoundingClientRect().top - node.getBoundingClientRect().top);
  };

  /** The box: the height left under the tabs */
  const size = () => {
    const v = getComputedStyle(view);
    const inner = view.clientHeight - (parseFloat(v.paddingTop) || 0) - (parseFloat(v.paddingBottom) || 0);
    // Everything of the stuck block that isn't the box: above it (the tabs, an edge) and below it (an edge)
    const above = box.getBoundingClientRect().top - stuck.getBoundingClientRect().top;
    const edge = parseFloat(getComputedStyle(stuck).borderBottomWidth) || 0;
    const below = (parseFloat(getComputedStyle(page).paddingBottom) || 0) + edge;
    node.style.setProperty("--list-h", `${Math.max(0, Math.floor(inner - dockedRow(page) - above - below))}px`);
    sync();
  };

  // The rows change (a tab, a search, someone signing up): watch what's in the box, and the list itself in it
  const grew = new ResizeObserver(sync);
  const watch = () => {
    grew.disconnect();
    for (const el of [...box.children, ...box.querySelectorAll(".list, .cards")]) grew.observe(el);
    sync();
  };
  const changed = new MutationObserver(watch);
  changed.observe(box, { childList: true, subtree: true });

  size();
  watch();
  const resized = new ResizeObserver(size);
  resized.observe(view);
  view.addEventListener("scroll", sync, { passive: true });
  return {
    destroy() {
      view.removeEventListener("scroll", sync);
      resized.disconnect();
      grew.disconnect();
      changed.disconnect();
      node.style.removeProperty("--list-h");
      node.style.removeProperty("--list-extra");
    },
  };
}
