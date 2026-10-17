// Stands in for `firebase/messaging` (vite.config.ts aliases it here). @capacitor-firebase/messaging's web build
// imports it, but the team app only asks for notifications inside the store app (native.ts, ADR 0108), so the
// Firebase web SDK isn't installed: in a browser, push is simply not supported.
const unsupported = () => {
  throw new Error("Notifications come through the store app, not the browser.");
};
export const isSupported = async () => false;
export const getMessaging = unsupported;
export const getToken = unsupported;
export const deleteToken = unsupported;
export const onMessage = unsupported;
