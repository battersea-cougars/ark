// The corner ribbon that says which copy of an app you're looking at (docs/adr/0010-environments-and-deploys.md):
// LOCAL on your machine, DEV on the dev Cloudflare account, nothing in production. Only a positive sign shows one: a
// ribbon missing on dev is harmless, one on the live site isn't, so anything unrecognised is treated as production.
// On your machine it also names the checkout the dev server runs from (ADR 0115): its branch, and "own data" when it
// runs on that checkout's own local D1 rather than main's shared one.

/** The checkout a dev server runs from, read when it starts (ribbon.checkout.ts). */
export interface Checkout {
  branch: string;
  ownData: boolean;
}

export interface Ribbon {
  env: "LOCAL" | "DEV";
  /** LOCAL only: the checkout's branch, and whether it's on its own local D1. */
  branch?: string;
  ownData?: boolean;
}

/**
 * The ribbon for a build. `siteEnv` is the deploy's environment (deploy.yml sets `dev` or `production`; a machine sets
 * none); `onMachine` is the app's own sign that it's running on your machine, used only when no environment was given;
 * `checkout` names the machine's checkout, and is never shown on DEV.
 */
export function ribbonFor(
  siteEnv: string | undefined,
  onMachine: boolean,
  checkout?: Checkout | null,
): Ribbon | undefined {
  if (siteEnv === "dev") return { env: "DEV" };
  if (siteEnv || !onMachine) return undefined;
  if (!checkout?.branch) return { env: "LOCAL" };
  return { env: "LOCAL", branch: checkout.branch, ...(checkout.ownData && { ownData: true }) };
}

/** The band's first line, "LOCAL · own data"; its second is the branch. */
export const ribbonHead = (ribbon: Ribbon) => (ribbon.ownData ? `${ribbon.env} · own data` : ribbon.env);

/** A browser tab's title with the ribbon in front ("[LOCAL team/review] Home"), so tabs side by side tell copies apart. */
export function withRibbon(ribbon: Ribbon | undefined, title: string): string {
  if (!ribbon) return title;
  return `[${ribbon.branch ? `${ribbon.env} ${ribbon.branch}` : ribbon.env}] ${title}`;
}
