// Cloudflare Turnstile on the sign-in page (#13, ADR 0028): asking for a code and asking to join send a token that
// says a person is asking. The widget is managed and shown only when Cloudflare wants a tap ("interaction-only"), so
// most members never see it. Its script comes from challenges.cloudflare.com (the CSP allows it, worker/index.ts),
// loaded only on this page. No site key (your machine): nothing loads, nothing is sent, and the server doesn't check.
const SITE_KEY: string = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? "";
const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface Turnstile {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
}
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

const NOT_CHECKED = "We couldn't check you're a person. Reload the page and try again.";
/** Long enough for a tap on the widget, when Cloudflare asks for one. */
const WAIT_MS = 60_000;

let loading: Promise<Turnstile> | null = null;
function load(): Promise<Turnstile> {
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error(NOT_CHECKED)));
    s.onerror = () => {
      loading = null;
      reject(new Error(NOT_CHECKED));
    };
    document.head.append(s);
  });
  return loading;
}

/**
 * One form's check: `attach` it to the element the widget goes in (`{@attach check.attach}`), then `token()` as it's
 * sent (waits for the widget if it's still working, or the member's tap) and `reset()` after, since a token is good
 * once. Without a site key, `token()` is undefined and nothing loads.
 */
export function humanCheck(action: "sign-in" | "join") {
  let widget: string | undefined;
  let current = "";
  let failed = false;
  let waiting: { resolve: (t: string) => void; reject: (e: Error) => void }[] = [];
  const settle = (token: string | null) => {
    const all = waiting;
    waiting = [];
    for (const w of all) {
      if (token) w.resolve(token);
      else w.reject(new Error(NOT_CHECKED));
    }
  };

  function attach(el: HTMLElement) {
    if (!SITE_KEY) return;
    let gone = false;
    load()
      .then((ts) => {
        if (gone) return;
        widget = ts.render(el, {
          sitekey: SITE_KEY,
          action,
          appearance: "interaction-only",
          theme: "dark",
          callback: (token: string) => {
            current = token;
            failed = false;
            settle(token);
          },
          "expired-callback": () => (current = ""),
          "error-callback": () => {
            failed = true;
            settle(null);
          },
        });
      })
      .catch(() => {
        failed = true;
        settle(null);
      });
    return () => {
      gone = true;
      if (widget) window.turnstile?.remove(widget);
      widget = undefined;
    };
  }

  /** The token to send; undefined where there's no Turnstile. Throws a sentence to show if there's none to be had. */
  async function token(): Promise<string | undefined> {
    if (!SITE_KEY) return undefined;
    if (current) return current;
    if (failed) throw new Error(NOT_CHECKED);
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(NOT_CHECKED)), WAIT_MS);
      waiting.push({
        resolve: (t) => (clearTimeout(timer), resolve(t)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
    });
  }

  /** Spent (sent once): the widget makes a new one for next time. */
  function reset() {
    current = "";
    failed = false;
    if (widget) window.turnstile?.reset(widget);
  }

  return { attach, token, reset };
}
