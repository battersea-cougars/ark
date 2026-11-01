// A turn changing, as one timeline (ADR 0060): "burn in the name, scroll to next team, and then highlight" (the
// user). The data moves at once; what's shown follows this, a step at a time: the pick burns into its team's card
// (the team picking keeps its light, nothing scrolls), a moment held, then the carousels glide to the next team
// together, and only when they've arrived does the light move to it (and the bar say so); then, on a phone, if it's
// your turn, the Your pick button comes up. A pick landing meanwhile waits for the one before to finish.

export type TurnStepKind = "burn" | "hold" | "scroll" | "highlight" | "players";

export interface TurnStep {
  kind: TurnStepKind;
  /** How long the step runs before the next starts. */
  ms: number;
}

/** A pick that's landed: who was picked, onto which team, and where the turn is now. */
export interface Landing {
  memberId: number;
  /** The team that picked (in pick order). */
  team: number;
  /** The team on the clock now. */
  clock: number;
  /** Picks made, this one included. */
  made: number;
}

/** The steps of one turn's change. `toPlayers`: it's now your turn and you're following on a phone. */
export function turnSteps({ toPlayers = false, reduced = false } = {}): TurnStep[] {
  const steps: TurnStep[] = [
    { kind: "burn", ms: reduced ? 300 : 1200 },
    { kind: "hold", ms: 800 },
    { kind: "scroll", ms: reduced ? 0 : 400 },
    { kind: "highlight", ms: reduced ? 0 : 300 },
  ];
  if (toPlayers) steps.push({ kind: "players", ms: 0 });
  return steps;
}

/**
 * Runs landings through their steps one at a time, in order. `show` does a step (the page's visuals); `steps` says a
 * landing's steps; `sleep` waits (a timer on the page, at once in a test). A landing that comes in while one's running
 * waits its turn.
 */
export function sequencer(
  show: (step: TurnStep, landing: Landing) => void,
  steps: (landing: Landing) => TurnStep[],
  sleep: (ms: number) => Promise<void>,
) {
  const queue: Landing[] = [];
  let running = false;
  async function drain() {
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        const landing = queue.shift()!;
        for (const step of steps(landing)) {
          show(step, landing);
          await sleep(step.ms);
        }
      }
    } finally {
      running = false;
    }
  }
  return {
    land(landing: Landing) {
      queue.push(landing);
      return drain();
    },
    /** Whether a turn's change is showing (or waiting to). */
    get busy() {
      return running || queue.length > 0;
    },
    /** Landings waiting behind the one showing. */
    get waiting() {
      return [...queue];
    },
  };
}
