// On your machine only (a dev server, which never loads Sentry, errors.ts): whatever the browser says went wrong — an
// error nothing caught, a promise nobody caught, a console.error (Svelte's own, like "Maximum update depth exceeded",
// arrive as one of these) — shows in a strip at the foot of the page, so it's seen while looking at the app, not only
// in the console. Plain DOM, not Svelte: it has to keep working when Svelte is what broke.

/** The newest few, newest first; the strip says how many in all. */
const KEEP = 5;

export function showDevErrors() {
  const seen: string[] = [];
  let count = 0;
  let strip: HTMLElement | null = null;

  const render = () => {
    strip ??= makeStrip(() => {
      strip?.remove();
      strip = null;
      seen.length = 0;
      count = 0;
    });
    const list = strip.querySelector("ol")!;
    list.replaceChildren(...seen.map((text) => Object.assign(document.createElement("li"), { textContent: text })));
    strip.querySelector("strong")!.textContent =
      count === 1 ? "1 error in the browser" : `${count} errors in the browser`;
    if (!strip.isConnected) document.body.append(strip);
  };

  const add = (text: string) => {
    count += 1;
    if (seen[0] !== text) seen.unshift(text.slice(0, 400));
    seen.length = Math.min(seen.length, KEEP);
    render();
  };

  addEventListener("error", (e) => add(messageOf(e.error ?? e.message)));
  addEventListener("unhandledrejection", (e) => add(`Unhandled: ${messageOf(e.reason)}`));
  // Wrapped, not replaced: the console still shows it
  // eslint-disable-next-line no-console
  const consoleError = console.error.bind(console);
  // eslint-disable-next-line no-console
  console.error = (...args: unknown[]) => {
    consoleError(...args);
    add(args.map(messageOf).join(" "));
  };
}

const messageOf = (x: unknown) =>
  x instanceof Error ? `${x.name === "Error" ? "" : `${x.name}: `}${x.message}` : String(x);

function makeStrip(dismiss: () => void) {
  const strip = document.createElement("aside");
  strip.setAttribute("role", "alert");
  strip.setAttribute("aria-label", "Errors in the browser (this machine only)");
  Object.assign(strip.style, {
    position: "fixed",
    insetInline: "0.75rem",
    bottom: "0.75rem",
    zIndex: "2147483647",
    maxHeight: "40vh",
    overflow: "auto",
    padding: "0.6rem 0.8rem",
    borderRadius: "0.4rem",
    background: "#1b1110",
    color: "#f3ece6",
    boxShadow: "0 0 0 2px #e5332a, 0 8px 24px rgb(0 0 0 / 0.5)",
    font: "13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace",
  } satisfies Partial<CSSStyleDeclaration>);
  const head = document.createElement("div");
  Object.assign(head.style, { display: "flex", gap: "0.75rem", alignItems: "center" });
  const title = document.createElement("strong");
  const note = Object.assign(document.createElement("span"), {
    textContent: "· this machine only · the console has more",
  });
  note.style.opacity = "0.7";
  const close = Object.assign(document.createElement("button"), { type: "button", textContent: "Dismiss" });
  Object.assign(close.style, {
    marginLeft: "auto",
    font: "inherit",
    color: "inherit",
    background: "none",
    border: "0",
    textDecoration: "underline",
    cursor: "pointer",
  });
  close.addEventListener("click", dismiss);
  head.append(title, note, close);
  const list = document.createElement("ol");
  Object.assign(list.style, {
    margin: "0.4rem 0 0",
    paddingLeft: "1.2rem",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  });
  strip.append(head, list);
  return strip;
}
