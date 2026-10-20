import { describe, expect, it, vi } from "vitest";
import type { PortableTextBlock } from "@portabletext/types";

vi.mock("astro:env/server", () => ({ SANITY_PROJECT_ID: "", SANITY_DATASET: "production" }));
const { renderPortableText } = await import("./portable-text");

const paragraph = (href: string): PortableTextBlock[] => [
  {
    _type: "block",
    _key: "b",
    style: "normal",
    markDefs: [{ _type: "link", _key: "l", href }],
    children: [{ _type: "span", _key: "s", text: "Sign up here", marks: ["l"] }],
  },
];

describe("an event's write-up", () => {
  it("links out to other sites in a new tab, and within the site in place", () => {
    expect(renderPortableText(paragraph("https://forms.gle/x"))).toContain(
      '<a href="https://forms.gle/x" rel="noopener" target="_blank">Sign up here</a>',
    );
    expect(renderPortableText(paragraph("/join/"))).toContain('<a href="/join/">Sign up here</a>');
  });

  it("shows a link that would run a script as plain words", () => {
    const html = renderPortableText(paragraph("javascript:alert(1)"));
    expect(html).toBe("<p>Sign up here</p>");
  });
});
