// Counts the build's own Sanity requests (ADR 0003): prerendering runs outside any Worker, so what it counted
// (packages/shared/sanity-requests.ts) goes to the environment's D1 over Cloudflare's API once the build is done.
// Never fails a build.
import type { AstroIntegration } from "astro";
import { ADD_SQL, takeSanityRequests } from "@cougars/shared/sanity-requests";
import { remoteD1 } from "../../../../../scripts/lib/d1-api.mjs";

export const sanityBuildCount = (): AstroIntegration => ({
  name: "cougars:sanity-count",
  hooks: {
    // In `astro dev`, each page asked for and who asked (`dev.page`): prerendered pages get no headers, so their
    // Sanity reads (`sanity.read`, with the route) are matched to a browser, crawler or script through this
    "astro:server:setup": ({ server, logger }) => {
      server.middlewares.use((req, _res, next) => {
        const path = req.url?.split("?")[0] ?? "";
        // Pages only: not Vite's modules, images or other files
        if (req.method === "GET" && !/^\/(@|_|node_modules)|\.[a-z0-9]+$/i.test(path))
          logger.info(`dev.page ${path} ${JSON.stringify(req.headers["user-agent"] ?? null)}`);
        next();
      });
    },
    "astro:build:done": async ({ logger }) => {
      const rows = takeSanityRequests();
      if (!rows.length) return;
      const sum = (kind: string) => rows.filter((r) => r.kind === kind).reduce((n, r) => n + r.count, 0);
      const said = `${sum("cdn")} to the API CDN, ${sum("api")} to the API (${rows[0].project})`;
      // Only CI has the account's token (deploy.yml); a local build reads the dev project and is only said
      if (!process.env.CI) return logger.info(`Sanity requests: ${said}. Not counted: a local build (ADR 0003).`);
      try {
        const query = await remoteD1(String(process.env.SITE_ENV) === "production" ? "production" : "dev");
        await query(ADD_SQL, [JSON.stringify(rows)]);
        logger.info(`Sanity requests: ${said}, counted.`);
      } catch (error) {
        // The build's own log, not Sentry (a build has no reporter): a count missed here only leaves the Usage page low
        logger.warn(`Sanity requests: ${said}, not counted: ${(error as Error).message}`);
      }
    },
  },
});
