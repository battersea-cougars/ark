// The club's inbox, as the team manager sets it in the Studio: Sanity → Club → Contact email (ADR 0027). Production
// sends as it (a Gmail alias of the sending account), the website's enquiries go to it, and outside production it never
// gets email. Read from the environment's Sanity project through its API CDN (public data, no token), at most every
// five minutes per isolate, and counted (ADR 0059). Null when Sanity has none or can't be read: email still goes out, as
// the sending account.
import { sanityProject } from "./sanity";
import { countSanity } from "./sanity-requests";

/** The fake world's answer (tests): set it, and Sanity is never asked. */
export const clubContactFake: { value?: string | null } = {};

let cached: { project: string; value: string | null; at: number } | undefined;
const FRESH_MS = 5 * 60_000;

export async function clubContact(
  siteEnv: string | undefined,
  { fetch = globalThis.fetch, now = Date.now() }: { fetch?: typeof globalThis.fetch; now?: number } = {},
): Promise<string | null> {
  if (clubContactFake.value !== undefined) return clubContactFake.value;
  const { projectId, dataset } = sanityProject(siteEnv);
  if (cached?.project === projectId && now - cached.at < FRESH_MS) return cached.value;
  const query = encodeURIComponent(`*[_id == "club"][0].contactEmail`);
  try {
    const url = `https://${projectId}.apicdn.sanity.io/v2025-01-01/data/query/${dataset}?query=${query}&perspective=published&tag=team`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    countSanity(url, res.status);
    const { result } = (await res.json()) as { result?: unknown };
    const value = typeof result === "string" && result.includes("@") ? result.trim().toLowerCase() : null;
    cached = { project: projectId, value, at: now };
    return value;
  } catch {
    // Sanity is down or out of quota: keep the last answer, if there was one
    return cached?.project === projectId ? cached.value : null;
  }
}
