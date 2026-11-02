// A member's bank-transfer reference (apps/team/worker/dues/README.md): "COUGARS ADRIAN K", their first name and surname initial, so
// it reads as a person on the statement. UK banks take 18 characters, A–Z, digits and spaces. A second Adrian K
// gets "COUGARS ADRIAN K2". Set once when the member is made and never changed after, even if the name is.
// Plain TypeScript with no imports, so the roster seed (scripts/lib/roster.mjs) runs it under Node too.

export const REFERENCE_PREFIX = "COUGARS";
/** The most a UK bank reference holds. */
export const REFERENCE_MAX = 18;
/** Clashes take a digit, 2 to 9; past that, the member's id. */
const SUFFIXES = ["", "2", "3", "4", "5", "6", "7", "8", "9"];

/** Letters a bank takes: accents dropped, ł → L, ß → SS, anything else gone. */
function letters(word: string): string {
  return word
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[łŁ]/g, "L")
    .replace(/[øØ]/g, "O")
    .replace(/ß/g, "SS")
    .replace(/[æÆ]/g, "AE")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

/** "Adrian Kaczmarczyk" → "COUGARS ADRIAN K". Room is always left for a clash digit. */
export function referenceBase(name: string): string {
  const words = name.split(/\s+/).map(letters).filter(Boolean);
  if (!words.length) return `${REFERENCE_PREFIX} MEMBER`;
  const initial = words.length > 1 ? ` ${words[words.length - 1][0]}` : "";
  const room = REFERENCE_MAX - REFERENCE_PREFIX.length - 1 - initial.length - 1;
  return `${REFERENCE_PREFIX} ${words[0].slice(0, room)}${initial}`;
}

/** The references to try for a name, in order: the base, then the base with 2 to 9. */
export const referenceCandidates = (name: string): string[] => SUFFIXES.map((s) => referenceBase(name) + s);

/**
 * SQL that gives the members matched by `where` the first free candidate, if they have no reference yet. With
 * all nine taken it falls back to the prefix and the id. `where` binds its own params, after the candidates.
 */
export function assignReferenceSql(name: string, where: string): { sql: string; candidates: string[] } {
  const candidates = referenceCandidates(name);
  const values = candidates.map((_, i) => `(${i}, ?)`).join(", ");
  return {
    candidates,
    sql:
      `UPDATE members SET payment_reference = COALESCE(` +
      `(SELECT column2 FROM (VALUES ${values}) WHERE column2 NOT IN ` +
      `(SELECT payment_reference FROM members WHERE payment_reference IS NOT NULL) ORDER BY column1 LIMIT 1), ` +
      `'${REFERENCE_PREFIX} ' || id) WHERE payment_reference IS NULL AND ${where}`,
  };
}
