import type { PortableTextBlock } from "@portabletext/types";

export interface SanityImage {
  asset?: { _ref: string };
  hotspot?: { x: number; y: number };
  crop?: unknown;
  alt?: string;
  /** Demo content only (lib/sanity/demo.ts): placeholder photo base URL, sized by imageUrl(). */
  demoUrl?: string;
}

export interface TrainingSlot {
  title: string;
  day: string;
  start: string;
  end: string;
  description?: string;
}

// Club facts, one Sanity singleton each (apps/studio/schemaTypes/settings.ts). Page wording lives in code.
export interface Club {
  founded: number;
  contactEmail: string;
  socials: { instagram?: string | null; facebook?: string | null; youtube?: string | null };
  youtubeChannelId?: string | null;
  /** Playlists on the club channel, shown together; they may hold unlisted videos (ADR 0016). */
  youtubePlaylists?: { url: string; label?: string | null }[] | null;
  heroImage?: SanityImage | null;
}

export interface Fridays {
  training: TrainingSlot[];
  venue: { name: string; address: string; mapUrl: string };
  kitNotes: string;
  /** What the club lends a newcomer. Empty: the site says nothing about lending kit. */
  firstSessionKit?: string | null;
  feesText?: string | null;
}

export interface Pub {
  name: string;
  about: string;
  mapUrl?: string | null;
}

export interface Team {
  /** Off: no team page, no team section on the home page, no menu link (ADR 0109). */
  onWebsite: boolean;
  intro: string;
  league?: string | null;
  photo?: SanityImage | null;
}

export interface Kumite {
  intro: string;
  /** Under the poster's title. */
  tagline: string;
  /** Stays on the poster under the title. */
  posterStatement: string;
  /** Appears after the statement out of a blur, holds, dissolves away, and comes back. */
  posterReveal: string;
  format: string[];
  awards: string[];
}

/** A tournament award: from the team app's tournament editor (ADR 0044), or a Sanity name with no line. */
export interface Award {
  name: string;
  about?: string | null;
}

/** Every club fact in one object, the shape pages read through getSettings(). */
export interface SiteSettings extends Club, Fridays {
  pub: Pub;
  team: Team;
  /** Its awards and the next one come from the team app, through the build's club snapshot (ADR 0044, 0042). */
  kumite: Omit<Kumite, "awards"> & {
    awards: Award[];
    next: { startsAt: string; venue: string; dateTbc: boolean; season: string | null } | null;
  };
}

export interface Video {
  _id: string;
  title: string;
  recordedOn: string;
  youtubeUrl: string;
  description?: string | null;
  /** The label of the club playlist it came from, e.g. "Friday hockey". */
  label?: string | null;
}

/** A Sanity `video` document. It overrides the channel video with the same YouTube id, or adds one. */
export interface VideoOverride {
  _id: string;
  _createdAt?: string;
  youtubeUrl: string;
  title?: string | null;
  recordedOn?: string | null;
  description?: string | null;
  hidden?: boolean | null;
  pinned?: boolean | null;
}

export type EventType = "training" | "social" | "tournament" | "kumite";

export interface ClubEvent {
  title: string;
  slug: string;
  type: EventType;
  startsAt: string;
  endsAt?: string | null;
  location?: string | null;
  summary?: string | null;
  cover?: SanityImage | null;
  body?: PortableTextBlock[] | null;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
}

/** One photo in an album. `aspect` is width / height, when Sanity knows it. */
export type Photo = SanityImage & { caption?: string | null; aspect?: number | null };

export interface Album {
  title: string;
  slug: string;
  date: string;
  /** The editor's cover photo, or the album's first photo. */
  cover?: Photo | null;
  photos: Photo[];
}

/** An album on the /photos list: its cover and how many photos it has. */
export interface AlbumSummary {
  title: string;
  slug: string;
  date: string;
  cover?: Photo | null;
  photoCount: number;
}

export interface Sponsor {
  name: string;
  url?: string | null;
  logo?: SanityImage | null;
}

export interface Player {
  _id: string;
  name: string;
  nickname?: string | null;
  number?: number | null;
  position?: string | null;
  shoots?: string | null;
  since?: number | null;
  knownFor?: string | null;
  weakness?: string | null;
  quote?: string | null;
  photo?: SanityImage | null;
  /** A roster player's record, as of the build (lib/roster.ts): training sessions played, this year and in all,
   * and tournaments played. */
  stats?: { sessions: number; season: number; tournaments: number; goals: number; assists: number; titles: number };
}
