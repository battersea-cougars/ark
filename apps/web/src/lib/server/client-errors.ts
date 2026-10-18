// A visitor's browser hit an error in our own scripts (ADR 0111). The page's tiny catcher (layouts/Base.astro) posts a
// short report to /api/client-error; this turns it into a Sentry event the Worker sends, under the deploy's release, so
// Sentry maps the minified stack back to source with the uploaded source maps. The website loads no Sentry SDK.
import { mask } from "@cougars/shared/scribe";

interface Frame {
  function: string;
  abs_path: string;
  filename: string;
  lineno: number;
  colno: number;
  in_app: boolean;
}
export interface BrowserErrorEvent {
  level: "error";
  platform: "javascript";
  tags: { source: "browser"; page: string };
  request: { url: string };
  exception: { values: { type: string; value: string; stacktrace: { frames: Frame[] } }[] };
}

const text = (v: unknown, max: number) => (typeof v === "string" ? mask(v.slice(0, max)) : null);

/** The report as a Sentry event, or null for one that isn't ours (an extension, another site's script) or isn't valid. */
export function browserErrorEvent(body: unknown, site: string): BrowserErrorEvent | null {
  if (typeof body !== "object" || body === null) return null;
  const r = body as Record<string, unknown>;
  const message = text(r.message, 500);
  const page = text(r.page, 300);
  if (message === null || page === null || !page.startsWith("/")) return null;
  const frames = parseStack(text(r.stack, 4_000) ?? "", site);
  // Only ours: a frame in one of our scripts. Not an extension's, another site's script, or a cross-origin "Script error."
  if (!frames.some((f) => f.in_app)) return null;
  return {
    level: "error",
    platform: "javascript",
    tags: { source: "browser", page },
    request: { url: site + page },
    exception: { values: [{ type: text(r.name, 100) || "Error", value: message, stacktrace: { frames } }] },
  };
}

// Chrome: "    at fn (url:line:col)" or "    at url:line:col". Safari and Firefox: "fn@url:line:col".
const CHROME = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/;
const OTHERS = /^(.*?)@(.+?):(\d+):(\d+)$/;

/** The stack's frames, oldest call first (Sentry's order); ours are the ones under the site's /_astro/. */
function parseStack(stack: string, site: string): Frame[] {
  const frames: Frame[] = [];
  for (const line of stack.split("\n")) {
    const m = line.match(CHROME) ?? line.match(OTHERS);
    if (!m) continue;
    const [, fn, url, lineno, colno] = m;
    frames.push({
      function: fn || "?",
      abs_path: url,
      filename: url,
      lineno: Number(lineno),
      colno: Number(colno),
      in_app: url.startsWith(`${site}/_astro/`),
    });
  }
  return frames.reverse();
}
