// The Kumite simulation (ADR 0123, dev only): its run as a store, and its moves sent as changes. Apart from the backend,
// so only the pages and the control that use it load it: no phone downloads it before Home paints (ADR 0120).
import { api } from "./api";
import { save, tell } from "./backend.svelte";
import { simulator, type Move, type SimulationState } from "../lib/simulation";

/**
 * The Kumite simulation (ADR 0123, dev only): which tournament, running or paused, its speed and its last move. A
 * store, so the floating control (lib/SimulationControl) keeps it across the Kumite's views and the draft room; a
 * reload ends it (run again, it carries on from where it is).
 */
export const simulating = $state<SimulationState>({ id: 0, status: "idle", speed: "kata", said: "" });
/**
 * The Kumite played on to its after-party, a move a request (a few at Spin kick), paced so each plays out on the page (lib/simulation.ts),
 * the live hub telling everyone watching. Stops at the first refusal (too few signed up, the minute's changes used
 * up), saying why: run again, it carries on from there.
 */
export const simulation = simulator(
  simulating,
  (tournamentId, moves, onItsDay) =>
    save(
      () =>
        api<Move>("POST", `/api/tournaments/${tournamentId}/simulate`, { moves, ...(onItsDay && { onItsDay: true }) }),
      "",
    ),
  (last) => {
    if (last?.done) tell(last.said);
  },
);
/**
 * Dev only (ADR 0123): a Kumite on a day gone by, signed up for, then played out on that evening to its last award
 * by the simulator, at Spin kick unless another speed's chosen, so it's history with a whole evening behind it.
 */
export async function playOnAPastDay(typeId: number, heldOn: string) {
  const made = await save(() => api<{ id: number }>("POST", "/api/tournaments/past-day", { typeId, heldOn }), "");
  if (!made) return null;
  if (simulating.speed === "kata") simulation.speed("spinKick");
  void simulation.start(made.id, true);
  return made;
}
