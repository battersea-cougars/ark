// Where a list that drops from a field goes (PersonPicker): under it when there's room, over it when there's more
// room there. "Room" is what's on screen: on a phone with the keyboard up that's the visual viewport (above the
// keyboard), not the window, which still runs down behind the keyboard, so a list placed by the window opened out of
// sight until the keyboard was closed.

/** The part of the window that's on screen, in the same coordinates as getBoundingClientRect. */
export interface Visible {
  top: number;
  bottom: number;
}

/** What's on screen now: above the keyboard, where the browser says (visualViewport); else the whole window. */
export function visibleArea(): Visible {
  const vv = globalThis.visualViewport;
  if (!vv) return { top: 0, bottom: innerHeight };
  return { top: vv.offsetTop, bottom: vv.offsetTop + vv.height };
}

const GAP = 6;
const EDGE = 12;
/** Below this much room under the field, the list goes over it if there's more room there. */
const ENOUGH = 180;
const TALLEST = 300;

/** The list's box, fixed-position: under or over the field, as tall as fits, never past what's on screen. */
export function menuPlace(field: { top: number; bottom: number; left: number; width: number }, visible: Visible) {
  const below = visible.bottom - field.bottom - GAP - EDGE;
  const above = field.top - visible.top - GAP - EDGE;
  const up = below < ENOUGH && above > below;
  const height = Math.max(0, Math.min(TALLEST, up ? above : below));
  const top = up ? Math.max(visible.top + EDGE, field.top - GAP - height) : field.bottom + GAP;
  return {
    top: Math.round(top),
    left: Math.round(field.left),
    width: Math.round(field.width),
    height: Math.round(height),
  };
}
