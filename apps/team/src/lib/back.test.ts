import { describe, expect, it, vi } from "vitest";
import { backStack } from "./back";

/** A browser's history for one page: entries, where we are, and a popstate (`pops`) after each Back. */
function fakeHistory() {
  const entries: unknown[] = [{}];
  let at = 0;
  const pops: (() => void)[] = [];
  const h = {
    get state() {
      return entries[at];
    },
    pushState(data: unknown) {
      entries.splice(at + 1, entries.length, data);
      at++;
    },
    replaceState(data: unknown) {
      entries[at] = data;
    },
    back() {
      if (at === 0) return;
      at--;
      pops.forEach((p) => p());
    },
    get length() {
      return at + 1;
    },
  };
  return { h, onPop: (p: () => void) => pops.push(p) };
}

/** The router's popstate: counts the Backs that weren't an overlay's (a move between pages). */
function world() {
  const { h, onPop } = fakeHistory();
  const stack = backStack(h);
  const moves = vi.fn();
  onPop(() => {
    if (!stack.popped()) moves();
  });
  return { h, stack, moves };
}

// Back (Android's gesture, the browser's, the app's) closes the sheet, drawer or card on top, and stays on the page.
describe("Back with an overlay open", () => {
  it("closes it and stays on the page", () => {
    const { h, stack, moves } = world();
    const close = vi.fn();
    stack.open(close);
    h.back();
    expect(close).toHaveBeenCalledOnce();
    expect(moves).not.toHaveBeenCalled();
    expect(h.length).toBe(1);
  });

  it("closed by its ×, it takes its own entry off: the next Back leaves the page", () => {
    const { h, stack, moves } = world();
    const close = vi.fn();
    const closedAnotherWay = stack.open(close);
    closedAnotherWay();
    expect(h.length).toBe(1);
    expect(moves).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    h.back(); // at the start of this fake history: nothing
    expect(close).not.toHaveBeenCalled();
  });

  it("closes the top one only: a sheet opened from a drawer, then the drawer", () => {
    const { h, stack } = world();
    const drawer = vi.fn();
    const sheet = vi.fn();
    const closeDrawer = stack.open(drawer);
    const closeSheet = stack.open(sheet);
    h.back();
    expect(sheet).toHaveBeenCalledOnce();
    expect(drawer).not.toHaveBeenCalled();
    closeSheet(); // the sheet's own close running after Back: nothing more
    expect(h.length).toBe(2);
    h.back();
    expect(drawer).toHaveBeenCalledOnce();
    closeDrawer();
    expect(h.length).toBe(1);
  });

  it("with unsaved changes it stays open to ask, and Back is ready to close it again", () => {
    const { h, stack, moves } = world();
    let asking = true;
    const close = vi.fn(() => !asking);
    const closedAnotherWay = stack.open(close);
    h.back();
    expect(close).toHaveBeenCalledOnce();
    expect(moves).not.toHaveBeenCalled();
    expect(h.length).toBe(2);
    // Discard: it closes, and takes its entry off
    asking = false;
    closedAnotherWay();
    expect(h.length).toBe(1);
    expect(moves).not.toHaveBeenCalled();
  });

  it("a page opened from inside one replaces its entry, so it isn't closed by a later Back", () => {
    const { h, stack } = world();
    const close = vi.fn();
    const closedAnotherWay = stack.open(close);
    expect(stack.onOverlay()).toBe(true);
    // The router puts the new page in the overlay's entry
    h.replaceState({});
    closedAnotherWay(); // unmounted as the page changed: no Back of its own
    expect(h.length).toBe(2);
    expect(close).not.toHaveBeenCalled();
  });

  it("with nothing open, Back is the router's", () => {
    const { h, moves } = world();
    h.pushState({});
    h.back();
    expect(moves).toHaveBeenCalledOnce();
  });
});
