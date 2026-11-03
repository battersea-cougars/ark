import { defineField, defineType } from "sanity";
import { youtubeUrlRule } from "./shared";

// Videos on the club YouTube channel appear on the website by themselves (ADR 0016).
// A document here changes one of them, matched by its YouTube link, or adds a video from somewhere else.
export const video = defineType({
  name: "video",
  title: "Video",
  type: "document",
  description:
    "Videos on the club YouTube channel appear on the website by themselves, within a day. Add one here only to " +
    "hide it, show it first or change its title, or to add a video that isn't on the club channel.",
  fields: [
    defineField({
      name: "youtubeUrl",
      title: "YouTube link",
      type: "url",
      description: "Copy the link from YouTube's Share button.",
      validation: youtubeUrlRule,
    }),
    defineField({
      name: "hidden",
      title: "Hide from the website",
      type: "boolean",
      description: "Turn on to keep this video off the website. It stays on YouTube.",
      initialValue: false,
    }),
    defineField({
      name: "pinned",
      title: "Show first",
      type: "boolean",
      description: "Turn on to show this video at the top, before newer ones.",
      initialValue: false,
    }),
    defineField({
      name: "title",
      type: "string",
      description: "Leave empty to use the title from YouTube.",
    }),
    defineField({
      name: "recordedOn",
      title: "Date",
      type: "date",
      description: "Leave empty to use the day it went on YouTube.",
    }),
    defineField({
      name: "description",
      type: "text",
      rows: 3,
      description: "Leave empty to use the first paragraph of the YouTube description.",
    }),
  ],
  orderings: [{ title: "Newest", name: "recordedOn", by: [{ field: "recordedOn", direction: "desc" }] }],
  preview: {
    select: { title: "title", url: "youtubeUrl", date: "recordedOn", hidden: "hidden", pinned: "pinned" },
    prepare: ({ title, url, date, hidden, pinned }) => ({
      title: title || url || "Video",
      subtitle: [hidden && "Hidden", pinned && "Shown first", date].filter(Boolean).join(" · "),
    }),
  },
});
