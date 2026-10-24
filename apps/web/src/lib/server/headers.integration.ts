// Writes the build's `_headers` (lib/server/headers.ts) beside the prerendered pages, for the environment being built:
// production on `release` (deploy.yml sets SITE_ENV), dev for anything else, as astro.config.mjs reads it. Ours go
// first, and what's there is kept: the Cloudflare adapter adds its own rule (a year's Cache-Control on /_astro/*) to
// the same file in the same hook, before or after this one.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { AstroIntegration } from "astro";
import { headersFile } from "./headers";

export const securityHeaders = (): AstroIntegration => ({
  name: "cougars:security-headers",
  hooks: {
    "astro:build:done": ({ dir, logger }) => {
      // String(): wrangler types reads SITE_ENV as always "dev", its value in wrangler.jsonc
      const siteEnv = String(process.env.SITE_ENV) === "production" ? "production" : "dev";
      const file = new URL("_headers", dir);
      const there = existsSync(file) ? readFileSync(file, "utf8") : "";
      writeFileSync(file, headersFile(siteEnv) + (there && `\n${there}`));
      logger.info(`_headers written for ${siteEnv}`);
    },
  },
});
