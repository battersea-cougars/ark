import type { APIRoute } from "astro";
import { postImage } from "../../../lib/server/instagram";
import { instagramConfig } from "../../../lib/server/instagram-env";

export const prerender = false;

// One of the club's Instagram pictures, through our Worker (lib/server/instagram.ts, ADR 0016). Kept in Cloudflare's
// edge cache too, so each picture is fetched from Instagram about once a week per data centre, not per visitor.
export const GET: APIRoute = async ({ params, request, locals }) => {
  const edge = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const hit = await edge?.match(request);
  if (hit) return hit;
  const res = await postImage(instagramConfig(), params.id ?? "");
  if (res.ok && edge) locals.cfContext?.waitUntil(edge.put(request, res.clone()));
  return res;
};
