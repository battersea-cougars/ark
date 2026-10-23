// The Kumite simulator's loop (ADR 0123), dev only: a move a request (a few at Spin kick), each paced so it plays out
// on the page before the next (the draft's burn-in and the turn moving on, a goal on the scoreboard, the carousel
// gliding to the next match), and paused, resumed or stopped from the floating control (lib/SimulationControl). Pause holds after the
// move in flight; Stop ends it there. Plain logic over a state object, so app/backend.svelte.ts makes it a store that
// outlives any page, and the tests drive it with fake timers.
import { turnSteps } from "./draft-sequence";

/** What a move was (worker/tournaments/simulate.ts MoveKind). */
export type MoveKind =
  | "order"
  | "open"
  | "pick"
  | "close"
  | "fixtures"
  | "scoresheet"
  | "clock"
  | "goal"
  | "penalty"
  | "period"
  | "fulltime"
  | "done";

export interface Move {
  done: boolean;
  /** The last move made. */
  move: MoveKind;
  said: string;
  /** How many moves the request made (more than one at Spin kick). */
  moves?: number;
}

/**
 * Kata: each move plays out. Sparring: as fast as a member's changes may go (60 a minute, api.limits.ts). Spin kick:
 * as fast again, a few moves a request (worker/tournaments/simulate.ts simulateMoves).
 */
export type Speed = "kata" | "sparring" | "spinKick";

/** The most moves a request makes (worker/tournaments/simulate.ts simulateMoves, which may make fewer). */
export const MOST_MOVES = 4;

/** The moves a request asks for, at a speed: Spin kick the most. */
export const MOVES_A_REQUEST: Record<Speed, number> = { kata: 1, sparring: 1, spinKick: MOST_MOVES };

export interface SimulationState {
  /** The tournament being played out; 0: none. */
  id: number;
  status: "idle" | "running" | "paused";
  speed: Speed;
  /** The last move, in words. */
  said: string;
}

/** A pick's change of turn, as the draft room shows it: burn in, hold, scroll, highlight; then a beat. */
const TURN_MS = turnSteps().reduce((ms, s) => ms + s.ms, 0) + 100;

/**
 * How long a move takes to watch, start to start. The draft's steps (the order, opening, closing) and the end of a
 * match, which moves the carousel on to the next, get 3s; a pick its turn change (2.8s); something in a match
 * (a goal, a penalty, the clock) under 2s; the scoresheet changing hands, which barely shows, 1.2s.
 */
export const WATCH_MS: Record<MoveKind, number> = {
  order: 3000,
  open: 3000,
  pick: TURN_MS,
  close: 3000,
  fixtures: 3000,
  scoresheet: 1200,
  clock: 1500,
  goal: 1800,
  penalty: 1800,
  period: 2000,
  fulltime: 3000,
  done: 0,
};

/**
 * Never closer than this, start to start, at any speed: a member's changes are limited to 60 a minute, so 1.25s
 * keeps the simulator at 48, with room for a tap or two of the admin's own meanwhile.
 */
export const FLOOR_MS = 1250;

/** The wait after a request, at a speed: Kata each move's own, Sparring a quarter, Spin kick the floor. */
export const paceOf = (move: MoveKind, speed: Speed) =>
  Math.max(FLOOR_MS, speed === "kata" ? WATCH_MS[move] : speed === "sparring" ? WATCH_MS[move] / 4 : 0);

/** A reply in words, for the control: "3 moves: Match 2: goal" when it made more than one. */
export const saidOf = (m: Move) => ((m.moves ?? 1) > 1 ? `${m.moves} moves: ${m.said}` : m.said);

/**
 * The loop over `state`. `move` makes one request, asking for `moves` (null: refused, and said why); `ended` hears
 * how it ended (the last reply, or null when stopped or refused).
 */
export function simulator(
  state: SimulationState,
  move: (tournamentId: number, moves: number) => Promise<Move | null>,
  ended: (last: Move | null) => void = () => {},
) {
  // Each run's own number: Stop and a new start mean the old loop's reply, landing late, is dropped
  let run = 0;
  let wake: (() => void) | null = null;
  const nudge = () => wake?.();
  /** Wait `ms` (forever, if null) or till nudged. */
  const nap = (ms: number | null) =>
    new Promise<void>((go) => {
      const timer = ms === null ? undefined : setTimeout(done, ms);
      wake = done;
      function done() {
        clearTimeout(timer);
        wake = null;
        go();
      }
    });

  function reset() {
    Object.assign(state, { id: 0, status: "idle", said: "" });
  }

  async function start(tournamentId: number) {
    if (state.status !== "idle") return;
    const mine = ++run;
    Object.assign(state, { id: tournamentId, status: "running", said: "" });
    let last: Move | null;
    try {
      for (;;) {
        const began = Date.now();
        last = await move(tournamentId, MOVES_A_REQUEST[state.speed]);
        if (mine !== run) return;
        if (!last || last.done) break;
        state.said = saidOf(last);
        // Wait the move out (the speed read afresh each time it's changed), held while paused
        for (;;) {
          if (mine !== run) return;
          // (read afresh: Pause comes from a tap while this waits)
          if ((state.status as SimulationState["status"]) === "paused") {
            await nap(null);
            continue;
          }
          const left = began + paceOf(last.move, state.speed) - Date.now();
          if (left <= 0) break;
          await nap(left);
        }
      }
    } catch {
      last = null;
    }
    if (mine !== run) return;
    reset();
    ended(last);
  }

  return {
    start,
    pause() {
      if (state.status === "running") state.status = "paused";
    },
    resume() {
      if (state.status !== "paused") return;
      state.status = "running";
      nudge();
    },
    /** Ends it after the move in flight (whose reply is let go). */
    stop() {
      if (state.status === "idle") return;
      run++;
      reset();
      nudge();
      ended(null);
    },
    speed(speed: Speed) {
      state.speed = speed;
      nudge();
    },
  };
}
