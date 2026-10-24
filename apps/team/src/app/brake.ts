// The app's own brake (ADR 0055). The club's Cloudflare allowance is free and daily (Worker requests, D1 reads), and
// a request our Worker refuses still counts, so the cheapest protection is the app itself not running away:
//
//   - Background checks for others' changes wait after a failure: 10 s, doubling each time, up to 5 minutes. A
//     success puts them back. A refusal about the request itself (403, 409…) isn't the server failing.
//   - One tab makes at most `perDay` calls a day (UTC, as Cloudflare counts): a loop can't spend the club's day.
//   - Cloudflare's error 1027 means the day's Worker requests are used up: nothing is sent until they reset at
//     midnight UTC, and the app says when that is. Any other 429 that isn't ours (ours say why, as JSON), such as
//     a bot challenge or a platform blip, only slows the background checks for a minute.

import { londonClock } from "../lib/dates";

const FIRST_WAIT_MS = 10_000;
const MAX_WAIT_MS = 5 * 60_000;
/** Our own per-minute limit (worker/api/api.limits.ts): try again once the minute's up. */
const LIMITED_WAIT_MS = 60_000;
const DAY_MS = 86_400_000;

const nextMidnightUtc = (t: number) => Math.floor(t / DAY_MS) * DAY_MS + DAY_MS;

export class Brake {
  private readonly now: () => number;
  private readonly perDay: number;
  private wait = FIRST_WAIT_MS;
  private checkAt = 0;
  private restingUntil = 0;
  private day = -1;
  private calls = 0;

  constructor({ now = Date.now, perDay = 3000 }: { now?: () => number; perDay?: number } = {}) {
    this.now = now;
    this.perDay = perDay;
  }

  /** Before any call: null to go ahead (it's counted), else why not. */
  take(): string | null {
    const t = this.now();
    if (t < this.restingUntil)
      return `The club's app has used today's free allowance. It's back at ${londonClock(this.restingUntil)}.`;
    const day = Math.floor(t / DAY_MS);
    if (day !== this.day) [this.day, this.calls] = [day, 0];
    if (this.calls >= this.perDay)
      return "This tab has paused itself after a lot of requests today. Close it and open the app again.";
    this.calls++;
    return null;
  }

  /** Whether a background check (not something you tapped) should go ahead now. */
  mayCheck(): boolean {
    const t = this.now();
    if (t < this.restingUntil || t < this.checkAt) return false;
    const day = Math.floor(t / DAY_MS);
    return day !== this.day || this.calls < this.perDay;
  }

  /** The server answered: its status, whether the body was ours (JSON), and whether it was Cloudflare's 1027. */
  answered(status: number, ours: boolean, dailyLimit = false) {
    const t = this.now();
    if (dailyLimit) {
      this.restingUntil = nextMidnightUtc(t);
    } else if (status === 429) {
      this.checkAt = t + LIMITED_WAIT_MS;
    } else if (status >= 500) {
      this.failed();
    } else {
      this.wait = FIRST_WAIT_MS;
      this.checkAt = 0;
    }
  }

  /** The request didn't reach the server (offline, the network dropped it). */
  failed() {
    this.checkAt = this.now() + this.wait;
    this.wait = Math.min(this.wait * 2, MAX_WAIT_MS);
  }
}
