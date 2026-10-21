// The store app (ADR 0108): the same team app, loaded by a native shell, which lends it the phone's own features.
// Everything here asks `inApp` first and falls back to what a browser does, so the web app is unchanged; it only asks
// "is this the app", never "is this an iPhone", so Android works the same when it comes.
import { Capacitor } from "@capacitor/core";

export const inApp = Capacitor.isNativePlatform();

/** A buzz, as when the scorekeeper's time runs out. */
export async function buzz(pattern: number[]) {
  if (!inApp) return void navigator.vibrate?.(pattern);
  const { Haptics, NotificationType } = await import("@capacitor/haptics");
  await Haptics.notification({ type: NotificationType.Warning });
}

/** Keep the screen on (the game clock); call what it returns to let it sleep again. */
export async function keepAwake(): Promise<() => void> {
  if (inApp) {
    const { KeepAwake } = await import("@capacitor-community/keep-awake");
    await KeepAwake.keepAwake();
    return () => void KeepAwake.allowSleep();
  }
  const lock = await navigator.wakeLock?.request("screen").catch(() => null);
  return () => void lock?.release();
}

/** A calendar file: the browser downloads it; the app hands it to the share sheet (Calendar is one of its choices). */
export async function saveCalendar(name: string, ics: string) {
  if (inApp) {
    const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
      import("@capacitor/filesystem"),
      import("@capacitor/share"),
    ]);
    const file = await Filesystem.writeFile({
      path: `${name.replace(/[^\w ]+/g, "").trim() || "event"}.ics`,
      data: ics,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    await Share.share({ title: name, files: [file.uri] });
    return;
  }
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `${name}.ics` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Whether to ask about notifications, once: "ask" (not yet asked: in the app, or a browser with Web Push, #24),
 * "homeScreen" (an iPhone in a Safari tab, where only the app on the Home Screen may have them: say how), or no.
 */
export async function mayAskToNotify(): Promise<"ask" | "homeScreen" | false> {
  if (!inApp) {
    const { mayAsk, webPush } = await import("./web-push");
    if (!(await mayAsk())) return false;
    return (await webPush()) === "homeScreen" ? "homeScreen" : "ask";
  }
  const { FirebaseMessaging } = await import("@capacitor-firebase/messaging");
  return (await FirebaseMessaging.checkPermissions()).receive === "prompt" && "ask";
}

/** Ask the phone (or the browser) for notifications, after saying why, from a tap; yes, and this sign-in gets them. */
export async function askToNotify(): Promise<boolean> {
  if (!inApp) return (await import("./web-push")).turnOn();
  const { FirebaseMessaging } = await import("@capacitor-firebase/messaging");
  const yes = (await FirebaseMessaging.requestPermissions()).receive === "granted";
  if (yes) await register();
  return yes;
}

/** This phone's token, to the club: once a start (tokens change), and whenever Firebase gives a new one. */
async function register() {
  const [{ FirebaseMessaging }, { api }] = await Promise.all([
    import("@capacitor-firebase/messaging"),
    import("./api"),
  ]);
  const { token } = await FirebaseMessaging.getToken();
  await api("PUT", "/api/auth/device", { token, platform: Capacitor.getPlatform() });
}

/**
 * The app's start, signed in: a link to the team app (an email's) opens its page here, and so does tapping a
 * notification; notifications already allowed register this sign-in again.
 */
export async function startInApp(navigate: (path: string) => void) {
  if (!inApp) return;
  const [{ App }, { FirebaseMessaging }] = await Promise.all([
    import("@capacitor/app"),
    import("@capacitor-firebase/messaging"),
  ]);
  const go = (url: string) => {
    const u = new URL(url, location.origin);
    if (u.origin === location.origin) navigate(u.pathname + u.search);
  };
  await App.addListener("appUrlOpen", ({ url }) => go(url));
  await FirebaseMessaging.addListener("notificationActionPerformed", ({ notification }) => {
    const path = (notification.data as { path?: string } | undefined)?.path;
    if (path) go(path);
  });
  await FirebaseMessaging.addListener("tokenReceived", () => void register().catch(() => {}));
  if ((await FirebaseMessaging.checkPermissions()).receive === "granted") await register().catch(() => {});
}
