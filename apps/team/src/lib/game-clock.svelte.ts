// The game clock as everyone sees it (ADR 0130): time left now, from when it last stopped and when it was started
// again, and the break between periods, ticking once a second while any page shows it.
import type { TournamentGame } from "../demo/model";
import { breakLeft } from "./periods";

const tick = $state({ now: Date.now() });
let users = 0;
let timer: ReturnType<typeof setInterval> | undefined;

/** Keep the clock ticking while a page shows it: call in an effect, and call what it returns on the way out. */
export function ticking() {
  if (!users++) timer = setInterval(() => (tick.now = Date.now()), 1000);
  return () => {
    if (!--users) clearInterval(timer);
  };
}

/** Milliseconds left on a game's clock now. */
export function leftOf(g: Pick<TournamentGame, "clockLeftMs" | "clockStartedAt">) {
  const since = g.clockStartedAt ? tick.now - Date.parse(g.clockStartedAt) : 0;
  return Math.max(0, (g.clockLeftMs ?? 0) - since);
}

/** What's left of the break before the next period now (lib/periods.ts breakLeft): null when there's none on. */
export const breakLeftOf = (g: Pick<TournamentGame, "periodEndedAt" | "clockStartedAt">, breakMinutes: number) =>
  breakLeft(g, breakMinutes, tick.now);

/** As the scoreboard shows it: 7:42. */
export const mmss = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
