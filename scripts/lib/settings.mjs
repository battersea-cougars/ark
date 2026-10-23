// The plain settings the deploys and scripts need: IDs, not secrets, so they're committed here, one copy each
// (docs/secrets.md says where each comes from; ADR 0002). Each is on a dashboard, in a URL, or in the team app's browser
// code anyway, and useless without its secret. scripts/env-pull.mjs hands them to every command and CI job beside the
// secrets, under the same names the code has always read (CLOUDFLARE_ACCOUNT_ID, APPLE_TEAM_ID, …); scripts/ci/target.mjs
// puts the team Worker's on as vars.

const FILL_IN = "FILL_IN"; // not filled in yet: a CI job refuses to start, your machine only warns

/** A value per environment, or one for both. */
const SETTINGS = {
  // Cloudflare: each account's ID (dashboard → Account home → ⋮ → Copy account ID). Every API call names it.
  CLOUDFLARE_ACCOUNT_ID: {
    production: "FILL_IN:CLOUDFLARE_ACCOUNT_ID__PRODUCTION", // Cougars
    dev: "FILL_IN:CLOUDFLARE_ACCOUNT_ID__DEV", // Cougars Dev
  },
  // Apple: the Developer team's ID (Membership details; store-setup.mjs prints it). The team Worker serves it to phones
  // (worker/store/store.links.ts) and store.yml signs the app with it.
  APPLE_TEAM_ID: "FILL_IN:APPLE_TEAM_ID",
  // Apple: the App Store Connect key's ID and its issuer (Users and Access → Integrations → Team Keys); the .p8 itself is
  // the secret APP_STORE_CONNECT_KEY. For store.yml and store-setup.mjs.
  APP_STORE_CONNECT_KEY_ID: "FILL_IN:APP_STORE_CONNECT_KEY_ID",
  APP_STORE_CONNECT_ISSUER_ID: "FILL_IN:APP_STORE_CONNECT_ISSUER_ID",
  // Sentry: where the team app sends its errors (project `team` → Client Keys), from the Worker and the browser alike.
  // The website's DSN stays a secret, SENTRY_DSN_WEB: nothing of it reaches a browser.
  SENTRY_DSN_TEAM: "FILL_IN:SENTRY_DSN_TEAM",
};

/** The settings for `environment` ("production" or "dev"), as NAME → value. */
export function settingsFor(environment) {
  const out = {};
  for (const [name, value] of Object.entries(SETTINGS)) {
    const v = typeof value === "string" ? value : value[environment];
    if (v === undefined) throw new Error(`No ${name} for ${environment} in scripts/lib/settings.mjs`);
    if (v.startsWith(FILL_IN)) {
      const message = `scripts/lib/settings.mjs has no ${name} for ${environment} yet (docs/secrets.md)`;
      if (process.env.CI) throw new Error(message);
      console.error(`Warning: ${message}.`);
      continue;
    }
    out[name] = v;
  }
  return out;
}
