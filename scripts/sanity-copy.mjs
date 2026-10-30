#!/usr/bin/env node
// Until launch, the website's words live in the repo (ADR 0014): apps/web/src/lib/sanity/fallback.ts. Each website
// deploy sends them to its environment's Sanity project before the build, so a copy change is a commit like any other.
// Only the words: switches (On the website), the contact email, links, photos and awards stay the Studio's. At launch
// this step comes out of deploy.yml and the Studio owns the words.
//   SITE_ENV=dev|production SANITY_CONTENT_TOKEN=… node scripts/sanity-copy.mjs [--dry-run]
// Without a token it says so and does nothing. The token is never printed.
import { FALLBACK_FRIDAYS, FALLBACK_KUMITE, FALLBACK_PUB, FALLBACK_TEAM } from "../apps/web/src/lib/sanity/fallback.ts";
import { sanityProject } from "../packages/shared/sanity.ts";

/** Each document's words: its fields that are copy, as the repo has them. */
const COPY = {
  kumite: pick(FALLBACK_KUMITE, ["intro", "tagline", "posterStatement", "posterReveal", "format"]),
  team: pick(FALLBACK_TEAM, ["intro"]),
  pub: pick(FALLBACK_PUB, ["about"]),
  fridays: pick(FALLBACK_FRIDAYS, ["kitNotes"]),
};

function pick(doc, fields) {
  return Object.fromEntries(fields.filter((f) => doc[f] != null).map((f) => [f, doc[f]]));
}

/** The mutations: each document made if it isn't there, then its words set. */
export function copyMutations() {
  return Object.entries(COPY).flatMap(([id, set]) => [
    { createIfNotExists: { _id: id, _type: id } },
    { patch: { id, set } },
  ]);
}

async function send() {
  const token = process.env.SANITY_CONTENT_TOKEN;
  const { projectId, dataset, name } = sanityProject(process.env.SITE_ENV);
  if (!token) return console.log(`No SANITY_CONTENT_TOKEN: the words in ${name} are left as they are.`);
  const dryRun = process.argv.includes("--dry-run");
  const url = `https://${projectId}.api.sanity.io/v2025-01-01/data/mutate/${dataset}?dryRun=${dryRun}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ mutations: copyMutations() }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(`Sanity refused the words (${res.status}): ${body.error?.description ?? "no reason given"}`);
  console.log(`${dryRun ? "Would set" : "Set"} the words of ${Object.keys(COPY).join(", ")} in ${name}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) await send();
