// A visitor's browser refused something the content security policy doesn't allow (middleware.ts CSP, ADR 0036), and
// posted a report to /api/csp-report. Browsers send one of two shapes: the older `report-uri` one (Firefox,
// Safari) and the Reporting API's list (Chrome). This reads either into the few facts worth keeping, only for our own
// pages, and leaves out what browser extensions cause: they aren't ours to fix.
import { mask } from "@cougars/shared/scribe";

export interface CspViolation {
  /** The directive that refused it, e.g. `script-src-elem` */
  directive: string;
  /** Where it came from: a host and path, or `inline` / `eval` */
  blocked: string;
  /** Our page's path */
  page: string;
  /** The script that tried it, and where, when the browser says */
  source: string | null;
}

const EXTENSION = /^(chrome|moz|safari-web|ms-browser)-extension:/;

const str = (v: unknown, max = 500) => (typeof v === "string" && v ? mask(v.slice(0, max)) : null);

/** A URL as host and path (no query: it may carry anything), or the browser's keyword (`inline`, `eval`) as it is. */
function where(v: string): string {
  try {
    const u = new URL(v);
    return u.protocol === "data:" || u.protocol === "blob:" ? u.protocol : u.host + u.pathname;
  } catch {
    return v;
  }
}

function violation(r: Record<string, unknown>, site: string): CspViolation | null {
  const doc = str(r.documentURL ?? r["document-uri"]);
  const directive = str(r.effectiveDirective ?? r["effective-directive"] ?? r["violated-directive"], 100);
  const blocked = str(r.blockedURL ?? r["blocked-uri"]) ?? "inline";
  const source = str(r.sourceFile ?? r["source-file"]);
  if (!doc || !directive) return null;
  let page: URL;
  try {
    page = new URL(doc);
  } catch {
    return null;
  }
  if (page.origin !== site) return null;
  if (EXTENSION.test(blocked) || (source && EXTENSION.test(source))) return null;
  const line = r.lineNumber ?? r["line-number"];
  return {
    directive: directive.split(" ")[0],
    blocked: where(blocked),
    page: page.pathname,
    source: source ? `${where(source)}${typeof line === "number" ? `:${line}` : ""}` : null,
  };
}

/** The violations in a report body, from either shape, ours only. At most five: one page load sends few. */
export function cspViolations(body: unknown, site: string): CspViolation[] {
  const reports = Array.isArray(body)
    ? body.filter((r) => r?.type === "csp-violation").map((r) => r.body)
    : [(body as Record<string, unknown> | null)?.["csp-report"]];
  return reports
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .map((r) => violation(r, site))
    .filter((v): v is CspViolation => v !== null)
    .slice(0, 5);
}
