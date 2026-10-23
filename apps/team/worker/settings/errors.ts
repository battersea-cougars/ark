// The apps' recent errors, from Sentry (ADR 0111): Settings → Errors shows whoever may read them (`read:Errors`;
// admins through `manage:all`) each project's open issues in this environment, newest first, each linking to Sentry.
// Read by the Worker with a read-only token, SENTRY_ISSUES_TOKEN (Issue & Event: Read), never the deploy's
// SENTRY_AUTH_TOKEN. Sentry is asked at most every few minutes, whoever opens the page: its last answer is kept in
// D1 (`sentry_issues`), one row. Sentry down or refusing keeps the last answer on show, saying so (ADR 0055).
import { first, run } from "@cougars/shared/d1";
import { mask, scribe } from "@cougars/shared/scribe";
import type { Env } from "../api/api";

const log = scribe.logger("errors");

/** Sentry's organisation and API, in its EU region (scripts/sentry-setup.mjs). */
const ORG = "battersea-cougars";
const API = "https://de.sentry.io/api/0";
/** The projects, as the page names them. */
const PROJECTS = [
  { slug: "team", name: "Team app" },
  { slug: "web", name: "Website" },
] as const;
/** How long Sentry's answer (or its failure) stands before it's asked again. */
export const ERRORS_FRESH_MS = 5 * 60_000;
/** The most issues shown a project; `more` says there are others. */
const SHOWN = 10;

export interface Issue {
  id: string;
  shortId: string;
  title: string;
  /** Where it happened: the route or function Sentry blames. */
  culprit: string;
  /** Events in the last 14 days, and the people they happened to (Sentry counts them; it's never told who). */
  count: number;
  users: number;
  level: string;
  firstSeen: string;
  lastSeen: string;
  link: string;
}

export interface ProjectIssues {
  slug: string;
  name: string;
  issues: Issue[];
  more: boolean;
}

export interface Errors {
  /** False without the token: the page says how to set it up. */
  configured: boolean;
  /** Sentry couldn't be read when last asked: `down` (no answer, 5xx, a rate limit) or `refused` (the token). */
  unavailable?: "down" | "refused";
  /** The environment shown: Sentry tags each event with it. */
  environment: "production" | "dev";
  /** When Sentry last answered; null before it has. */
  readAt: string | null;
  projects: ProjectIssues[];
}

/** The fields we take from Sentry's issue (GET /projects/{org}/{project}/issues/). */
interface SentryIssue {
  id: string;
  shortId: string;
  title: string;
  culprit: string | null;
  count: string;
  userCount: number;
  level: string;
  firstSeen: string;
  lastSeen: string;
  permalink: string;
}

class Refused extends Error {
  override name = "SentryRefused";
}

const environmentOf = (env: Env): Errors["environment"] => (env.SITE_ENV === "production" ? "production" : "dev");

async function readProject(token: string, slug: string, environment: string): Promise<ProjectIssues> {
  const query = new URLSearchParams({ query: `is:unresolved environment:${environment}`, statsPeriod: "14d" });
  const res = await fetch(`${API}/projects/${ORG}/${slug}/issues/?${query}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  });
  if (res.status === 401 || res.status === 403) throw new Refused(`Sentry ${slug}: HTTP ${res.status}`);
  if (!res.ok) throw new Error(`Sentry ${slug}: HTTP ${res.status}`);
  const found = (await res.json()) as SentryIssue[];
  if (!Array.isArray(found)) throw new Error(`Sentry ${slug}: not a list of issues`);
  const issues = [...found]
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
    .slice(0, SHOWN)
    .map((i) => ({
      id: i.id,
      shortId: i.shortId,
      // Sentry's beforeSend masks addresses already; masked again, as this goes to a page
      title: mask(i.title),
      culprit: mask(i.culprit ?? ""),
      count: Number(i.count) || 0,
      users: i.userCount ?? 0,
      level: i.level,
      firstSeen: i.firstSeen,
      lastSeen: i.lastSeen,
      link: i.permalink,
    }));
  const name = PROJECTS.find((p) => p.slug === slug)!.name;
  return { slug, name, issues, more: found.length > SHOWN };
}

interface Kept {
  triedAt: string;
  readAt: string | null;
  body: string | null;
  failure: "down" | "refused" | null;
}

/** The open issues, from what Sentry last said if that's recent, else from Sentry now. */
export async function readErrors(env: Env, now: Date): Promise<Errors> {
  const environment = environmentOf(env);
  const token = env.SENTRY_ISSUES_TOKEN;
  if (!token) return { configured: false, environment, readAt: null, projects: [] };
  const kept = await first<Kept>(
    env.DB,
    "SELECT tried_at triedAt, read_at readAt, body, failure FROM sentry_issues WHERE id = 1",
  );
  const shown = (k: Pick<Kept, "readAt" | "body" | "failure">): Errors => ({
    configured: true,
    ...(k.failure ? { unavailable: k.failure } : {}),
    environment,
    readAt: k.readAt,
    projects: k.body ? (JSON.parse(k.body) as ProjectIssues[]) : [],
  });
  // Asked a moment ago, answered or not: that stands, so Sentry is asked at most every few minutes
  if (kept && now.getTime() - Date.parse(kept.triedAt) < ERRORS_FRESH_MS) return shown(kept);

  const at = now.toISOString();
  try {
    const projects = await Promise.all(PROJECTS.map((p) => readProject(token, p.slug, environment)));
    const body = JSON.stringify(projects);
    await keep(env.DB, { triedAt: at, readAt: at, body, failure: null });
    return shown({ readAt: at, body, failure: null });
  } catch (e) {
    const failure = e instanceof Refused ? "refused" : "down";
    // A warning, not an error: the error would go to the Sentry that just didn't answer, and the page says so to the
    // admin looking at it. The last answer stays on show
    log.warn("errors.sentry_unavailable", e, { failure });
    await keep(env.DB, { triedAt: at, readAt: null, body: null, failure });
    return shown({ readAt: kept?.readAt ?? null, body: kept?.body ?? null, failure });
  }
}

/** One write: when Sentry was asked, and its answer if it gave one (a failure keeps the last). */
const keep = (db: D1Database, k: Kept) =>
  run(
    db,
    `INSERT INTO sentry_issues (id, tried_at, read_at, body, failure) VALUES (1, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET tried_at = excluded.tried_at, failure = excluded.failure,
       read_at = COALESCE(excluded.read_at, read_at), body = COALESCE(excluded.body, body)`,
    [k.triedAt, k.readAt, k.body, k.failure],
  );
