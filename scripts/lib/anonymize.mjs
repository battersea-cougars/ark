// Dev's players under made-up names (ADR 0029): the club's roster is real people, and dev is for trying things, so
// everyone but the admins (who sign in to it) shows as someone invented. The swap is worked out from the real name
// alone, the same every time: the dev seed swaps the roster before adding it, and scripts/anonymize-members.mjs swaps
// who's already in D1, so the seed then finds them all and adds nobody. The roster itself (TEAM_ROSTER) stays real.

const FIRST = [
  "Alex",
  "Ash",
  "Bailey",
  "Blake",
  "Bo",
  "Cal",
  "Cam",
  "Casey",
  "Charlie",
  "Corey",
  "Dale",
  "Dani",
  "Drew",
  "Eli",
  "Ellis",
  "Emery",
  "Finn",
  "Flynn",
  "Frankie",
  "Gabe",
  "Glen",
  "Harley",
  "Harper",
  "Hayden",
  "Jace",
  "Jamie",
  "Jess",
  "Jody",
  "Jordan",
  "Jules",
  "Kai",
  "Kelly",
  "Kit",
  "Lane",
  "Lee",
  "Lennie",
  "Logan",
  "Lou",
  "Mack",
  "Marley",
  "Max",
  "Mel",
  "Micky",
  "Morgan",
  "Nat",
  "Nico",
  "Noel",
  "Oakley",
  "Ollie",
  "Parker",
  "Pat",
  "Quinn",
  "Ray",
  "Reese",
  "Remy",
  "Rik",
  "Robin",
  "Rory",
  "Ross",
  "Rowan",
  "Ryan",
  "Sam",
  "Sasha",
  "Shay",
  "Sid",
  "Sky",
  "Spencer",
  "Stevie",
  "Sunny",
  "Tate",
  "Teddy",
  "Terry",
  "Toby",
  "Tony",
  "Val",
  "Vic",
  "Wes",
  "Will",
  "Wren",
  "Zac",
];
const LAST = [
  "Abbott",
  "Archer",
  "Ashby",
  "Bain",
  "Barlow",
  "Baxter",
  "Beck",
  "Booth",
  "Bramble",
  "Brooks",
  "Burke",
  "Cairns",
  "Carver",
  "Chandler",
  "Cole",
  "Crane",
  "Croft",
  "Dalton",
  "Doyle",
  "Drake",
  "Dunmore",
  "Ellery",
  "Fairley",
  "Finch",
  "Fletcher",
  "Ford",
  "Fox",
  "Gale",
  "Garner",
  "Gibbs",
  "Hale",
  "Harlow",
  "Hart",
  "Hayes",
  "Hollis",
  "Hood",
  "Hughes",
  "Ingram",
  "Jarvis",
  "Kemp",
  "Kerr",
  "Knox",
  "Lane",
  "Lark",
  "Lowe",
  "Lyle",
  "Marsh",
  "Mercer",
  "Moss",
  "Nash",
  "Nolan",
  "Oakes",
  "Orme",
  "Page",
  "Parr",
  "Penn",
  "Pike",
  "Quill",
  "Rafferty",
  "Reed",
  "Rhodes",
  "Rook",
  "Rowe",
  "Sharpe",
  "Shaw",
  "Slater",
  "Stone",
  "Strong",
  "Swift",
  "Tanner",
  "Thorne",
  "Tully",
  "Vance",
  "Wade",
  "Walsh",
  "Ward",
  "Webb",
  "Wilde",
  "Wren",
  "York",
];

/** A 32-bit hash of a string (FNV-1a): the same name always gives the same number. */
function hash(s) {
  let h = 0x811c9dc5;
  for (const ch of s) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** The made-up name for a real one: the same every time, whatever case or spacing it's written in. */
export function fakeName(real) {
  const h = hash(real.trim().toLowerCase());
  return `${FIRST[h % FIRST.length]} ${LAST[Math.floor(h / FIRST.length) % LAST.length]}`;
}

/** Whether a name is already one of ours (so swapping twice changes nothing). */
export function isFake(name) {
  const [first, last, ...rest] = name.trim().split(/\s+/);
  return !rest.length && FIRST.includes(first) && LAST.includes(last);
}

/** Admins keep their own name and email: they sign in to dev. */
export const keepsReal = (roles) => roles.includes("Admin");

/** A parsed roster (roster.mjs) with everyone but the admins swapped: a made-up name and no email. */
export function anonymizeRoster(players) {
  const out = players.map((p) =>
    keepsReal(p.roles) || isFake(p.name) ? p : { ...p, name: fakeName(p.name), email: null },
  );
  const seen = new Map();
  for (const [i, p] of out.entries()) {
    const key = p.name.toLowerCase();
    // Two people on one made-up name would seed as one: say so, rather than lose someone (change the lists)
    if (seen.has(key)) throw new Error(`Rows ${seen.get(key) + 1} and ${i + 1} both come out as ${p.name}.`);
    seen.set(key, i);
  }
  return out;
}
