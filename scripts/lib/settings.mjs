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
    production: "27672b8cc27ebd904d18d2b06e64f713", // Cougars
    dev: "c9c62ec41bfdb158d51d5afb8b4fe337", // Cougars Dev
  },
  // Apple: the Developer team's ID (Membership details; store-setup.mjs prints it). The team Worker serves it to phones
  // (worker/store/store.links.ts) and store.yml signs the app with it.
  APPLE_TEAM_ID: "A7M57N34S7",
  // Apple: the App Store Connect key's ID and its issuer (Users and Access → Integrations → Team Keys); the .p8 itself is
  // the secret APP_STORE_CONNECT_KEY. For store.yml and store-setup.mjs.
  APP_STORE_CONNECT_KEY_ID: "4PMD6WY6K3",
  APP_STORE_CONNECT_ISSUER_ID: "1c15fa2a-b06c-4f07-85dd-fd5598286037",
  // Sentry: where the team app sends its errors (project `team` → Client Keys), from the Worker and the browser alike.
  // The website's DSN stays a secret, SENTRY_DSN_WEB: nothing of it reaches a browser.
  SENTRY_DSN_TEAM: "https://49f6b8a93cdf925ff3b2a2ffce02f0cd@o4512275839778816.ingest.de.sentry.io/4512275988676688",
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
