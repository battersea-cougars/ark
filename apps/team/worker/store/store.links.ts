// The store app's links (ADR 0108): a phone asks the team app's own address which app it trusts with its links, so
// a link to the team app (an email's) opens the app, and (webcredentials) which app may use its passkeys (ADR 0023):
// with the app's entitlement for the same domain, the iPhone app signs in with a passkey as Safari does. Served by
// the Worker, not a file, so the Apple team's id is a setting: APPLE_TEAM_ID, a var the deploy puts on from
// scripts/lib/settings.mjs (scripts/ci/target.mjs). Unset (your machine), nothing's there. Android's assetlinks.json joins it when the Play Store app comes.

export const APP_ID = "com.batterseacougars.team";

export interface StoreEnv {
  /** The Apple Developer team's id (ten characters, not secret): store-setup.mjs prints it. */
  APPLE_TEAM_ID?: string;
}

/** The answer to a phone's question, or null for any other path. */
export function storeLinks(pathname: string, env: StoreEnv): Response | null {
  if (pathname !== "/.well-known/apple-app-site-association") return null;
  if (!env.APPLE_TEAM_ID) return new Response("Not found.", { status: 404 });
  const app = `${env.APPLE_TEAM_ID}.${APP_ID}`;
  return Response.json({
    applinks: { details: [{ appIDs: [app], components: [{ "/": "/*" }] }] },
    webcredentials: { apps: [app] },
  });
}
