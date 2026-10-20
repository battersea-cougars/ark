// How a post from the club's Instagram is shown (lib/server/instagram.ts, ADR 0113): the words on its link to
// Instagram, and its tile's mark. Kept free of server code so the home page's script can use it too.
import type { Post } from "./server/instagram";

/** What the link to the post says: a video plays there, an album has more there. */
export const postLabel = (p: Pick<Post, "kind" | "count">) =>
  p.kind === "video" ? "Watch it on Instagram" : p.kind === "album" ? `All ${p.count} on Instagram` : "On Instagram";

/** The tile's corner mark: ▶ for a video, the photo count for an album, nothing for a photo. */
export const postMark = (p: Pick<Post, "kind" | "count">) =>
  p.kind === "video" ? "▶" : p.kind === "album" ? `1/${p.count}` : "";
