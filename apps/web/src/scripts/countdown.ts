// The home page's scoreboard (pages/index.astro): the next face-off, counting down. Prerendered as "Fridays 19:30",
// so it reads fine without JavaScript. Once What's on has loaded, its first session that's on takes over, so a
// called-off week is skipped and the two never disagree. Every 30 seconds, every second in the last hour, and not
// at all while the tab is hidden.
import { nextSession, scoreboard, type Session } from "../lib/next-session";

let timer = 0;

function liveSession(now: number): Session | null {
  const row = document.querySelector<HTMLElement>(
    "[data-whats-on] li.training:not(.cancelled)[data-starts][data-ends]",
  );
  const session = row && { startsAt: row.dataset.starts!, endsAt: row.dataset.ends! };
  return session && now < Date.parse(session.endsAt) ? session : null;
}

function start() {
  clearTimeout(timer);
  const el = document.querySelector<HTMLElement>("[data-countdown]");
  const text = el?.querySelector<HTMLElement>("[data-countdown-text]");
  if (!el || !text || document.hidden) return;
  const { day = "", start = "", end = "" } = el.dataset;
  const tick = () => {
    if (!el.isConnected || document.hidden) return;
    const now = Date.now();
    const session = liveSession(now) ?? nextSession(day, start, end, now);
    if (!session) return;
    text.textContent = scoreboard(session, now);
    const lastHour = Date.parse(session.startsAt) - now < 60 * 60_000;
    timer = window.setTimeout(tick, lastHour ? 1000 - (now % 1000) : 30_000);
  };
  tick();
}

document.addEventListener("astro:page-load", start);
document.addEventListener("visibilitychange", start);
