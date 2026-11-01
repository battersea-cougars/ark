import type { APIRoute } from "astro";

export const prerender = false;

// For the down alert (ADR 0110): the Worker answers. Reads nothing (no D1, no Sanity), so it costs next to nothing
// every 10 minutes and fails only when the site does.
export const GET: APIRoute = () => Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
