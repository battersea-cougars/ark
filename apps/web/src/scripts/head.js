// The first script in every page (layouts/Base.astro), a plain file rather than inline so the content security
// policy needs no exceptions (ADR 0036). It blocks while it loads, so it runs before anything else.

// Errors in our scripts reach Sentry (ADR 0110, pages/api/client-error.ts): first in the page, so it hears everything.
// Each distinct error once per page, a few at most; the server keeps only those from our own /_astro/ scripts.
// Code that catches its own error calls window.reportError?.(e) as usual: the browser hands it here too.
(() => {
  const seen = new Set();
  const send = (e) => {
    const err = e instanceof Error ? e : new Error(String(e));
    const key = err.message + err.stack;
    if (seen.has(key) || seen.size >= 5) return;
    seen.add(key);
    const body = JSON.stringify({
      name: err.name,
      message: String(err.message),
      stack: String(err.stack || ""),
      page: location.pathname,
    });
    if (!navigator.sendBeacon?.("/api/client-error", new Blob([body], { type: "application/json" })))
      fetch("/api/client-error", { method: "POST", body, keepalive: true }).catch(() => {});
  };
  addEventListener("error", (e) => send(e.error ?? e.message));
  addEventListener("unhandledrejection", (e) => send(e.reason));
})();

// Back/forward (incl. first load from history): skip entrance motion. From ark.
try {
  const nav = performance.getEntriesByType("navigation")[0];
  if (nav && nav.type === "back_forward") document.documentElement.classList.add("navigation-restore");
} catch {
  // Navigation Timing unavailable: animate as normal.
}
