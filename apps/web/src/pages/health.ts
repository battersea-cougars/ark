import type { APIRoute } from "astro";

export const prerender = false;

// For the down alert (ADR 0111): the Worker answers. Reads nothing (no D1, no Sanity), so it costs next to nothing
// every minute and fails only when the site does. Past Cloudflare Access before launch (scripts/access-setup.mjs).
export const GET: APIRoute = () => Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
