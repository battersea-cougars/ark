import { describe, expect, it } from "vitest";
import { canSave, fingerprint, footNote, savedWhen, type SaveState } from "./dirty";

const sources = import.meta.glob<string>("../**/*.svelte", { query: "?raw", import: "default", eager: true });

describe("whether a form has unsaved changes", () => {
  it("sees a change, and typing back to what it was makes it clean again", () => {
    const loaded = fingerprint({ name: "Kumite", fee: "15", teams: [{ name: "Dan" }] });
    expect(fingerprint({ name: "Kumite II", fee: "15", teams: [{ name: "Dan" }] })).not.toBe(loaded);
    expect(fingerprint({ name: "Kumite", fee: "15", teams: [{ name: "Dan" }] })).toBe(loaded);
  });

  it("doesn't count the order fields were set in, or a field left undefined", () => {
    expect(fingerprint({ a: 1, b: { c: 2, d: 3 } })).toBe(fingerprint({ b: { d: 3, c: 2 }, a: 1 }));
    expect(fingerprint({ a: 1, b: undefined })).toBe(fingerprint({ a: 1 }));
  });

  it("counts a list's order (teams, awards)", () => {
    expect(fingerprint([1, 2])).not.toBe(fingerprint([2, 1]));
  });
});

describe("what a Save footer says", () => {
  const base: SaveState = { dirty: false, busy: false, savedAt: null, problem: "", asking: false, fresh: false };
  const now = Date.parse("2026-10-23T13:05:00Z");

  it("says nothing's changed while it's as loaded, and Save is off", () => {
    expect(footNote(base, now)).toEqual({ kind: "clean", text: "No changes" });
    expect(canSave(base)).toBe(false);
  });

  it("says Unsaved changes once something is, and Save is on", () => {
    const s = { ...base, dirty: true };
    expect(footNote(s, now)).toEqual({ kind: "dirty", text: "Unsaved changes" });
    expect(canSave(s)).toBe(true);
  });

  it("says Saved ✓ just now after a save, then the time it was saved", () => {
    expect(footNote({ ...base, savedAt: now - 5_000 }, now).text).toBe("Saved ✓ · just now");
    expect(footNote({ ...base, savedAt: now - 5 * 60_000 }, now).text).toBe("Saved ✓ · 2pm");
  });

  it("keeps what went wrong in view when a save fails, and Save stays on to try again", () => {
    const s = { ...base, dirty: true, problem: "Something changed meanwhile." };
    expect(footNote(s, now)).toEqual({ kind: "failed", text: "Not saved: Something changed meanwhile." });
    expect(canSave(s)).toBe(true);
  });

  it("asks before closing with changes", () => {
    expect(footNote({ ...base, dirty: true, asking: true }, now).text).toBe("Discard your changes?");
  });

  it("can't be saved twice at once", () => {
    const s = { ...base, dirty: true, busy: true };
    expect(footNote(s, now).text).toBe("Saving…");
    expect(canSave(s)).toBe(false);
  });

  it("lets a new one be saved from the start, saying nothing till it's changed", () => {
    const s = { ...base, fresh: true };
    expect(canSave(s)).toBe(true);
    expect(footNote(s, now).text).toBe("");
  });

  it("says the time in London", () => {
    // 13:05 UTC in October is 14:05 BST
    expect(savedWhen(now, now + 2 * 60_000)).toBe("2:05pm");
  });
});

describe("every Save form", () => {
  it("saves from lib/SaveBar, so it shows unsaved and saved the same way", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    // A button whose words are just "Save": the SaveBar's own, nowhere else
    const SAVE_BUTTON = /<button[^>]*>\s*Save\s*<\/button>/;
    const offenders = Object.entries(sources)
      .filter(([file, code]) => !file.endsWith("/SaveBar.svelte") && SAVE_BUTTON.test(code))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});
