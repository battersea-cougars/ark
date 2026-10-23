// A calendar file for one session or tournament, so a member can put it in their phone's or laptop's calendar
// (Add to calendar on Home's card, off for now: nothing calls it). Times are written in UTC, which every calendar
// converts to the reader's zone.
import { saveCalendar } from "../app/native";
import type { Bookable } from "../demo/model";

/** "2026-10-09T18:30:00.000Z" as iCalendar's "20261009T183000Z". */
const stamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Commas, semicolons, backslashes and newlines are escaped in iCalendar text. */
const text = (s: string) =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/([,;])/g, "\\$1")
    .replace(/\r?\n/g, "\\n");

export function icsFor(event: Bookable, now = new Date()): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Battersea Cougars//Team app//EN",
    "BEGIN:VEVENT",
    `UID:${event.key}@team.batterseacougars`,
    `DTSTAMP:${stamp(now.toISOString())}`,
    `DTSTART:${stamp(event.startsAt)}`,
    `DTEND:${stamp(event.endsAt)}`,
    `SUMMARY:${text(event.title)}`,
    // The venue and its address, so the phone's calendar can find it
    ...(event.venue ? [`LOCATION:${text([event.venue, event.address].filter(Boolean).join(", "))}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

/**
 * Hands the phone the file (a download, or the store app's share sheet); it offers to add it to the calendar.
 * @public Off for now (above), kept for when Add to calendar is back.
 */
export const downloadIcs = (event: Bookable) => saveCalendar(event.title, icsFor(event));
