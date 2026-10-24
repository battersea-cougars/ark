// The club as the app holds it, from the core and the pages' parts (#178): each list the pages read is the core's and
// a page's put together, so a page doesn't care which the rows came from. The roster's rows, with your own from
// Home's people (the roster everyone of a role shares leaves your private details out) and anyone Home names that it
// doesn't have; the nights from tonight and the weeks just held; Home's tournaments and each series' last one played;
// your own dues line and everyone's. The app's store (demo/data.ts) and the tests' fake app (worker/testing.ts) both
// put the club together here.
//
// No imports: the tests' Worker side uses it too.

interface Member {
  id: number;
}
interface Night {
  id: number;
  heldOn: string;
}
interface Edition {
  id: number;
  heldOn: string;
}
interface Owing {
  memberId: number;
  owed: number;
  oldest: number;
}

/** Everyone: the roster's rows (`roster`, if it's been read), your own and anyone else Home names from `people`. */
export function membersOf<T extends Member>(roster: T[] | undefined, people: T[], you: number): T[] {
  if (!roster) return people;
  const yours = people.find((p) => p.id === you);
  const named = new Set(roster.map((m) => m.id));
  const rows = roster.map((m) => (m.id === you && yours ? yours : m));
  return [...rows, ...people.filter((p) => !named.has(p.id))];
}

/** One list from two, by id, the first's row where both have one, in the order `by` says. */
function together<T extends { id: number }>(first: T[], second: T[] | undefined, by: (a: T, b: T) => number): T[] {
  const ids = new Set(first.map((row) => row.id));
  return [...first, ...(second ?? []).filter((row) => !ids.has(row.id))].sort(by);
}

/** The nights from tonight, and the weeks just held, by day. */
export const nightsOf = <T extends Night>(next: T[], past: T[] | undefined) =>
  together(next, past, (a, b) => a.heldOn.localeCompare(b.heldOn) || a.id - b.id);

/** Home's tournaments, and each series' last one played, by day. */
export const tournamentsOf = <T extends Edition>(home: T[], last: T[] | undefined) =>
  together(home, last, (a, b) => a.heldOn.localeCompare(b.heldOn));

/** What each owes: everyone's (if read), with your own, worst first as the server orders them. */
export function duesOf<T extends Owing>(yours: T[], everyone: T[] | undefined): T[] {
  if (!everyone?.length) return yours;
  const named = new Set(everyone.map((d) => d.memberId));
  return [...everyone, ...yours.filter((d) => !named.has(d.memberId))].sort(
    (a, b) => b.oldest - a.oldest || b.owed - a.owed || a.memberId - b.memberId,
  );
}
