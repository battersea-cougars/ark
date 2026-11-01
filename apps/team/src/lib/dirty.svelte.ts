// A Save form's unsaved and saved state (ADR 0065), held by whatever owns the form's overlay and handed to three
// places: the form, which says what to compare (`watch`) and saves through `run`; the overlay (lib/Drawer, lib/Sheet,
// lib/EditorPanel), whose every way out asks `guard` first; and its footer (lib/SaveBar), which says where it stands.
//
//   const edits = new Edits();                       // the overlay's owner
//   edits.watch(() => form);                         // the form, as it starts
//   await edits.run(() => updateThing(form));         // its save: clean again, "Saved ✓ · just now"
//   <Drawer {edits} …> {#snippet footer()}<SaveBar {edits} form="thing-form" />{/snippet}
//
// While any form is unsaved, leaving the page in the app asks the same question, and closing the tab asks the
// browser's (beforeunload).
import { untrack } from "svelte";
import { saving } from "../app/backend.svelte";
import { holdLeaving } from "../app/router.svelte";
import { FormOwner, fingerprint, type SaveState } from "./dirty";

// Read only on a way out (beforeunload, a move), never drawn: a plain set, not a reactive one
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const open = new Set<Edits>();
/** The form with unsaved changes most recently opened, if any. */
const unsaved = () => [...open].reverse().find((e) => e.dirty);

if (typeof window !== "undefined") {
  addEventListener("beforeunload", (e) => {
    if (!unsaved()) return;
    e.preventDefault();
    e.returnValue = "";
  });
  holdLeaving((go) => {
    const edits = unsaved();
    return edits ? edits.guard(go) : false;
  });
}

export class Edits {
  /** What the form's values are now; null until a form is watched. */
  #read = $state.raw<(() => unknown) | null>(null);
  /** Which form that is, kept out of reactive state so a teardown sees the truth (lib/dirty.ts FormOwner). */
  #owner = new FormOwner<() => unknown>();
  #now = $derived(this.#read ? fingerprint(this.#read()) : "");
  #base = $state("");
  #then: (() => void) | null = null;
  busy = $state(false);
  savedAt = $state<number | null>(null);
  problem = $state("");
  asking = $state(false);
  /** A new one, not saved yet: Save works from the start. */
  fresh = $state(false);

  constructor() {
    $effect(() => {
      open.add(this);
      return () => void open.delete(this);
    });
  }

  get dirty(): boolean {
    return this.#read !== null && this.#now !== this.#base;
  }

  get state(): SaveState {
    const { dirty, busy, savedAt, problem, asking, fresh } = this;
    return { dirty, busy, savedAt, problem, asking, fresh };
  }

  /**
   * Called as the form starts (in its component's setup): `read` gives its values, and what they are now is clean.
   * Done when the form goes, unless another form has taken over by then (lib/dirty.ts FormOwner). `fresh`: a new one,
   * not saved yet.
   */
  watch(read: () => unknown, { fresh = false }: { fresh?: boolean } = {}) {
    const release = this.#owner.claim(read);
    this.#load(read, fresh);
    $effect(() => () => {
      if (release()) this.#load(null, false);
    });
  }

  /** The one place the form and its baseline change: together, so what's loaded is what's clean. */
  #load(read: (() => unknown) | null, fresh: boolean) {
    this.#read = read;
    this.fresh = fresh;
    this.problem = "";
    this.reset();
  }

  /** What's on screen now is what's saved (after a save, or a form loaded afresh). */
  reset() {
    untrack(() => (this.#base = this.#now));
  }

  /**
   * Save through this: on success it's clean and says when; on failure (null or false back) it stays unsaved and says
   * what went wrong. Returns what the save returned.
   */
  async run<T>(change: () => Promise<T>): Promise<T> {
    this.busy = true;
    this.problem = "";
    try {
      const result = await change();
      if (result === null || result === false) {
        this.problem = saving.message || "Couldn't save.";
        return result;
      }
      this.reset();
      this.savedAt = Date.now();
      return result;
    } finally {
      this.busy = false;
    }
  }

  /**
   * Every way out of the form's overlay comes here (lib/overlay.ts's CloseGuard): unsaved, it asks and returns
   * true, and `leave` happens only on Discard; otherwise false, and the caller leaves.
   */
  guard = (leave: () => void): boolean => {
    if (!this.dirty) return false;
    this.#then = leave;
    this.asking = true;
    return true;
  };

  /** "Keep editing": back to the form. */
  keep() {
    this.asking = false;
    this.#then = null;
  }

  /** "Discard": what was typed goes, and so does the overlay (or the page). */
  discard() {
    const then = this.#then;
    this.asking = false;
    this.#then = null;
    this.reset();
    then?.();
  }

  /** Closed: the next opening starts with nothing to say. */
  closed() {
    this.asking = false;
    this.#then = null;
    this.savedAt = null;
    this.problem = "";
  }
}
