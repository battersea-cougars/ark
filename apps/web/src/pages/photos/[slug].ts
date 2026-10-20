import type { APIRoute } from "astro";

export const prerender = false;

// Album pages are gone: the photos are the club's Instagram now (ADR 0113). An old album's address goes to them.
export const GET: APIRoute = ({ redirect }) => redirect("/photos/", 301);
