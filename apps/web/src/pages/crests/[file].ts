import type { APIRoute, GetStaticPaths } from "astro";
import { getCrestFiles } from "../../lib/sanity/content";

// Team crests on the results (ADR 0016), written as files at build time from the images the team app keeps as data:
// URLs. Only for a published tournament's teams.
export const getStaticPaths = (async () =>
  (await getCrestFiles()).map((c) => ({
    params: { file: c.path.slice("/crests/".length) },
    props: { type: c.type, base64: c.base64 },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) =>
  new Response(
    Uint8Array.from(atob(props.base64), (c) => c.charCodeAt(0)),
    { headers: { "Content-Type": props.type } },
  );
