// The club's facts, one small document each, in the order the team manager thinks about them
// (docs/adr/0014-sanity-public-content.md). Only facts are editable here: page wording lives in the website code.
// Each is a singleton with a fixed _id (SINGLETONS in structure.ts), so the team app can write them through the
// Sanity API later. Required fields fall back to the website's defaults if missing; optional ones stay empty when
// empty (apps/web/src/lib/sanity/merge.ts, OPTIONAL: keep the two in step).
import { defineArrayMember, defineField, defineType } from "sanity";
import { imageField } from "./shared";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const club = defineType({
  name: "club",
  title: "Club",
  type: "document",
  description: "The basics about the club: when it started, how to get in touch, and where to find us online.",
  fields: [
    defineField({
      name: "founded",
      title: "Year founded",
      type: "number",
      description: "Shown in the header, the footer and the homepage, e.g. “Since 1996”.",
      validation: (r) => r.required().integer().min(1900).max(2100),
    }),
    defineField({
      name: "contactEmail",
      title: "Contact email",
      type: "string",
      description: "The address people write to. Shown in the footer and on the “Try a session” page.",
      validation: (r) =>
        r
          .required()
          .custom((v?: string) => (!v || EMAIL_RE.test(v) ? true : "This doesn't look like an email address")),
    }),
    defineField({
      name: "socials",
      title: "Social media links",
      type: "object",
      description: "Paste the full web address of each page. Leave one empty to hide it.",
      options: { collapsible: false },
      fields: [
        defineField({
          name: "instagram",
          title: "Instagram",
          type: "url",
          description: "e.g. https://www.instagram.com/…",
        }),
        defineField({
          name: "facebook",
          title: "Facebook",
          type: "url",
          description: "The club's Facebook page or group.",
        }),
        defineField({
          name: "youtube",
          title: "YouTube channel",
          type: "url",
          description: "The channel's web address.",
        }),
      ],
    }),
    defineField({
      name: "youtubeChannelId",
      title: "YouTube channel ID",
      type: "string",
      description:
        "Optional. Lets the website list the channel's videos by itself. It starts with “UC”: on YouTube, open the " +
        "channel → About → Share channel → Copy channel ID.",
      validation: (r) =>
        r.custom((v?: string) =>
          !v || /^UC[\w-]{22}$/.test(v) ? true : "A channel ID starts with UC and is 24 characters",
        ),
    }),
    defineField({
      name: "youtubePlaylists",
      title: "YouTube playlists",
      type: "array",
      description:
        "Optional. The website shows every video in these playlists, together, instead of all the channel's public " +
        "uploads. Videos in them can be Unlisted.",
      of: [
        defineArrayMember({
          type: "object",
          name: "playlist",
          title: "Playlist",
          fields: [
            defineField({
              name: "url",
              title: "Playlist link",
              type: "string",
              description: "On YouTube, open the playlist → Share → Copy, and paste the link here.",
              validation: (r) =>
                r
                  .required()
                  .custom((v?: string) =>
                    !v || /^(PL|OL|UU|FL)[\w-]{10,}$/.test(v.trim()) || /[?&]list=[\w-]{10,}/.test(v)
                      ? true
                      : "Paste the playlist's link from YouTube's Share button",
                  ),
            }),
            defineField({
              name: "label",
              title: "Label",
              type: "string",
              description: "Optional. Shown on each of its videos, e.g. Friday hockey or Kumite. Empty: no label.",
            }),
          ],
          preview: { select: { title: "label", subtitle: "url" } },
        }),
      ],
    }),
    imageField("heroImage", "Homepage background photo", {
      description: "Optional. A wide action shot works best. Leave empty to show the carbon-fibre background.",
    }),
  ],
  preview: { prepare: () => ({ title: "Club" }) },
});

