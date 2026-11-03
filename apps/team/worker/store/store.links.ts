// The store app's links (ADR 0108): the apple-app-site-association that lets a link to the team app open the store
// app, and the app use its passkeys (ADR 0023).

export const APP_ID = "com.batterseacougars.team";

export interface StoreEnv {
  /**
   * The Apple Developer team's id (ten characters, not secret): store-setup.mjs prints it, and the deploy puts it on
   * from scripts/lib/settings.mjs. Unset (your machine), there's no file. Served by the Worker so it can be a setting.
   */
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
