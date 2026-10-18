import { defineConfig } from "sanity";
import { structureTool } from "sanity/structure";
import { visionTool } from "@sanity/vision";
import { sanityProject } from "@cougars/shared/sanity";
import { schemaTypes } from "./schemaTypes";
import { NOT_EDITED_HERE, structure, SINGLETONS } from "./structure";

// One project per environment (docs/adr/0010-environments-and-deploys.md). The live Studio is built with
// SANITY_STUDIO_SITE_ENV=production (deploy.yml); a local Studio is always the dev project.
const live = process.env.SANITY_STUDIO_SITE_ENV === "production";
const { projectId, dataset } = sanityProject(live ? "production" : "dev");

export default defineConfig({
  name: live ? "live" : "dev",
  title: live ? "Cougars website" : "Cougars dev site",
  subtitle: live ? "Live" : "Practice copy, not live",
  projectId,
  dataset,
  plugins: [structureTool({ structure }), visionTool()],
  // The GROQ playground (Vision) is for developers: only administrators see it.
  tools: (tools, { currentUser }) =>
    currentUser?.roles.some((r) => r.name === "administrator") ? tools : tools.filter((t) => t.name !== "vision"),
  schema: {
    types: schemaTypes,
    // The global "New document" menu: no singletons, and nothing that isn't edited here (structure.ts)
    templates: (templates) =>
      templates.filter(({ schemaType }) => !SINGLETONS.has(schemaType) && !NOT_EDITED_HERE.has(schemaType)),
  },
  document: {
    // Singletons can only be edited and published, never duplicated or deleted.
    actions: (actions, { schemaType }) =>
      SINGLETONS.has(schemaType)
        ? actions.filter(({ action }) => action && ["publish", "discardChanges", "restore"].includes(action))
        : actions,
  },
});
