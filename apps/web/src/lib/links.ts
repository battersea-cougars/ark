// Links typed by someone else (the Studio, the team app's venues) are checked before they reach a page (ADR 0036):
// only web, email and phone links, or a link within the site. Anything else, a `javascript:` link above all, is
// dropped, so a page shows the words without the link.

const ALLOWED = new Set(["http:", "https:", "mailto:", "tel:"]);

// Browsers ignore control characters and spaces inside a scheme ("java\tscript:"), so the check does too
const SCHEME = /^([a-z][a-z0-9+.-]*:)/i;

/** The link, trimmed, if it's safe to put in an href; otherwise null. A link with no scheme is within the site. */
export function safeHref(href: unknown): string | null {
  if (typeof href !== "string" || !href.trim()) return null;
  // eslint-disable-next-line no-control-regex
  const scheme = SCHEME.exec(href.replace(/[\u0000- \u007f]/g, ""))?.[1];
  return !scheme || ALLOWED.has(scheme.toLowerCase()) ? href.trim() : null;
}

// The fields that hold a link, wherever they sit in a Sanity document (apps/studio/schemaTypes)
const LINK_FIELDS = new Set(["url", "href", "mapUrl", "ctaUrl", "instagram", "facebook", "youtube"]);

/** A copy of Sanity's answer with every link field checked: a bad one becomes null, as if it were empty. */
export function checkLinks<T>(value: T): T {
  if (Array.isArray(value)) return value.map(checkLinks) as T;
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      k,
      LINK_FIELDS.has(k) && typeof v === "string" ? safeHref(v) : checkLinks(v),
    ]),
  ) as T;
}
