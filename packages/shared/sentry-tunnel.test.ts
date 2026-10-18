import { describe, expect, it } from "vitest";
import { sentryTunnel } from "./sentry-tunnel";

const DSN = "https://publickey@o123.ingest.de.sentry.io/456";
const envelope = (dsn: string) =>
  `${JSON.stringify({ dsn, sent_at: "2026-10-18T07:00:00Z" })}\n{"type":"event"}\n{"message":"boom"}`;
const post = (body: string, origin = "https://team.example.org") =>
  new Request("https://team.example.org/api/errors", { method: "POST", body, headers: { origin } });

function fakeSentry() {
  const sent: { url: string; body: string }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), body: String(init?.body) });
    return new Response(null, { status: 200 });
  };
  return { sent, fetch: fetch as typeof globalThis.fetch };
}

describe("the app's errors reach Sentry through its own address", () => {
  it("an envelope for our project is passed on to Sentry's ingest, as is", async () => {
    const sentry = fakeSentry();
    const res = await sentryTunnel(post(envelope(DSN)), DSN, { fetch: sentry.fetch });
    expect(res.status).toBe(204);
    expect(sentry.sent).toEqual([{ url: "https://o123.ingest.de.sentry.io/api/456/envelope/", body: envelope(DSN) }]);
  });

  it("an envelope for another project is refused: the tunnel isn't an open relay", async () => {
    const sentry = fakeSentry();
    const res = await sentryTunnel(post(envelope("https://k@o999.ingest.sentry.io/1")), DSN, { fetch: sentry.fetch });
    expect(res.status).toBe(400);
    expect(sentry.sent).toEqual([]);
  });

  it("from another site's page it's refused", async () => {
    const sentry = fakeSentry();
    const res = await sentryTunnel(post(envelope(DSN), "https://evil.example"), DSN, { fetch: sentry.fetch });
    expect(res.status).toBe(403);
    expect(sentry.sent).toEqual([]);
  });

  it("without Sentry set up (your machine) it's accepted and dropped", async () => {
    const sentry = fakeSentry();
    const res = await sentryTunnel(post(envelope(DSN)), undefined, { fetch: sentry.fetch });
    expect(res.status).toBe(204);
    expect(sentry.sent).toEqual([]);
  });

  it("a body that's too big or not an envelope is refused", async () => {
    const sentry = fakeSentry();
    expect((await sentryTunnel(post("x".repeat(300_000)), DSN, { fetch: sentry.fetch })).status).toBe(413);
    expect((await sentryTunnel(post("not json"), DSN, { fetch: sentry.fetch })).status).toBe(400);
    expect(sentry.sent).toEqual([]);
  });
});
