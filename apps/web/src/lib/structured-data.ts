// schema.org data for search engines (JSON-LD in Base.astro): the club on the home page, each event on its page.
// Google uses it for the club's name, logo and links, and can show events as rich results. Facts come from the
// Studio, like the rest of the site; nothing here is invented.
import type { ClubEvent, SiteSettings } from "./sanity/types";

type Thing = Record<string, unknown>;

export function clubData(s: SiteSettings, site: URL, logo: string, description: string): Thing {
  return {
    "@context": "https://schema.org",
    "@type": "SportsOrganization",
    name: "Battersea Cougars",
    alternateName: "Battersea Cougars Inline Hockey Club",
    url: site.href,
    logo: new URL(logo, site).href,
    description,
    sport: "Roller hockey",
    foundingDate: String(s.founded),
    ...(s.contactEmail && { email: s.contactEmail }),
    sameAs: Object.values(s.socials).filter(Boolean),
    location: venue(s),
  };
}

export function eventData(e: ClubEvent, s: SiteSettings, url: string, image: string): Thing {
  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: e.title,
    url,
    startDate: e.startsAt,
    ...(e.endsAt ? { endDate: e.endsAt } : {}),
    ...(e.summary ? { description: e.summary } : {}),
    image: [image],
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    // An event somewhere else names its place; Google wants an address, which only the club's venue has.
    location: e.location && e.location !== s.venue.name ? { "@type": "Place", name: e.location } : venue(s),
    organizer: { "@type": "SportsOrganization", name: "Battersea Cougars", url: new URL("/", url).href },
  };
}

const venue = (s: SiteSettings): Thing => ({
  "@type": "SportsActivityLocation",
  name: s.venue.name,
  address: s.venue.address,
  ...(s.venue.mapUrl ? { hasMap: s.venue.mapUrl } : {}),
});

/** JSON for a <script type="application/ld+json">: "<" escaped so text can't close the script. */
export const jsonLd = (data: Thing | Thing[]) => JSON.stringify(data).replace(/</g, "\\u003c");
