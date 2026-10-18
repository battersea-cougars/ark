import { defineCliConfig } from "sanity/cli";
import { sanityProject } from "@cougars/shared/sanity";

// The dev project unless SANITY_STUDIO_SITE_ENV=production (docs/adr/0010-environments-and-deploys.md).
const { projectId, dataset } = sanityProject(process.env.SANITY_STUDIO_SITE_ENV);

export default defineCliConfig({
  api: { projectId, dataset },
  // Self-hosted on our own Worker (wrangler.jsonc, ADR 0112): admin.batterseacougars.com, and dev's workers.dev.
  // autoUpdates: the Studio loads Sanity's latest compatible code from its CDN, wherever it's hosted.
  deployment: { autoUpdates: true },
});
