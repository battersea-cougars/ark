// A masonry photo grid (the home strip, /photos/): every photo keeps its own shape (square, portrait or landscape, as
// on Instagram), in order left to right, packed with no gaps. The grid's rows are a few pixels each, and every tile
// spans as many as its photo's height at its width needs; worked out again as pictures load, the width changes or a
// photo leaves. Without JavaScript the CSS's square tiles stand.

const ROW_PX = 4;

/** The rows a tile spans: its photo's height at `width` (height ÷ width as `ratio`; 0, not loaded yet: square). */
export function rowSpan(width: number, ratio: number, row = ROW_PX, gap = 0): number {
  const height = width * (ratio || 1);
  return Math.max(1, Math.ceil((height + gap) / (row + gap)));
}

/** Lays `list`'s tiles out as masonry, and keeps them so. */
export function masonry(list: HTMLElement): void {
  list.style.gridAutoRows = `${ROW_PX}px`;
  // Each tile into the first hole that fits, so tall ones leave no gaps behind them
  list.style.gridAutoFlow = "dense";
  list.dataset.masonry = "";
  const fit = () => {
    const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
    for (const tile of list.children as HTMLCollectionOf<HTMLElement>) {
      const img = tile.querySelector("img");
      const ratio = img?.naturalWidth ? img.naturalHeight / img.naturalWidth : 1;
      tile.style.gridRowEnd = `span ${rowSpan(tile.getBoundingClientRect().width, ratio, ROW_PX, gap)}`;
    }
  };
  fit();
  list.addEventListener("load", fit, true);
  new ResizeObserver(fit).observe(list);
  new MutationObserver(fit).observe(list, { childList: true });
}
