// Unsaved changes and saved ones (ADR 0065): every Save form compares what's on screen with what it loaded, and its
// footer (lib/SaveBar) says which it is. The reactive part, which a form holds, is lib/dirty.svelte.ts; what's here is
// the logic it runs on, kept apart to be tested.
import { formatTime } from "./dates";

/**
 * What a form's values come to, to compare: the same values give the same string, whatever order their keys were
 * set in. `undefined` is the same as missing (as JSON has it).
 */
export function fingerprint(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v as object)
            .sort()
            .map((k) => [k, (v as Record<string, unknown>)[k]]),
        )
      : v,
  );
}

/** "just now" for the first minute after a save, then its time ("2:05pm", London). */
export function savedWhen(at: number, now: number): string {
  return now - at < 60_000 ? "just now" : formatTime(new Date(at).toISOString());
}

export interface SaveState {
  /** What's on screen differs from what was loaded (or last saved). */
  dirty: boolean;
  /** Being saved now. */
  busy: boolean;
  /** When it was last saved in this sitting, if it was. */
  savedAt: number | null;
  /** The last save's failure, said in words. */
  problem: string;
  /** Closing with changes: asking first. */
  asking: boolean;
  /** Not saved yet at all (a new one): Save works from the start, since a blank one may be all it needs. */
  fresh: boolean;
}

export type FootNote =
  | { kind: "asking"; text: string }
  | { kind: "busy"; text: string }
  | { kind: "failed"; text: string }
  | { kind: "dirty"; text: string }
  | { kind: "saved"; text: string }
  | { kind: "clean"; text: string };

/** What a Save footer says, beside the button. One line, always there (empty is a space), so nothing moves. */
export function footNote(s: SaveState, now: number): FootNote {
  if (s.asking) return { kind: "asking", text: "Discard your changes?" };
  if (s.busy) return { kind: "busy", text: "Saving…" };
  if (s.problem) return { kind: "failed", text: `Not saved: ${s.problem}` };
  if (s.dirty) return { kind: "dirty", text: "Unsaved changes" };
  if (s.savedAt !== null) return { kind: "saved", text: `Saved ✓ · ${savedWhen(s.savedAt, now)}` };
  return { kind: "clean", text: s.fresh ? "" : "No changes" };
}

/** Save is the main button while there's something to save (or a new one); otherwise it's quiet and off. */
export function canSave(s: SaveState): boolean {
  return !s.busy && (s.dirty || s.fresh);
}

/**
 * Which form an overlay's save state belongs to now (lib/dirty.svelte.ts). One overlay can show one form after
 * another (a new tournament's editor gives way to the saved one's in the same panel), and the old form lets go only
 * after the new one has taken over, so letting go must never undo the new one's claim. Kept in a plain field, never
 * in reactive state: a Svelte teardown reads state as it was before the flush that tore it down, so a teardown that
 * asked reactive state "is it still mine?" was told yes by the old form and wiped the new one's (Save stayed off
 * after a Kumite was scheduled and a captain added).
 */
export class FormOwner<T> {
  #current: T | null = null;

  get current(): T | null {
    return this.#current;
  }

  /** `form` is the one now; the returned function lets go, and does nothing once another form has claimed it. */
  claim(form: T): () => boolean {
    this.#current = form;
    return () => {
      if (this.#current !== form) return false;
      this.#current = null;
      return true;
    };
  }
}
