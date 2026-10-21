// The bootstrap's ETag (ADR 0053), on both sides: the Worker makes it, and the app asks with it at the data version
// it holds, which moves on as it reads the club in parts (catch-up.ts, ADR 0072). The deploy, the data version, who's
// asking and the day; none has a dot in it. No imports: the load runs' phones use it too.

/** The club as one member sees it, at one data version, one day, from one deploy. */
export const clubTag = (build: string, version: number, memberId: number | string, today: string) =>
  `"${build}.${version}.${memberId}.${today}"`;

/** The same tag at another data version. A weak tag (a proxy that compressed the reply) stays weak. */
export function atVersion(tag: string, version: number): string {
  const weak = tag.startsWith("W/");
  const [build, , memberId, today] = tag.replace(/^W\//, "").replace(/"/g, "").split(".");
  return `${weak ? "W/" : ""}${clubTag(build, version, memberId, today)}`;
}

/** Whether an If-None-Match names this tag, weak or not. */
export const sameTag = (header: string | null, tag: string) => !!header && header.replace(/^W\//, "") === tag;

/** The header the club's data version comes in, on the bootstrap and on every change's reply. */
export const VERSION_HEADER = "x-club-version";
