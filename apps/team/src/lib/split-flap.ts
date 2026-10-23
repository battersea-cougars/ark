// A split-flap board's timing (lib/SplitFlap): each character is a flap that turns through a few others before it
// settles on its own, the cells starting a beat apart, left to right, so the word resolves like a departures board
// updating. Seeded by the text, so everyone watching sees the same flaps turn.

/** What a flap can show on its way: a blank, the letters, the figures. */
export const FLAP_CHARS = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
/** How long one flap's turn takes (a fold down and the next half landing), ms. */
export const FLAP_STEP_MS = 60;
/** The most the left-to-right stagger may add, however long the text: long names clack faster, not longer. */
const STAGGER_SPAN_MS = 640;
const STAGGER_MS = 40;

export type FlapCell = {
  /** The character it settles on. */
  char: string;
  /** What it shows, in turn, ending on `char`. */
  seq: string[];
  /** When it starts turning, ms after the board's start. */
  start: number;
};

/** A small seeded generator (mulberry32): 0 ≤ n < 1, the same run for the same seed. */
export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A text's seed: the same words, the same flaps. */
export function seedOf(text: string) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.codePointAt(0)!, 16777619);
  return h >>> 0;
}

/**
 * The characters one cell shows before settling on `target`: 3 to 6 others from FLAP_CHARS (never the target, never
 * the same twice running), then the target.
 */
export function flapSequence(target: string, next: () => number): string[] {
  const turns = 3 + Math.floor(next() * 4);
  const seq: string[] = [];
  while (seq.length < turns) {
    const c = FLAP_CHARS[Math.floor(next() * FLAP_CHARS.length)];
    if (c !== target && c !== seq[seq.length - 1]) seq.push(c);
  }
  return [...seq, target];
}

/** The board for a text: its words (they wrap whole), a cell per character, upper case. */
export function flapBoard(text: string): FlapCell[][] {
  const words = text.toUpperCase().split(/\s+/).filter(Boolean);
  const count = words.reduce((n, w) => n + [...w].length, 0);
  const stagger = count > 1 ? Math.min(STAGGER_MS, STAGGER_SPAN_MS / (count - 1)) : 0;
  const next = seeded(seedOf(text));
  let k = 0;
  return words.map((w) =>
    [...w].map((char) => ({ char, seq: flapSequence(char, next), start: Math.round(k++ * stagger) })),
  );
}

/** How long a text takes to settle, ms from its start (its last cell's last turn done). */
export function flapMs(text: string) {
  return flapBoard(text)
    .flat()
    .reduce((ms, c) => Math.max(ms, c.start + c.seq.length * FLAP_STEP_MS), 0);
}

/** What a cell shows `at` ms into the board: a blank before it starts, its flaps in turn, then its character. */
export function flapAt(cell: FlapCell, at: number) {
  const k = Math.floor((at - cell.start) / FLAP_STEP_MS);
  if (k < 0) return " ";
  return cell.seq[Math.min(k, cell.seq.length - 1)];
}