export const fridays = defineType({
  name: "fridays",
  title: "Fridays",
  type: "document",
  description: "Everything a newcomer needs for a regular session: when, where, what to bring and what it costs.",
  fields: [
    defineField({
      name: "training",
      title: "Sessions",
      type: "array",
      description: "Usually one: the Friday session. The first one is the one the homepage talks about.",
      validation: (r) => r.min(1).error("Add at least one session"),
      of: [
        defineArrayMember({
          type: "object",
          name: "slot",
          title: "Session",
          fields: [
            defineField({
              name: "title",
              title: "Name",
              type: "string",
              description: "e.g. “Friday session”.",
              initialValue: "Friday session",
              validation: (r) => r.required(),
            }),
            defineField({
              name: "day",
              title: "Day",
              type: "string",
              description: "The day of the week it happens.",
              options: { list: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] },
              validation: (r) => r.required(),
            }),
            defineField({
              name: "start",
              title: "Starts",
              type: "string",
              description: "24-hour time, e.g. 19:30.",
              validation: (r) => r.required().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { name: "time (e.g. 19:30)" }),
            }),
            defineField({
              name: "end",
              title: "Ends",
              type: "string",
              description: "24-hour time, e.g. 21:30.",
              validation: (r) => r.required().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { name: "time (e.g. 21:30)" }),
            }),
            defineField({
              name: "description",
              title: "What happens",
              type: "text",
              rows: 3,
              description: "A sentence or two about the session, shown on the homepage and the Fridays page.",
            }),
          ],
          preview: {
            select: { title: "title", day: "day", start: "start", end: "end" },
            prepare: ({ title, day, start, end }) => ({ title, subtitle: `${day ?? ""} ${start ?? ""}–${end ?? ""}` }),
          },
        }),
      ],
    }),
    defineField({
      name: "venue",
      title: "Where we play",
      type: "object",
      options: { collapsible: false },
      fields: [
        defineField({
          name: "name",
          title: "Venue name",
          type: "string",
          description: "e.g. “Battersea Sports Centre”.",
          validation: (r) => r.required(),
        }),
        defineField({
          name: "address",
          title: "Address",
          type: "string",
          description: "Short is fine: area and postcode.",
          validation: (r) => r.required(),
        }),
        defineField({
          name: "mapUrl",
          title: "Google Maps link",
          type: "url",
          description: "In Google Maps, find the venue, press Share and copy the link.",
          validation: (r) => r.required(),
        }),
      ],
      validation: (r) => r.required(),
    }),
    defineField({
      name: "kitNotes",
      title: "What to bring",
      type: "text",
      rows: 3,
      description: "The kit rules: what's compulsory and what's recommended.",
      validation: (r) => r.required(),
    }),
    defineField({
      name: "firstSessionKit",
      title: "Kit for first-timers",
      type: "text",
      rows: 2,
      description:
        "What the club lends a newcomer on their first night, e.g. “The club can lend you some kit, and players often have spares.” " +
        "Leave this empty if the club doesn't lend kit: the website then won't mention lending kit anywhere.",
    }),
    defineField({
      name: "feesText",
      title: "Fees",
      type: "text",
      rows: 2,
      description: "Optional, e.g. “£10 per session, first session free”. Leave empty to say nothing about cost.",
    }),
  ],
  preview: { prepare: () => ({ title: "Fridays" }) },
});

export const pub = defineType({
  name: "pub",
  title: "Pub",
  type: "document",
  description: "Where everyone goes after the session. Shown on the homepage, the Fridays page and the footer.",
  fields: [
    defineField({ name: "name", title: "Pub name", type: "string", validation: (r) => r.required() }),
    defineField({
      name: "about",
      title: "A line or two about it",
      type: "text",
      rows: 3,
      description: "Shown under the pub's name on the Fridays page.",
      validation: (r) => r.required(),
    }),
    defineField({
      name: "mapUrl",
      title: "Google Maps link",
      type: "url",
      description: "Optional. In Google Maps, find the pub, press Share and copy the link.",
    }),
  ],
  preview: { prepare: () => ({ title: "Pub" }) },
});

export const team = defineType({
  name: "team",
  title: "Team",
  type: "document",
  description: "The official league team. Players are added under “Team → Players”.",
  fields: [
    defineField({
      name: "onWebsite",
      title: "Show on the website",
      type: "boolean",
      initialValue: false,
      description:
        "Off: the website has no Team page, no team section on the homepage and no menu link. Changes show after " +
        "the next deploy.",
    }),
    defineField({
      name: "intro",
      title: "Introduction",
      type: "text",
      rows: 3,
      description: "A sentence or two about the team, shown on the Team page and the homepage.",
      validation: (r) => r.required(),
    }),
    defineField({
      name: "league",
      title: "League",
      type: "string",
      description: "The league the team plays in, e.g. BIPHA. Leave empty to hide it.",
    }),
    imageField("photo", "Team photo", { description: "A wide group shot works best." }),
  ],
  preview: { prepare: () => ({ title: "Team" }) },
});

export const kumite = defineType({
  name: "kumite",
  title: "Kumite",
  type: "document",
  description:
    "The Cougars Kumite tournament. Kumite dates are added as Events (type “Cougars Kumite”). Results come from " +
    "the team app by themselves.",
  fields: [
    defineField({
      name: "onWebsite",
      title: "Show on the website",
      type: "boolean",
      initialValue: false,
      description:
        "Off: the website has no Kumite page, no Kumite section on the homepage and no menu link. Changes show " +
        "after the next deploy.",
    }),
    defineField({
      name: "intro",
      title: "Introduction",
      type: "text",
      rows: 4,
      description: "What the Kumite is, shown at the top of the Kumite page.",
      validation: (r) => r.required(),
    }),
    defineField({
      name: "tagline",
      title: "Poster tagline",
      type: "string",
      description: "The line under the title on the Kumite poster (homepage and Kumite page).",
      validation: (r) => r.required().max(140),
    }),
    defineField({
      name: "posterStatement",
      title: "Poster statement",
      type: "string",
      description: "Stays on the poster under the title, e.g. “One team walks away.”",
      validation: (r) => r.required().max(40),
    }),
    defineField({
      name: "posterReveal",
      title: "Poster reveal",
      type: "string",
      description:
        "Appears after the statement, letter by letter out of a blur, holds, dissolves away, and comes back. One " +
        "or two words, e.g. “Champions.”",
      validation: (r) => r.required().max(20),
    }),
    defineField({
      name: "format",
      title: "How it works",
      type: "array",
      of: [defineArrayMember({ type: "string" })],
      description: "One short line per rule, in order. Shown on the homepage and the Kumite page.",
      validation: (r) => r.min(1),
    }),
    defineField({
      name: "awards",
      title: "Awards",
      type: "array",
      of: [defineArrayMember({ type: "string" })],
      description: "The prizes handed out, one per line, e.g. Champions, Top scorer.",
      validation: (r) => r.min(1),
    }),
  ],
  preview: { prepare: () => ({ title: "Kumite" }) },
});
