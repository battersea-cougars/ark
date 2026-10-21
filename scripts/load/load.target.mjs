// Where a load run's phones go (docs/load-testing.md), each as { url, remote, roster, signIn?, cpu, d1, crons, db?,
// analytics?, stop }:
//   own     a Worker of the run's own (wrangler dev, its own D1 in a temp folder), signed in as dev-sign-in does
//   local   the same Worker, but the run adds its members and mints their sessions as it does on dev (load.club.mjs):
//           the dev path end to end, on this machine
//   dev     dev's deployment, https://team.cougars-dev.workers.dev, and its D1 (load.dev.mjs): nothing else, ever
// On `local` and `dev`, `stop` always takes the run's people and what they made away again; a run stopped part way
// (Ctrl-C, an error) does it too.
import { addMembers, cleanUp, loadRoster, mintSessions, nothingLeft, sessionCookie } from "./load.club.mjs";
import { DEV, devD1, refuseUnlessDev } from "./load.dev.mjs";
import { startServer } from "./load.server.mjs";

const scheduled = (url) => (cron) => fetch(`${url}/__scheduled?cron=${encodeURIComponent(cron)}`).then((r) => r.status);

/** A Worker of the run's own, as before: its own D1 holds only the run's club, so nothing needs taking away. */
export async function ownTarget({ members, build }) {
  const server = await startServer({ members, build });
  const cron = scheduled(server.url);
  return {
    name: "own",
    url: server.url,
    remote: false,
    roster: server.roster,
    cpu: server.cpu,
    d1: server.d1,
    cron,
    crons: () => Promise.all([cron("*/5 * * * *"), cron("7 * * * *")]),
    output: server.output,
    stop: ({ keep } = {}) => server.stop({ keep }),
  };
}

/**
 * The run's club on a database it shares: its members added and signed in (tokens in memory only), and `leave`
 * taking it all away again, whatever happened. `log` says what it did.
 */
async function joinClub(db, url, members, log) {
  const roster = loadRoster(members);
  await addMembers(db, roster);
  log(`Added the run's ${roster.length} members to ${db.name} (@load.test, "Load Admin" an Admin)`);
  const sessions = await mintSessions(
    db,
    roster.map((r) => r.email),
  );
  log(`Minted ${Object.keys(sessions).length} sign-ins (auth_sessions.method "load", a day long)`);
  const signIn = async (email) => {
    const s = sessions[email];
    if (!s) throw new Error(`No sign-in minted for ${email}`);
    return { cookie: sessionCookie(url, s.token), memberId: s.memberId };
  };
  let left = null;
  const leave = async () => {
    if (left) return left;
    for (const k of Object.keys(sessions)) delete sessions[k];
    left = await cleanUp(db);
    log(`Cleaned up ${db.name}: was ${JSON.stringify(left.before)}, now ${JSON.stringify(left.after)}`);
    if (!nothingLeft(left.after)) throw new Error(`Left behind in ${db.name}: npm run load -- --cleanup`);
    return left;
  };
  return { roster, signIn, leave };
}

/** The dev path on this machine: a Worker of the run's own with only the club's seed, the run's people minted in. */
export async function localTarget({ members, build, log = console.log }) {
  const server = await startServer({ members, build, roster: false });
  const cron = scheduled(server.url);
  let club;
  try {
    club = await joinClub(server.d1db, server.url, members, log);
  } catch (e) {
    await server.stop();
    throw e;
  }
  return {
    name: "local",
    url: server.url,
    remote: false,
    roster: club.roster,
    signIn: club.signIn,
    db: server.d1db,
    cpu: server.cpu,
    d1: server.d1,
    cron,
    crons: () => Promise.all([cron("*/5 * * * *"), cron("7 * * * *")]),
    output: server.output,
    leave: club.leave,
    async stop({ keep } = {}) {
      try {
        await club.leave();
      } finally {
        await server.stop({ keep });
      }
    },
  };
}

/** Dev's D1 and the analytics' credentials, after the checks that it's dev's (load.dev.mjs). */
export async function devHandles(env = process.env) {
  refuseUnlessDev({ url: DEV.url, database: DEV.database, env });
  const db = await devD1(env);
  return {
    db,
    analytics: env.CLOUDFLARE_ANALYTICS_TOKEN
      ? { account: db.account, token: env.CLOUDFLARE_ANALYTICS_TOKEN, databaseId: db.id, databaseName: db.name }
      : null,
  };
}

/** Dev's deployment: the run's members added to dev's D1 and signed in, taken away again at the end. */
export async function devTarget({ members, log = console.log }) {
  const { db, analytics } = await devHandles();
  const health = await fetch(`${DEV.url}/api/health`);
  if (!health.ok) throw new Error(`Dev's team app isn't healthy: ${health.status}`);
  const club = await joinClub(db, DEV.url, members, log);
  return {
    name: "dev",
    url: DEV.url,
    remote: true,
    roster: club.roster,
    signIn: club.signIn,
    db,
    analytics,
    cpu: null,
    d1: null,
    cron: null,
    // Dev's own Cron Triggers run on their schedule (every five minutes, and at :07); a run can't start them
    crons: async () => ["dev's own schedule (*/5, :07)"],
    leave: club.leave,
    stop: () => club.leave(),
  };
}
