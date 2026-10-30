// A justified photo strip (the home page's latest photos): photos in rows, each row scaled to exactly the strip's
// width, so both sides and the bottom are straight, every photo shows, and each keeps its own shape (square, portrait
// or landscape, as on Instagram). The photos are split into rows, in order, as evenly as their shapes allow, so the
// rows come out alike in height; the last row is full like the rest. Worked out again as pictures load, the width
// changes or a photo leaves. Without JavaScript the CSS's square tiles stand.

/** Splits `ratios` (width ÷ height), in order, into `rows` runs whose sums are as even as can be (least sum of squares,
 *  so no row much wider, or narrower, than the rest). */
export function partition(ratios: number[], rows: number): number[][] {
  const n = ratios.length;
  const k = Math.max(1, Math.min(rows, n));
  const sum = (a: number, b: number) => ratios.slice(a, b).reduce((s, r) => s + r, 0);
  // cost[j][i]: the least sum of squared row widths for the first i photos in j rows; cut[j][i]: where its last row starts
  const cost = Array.from({ length: k + 1 }, () => Array<number>(n + 1).fill(Infinity));
  const cut = Array.from({ length: k + 1 }, () => Array<number>(n + 1).fill(0));
  cost[0][0] = 0;
  // The cheapest place to start the last of j rows over the first i photos
  const lastRow = (j: number, i: number) => {
    for (let s = j - 1; s < i; s++) {
      const c = cost[j - 1][s] + sum(s, i) ** 2;
      if (c < cost[j][i]) [cost[j][i], cut[j][i]] = [c, s];
    }
  };
  for (let j = 1; j <= k; j++) for (let i = j; i <= n; i++) lastRow(j, i);
  const out: number[][] = [];
  for (let j = k, i = n; j > 0; i = cut[j][i], j--) out.unshift(ratios.slice(cut[j][i], i));
  return out;
}

/** How many rows photos of `ratios` fill at about `target` px tall across `width`: at least one, at most one each. */
export function rowCount(ratios: number[], width: number, target: number): number {
  const total = ratios.reduce((s, r) => s + r, 0);
  return Math.max(1, Math.min(ratios.length, Math.round((total * target) / width)));
}

/** Each row's height, so its photos and the gaps between them come to exactly `width`. */
export function rowHeight(row: number[], width: number, gap: number): number {
  return (width - gap * (row.length - 1)) / row.reduce((s, r) => s + r, 0);
}

/** About how tall a row should be at `width`: more, shorter rows on a phone. */
const targetHeight = (width: number) => (width < 576 ? width / 2.2 : width < 900 ? width / 3.2 : width / 4.2);

/** Lays `list`'s tiles out justified, and keeps them so. */
export function justify(list: HTMLElement): void {
  list.dataset.justified = "";
  let laidWidth = 0;
  const fit = () => {
    const tiles = [...(list.children as HTMLCollectionOf<HTMLElement>)];
    const width = list.clientWidth;
    if (!tiles.length || !width) return;
    laidWidth = width;
    const gap = parseFloat(getComputedStyle(list).columnGap) || 0;
    const ratios = tiles.map((tile) => {
      const img = tile.querySelector("img");
      return img?.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
    });
    let at = 0;
    for (const row of partition(ratios, rowCount(ratios, width, targetHeight(width)))) {
      const height = rowHeight(row, width, gap);
      row.forEach((ratio, i) => {
        const tile = tiles[at++];
        // Whole pixels, the last tile taking up what the rounding leaves, so a row never wraps
        tile.style.height = `${Math.floor(height)}px`;
        tile.style.width = `${Math.floor(ratio * height)}px`;
        tile.style.flexGrow = i === row.length - 1 ? "1" : "0";
      });
    }
  };
  fit();
  list.addEventListener("load", fit, true);
  new ResizeObserver(() => list.clientWidth !== laidWidth && fit()).observe(list);
  new MutationObserver(fit).observe(list, { childList: true });
}
