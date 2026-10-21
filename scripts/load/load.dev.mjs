// The dev deployment as a load run's target (docs/load-testing.md, "Against dev"): the team Worker at its one
// workers.dev address and its D1, `cougars-dev`, reached through Cloudflare's API with the dev account's token
// (scripts/env-pull.mjs). Nothing else is ever a target: the address and the database are fixed here, the database
// must be found by that name in the account the token reaches (production's account has no `cougars-dev`), and
// anything that looks like production is refused before a request is sent.
export const DEV = {
  url: "https://team.cougars-dev.workers.dev",
  database: "cougars-dev",
};

/** Why `url` and `database` aren't dev's, or null when they are. Production's names are refused by name too. */
export function notDev({ url, database, env = process.env }) {
  if (!URL.canParse(url)) return `"${url}" isn't an address.`;
  const { host } = new URL(url);
  if (host !== new URL(DEV.url).host) return `${host} isn't dev's team app (${new URL(DEV.url).host}).`;
  if (database !== DEV.database) return `D1 "${database}" isn't dev's (${DEV.database}).`;
  // Run through env-pull for dev, never --environment production
  if (env.SITE_ENV === "production") return "This shell says SITE_ENV=production.";
  return null;
}

/** Throws unless the target is dev's. */
export function refuseUnlessDev(target) {
  const why = notDev(target);
  if (why) throw new Error(`Refused: ${why} Load runs go to dev only (ADR 0121).`);
}

async function cloudflare(path, body, { account, token }) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body && JSON.stringify(body),
  });
  const out = await res.json().catch(() => ({}));
  if (!out.success) throw new Error(`Cloudflare ${path.split("?")[0]}: ${res.status} ${JSON.stringify(out.errors)}`);
  return out.result;
}

/**
 * Dev's D1, through Cloudflare's API, as load.club.mjs reaches a database: `run(sql)` runs a script of statements
 * (D1 runs them as one batch, all or nothing), `rows(sql)` gives one SELECT's rows. Needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (dev's, from env-pull). Refuses unless the account holds a
 * database by dev's name.
 */
export async function devD1(env = process.env) {
  const auth = { account: env.CLOUDFLARE_ACCOUNT_ID, token: env.CLOUDFLARE_API_TOKEN };
  if (!auth.account || !auth.token)
    throw new Error("No Cloudflare token: run it through env-pull, node scripts/env-pull.mjs -- npm run load -- …");
  const found = (await cloudflare(`/d1/database?name=${DEV.database}`, null, auth)).filter(
    (d) => d.name === DEV.database,
  );
  if (found.length !== 1)
    throw new Error(`Refused: this account has no D1 called ${DEV.database}, so it isn't dev's. Use dev's token.`);
  const { uuid } = found[0];
  return {
    name: DEV.database,
    id: uuid,
    account: auth.account,
    async run(sql) {
      await cloudflare(`/d1/database/${uuid}/query`, { sql }, auth);
    },
    async rows(sql) {
      const [answer] = await cloudflare(`/d1/database/${uuid}/query`, { sql }, auth);
      return answer?.results ?? [];
    },
  };
}
