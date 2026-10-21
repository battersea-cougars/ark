// Stands in for `firebase/messaging` (vite.config.ts aliases it here). @capacitor-firebase/messaging's web build
// imports it, but the plugin only ever runs inside the store app (native.ts, ADR 0108): a browser gets notifications
// through its own push service (Web Push, web-push.ts), not Firebase, so the Firebase web SDK isn't installed.
const unsupported = () => {
  throw new Error("In a browser, notifications are Web Push (web-push.ts), not Firebase.");
};
export const isSupported = async () => false;
export const getMessaging = unsupported;
export const getToken = unsupported;
export const deleteToken = unsupported;
export const onMessage = unsupported;
