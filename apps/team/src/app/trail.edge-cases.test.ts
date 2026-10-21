// The pages you came through, at their edges: Back with nothing behind, the same page twice, a swap that keeps it.
import { describe, expect, it } from "vitest";
import { walk } from "./trail";

describe("the trail, at its edges", () => {
  it("Back with nothing behind (a reload, a link from outside) is a forward step from where you were", () => {
    expect(walk([], { kind: "pop", to: "/board", from: "/team/1" })).toEqual({ trail: ["/team/1"], back: false });
  });

  it("a page opened from itself is on the trail twice, and Back walks each", () => {
    let t = walk([], { kind: "open", from: "/board" }).trail;
    t = walk(t, { kind: "open", from: "/board" }).trail;
    expect(t).toEqual(["/board", "/board"]);
    const back = walk(t, { kind: "pop", to: "/board", from: "/board" });
    expect(back).toEqual({ trail: ["/board"], back: true });
  });

  it("never changes the trail it was given", () => {
    const t = Object.freeze(["/a", "/b"]);
    walk(t, { kind: "open", from: "/c" });
    walk(t, { kind: "pop", to: "/b", from: "/c" });
    walk(t, { kind: "replace" });
    expect(t).toEqual(["/a", "/b"]);
  });
});
