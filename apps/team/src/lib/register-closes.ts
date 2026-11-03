// When a training night's register closes (apps/team/worker/training/README.md), shared by the app and the Worker: at
// 06:00 London the morning after. Until then whoever takes the register ticks who came and the charges follow; from
// then it's the record, and nothing changes who was there.
import { dayWords, londonEvening } from "./dates";
import { addDays } from "./recurrence";

/** Whether a night held on `heldOn` (London YYYY-MM-DD) has its register closed at `now`. */
export const registerClosed = (heldOn: string, now = new Date()) => londonEvening(now) > heldOn;

/** What the server says when it's asked to change a closed register. */
export const REGISTER_CLOSED = "The register's closed: it closed at 6am the morning after.";

/** The morning it closes, its weekday: "Sat" for a Friday. */
export const registerClosesOn = (heldOn: string) => dayWords(addDays(heldOn, 1), { weekday: "short" });

/** The night's line once it's closed, where In and Out were: "Over: the register closed Sat morning". */
export const registerClosedWords = (heldOn: string) => `Over: the register closed ${registerClosesOn(heldOn)} morning`;
