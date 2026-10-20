// Share pictures (lib/og.ts): one per section and one per event, drawn at build time. Base.astro points each page's
// og:image here; a page with its own photo (an event cover) uses that instead.
import type { APIRoute, GetStaticPaths } from "astro";
import { renderCard, type Card } from "../../lib/og";
import { getEventPages, getSections, getSettings } from "../../lib/sanity/content";
import { formatRange } from "../../lib/dates";

export const prerender = true;

export const getStaticPaths = (async () => {
  const s = await getSettings();
  const on = await getSections();
  const slot = s.training[0];
  const session = slot ? `${slot.day.slice(0, 3)} ${slot.start}` : undefined;
  const since = `South West London · Since ${s.founded}`;
  const cards: Record<string, Card> = {
    home: { title: "Roller hockey club", osd: session, footer: since },
    fridays: { title: `${slot?.day ?? "Friday"} nights`, osd: session, footer: s.venue.name },
    join: { title: "Try a session", osd: session, footer: s.venue.name },
    // The results pages share the Kumite's (ADR 0109)
    ...((on.kumite || on.results) && {
      kumite: { title: "The Cougars Kumite", osd: "Special event", footer: since, night: true },
    }),
    events: { title: "Events", osd: "What's on", footer: since },
    videos: { title: "Videos", osd: "Footage", footer: since },
    photos: { title: "Gallery", osd: "The evidence", footer: since },
    ...(on.team && { team: { title: "The team", osd: s.team.league ?? undefined, footer: since } }),
  };
  for (const e of await getEventPages()) {
    cards[`events/${e.slug}`] = {
      title: e.title,
      osd: formatRange(e.startsAt),
      footer: e.location ?? s.venue.name,
      night: e.type === "kumite",
    };
  }
  return Object.entries(cards).map(([card, props]) => ({ params: { card }, props: { card: props } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) =>
  new Response(new Uint8Array(await renderCard((props as { card: Card }).card)), {
    headers: { "Content-Type": "image/png" },
  });
