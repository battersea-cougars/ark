// A photo grid shows only whole rows (PhotoStrip on the home page, /photos/): a photo left alone on the last row looks
// dropped, so the last row's leftovers are hidden, and shown again when a resize gives the grid other columns.

/**
 * How many of `count` photos fill whole rows of `columns`, with `extraCells` more cells taken by big tiles (the home
 * strip's first photo spans four cells: three extra). Fewer than a row: all of them, rather than none.
 */
export function photosForFullRows(count: number, columns: number, extraCells = 0): number {
  for (let shown = count; shown > 0; shown--) if ((shown + extraCells) % columns === 0) return shown;
  return count;
}

/** Keeps `list`'s items to whole rows of its grid's columns, now, when its size changes, and when a photo leaves it. */
export function keepFullRows(list: HTMLElement, extraCells = 0): void {
  const fit = () => {
    const items = [...list.children] as HTMLElement[];
    const columns = getComputedStyle(list).gridTemplateColumns.split(" ").filter(Boolean).length || 1;
    const shown = photosForFullRows(items.length, columns, extraCells);
    items.forEach((item, i) => (item.hidden = i >= shown));
  };
  fit();
  new ResizeObserver(fit).observe(list);
  new MutationObserver(fit).observe(list, { childList: true });
}
