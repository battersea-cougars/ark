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

  let listH = 0;
  // While the block glides (a phone's bar hiding or coming back moves where it sticks), the rows keep with it
  let gliding = 0;
  let extraNow = -1;
  /** The spacer: the rows that don't fit the box at its usual height (a phone's hidden bar makes it taller for a
     while; the page's length doesn't change for that, or hiding the bar would shorten the page under you) */
  const extra = () => {
    let rows = 0;
    for (const child of box.children) rows += child.getBoundingClientRect().height;
    const now = Math.max(0, Math.ceil(rows - listH));
    if (now === extraNow) return;
    node.style.setProperty("--list-extra", `${(extraNow = now)}px`);
    requestAnimationFrame(settle);
  };

  /** A tab or a search shortened the list while a phone's bar is hidden: the page pulls back to where the table
     sticks under the bar, short of where it sticks in the bar's room. Scroll it the rest of the way, so the table
     stays at the top and the bar stays hidden */
  const settle = () => {
    if (gliding || !node.closest(".bar-tucked") || stuck.offsetTop > 0) return;
    const v = view.getBoundingClientRect().top + (parseFloat(getComputedStyle(view).paddingTop) || 0);
    const at = stuck.getBoundingClientRect().top - v;
    const want = parseFloat(getComputedStyle(stuck).top) || 0;
    if (at <= 0 && at > want + 1) view.scrollTop += at - want;
  };

  /** The rows scroll by as much as the page has pushed the stuck block down its wrapper (its sticky offset) */
  const sync = () => {
    extra(); // (rows settle after they're dealt in: a scroll is the moment to catch up)
    box.scrollTop = Math.max(0, stuck.offsetTop);
  };

  /** The box: the height left under the tabs */
  const size = () => {
    const v = getComputedStyle(view);
    const inner = view.clientHeight - (parseFloat(v.paddingTop) || 0) - (parseFloat(v.paddingBottom) || 0);
    // Everything of the stuck block that isn't the box: above it (the tabs, an edge) and below it (an edge)
    const above = box.getBoundingClientRect().top - stuck.getBoundingClientRect().top;
    const edge = parseFloat(getComputedStyle(stuck).borderBottomWidth) || 0;
    const below = (parseFloat(getComputedStyle(page).paddingBottom) || 0) + edge;
    listH = Math.max(0, Math.floor(inner - dockedRow(page) - above - below));
    node.style.setProperty("--list-h", `${listH}px`);
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

  let frame = 0;
  const follow = () => {
    sync();
    frame = gliding > 0 ? requestAnimationFrame(follow) : 0;
  };
  const glide = (e: TransitionEvent) => {
    if (e.target !== stuck && e.target !== box) return;
    gliding = Math.max(0, gliding + (e.type === "transitionrun" ? 1 : -1));
    if (gliding && !frame) frame = requestAnimationFrame(follow);
    if (!gliding) sync();
  };
  const glides = ["transitionrun", "transitionend", "transitioncancel"] as const;
  for (const type of glides) node.addEventListener(type, glide);

  size();
  watch();
  const resized = new ResizeObserver(size);
  resized.observe(view);
  view.addEventListener("scroll", sync, { passive: true });
  return {
    destroy() {
      for (const type of glides) node.removeEventListener(type, glide);
      cancelAnimationFrame(frame);
      view.removeEventListener("scroll", sync);
      resized.disconnect();
      grew.disconnect();
      changed.disconnect();
      node.style.removeProperty("--list-h");
      node.style.removeProperty("--list-extra");
    },
  };
}
