// The website's results are built from a snapshot of D1 (ADR 0100), so a change to a result asks for a rebuild. A
// change marks one wanted (`wantRebuild`, from the API's change pipeline); the five-minute cron (`rebuildWebsite`)
// sends it once things have been quiet for five minutes, so a results day is one rebuild. It asks GitHub as the
// club's GitHub App (README#github_app_private_key): a JWT signed with the App's key buys an hour's installation token
// that can only start workflows, which runs deploy.yml for the website from this environment's branch.
import { first, run } from "@cougars/shared/d1";
import { isDone } from "@cougars/shared/results";
import { scribe } from "@cougars/shared/scribe";

const log = scribe.logger("website");

export interface WebsiteEnv {
  DB: D1Database;
  /** "local" on a laptop's server: never asks GitHub. */
  TEAM_ENV?: string;
  /** "dev" or "production" on a deploy (scripts/ci/target.mjs): the website to rebuild. */
  SITE_ENV?: string;
  GITHUB_APP_CLIENT_ID?: string;
  GITHUB_APP_INSTALLATION_ID?: string;
  /** PKCS#8 PEM (a Worker secret). */
  GITHUB_APP_PRIVATE_KEY?: string;
}

const REPO = "battersea-cougars/ark";
const QUIET_MS = 5 * 60_000;

/** The tournament a route is about, from its path (/api/tournaments/12/...), or null. */
export const tournamentOfPath = (path: string) => Number(path.match(/^\/api\/tournaments\/(\d+)(?:\/|$)/)?.[1]) || null;

/** Whether this tournament's result is (or was) on the website's pages: done, by the shared rule. */
export async function onTheWebsite(db: D1Database, tournamentId: number) {
  const t = await first<{ status: string; games: number; played: number }>(
    db,
    `SELECT t.status, COUNT(g.id) games, COUNT(CASE WHEN g.status = 'done' THEN 1 END) played
     FROM tournaments t LEFT JOIN tournament_games g ON g.tournament_id = t.id WHERE t.id = ? GROUP BY t.id`,
    [tournamentId],
  );
  if (!t) return false;
  return isDone(
    t.status,
    Array.from({ length: t.games }, (_, i) => ({ status: i < t.played ? "done" : "next" })),
  );
}

/** A rebuild is wanted: from now, so each change in a busy spell restarts the quiet time. */
export const wantRebuild = (db: D1Database, now: Date) =>
  run(
    db,
    `INSERT INTO website_rebuild (id, wanted_at) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET wanted_at = excluded.wanted_at`,
    [now.toISOString()],
  );

/** The cron's job: send a wanted rebuild once it's been quiet for five minutes. What happened, for the log and tests. */
export async function rebuildWebsite(env: WebsiteEnv, now: Date): Promise<"nothing" | "waiting" | "sent" | "failed"> {
  if (env.TEAM_ENV === "local" || !env.SITE_ENV) return "nothing";
  const wanted = await first<{ wantedAt: string }>(
    env.DB,
    "SELECT wanted_at wantedAt FROM website_rebuild WHERE id = 1",
  );
  if (!wanted) return "nothing";
  if (now.getTime() - Date.parse(wanted.wantedAt) < QUIET_MS) return "waiting";
  try {
    await dispatch(env, now);
  } catch (e) {
    // Kept wanted: the next check tries again
    log.error("website.rebuild_failed", e);
    return "failed";
  }
  // Only the request it sent: a change since then waits for its own quiet five minutes
  await run(env.DB, "DELETE FROM website_rebuild WHERE id = 1 AND wanted_at = ?", [wanted.wantedAt]);
  log.info("website.rebuild_sent", { environment: env.SITE_ENV });
  return "sent";
}

async function dispatch(env: WebsiteEnv, now: Date) {
  const { GITHUB_APP_CLIENT_ID: app, GITHUB_APP_INSTALLATION_ID: installation, GITHUB_APP_PRIVATE_KEY: pem } = env;
  if (!app || !installation || !pem) throw new Error("The GitHub App isn't set up for this Worker.");
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "cougars-team" };
  // A token for this alone, whatever else the App may do: start a workflow in this one repo (#71)
  const tokenRes = await fetch(`https://api.github.com/app/installations/${installation}/access_tokens`, {
    method: "POST",
    headers: { ...headers, Authorization: `Bearer ${await appJwt(app, pem, now)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ repositories: [REPO.split("/")[1]], permissions: { actions: "write" } }),
  });
  if (!tokenRes.ok) throw new Error(`GitHub installation token: ${tokenRes.status}`);
  const { token } = (await tokenRes.json()) as { token: string };
  // The website's deploy, from this environment's branch: release is production (ADR 0010)
  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/deploy.yml/dispatches`, {
    method: "POST",
    headers: { ...headers, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ref: env.SITE_ENV === "production" ? "release" : "main", inputs: { apps: "web" } }),
  });
  if (!res.ok) throw new Error(`GitHub dispatch: ${res.status}`);
}

/** The App's own token: a JWT from its Client ID, signed RS256 with its key, good for nine minutes. */
async function appJwt(clientId: string, pem: string, now: Date) {
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const b64 = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes))
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  const part = (o: object) => b64(new TextEncoder().encode(JSON.stringify(o)));
  const at = Math.floor(now.getTime() / 1000);
  // A minute back, for clock drift (GitHub's advice)
  const unsigned = `${part({ alg: "RS256", typ: "JWT" })}.${part({ iat: at - 60, exp: at + 540, iss: clientId })}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64(new Uint8Array(sig))}`;
}
