import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { cloudflare } from "@cloudflare/vite-plugin";
import { takeOverPort } from "../../scripts/lib/dev-server.mjs";

const PORT = 4510;
// The browser's libraries are package.json "dependencies" (scripts/team-app-deps.test.mjs holds every import to that).
const pkg = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8"));

// Port 4510 is the team app's (README, Ports). strictPort: never drift onto another project's port. Under the show
// switch (`npm run team`, ADR 0115) it runs on a private port given as --port, and 4510 forwards to it.
// The Worker (worker/, the API) runs inside Vite on the same port. Local D1 is the website's
// (apps/web/.wrangler), so `npm run db:rebuild:local` and the roster seed serve both; a worktree's apps use main's
// (COUGARS_LOCAL_STATE, set by the switch) unless it asked for its own.
export default defineConfig(({ command }) => ({
  // Which build this is (ADR 0104, src/app/build.ts), in the app and its Worker alike: the release's version, and the
  // commit as the build id (CI's PUBLIC_BUILD_VERSION ends "+<commit>"; a build on your machine asks git). The dev
  // server is "dev", so it never offers a reload.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD__: JSON.stringify(command === "serve" ? "dev" : buildId()),
  },
  plugins: [
    oneDevServer(PORT),
    waitForDepsCache(),
    firstScreen(),
    svelte(),
    cloudflare({
      persistState: { path: process.env.COUGARS_LOCAL_STATE || "../../apps/web/.wrangler/state" },
      // `vite` on your machine is "local": nothing is emailed, so sign-in shows the code on screen. With
      // TEAM_AUTO_ADMIN=1 in the shell (screenshots, quick looks) nobody needs to sign in: you're the first admin.
      // A build never carries either.
      config:
        command === "serve"
          ? {
              vars: {
                TEAM_ENV: "local",
                TEAM_AUTO_ADMIN: process.env.TEAM_AUTO_ADMIN === "1" ? "1" : "",
                // The Usage page (ADR 0059), when started through env-pull: in memory, never in a file
                CLOUDFLARE_ANALYTICS_TOKEN: process.env.CLOUDFLARE_ANALYTICS_TOKEN ?? "",
                CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
              },
            }
          : undefined,
    }),
  ],
  // Vite bundles libraries for the browser and stamps their URLs. If it finds a new one mid-session (a screen
  // that wasn't reached at startup), it rebundles, the stamp changes, and an open tab 504s on the old URLs.
  // So crawl every source file at startup, not just what index.html reaches, and bundle every dependency up front.
  // Svelte's own entry points are added by the Svelte plugin.
  optimizeDeps: {
    entries: ["index.html", "src/**/*.svelte", "src/**/*.ts", "!src/**/*.test.ts"],
    // Our own packages (@cougars/shared) are source, served as is so an edit reloads; only libraries are bundled
    include: Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith("@cougars/")),
  },
  // The notifications plugin's web build wants the Firebase web SDK; the app never uses it (src/app/no-web-push.ts)
  resolve: { alias: { "firebase/messaging": fileURLToPath(new URL("src/app/no-web-push.ts", import.meta.url)) } },
  // Source maps for Sentry (ADR 0111): written but never linked from the files; the deploy uploads them, then deletes
  // them before the files go live
  build: { sourcemap: "hidden" },
  server: { port: PORT, strictPort: true, host: true },
  preview: { port: PORT, strictPort: true, host: true },
}));

// One dev server per checkout. The show switch runs it and never starts a second in the same checkout (ADR 0115); a
// `vite` started by hand takes over 4510 (scripts/lib/dev-server.mjs): it stops the running one before Vite rebuilds
// node_modules/.vite, so two never share the cache. Vite's own restart after a config edit is the same process, so
// it's let through, and tools that only read this config (svelte-check) aren't the `vite` command, so they're left
// alone.
function oneDevServer(port: number): Plugin {
  return {
    name: "cougars:one-dev-server",
    apply: "serve",
    async config() {
      if (!/[\\/]vite(\.js)?$/.test(process.argv[1] ?? "") || process.env.COUGARS_APP_SUPERVISOR) return;
      await takeOverPort(port, fileURLToPath(new URL("node_modules/.cache/dev-server.pid", import.meta.url)));
    },
  };
}

