// Notifications in a browser (ADR 0108, #24): what the store app's phone gets, through the browser's own push service
// (Web Push), on Android's Chrome or Firefox, a desktop, or an iPhone with the app on its Home Screen. native.ts asks
// for them in the store app and comes here everywhere else. The browser's subscription is this device's: turned on
// from a tap, given to the club for this sign-in (PUT /api/auth/device), and given again each start, so whoever signs
// in on this browser next gets them; turned off, it's unsubscribed and forgotten.
import { api } from "./api";

declare const __VAPID_PUBLIC_KEY__: string | undefined;
/** The club's VAPID public key (wrangler.jsonc, built in): none yet, no Web Push. */
const KEY = typeof __VAPID_PUBLIC_KEY__ === "string" ? __VAPID_PUBLIC_KEY__ : "";

/**
 * Where this browser is: can't (no Web Push here), `homeScreen` (an iPhone or iPad in a Safari tab: only the app on
 * the Home Screen may have notifications), `blocked` (said no, in the browser's settings now), off, or on.
 */
export type WebPush = "unsupported" | "homeScreen" | "blocked" | "off" | "on";

const isAppleTouch = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const onHomeScreen = () =>
  matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
const supported = () => !!KEY && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** Where this browser is, as far as can be told at once: "maybe" is allowed, on if it has a subscription (webPush). */
export function webPushHere(): Exclude<WebPush, "on" | "off"> | "ask" | "maybe" {
  if (!supported()) return KEY && isAppleTouch() && !onHomeScreen() ? "homeScreen" : "unsupported";
  if (Notification.permission === "denied") return "blocked";
  return Notification.permission === "granted" ? "maybe" : "ask";
}

export async function webPush(): Promise<WebPush> {
  const here = webPushHere();
  if (here === "ask") return "off";
  if (here !== "maybe") return here;
  return (await current()) ? "on" : "off";
}

/** Whether Home should ask, once: Web Push is here, and the browser hasn't been asked (or the iPhone's way to it). */
export async function mayAsk(): Promise<boolean> {
  if (!supported()) return (await webPush()) === "homeScreen";
  return Notification.permission === "default";
}

const keyBytes = () => {
  const s = KEY.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(s + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
};
const sameKey = (sub: PushSubscription) => {
  const theirs = sub.options.applicationServerKey;
  if (!theirs) return false;
  const a = new Uint8Array(theirs);
  const b = keyBytes();
  return a.length === b.length && a.every((x, i) => x === b[i]);
};

/** The service worker that shows notifications (public/sw.js): a built copy's (main.ts), or, on the dev server, one
 * that only does notifications (sw.js?dev), since the cached shell would serve stale modules there. */
async function worker(): Promise<ServiceWorkerRegistration> {
  if (!(await navigator.serviceWorker.getRegistration("/")))
    await navigator.serviceWorker.register(import.meta.env.PROD ? "/sw.js" : "/sw.js?dev");
  return navigator.serviceWorker.ready;
}

async function current(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** This browser's subscription, with the club's key (a new key pair: the old subscription goes, a new one comes). */
async function subscribe(reg: ServiceWorkerRegistration): Promise<PushSubscription> {
  const sub = await reg.pushManager.getSubscription();
  if (sub && sameKey(sub)) return sub;
  await sub?.unsubscribe();
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes() });
}

const give = (sub: PushSubscription) => api("PUT", "/api/auth/device", { platform: "web", subscription: sub.toJSON() });

/** From a tap: the browser's own question, then this browser's subscription to the club. Whether they're on. */
export async function turnOn(): Promise<boolean> {
  if (!supported()) return false;
  if ((await Notification.requestPermission()) !== "granted") return false;
  await give(await subscribe(await worker()));
  return true;
}

/** Off on this device: forgotten by the club, and unsubscribed. */
export async function turnOff() {
  const sub = await current();
  if (!sub) return;
  await api("DELETE", "/api/auth/device", { token: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}

/**
 * The app's start, signed in: a tapped notification opens its page here (sw.js tells the open window), and
 * notifications already on in this browser are given to this sign-in again (as the store app does).
 */
export async function startWebPush(navigate: (path: string) => void) {
  if (!supported()) return;
  navigator.serviceWorker.addEventListener("message", (e: MessageEvent) => {
    const path = e.data?.type === "notification-tap" ? e.data.path : null;
    if (typeof path === "string" && path.startsWith("/")) navigate(path);
  });
  if (Notification.permission !== "granted" || !(await current())) return;
  await give(await subscribe(await worker()));
}
