// The browser's errors reach Sentry through the app's own address (ADR 0110): the app's CSP talks only to its own
// origin, and ad blockers stop requests to sentry.io. The SDK posts its envelope here (its `tunnel` option); this passes
// it on to Sentry's ingest for our project, and only ours, so it's no relay for anyone else.
const MAX_BYTES = 200_000;

export async function sentryTunnel(
  request: Request,
  dsn: string | undefined,
  {
    fetch = globalThis.fetch,
    allowed = async () => true,
  }: {
    fetch?: typeof globalThis.fetch;
    /** Whether one more may go today (error-report-cap.ts): asked only of an envelope for our project. */
    allowed?: () => Promise<boolean>;
  } = {},
): Promise<Response> {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  // Only our own pages: a browser always sends Origin on a POST
  if (request.headers.get("origin") !== new URL(request.url).origin) return new Response(null, { status: 403 });
  const body = await request.text();
  if (body.length > MAX_BYTES) return new Response(null, { status: 413 });
  // No Sentry here (your machine): the report is dropped, and the app carries on
  if (!dsn) return new Response(null, { status: 204 });

  let theirs: URL;
  try {
    theirs = new URL(JSON.parse(body.slice(0, body.indexOf("\n"))).dsn);
  } catch {
    return new Response(null, { status: 400 });
  }
  const ours = new URL(dsn);
  const project = ours.pathname.replace(/^\//, "");
  if (theirs.host !== ours.host || theirs.pathname.replace(/^\//, "") !== project) {
    return new Response(null, { status: 400 });
  }
  // Past the club's daily cap: dropped, quietly, as the app expects nothing back
  if (!(await allowed())) return new Response(null, { status: 204 });
  // Not logged: the report was for Sentry, and Sentry not answering is nothing an error line could tell it
  await fetch(`https://${ours.host}/api/${project}/envelope/`, {
    method: "POST",
    body,
    headers: { "content-type": "application/x-sentry-envelope" },
    signal: AbortSignal.timeout(5_000),
  }).catch(() => undefined);
  return new Response(null, { status: 204 });
}
