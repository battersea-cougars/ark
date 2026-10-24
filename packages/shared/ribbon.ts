// The corner ribbon that says which copy of an app you're looking at (docs/adr/0010-environments-and-deploys.md):
// LOCAL on your machine, DEV on the dev Cloudflare account, nothing in production. Only a positive sign shows one: a
// ribbon missing on dev is harmless, one on the live site isn't, so anything unrecognised is treated as production.

export type Ribbon = "LOCAL" | "DEV";

/**
 * The ribbon for a build. `siteEnv` is the deploy's environment (deploy.yml sets `dev` or `production`; a machine sets
 * none); `onMachine` is the app's own sign that it's running on your machine, used only when no environment was given.
 */
export function ribbonFor(siteEnv: string | undefined, onMachine: boolean): Ribbon | undefined {
  if (siteEnv === "dev") return "DEV";
  if (siteEnv) return undefined;
  return onMachine ? "LOCAL" : undefined;
}

/** A browser tab's title with the ribbon in front ("[DEV] Home"), so tabs side by side tell the copies apart too. */
export const withRibbon = (ribbon: Ribbon | undefined, title: string) => (ribbon ? `[${ribbon}] ${title}` : title);
