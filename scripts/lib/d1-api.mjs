// An environment's D1 over Cloudflare's API, for scripts and builds that run outside a Worker (CI). Needs
// CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID for that environment's account. Used by scripts/club-snapshot.mjs
// and the website build's Sanity count (apps/web/src/lib/sanity/count.integration.ts, ADR 0116).
export const DATABASES = { production: "cougars", dev: "cougars-dev" };

/** A query function for `environment`'s D1: SQL and its parameters in, the rows out. */
export async function remoteD1(environment) {
  const name = DATABASES[environment];
  if (!name) throw new Error(`the environment should be ${Object.keys(DATABASES).join(" or ")}`);
  const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = process.env;
  if (!token || !account) throw new Error("needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID");
  const api = async (path, init) => {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    const body = await res.json();
    if (!body.success) throw new Error(`D1 API: ${JSON.stringify(body.errors)}`);
    return body.result;
  };
  const db = (await api(`?name=${encodeURIComponent(name)}`)).find((d) => d.name === name);
  if (!db) throw new Error(`no D1 database ${name}`);
  return async (sql, params = []) =>
    (await api(`/${db.uuid}/query`, { method: "POST", body: JSON.stringify({ sql, params }) }))[0].results;
}
