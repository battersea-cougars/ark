// Finding a member by typing (PersonPicker, the quick create's Captains): names that start with what's typed first,
// then names with a word that does, then any that has it.

export interface Findable {
  id: number;
  name: string;
}

/** Who matches `query` (all of them, alphabetical, when it's empty), at most `limit`. */
export function findPeople<T extends Findable>(pool: readonly T[], query: string, limit = 60): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return pool.slice(0, limit);
  const rank = (n: string) => {
    const s = n.toLowerCase();
    if (s.startsWith(q)) return 0;
    if (s.split(/\s+/).some((w) => w.startsWith(q))) return 1;
    return s.includes(q) ? 2 : 3;
  };
  return pool
    .map((m) => ({ m, r: rank(m.name) }))
    .filter((x) => x.r < 3)
    .sort((a, b) => a.r - b.r || a.m.name.localeCompare(b.m.name))
    .slice(0, limit)
    .map((x) => x.m);
}
