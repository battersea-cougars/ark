import { describe, expect, it } from "vitest";
import { menuPlace } from "./menu-place";

// A field's list on a phone: on screen above the keyboard, whichever side of the field has the room.
describe("where a field's list opens", () => {
  const field = { top: 540, bottom: 590, left: 16, width: 360, height: 50 };

  it("under the field when the screen has room there", () => {
    expect(menuPlace(field, { top: 0, bottom: 900 })).toEqual({ top: 596, left: 16, width: 360, height: 292 });
  });

  it("over the field when the keyboard is up and covers the room under it", () => {
    // The window runs to 900, but the keyboard leaves only 0-610 on screen
    const place = menuPlace(field, { top: 0, bottom: 610 });
    expect(place.top + place.height).toBeLessThanOrEqual(field.top);
    expect(place.top).toBeGreaterThanOrEqual(12);
    expect(place.height).toBe(300);
  });

  it("inside what's on screen when the page has been panned up under the keyboard", () => {
    const place = menuPlace({ ...field, top: 700, bottom: 750 }, { top: 300, bottom: 770 });
    expect(place.top).toBeGreaterThanOrEqual(312);
    expect(place.top + place.height).toBeLessThanOrEqual(700);
  });
});
