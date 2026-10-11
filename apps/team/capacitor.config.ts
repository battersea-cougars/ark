// The team app in the app stores (ADR 0108): a native shell that loads the live team app, so sign-in, live updates
// and every change work exactly as in a browser, and a web deploy updates the app. One config for iPhone and Android.
// Which server: CAP_SERVER_URL (store.yml sets production's for a release), else dev's.
import type { CapacitorConfig } from "@capacitor/cli";

export const SERVER_URL = process.env.CAP_SERVER_URL ?? "https://team.cougars-dev.workers.dev";

const config: CapacitorConfig = {
  appId: "com.batterseacougars.team",
  appName: "Cougars Fresh Meat",
  // Only the offline screen lives in the app; everything else comes from the server
  webDir: "native",
  server: { url: SERVER_URL, errorPath: "offline.html" },
  backgroundColor: "#0e0d0b",
  ios: { contentInset: "never", limitsNavigationsToAppBoundDomains: true },
  plugins: {
    SplashScreen: { launchAutoHide: true, launchShowDuration: 0, backgroundColor: "#0e0d0b" },
    // A notification that arrives while the app is open still shows
    FirebaseMessaging: { presentationOptions: ["badge", "sound", "alert"] },
  },
};

export default config;
