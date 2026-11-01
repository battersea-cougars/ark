import type { APIRoute } from "astro";
import { latestPosts, photoListCacheControl, type Post } from "../../../lib/server/instagram";
import { instagramConfig } from "../../../lib/server/instagram-env";

export const prerender = false;

/** A photo as the home page strip draws it. */
export type StripPhoto = Pick<Post, "id" | "image" | "alt" | "caption" | "href">;

// The home page is prerendered without photos (its build can't read Instagram); its script fills the strip from
// here, the club's newest twelve photos (ADR 0016).
export const GET: APIRoute = async () => {
  const { data, unavailable } = await latestPosts(instagramConfig(), {}, 12);
  const photos: StripPhoto[] = data.map(({ id, image, alt, caption, href }) => ({ id, image, alt, caption, href }));
  return Response.json(
    { photos, unavailable },
    { status: unavailable ? 503 : 200, headers: { "Cache-Control": photoListCacheControl(unavailable) } },
  );
};
