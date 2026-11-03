import type { APIRoute } from "astro";

export const prerender = false;

// An old album's address (/photos/<album>) goes to the club's photos, its Instagram (ADR 0016).
export const GET: APIRoute = ({ redirect }) => redirect("/photos/", 301);
