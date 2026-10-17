// All GROQ lives here. Keep projections explicit so the shape matches types.ts.

// Club facts: one singleton each, found by its fixed _id (apps/studio/structure.ts).
export const CLUB = /* groq */ `*[_id == "club"][0]{founded, contactEmail, socials, youtubeChannelId, youtubePlaylists, heroImage}`;
export const FRIDAYS = /* groq */ `*[_id == "fridays"][0]{
  training[]{title, day, start, end, description}, venue{name, address, mapUrl}, kitNotes, firstSessionKit, feesText
}`;
export const PUB = /* groq */ `*[_id == "pub"][0]{name, about, mapUrl}`;
export const TEAM = /* groq */ `*[_id == "team"][0]{onWebsite, intro, league, photo}`;
export const KUMITE = /* groq */ `*[_id == "kumite"][0]{onWebsite, intro, tagline, posterStatement, posterReveal, format, awards}`;

// Overrides for channel videos, and videos that aren't on the channel. Merged and sorted in lib/youtube.ts.
export const VIDEOS = /* groq */ `*[_type == "video" && defined(youtubeUrl)]{
  _id, _createdAt, youtubeUrl, title, recordedOn, description, hidden, pinned
}`;
/** Everything the live video list needs from Sanity, in one request (lib/server/videos.ts). */
export const VIDEO_DATA = /* groq */ `{
  "club": *[_id == "club"][0]{socials, youtubeChannelId, youtubePlaylists},
  "videos": ${VIDEOS}
}`;

const EVENT_FIELDS = `title, "slug": slug.current, type, startsAt, endsAt, location, summary, cover, ctaLabel, ctaUrl`;
export const EVENTS = /* groq */ `*[_type == "event" && defined(slug.current)] | order(startsAt asc){${EVENT_FIELDS}}`;
export const EVENT_PAGES = /* groq */ `*[_type == "event" && defined(slug.current)]{${EVENT_FIELDS}, body}`;

// Albums. The website reads these live from the Worker (lib/server/photos.ts, ADR 0016); the home page
// also bakes the newest photos in at build time, for visitors without JavaScript.
const PHOTO = `asset, hotspot, crop, alt, caption, "aspect": asset->metadata.dimensions.aspectRatio`;
const ALBUM_FILTER = `_type == "album" && defined(slug.current)`;
export const ALBUMS = /* groq */ `*[${ALBUM_FILTER}] | order(date desc, _createdAt desc){
  title, "slug": slug.current, date, cover{${PHOTO}}, photos[]{${PHOTO}}
}`;
export const ALBUM_LIST = /* groq */ `*[${ALBUM_FILTER}] | order(date desc, _createdAt desc){
  title, "slug": slug.current, date, cover{${PHOTO}}, "photos": photos[0...1]{${PHOTO}}, "photoCount": count(photos)
}`;
export const ALBUM = /* groq */ `*[${ALBUM_FILTER} && slug.current == $slug] | order(_updatedAt desc)[0]{
  title, "slug": slug.current, date, cover{${PHOTO}}, photos[]{${PHOTO}}
}`;
/** The newest albums' photos, for the home page strip (trimmed to a dozen in code). */
export const LATEST_PHOTOS = /* groq */ `*[${ALBUM_FILTER}] | order(date desc, _createdAt desc)[0...12]{
  title, "slug": slug.current, date, "photos": photos[0...12]{${PHOTO}}
}`;

export const SPONSORS = /* groq */ `*[_type == "sponsor"] | order(orderRank asc){name, url, logo}`;

export const PLAYERS = /* groq */ `*[_type == "player"] | order(orderRank asc, name asc){
  _id, name, nickname, number, position, shoots, since, knownFor, weakness, quote, photo
}`;
