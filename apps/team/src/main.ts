import "./app.css";
import { ApiError, getBootstrap, running } from "./app/api";
import { isStaleCode, recoverOnce } from "./app/stale-code";
import { hydrate } from "./demo/data";

// The club's data comes first: the store and the app's modules read it as they load, so they're imported only
// after it's in place. Nothing above may import the store. Nobody signed in: the sign-in screen, which reloads the
// page once they are.
const target = document.getElementById("app")!;
// Errors to Sentry (ADR 0111), started beside the club's data rather than before it: a built copy only
const dsn = import.meta.env.VITE_SENTRY_DSN;
if (dsn) void import("./app/errors").then(({ startErrorReports }) => startErrorReports(dsn)).catch(() => {});
try {
  hydrate(await getBootstrap());
  const [{ mount }, { default: App }] = await Promise.all([import("svelte"), import("./App.svelte"), firstPage()]);
  mount(App, { target });
  running.app = true;
  unsplash();
  // In the store app (ADR 0108): links and notifications open their page; nothing in a browser
  const [{ startInApp }, { navigate }] = await Promise.all([import("./app/native"), import("./app/router.svelte")]);
  void startInApp((path) => navigate(path)).catch(() => {});
} catch (e) {
  if (e instanceof ApiError && e.status === 401) {
    const [{ mount }, { default: SignIn }] = await Promise.all([import("svelte"), import("./pages/SignIn.svelte")]);
    mount(SignIn, { target });
  } else if (!(isStaleCode(e) && newCode())) showError(e);
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

// The page you're opening, so the app's first paint has it (each page is its own chunk: app/pages.svelte.ts)
async function firstPage() {
  const [{ routes }, { routeFor }, { loadPage }] = await Promise.all([
    import("./app/routes.svelte"),
    import("./app/nav-routes"),
    import("./app/pages.svelte"),
  ]);
  const all = routes();
  await loadPage((routeFor(all, location.pathname) ?? routeFor(all, "/")!).page);
}

/** The splash (index.html) fades once the first screen is up, over it, so nothing moves underneath. */
function unsplash() {
  const splash = document.getElementById("splash");
  if (!splash) return;
  splash.classList.add("gone");
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

// Only built copies register the service worker; in dev it would serve stale modules.
if (import.meta.env.PROD && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
