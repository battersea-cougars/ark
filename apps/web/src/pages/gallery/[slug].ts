import type { APIRoute } from "astro";

export const prerender = false;

// Old Wix album addresses (/gallery/<album>): the photos are the club's Instagram now (ADR 0016).
export const GET: APIRoute = ({ redirect }) => redirect("/photos/", 301);
