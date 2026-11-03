// A newer build is out (ADR 0022). An installed app can stay open for days on the code it started with; every
// bootstrap says which build answered (worker/api/api.version.ts), and when that isn't this one, the shell offers a reload.
// Never forced: a reload could land mid-form or mid-game.
import { APP_BUILD } from "./build";

export const update = $state({ ready: false, dismissed: false });

/** What a bootstrap said answered it. */
export function heardBuild(build: string | null) {
  if (!build || build === "dev" || APP_BUILD === "dev") return;
  update.ready = build !== APP_BUILD;
}
