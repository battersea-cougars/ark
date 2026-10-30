// A team's crest when it has no logo: its initials, the same in the team app (lib/TeamCrest) and on the website's
// results (ADR 0100), so a team looks the same in both. Cut by whole characters, so an emoji is never split in half.

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const characters = (text: string): string[] => Array.from(segmenter.segment(text), (s) => s.segment);
const firstCharacters = (text: string, count: number) => characters(text).slice(0, count).join("");
const firstCharacter = (text: string) => firstCharacters(text, 1);

// A word that says it's a team rather than which: "Team Charlie" is known by Charlie
const GENERIC = /^(team|the|fc|club)$/i;

/** The words that name it: "Team Charlie" is ["Charlie"], "The Dim Maks" ["Dim", "Maks"] (all of them if that's all). */
function nameWords(name: string) {
  const words = name.split(/\s+/).filter(Boolean);
  const from = words.findIndex((w) => !GENERIC.test(w));
  return from < 0 ? words : words.slice(from);
}

/** Its own initials: the first two words' first letters, or a single word's first two letters. */
function ownInitials(name: string) {
  const [a = "", b] = nameWords(name);
  return (b ? firstCharacter(a) + firstCharacter(b) : firstCharacters(a, 2)).toUpperCase();
}

/** Its other choices, in order, when another team has its own: its first letter with each later one, then three. */
function fallbacks(name: string) {
  const words = nameWords(name);
  const [a = ""] = words;
  const letters = [...characters(a).slice(1), ...words.slice(1).map(firstCharacter)];
  return [...letters.map((l) => firstCharacter(a) + l), firstCharacters(a, 3)].map((x) => x.toUpperCase());
}

/**
 * A team's initials, for when it has no logo: "Team Charlie" is "CH", "The Dim Maks" is "DM". Among its tournament's
 * teams (`among`, their names in order) no two share them: the first keeps its own, a later one takes its next letters,
 * never what's another team's own.
 */
export function teamInitials(name: string, among: readonly string[] = []): string {
  if (!among.includes(name)) return ownInitials(name);
  const own = among.map(ownInitials);
  const given = new Map<string, string>();
  const used = new Set<string>();
  among.forEach((n, i) => {
    if (given.has(n)) return;
    const others = new Set(own.filter((_, j) => j > i && among[j] !== n));
    const pick =
      [own[i], ...fallbacks(n)].find((x) => x && !used.has(x) && (x === own[i] || !others.has(x))) ??
      `${firstCharacter(own[i])}${i + 1}`;
    given.set(n, pick);
    used.add(pick);
  });
  return given.get(name)!;
}