// Vite restarts itself in the same process (index.html or wrangler.jsonc edited, workerd restarted). It tells the open
// tab to reload and builds the new server while the old one still answers: the reload lands in that gap, main.ts is
// stamped with a throwaway hash (svelte.js?v=<new>), the new server keeps that transform, and every load 504s until a
// full restart. So once a restart is done, drop every cached transform (the tab's stale-code reload, src/main.ts,
// then gets a good main.ts), and hold requests until the dependency optimizer has read node_modules/.vite.
function waitForDepsCache(): Plugin {
  return {
    name: "cougars:wait-for-deps-cache",
    apply: "serve",
    configureServer(server) {
      const restart = server.restart.bind(server);
      server.restart = async (forceOptimize) => {
        await restart(forceOptimize);
        // `server` is the same object after a restart, holding the new server's environments
        for (const environment of Object.values(server.environments)) environment.moduleGraph.invalidateAll();
      };
      server.middlewares.use(async (_req, _res, next) => {
        const optimizer = server.environments.client.depsOptimizer;
        for (const end = Date.now() + 15_000; optimizer && optimizer.initState !== "initialized" && Date.now() < end;)
          await new Promise((resolve) => setTimeout(resolve, 25));
        next();
      });
    },
  };
}

// The first screen, fetched all at once (docs/adr/0120-team-app-first-paint.md). main.ts reads the club's data before
// it imports the app (the store reads it as it loads), so without this the browser only learns of App and Home once
// /api/bootstrap is back, then finds their imports one level at a time: three trips in a row on a phone's network.
// Listed here, every file Home's first paint needs is fetched beside the data (modulepreload: fetched and parsed,
// never run early), and the build fails if they grow past the budget.
const FIRST_SCREEN = [
  "/svelte/src/index-client.js", // mount()
  "/src/App.svelte",
  "/src/app/routes.svelte.ts",
  "/src/app/nav-routes.ts",
  "/src/app/pages.svelte.ts",
  "/src/pages/Home.svelte", // where the app opens (manifest start_url); another page's link loads its own chunk
];
/** The first screen's JavaScript, gzipped: 76 kB when this was set (2026-10-21); about a third more is room to grow. */
const FIRST_SCREEN_BUDGET_KB = 100;

function firstScreen(): Plugin {
  return {
    name: "cougars:first-screen",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html, { bundle }) {
        if (!bundle) return html;
        const chunks = Object.values(bundle).filter((file) => file.type === "chunk");
        const js = new Set<string>();
        const css = new Set<string>();
        const take = (chunk: (typeof chunks)[number]) => {
          if (js.has(chunk.fileName)) return;
          js.add(chunk.fileName);
          chunk.viteMetadata?.importedCss.forEach((file) => css.add(file));
          for (const file of chunk.imports) {
            const imported = bundle[file];
            if (imported?.type === "chunk") take(imported);
          }
        };
        // The entry's own imports Vite already links (and its stylesheet), so they aren't listed twice
        chunks.filter((chunk) => chunk.isEntry).forEach(take);
        const linked = new Set([...js, ...css]);
        for (const id of FIRST_SCREEN) {
          const chunk = chunks.find((c) => c.facadeModuleId?.endsWith(id));
          if (!chunk) throw new Error(`first screen: no chunk for ${id} (vite.config.ts FIRST_SCREEN)`);
          take(chunk);
        }
        const kb =
          [...js].reduce((sum, file) => {
            const chunk = bundle[file];
            return sum + (chunk.type === "chunk" ? gzipSync(chunk.code).length : 0);
          }, 0) / 1024;
        if (kb > FIRST_SCREEN_BUDGET_KB)
          throw new Error(
            `The first screen's JavaScript is ${kb.toFixed(1)} kB gzipped, over its ${FIRST_SCREEN_BUDGET_KB} kB budget ` +
              `(vite.config.ts, ADR 0120): load what Home doesn't need at once with import(), or raise the budget there.`,
          );
        this.info?.(
          `first screen: ${js.size} files, ${kb.toFixed(1)} kB of JavaScript gzipped (budget ${FIRST_SCREEN_BUDGET_KB})`,
        );
        const href = (file: string) => `/${file}`;
        return {
          html,
          tags: [
            ...[...js]
              .filter((file) => !linked.has(file))
              .map((file) => ({
                tag: "link",
                attrs: { rel: "modulepreload", crossorigin: true, href: href(file) },
                injectTo: "head" as const,
              })),
            ...[...css]
              .filter((file) => !linked.has(file))
              .map((file) => ({
                tag: "link",
                attrs: { rel: "preload", as: "style", crossorigin: true, href: href(file) },
                injectTo: "head" as const,
              })),
          ],
        };
      },
    },
  };
}

/** The commit being built: CI's stamp, else git's, else "dev" (no git: a tarball). */
function buildId(): string {
  const stamped = process.env.PUBLIC_BUILD_VERSION?.split("+")[1];
  if (stamped) return stamped;
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim() || "dev";
  } catch {
    return "dev";
  }
}
