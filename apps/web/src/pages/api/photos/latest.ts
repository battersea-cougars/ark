import type { APIRoute } from "astro";
import { latestPosts, type Post } from "../../../lib/server/instagram";
import { instagramConfig } from "../../../lib/server/instagram-env";
import { cacheControl } from "../../../lib/server/sanity-env";

export const prerender = false;

/** A post as the home page strip draws it. */
export type StripPhoto = Pick<Post, "id" | "kind" | "image" | "alt" | "caption" | "href" | "count">;

// The home page is prerendered without photos (its build can't read Instagram); its script fills the strip from
// here, the club's newest twelve posts (ADR 0113).
export const GET: APIRoute = async () => {
  const { data, unavailable } = await latestPosts(instagramConfig(), {}, 12);
  const photos: StripPhoto[] = data.map(({ id, kind, image, alt, caption, href, count }) => ({
    id,
    kind,
    image,
    alt,
    caption,
    href,
    count,
  }));
  return Response.json(
    { photos, unavailable },
    { status: unavailable ? 503 : 200, headers: { "Cache-Control": cacheControl(unavailable) } },
  );
};
