// The awards in the website's order: the champions first, then the rest as the team app keeps them. The app reveals
// the champions last, for the night's drama; a page about the Kumite leads with them.

interface Decided {
  name: string;
  decidedBy?: { kind: string; stat?: string } | null;
}

/** The champions' award: the one the table decides (ADR 0044), or, saved before awards said how, one named so. */
export const isChampions = (a: Decided): boolean =>
  a.decidedBy ? a.decidedBy.kind === "stat" && a.decidedBy.stat === "table" : /champion/i.test(a.name);

/** `awards` with the champions' first, the rest in their order. */
export const championsFirst = <T extends Decided>(awards: T[]): T[] => [
  ...awards.filter(isChampions),
  ...awards.filter((a) => !isChampions(a)),
];
