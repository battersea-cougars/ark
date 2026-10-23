// First, so it listens before anything else runs: errors from the start wait for Sentry (ADR 0111)
import { reportEarly } from "./app/errors.early";
import "./app.css";
import { mount } from "svelte";
import App from "./App.svelte";
import { ApiError, getBootstrap, running } from "./app/api";
import { start } from "./app/backend.svelte";
import { inApp, startInApp } from "./app/native";
import { routeFor } from "./app/nav-routes";
import { loadPage } from "./app/pages.svelte";
import { navigate } from "./app/router.svelte";
import { routes } from "./app/routes.svelte";
import { isStaleCode, recoverOnce } from "./app/stale-code";

// The app is imported up front, so Vite fetches all of it (Home too, app/pages.svelte.ts) with this file, beside the
// club's data, which index.html started reading at once (getBootstrap takes that reply); nothing reads the data as it
// loads (ADR 0120). The data is in place before the app mounts. Nobody signed in: the sign-in screen, which reloads the page once they are.
const club = getBootstrap();
const target = document.getElementById("app")!;
// Errors to Sentry (ADR 0111), started beside the club's data rather than before it: a built copy only. What goes wrong
// before it's up waits for it (errors.early.ts)
const dsn = import.meta.env.VITE_SENTRY_DSN;
if (dsn) void import("./app/errors").then(({ startErrorReports }) => startErrorReports(dsn)).catch(() => {});
// On your machine, where there's no Sentry: what goes wrong shows on the page (app/dev-errors.ts)
if (import.meta.env.DEV) void import("./app/dev-errors").then((d) => d.showDevErrors());
try {
  start(await club);
  await firstPage();
  mount(App, { target });
  running.app = true;
  unsplash();
  // In the store app (ADR 0108): links and notifications open their page; in a browser, Web Push's (#24)
  if (inApp) void startInApp((path) => navigate(path)).catch(() => {});
  else void import("./app/web-push").then((w) => w.startWebPush((path) => navigate(path))).catch(() => {});
} catch (e) {
  if (e instanceof ApiError && e.status === 401) {
    const { default: SignIn } = await import("./pages/SignIn.svelte");
    mount(SignIn, { target });
  } else if (!(isStaleCode(e) && newCode())) {
    // Sentry hears of it (when it's up, errors.early.ts): this is how a Safari-only failure on Home stayed unseen.
    // Not resting (429, ADR 0055): that's the club's allowance used up, which the admins are emailed about.
    if (!(e instanceof ApiError && e.status === 429)) reportEarly(e, "start");
    showError(e);
  }
  unsplash();
}

// Later too: a page opened after a deploy (or a dev server restart) asks for a file that's gone. Reload for the new code.
window.addEventListener("vite:preloadError", (e) => {
  if (newCode()) e.preventDefault();
});
window.addEventListener("unhandledrejection", (e) => {
  if (isStaleCode(e.reason)) newCode();
});

function newCode() {
  return recoverOnce(sessionStorage, () => location.reload());
}

// The page you're opening, so the app's first paint has it (Home is already in; another page is its own chunk)
async function firstPage() {
  const all = routes();
  await loadPage((routeFor(all, location.pathname) ?? routeFor(all, "/")!).page);
}

/** The splash (index.html) fades once the first screen is up, over it, so nothing moves underneath. */
function unsplash() {
  const splash = document.getElementById("splash");
  if (!splash) return;
  splash.classList.add("gone");
  // Up before the splash had painted (the club's data and the app's files both quick): no fade runs, so nothing would
  // say it ended, and the splash would sit, unseen, over the page
  if (!splash.getAnimations().length) return splash.remove();
  splash.addEventListener("transitionend", () => splash.remove(), { once: true });
  // Reduced motion, or a tab in the background, may never send transitionend
  setTimeout(() => splash.remove(), 400);
}

function showError(e: unknown) {
  // Resting (the day's free allowance is used up, ADR 0055) isn't broken: say when it's back
  const title =
    e instanceof ApiError && e.status === 429
      ? "Back soon"
      : isStaleCode(e)
        ? // A reload didn't help: in dev, the server is handing out its old bundle's addresses until it restarts
          import.meta.env.DEV
          ? "The dev server's files changed: restart it"
          : "The app has changed: reload the page"
        : "Can't reach the club's data";
  target.innerHTML = `<div class="boot-error"><p class="display"></p><p class="hint"></p></div>`;
  target.querySelector(".display")!.textContent = title;
  target.querySelector(".hint")!.textContent = e instanceof Error ? e.message : String(e);
}

// Only built copies register the service worker; in dev it would serve stale modules. A browser may refuse it (private
// browsing, some in-app browsers, crawlers): the app works without it, so that's not an error to report.
if (import.meta.env.PROD && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
