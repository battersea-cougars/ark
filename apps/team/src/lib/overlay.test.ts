import { describe, expect, it, vi } from "vitest";
import { backdropClicks, lockScroll, outside, rememberFocus, requestClose } from "./overlay";

// The close contract every drawer and sheet keeps (lib/Drawer, lib/Sheet): one way out a guard can hold, a full
// click on the backdrop, the page locked under it, focus back where it was.
describe("closing a drawer or sheet", () => {
  it("closes at once when nothing holds it", () => {
    const close = vi.fn();
    expect(requestClose(close)).toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });

  it("asks first when its form has unsaved changes, and closes only on Discard", () => {
    const close = vi.fn();
    let discard: (() => void) | undefined;
    const guard = (leave: () => void) => ((discard = leave), true);
    expect(requestClose(close, guard)).toBe(false);
    expect(close).not.toHaveBeenCalled();
    discard!();
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes when the guard has nothing to ask", () => {
    const close = vi.fn();
    expect(requestClose(close, () => false)).toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });

  it("goes the same way for Escape, the ×, the backdrop and a swipe: each calls requestClose", () => {
    // Escape is the native dialog's cancel, sent to the top one only; the drawer prevents its default and asks
    const close = vi.fn();
    const guard = vi.fn(() => true);
    for (let i = 0; i < 4; i++) requestClose(close, guard);
    expect(guard).toHaveBeenCalledTimes(4);
    expect(close).not.toHaveBeenCalled();
  });
});

describe("a click on the dimmed page", () => {
  const box = { left: 100, top: 0, right: 500, bottom: 800 };

  it("is on the backdrop only outside the drawer's box", () => {
    expect(outside(box, 50, 400)).toBe(true);
    expect(outside(box, 300, 400)).toBe(false);
    expect(outside(box, 300, 900)).toBe(true);
  });

  it("closes when pressed and let go there", () => {
    const clicks = backdropClicks();
    clicks.press(true);
    expect(clicks.release(true)).toBe(true);
  });

  it("doesn't close when a drag starts inside (selecting a field's text) and ends outside", () => {
    const clicks = backdropClicks();
    clicks.press(false);
    expect(clicks.release(true)).toBe(false);
  });

  it("doesn't close when pressed outside and let go inside", () => {
    const clicks = backdropClicks();
    clicks.press(true);
    expect(clicks.release(false)).toBe(false);
  });

  it("forgets the press once it's let go: a later click starting inside doesn't count the old one", () => {
    const clicks = backdropClicks();
    clicks.press(true);
    clicks.release(false);
    expect(clicks.release(true)).toBe(false);
  });
});

describe("the page under it", () => {
  const root = () => ({ style: { overflow: "", scrollbarGutter: "" }, clientWidth: 1270 });

  it("stops scrolling while one is open, keeping a desktop scrollbar's room so nothing moves", () => {
    const r = root();
    const unlock = lockScroll(r, 1280);
    expect(r.style).toEqual({ overflow: "hidden", scrollbarGutter: "stable" });
    unlock();
    expect(r.style).toEqual({ overflow: "", scrollbarGutter: "" });
  });

  it("keeps no room where there's no scrollbar (a phone's overlay bars)", () => {
    const r = { ...root(), clientWidth: 375 };
    const unlock = lockScroll(r, 375);
    expect(r.style.scrollbarGutter).toBe("");
    unlock();
  });

  it("stays locked until the last of stacked ones closes (a sheet over a drawer), each unlock counting once", () => {
    const r = root();
    const drawer = lockScroll(r, 1280);
    const sheet = lockScroll(r, 1280);
    sheet();
    sheet();
    expect(r.style.overflow).toBe("hidden");
    drawer();
    expect(r.style.overflow).toBe("");
  });

  it("gets focus back on what opened it", () => {
    const opener = { focus: vi.fn(), isConnected: true };
    rememberFocus(opener as unknown as Element)();
    expect(opener.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("leaves focus alone when the opener has gone from the page, with nothing near it to take it", () => {
    const opener = { focus: vi.fn(), isConnected: false };
    rememberFocus(opener as unknown as Element)();
    expect(opener.focus).not.toHaveBeenCalled();
  });

  /** Focusable things in page order, as `document.querySelectorAll` gives them; each still there and shown or not. */
  function page(...things: { connected?: boolean; shown?: boolean; disabled?: boolean }[]) {
    const all: Record<string, unknown>[] = [];
    const doc = { querySelectorAll: () => all };
    for (const { connected = true, shown = true, disabled = false } of things)
      all.push({
        focus: vi.fn(),
        isConnected: connected,
        disabled,
        ownerDocument: doc,
        getClientRects: () => (shown ? [{}] : []),
      });
    return all as unknown as (Element & { focus: ReturnType<typeof vi.fn> })[];
  }

  it("its row removed (the last award, a player taken off): focus goes to what came next, the list's Add", () => {
    const [before, opener, add] = page({}, {}, {});
    const back = rememberFocus(opener);
    Object.assign(opener, { isConnected: false });
    back();
    expect(add.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(before.focus).not.toHaveBeenCalled();
  });

  it("the Add that opened it gone at the cap: focus goes to the row just before it, skipping what's hidden or off", () => {
    const [row, opener, hidden, off] = page({}, {}, { shown: false }, { disabled: true });
    const back = rememberFocus(opener);
    Object.assign(opener, { isConnected: false });
    back();
    expect(row.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(hidden.focus).not.toHaveBeenCalled();
    expect(off.focus).not.toHaveBeenCalled();
  });
});
