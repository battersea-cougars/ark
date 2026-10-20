import { describe, expect, it } from "vitest";
import { checkLinks, safeHref } from "./links";

describe("a link typed in the Studio", () => {
  it("is kept when it's a web, email or phone link, or within the site", () => {
    for (const href of [
      "https://maps.app.goo.gl/x",
      "http://example.org",
      "mailto:club@example.org",
      "tel:+44 20 7946 0000",
      "/join/",
      "#fees",
      "join/",
    ])
      expect(safeHref(href)).toBe(href);
    expect(safeHref("  https://example.org ")).toBe("https://example.org");
  });

  it("is dropped when it would run a script or open something else, however it's disguised", () => {
    for (const href of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      " javascript:alert(1)",
      "java\tscript:alert(1)",
      "java\nscript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:x",
      "file:///etc/passwd",
    ])
      expect(safeHref(href)).toBeNull();
  });

  it("is dropped when it's empty or isn't text", () => {
    expect(safeHref("")).toBeNull();
    expect(safeHref("  ")).toBeNull();
    expect(safeHref(null)).toBeNull();
    expect(safeHref(42)).toBeNull();
  });
});

describe("Sanity's answer", () => {
  it("has every link field checked, however deep, and nothing else touched", () => {
    const doc = {
      title: "javascript: the musical",
      ctaUrl: "javascript:alert(1)",
      socials: { instagram: "https://instagram.com/x", facebook: "javascript:x", youtube: null },
      venue: { name: "Battersea Park", mapUrl: "https://maps.app.goo.gl/x" },
      body: [
        {
          _type: "block",
          markDefs: [
            { _type: "link", href: "javascript:x" },
            { _type: "link", href: "/join/" },
          ],
        },
      ],
    };
    expect(checkLinks(doc)).toEqual({
      title: "javascript: the musical",
      ctaUrl: null,
      socials: { instagram: "https://instagram.com/x", facebook: null, youtube: null },
      venue: { name: "Battersea Park", mapUrl: "https://maps.app.goo.gl/x" },
      body: [
        {
          _type: "block",
          markDefs: [
            { _type: "link", href: null },
            { _type: "link", href: "/join/" },
          ],
        },
      ],
    });
  });
});
