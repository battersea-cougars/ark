import { characters, firstCharacter, firstCharacters } from "./text";

/**
 * A team's logo, shrunk in the browser to 256px on its longest side so it's small enough to keep in the database:
 * WebP where the browser can write it, else PNG. Throws when the file isn't an image it can read.
 */
export async function shrinkLogo(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const webp = canvas.toDataURL("image/webp", 0.85);
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/png");
}

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
