import type { APIRoute } from "astro";

export const prerender = false;

// Old Wix album addresses (/gallery/<album>) go to the club's photos, its Instagram (ADR 0016).
export const GET: APIRoute = ({ redirect }) => redirect("/photos/", 301);
