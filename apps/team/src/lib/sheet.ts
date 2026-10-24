// The phone's one overlay (ADR 0065): every sheet, drawer and editor panel is a bottom sheet below the 900px
// breakpoint. These are the choices lib/Sheet, lib/Drawer and lib/EditorPanel make, kept here to be tested.

/**
 * Whether a drawer or panel is drawn as the phone's bottom sheet. Decided as it opens and kept while it's open, so a
 * window resized across the breakpoint doesn't swap the layer (and lose what's typed in it) under your hands.
 */
export function drawnAsSheet(open: boolean, wasSheet: boolean, isPhone: boolean): boolean {
  return open ? wasSheet : isPhone;
}

/** How far down (px) a sheet's handle is pulled before letting go closes it: a quarter of it, at most 120px. */
export function swipeDistance(height: number): number {
  return Math.min(120, height / 4);
}

/** Letting go of a sheet pulled down `dy` px in `ms`: far enough, or flicked down fast, closes it. */
export function swipeCloses(dy: number, ms: number, height: number): boolean {
  if (dy <= 0) return false;
  const flick = ms > 0 && dy / ms > 0.6 && dy > 24;
  return flick || dy >= swipeDistance(height);
}
