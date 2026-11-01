// An editor panel opens over the page in the page's own column (desktop): the same left edge and width as the
// cards under it, so it reads as the thing it opened from, grown, not a box of some other size. The column is the
// page's frame less its gutters, at the reading width unless the page is .full (app.css). Phones keep the panel full
// screen, so this only gives --col-left and --col-width for the desktop CSS to use. Read when the panel is created,
// before it's laid out, so its opening motion starts from the right box, and again when the window is resized.
const READING_REM = 52;

export function column(): { left: number; width: number } | null {
  // The page itself, never a drawer in it (lib/Drawer's editor mode is .drawer.page too: measuring that gave a
  // column no wider than the closed drawer, and an editor that opened as a sliver)
  const pages = document.querySelectorAll<HTMLElement>(".view .page:not(dialog)");
  const page = pages[pages.length - 1];
  if (!page) return null;
  const r = page.getBoundingClientRect();
  const cs = getComputedStyle(page);
  const left = r.left + parseFloat(cs.paddingLeft);
  const inner = r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const width = page.classList.contains("full") ? inner : Math.min(inner, READING_REM * rem);
  return { left, width };
}

/** The page column as CSS variables for the panel's style attribute ("" when there's no page). */
export function pageColumnStyle(): string {
  const c = column();
  return c ? `--col-left: ${c.left}px; --col-width: ${c.width}px` : "";
}
