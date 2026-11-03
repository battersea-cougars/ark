// Which build this is (ADR 0022): the release's version (package.json "version", semver) and the build id (the
// commit), stamped by vite.config.ts into the app and its Worker alike. The dev server stamps "dev", and so does
// anything unstamped (the Worker under test), so a dev app never hears of a newer build.
declare const __APP_VERSION__: string | undefined;
declare const __APP_BUILD__: string | undefined;

export const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";
export const APP_BUILD = typeof __APP_BUILD__ === "string" ? __APP_BUILD__ : "dev";

/** The header the Worker answers with on every bootstrap: the build that answered. */
export const BUILD_HEADER = "x-app-build";
