// The pages you came through, in the app: each one opened from another is pushed, and Back walks it back, so a
// team opened from The board goes back to The board, and a matchup opened from that team goes back to the team, then
// the board. Kept beside the browser's own history, which can't be read; a reload starts it again (empty: Back goes to
// the page's section instead).

/** What moved: a link opened in the app, the browser's back or forward, or a page swapped in place. */
export type Move = { kind: "open"; from: string } | { kind: "pop"; to: string; from: string } | { kind: "replace" };

/** The trail after a move, and whether it was a step back along it. */
export function walk(trail: readonly string[], move: Move): { trail: string[]; back: boolean } {
  if (move.kind === "replace") return { trail: [...trail], back: false };
  if (move.kind === "open") return { trail: [...trail, move.from], back: false };
  // The browser's back to the page before: one step back along the trail
  if (trail.at(-1) === move.to) return { trail: trail.slice(0, -1), back: true };
  // Its forward (or a jump the trail doesn't know): as if opened from where we were
  return { trail: [...trail, move.from], back: false };
}
