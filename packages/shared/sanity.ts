// The two Sanity projects (ADR 0010). Each has one dataset, `production`; the environment picks the project, so a dev
// token or a local Studio can never write the live site's content. Project IDs aren't secret: they're in every image URL.
export type SanityEnvironment = "production" | "dev";

export const SANITY_PROJECTS = {
  production: { projectId: "ah165efl", dataset: "production", name: "Cougars" },
  dev: { projectId: "zmg6rbe3", dataset: "production", name: "Cougars Dev" },
} as const satisfies Record<SanityEnvironment, { projectId: string; dataset: string; name: string }>;

/** The project for an environment name: `production` is the live site, anything else (dev, a laptop) is dev. */
export const sanityProject = (environment: string | undefined) =>
  SANITY_PROJECTS[environment === "production" ? "production" : "dev"];
