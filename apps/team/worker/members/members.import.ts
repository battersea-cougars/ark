// An admin brings players in from a file: a spreadsheet saved as CSV (a header row naming the columns), or the
// roster's JSON (db/seed/README.md). Like the roster seed it only adds: someone already in the club, by email or by
// name, is left as they are. The whole file is checked first and goes in all at once or not at all, in one D1 batch
// (the free plan allows 50 queries per request). Nobody is emailed: they sign in with their email once told.
// The columns are the club's own spreadsheet's (name, position, subx, email, role, is Cougars), or the app's names.
import { all } from "@cougars/shared/d1";
import { assignReferenceSql } from "@cougars/shared/payment-reference";
import type { Action } from "../../src/access/actions";
import { HttpError } from "../api/api.http";
import { canGrant } from "./members";
import { londonToday } from "@cougars/shared/london";

export interface ImportRow {
  row: number;
  name: string;
  email: string | null;
  position: "F" | "D" | "G";
  rating: number;
  cougar: boolean;
  /** Besides Member, which everyone gets. */
  roles: string[];
  /** Their plan this quarter (ADR 0007): a goalie is always on the Keeper plan. */
  plan: Plan;
}
export type Plan = "quarterly" | "payg" | "keeper";
export interface ImportNote {
  row: number;
  name: string;
  why: string;
}
export interface ImportCheck {
  add: ImportRow[];
  skip: ImportNote[];
  problems: ImportNote[];
}

const MAX_ROWS = 500;
type Column = "name" | "email" | "position" | "rating" | "cougar" | "roles" | "plan";
/** Each column by the names a header may give it, in any case. */
const HEADERS: Record<string, Column> = {
  name: "name",
  email: "email",
  "e-mail": "email",
  position: "position",
  rating: "rating",
  cougar: "cougar",
  cougars: "cougar",
  "is cougar": "cougar",
  "is cougars": "cougar",
  role: "roles",
  roles: "roles",
  subx: "plan",
  subscription: "plan",
  plan: "plan",
  quarterly: "plan",
};
const column = (header: string) => HEADERS[header.trim().toLowerCase().replace(/\s+/g, " ")];
const POSITIONS: Record<string, "F" | "D" | "G"> = {
  f: "F",
  forward: "F",
  d: "D",
  defence: "D",
  defense: "D",
  g: "G",
  goalie: "G",
  keeper: "G",
  goalkeeper: "G",
};
const YES = new Set(["yes", "y", "true", "1", "x"]);
const NO = new Set(["", "no", "n", "false", "0"]);
const PLANS: Record<string, Plan> = {
  quarterly: "quarterly",
  q: "quarterly",
  yes: "quarterly",
  y: "quarterly",
  true: "quarterly",
  "1": "quarterly",
  sub: "quarterly",
  subscription: "quarterly",
  payg: "payg",
  "pay as you go": "payg",
  no: "payg",
  n: "payg",
  false: "payg",
  "0": "payg",
  "": "payg",
  keeper: "keeper",
};

/** CSV as spreadsheets save it: quoted fields may hold commas, quotes ("") and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") endField();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else field += ch;
  }
  if (field || row.length) endRow();
  return rows.filter((r) => r.some((f) => f.trim()));
}

/** The file as records, keyed by column, each with its row number as a spreadsheet shows it. */
function records(file: string): { row: number; get: (c: Column) => unknown }[] {
  const text = file.replace(/^\uFEFF/, "").trim();
  if (text.startsWith("[")) {
    let list: unknown;
    try {
      list = JSON.parse(text);
    } catch {
      throw new HttpError(400, "That file isn't valid JSON.");
    }
    if (!Array.isArray(list)) throw new HttpError(400, "The JSON should be a list of players.");
    return list.map((r, i) => {
      const fields = new Map<Column, unknown>();
      for (const [k, v] of Object.entries((r as Record<string, unknown> | null) ?? {}))
        if (column(k) && !fields.has(column(k))) fields.set(column(k), v);
      return { row: i + 1, get: (c) => fields.get(c) };
    });
  }
  const [head, ...body] = parseCsv(text);
  const at = new Map<Column, number>();
  (head ?? []).forEach((h, i) => column(h) && !at.has(column(h)) && at.set(column(h), i));
  if (!at.has("name"))
    throw new HttpError(
      400,
      `The first row should name the columns, with at least "name": name, position, subx, email, role, is Cougars.`,
    );
  return body.map((cells, i) => ({
    row: i + 2,
    get: (c) => (at.has(c) ? cells[at.get(c)!]?.trim() : undefined),
  }));
}

/** What the file would do: who'd be added, who's in already, and what's wrong with it, row by row. */
export async function checkImport(db: D1Database, file: unknown, caller: ReadonlySet<Action>): Promise<ImportCheck> {
  if (typeof file !== "string" || !file.trim()) throw new HttpError(400, "file is needed.");
  if (file.length > 500_000) throw new HttpError(400, "That file's too big.");
  const list = records(file);
  if (!list.length) throw new HttpError(400, "There's nobody in that file.");
  if (list.length > MAX_ROWS) throw new HttpError(400, `Up to ${MAX_ROWS} players at a time.`);

  const club = await all<{ name: string; email: string | null }>(db, "SELECT name, email FROM members");
  const names = new Set(club.map((m) => m.name.toLowerCase()));
  const emails = new Set(club.flatMap((m) => (m.email ? [m.email.toLowerCase()] : [])));
  const roles = await all<{ id: number; name: string }>(db, "SELECT id, name FROM roles");
  const roleActions = await all<{ name: string; action: string }>(
    db,
    "SELECT r.name, ra.action FROM role_actions ra JOIN roles r ON r.id = ra.role_id",
  );

  const out: ImportCheck = { add: [], skip: [], problems: [] };
  const seenName = new Map<string, number>();
  const seenEmail = new Map<string, number>();
  for (const { row, get } of list) {
    const raw = (c: Column) => {
      const v = get(c);
      return v == null ? "" : String(v).trim();
    };
    const name = raw("name");
    const wrong = (why: string) => out.problems.push({ row, name, why });
    if (!name) {
      wrong("A name is needed");
      continue;
    }
    if (name.length > 80) wrong("That name's too long (80 letters at most)");

    const email = raw("email").toLowerCase() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) wrong("That email doesn't look right");

    const position = POSITIONS[raw("position").toLowerCase() || "f"];
    if (!position) wrong("Position should be F, D or G");

    const ratingText = raw("rating");
    const rating = ratingText === "" ? 50 : Number(ratingText);
    if (!Number.isInteger(rating) || rating < 0 || rating > 100) wrong("Rating should be a whole number from 0 to 100");

    const cougarValue = get("cougar");
    const cougarText = raw("cougar").toLowerCase();
    const cougar = cougarValue === true || YES.has(cougarText);
    if (!(cougarValue === true || cougarValue === false || YES.has(cougarText) || NO.has(cougarText)))
      wrong("Cougar should be yes or no");

    const planValue = get("plan");
    const chosen =
      typeof planValue === "boolean" ? (planValue ? "quarterly" : "payg") : PLANS[raw("plan").toLowerCase()];
    if (!chosen) wrong("Subx should be quarterly, payg or keeper");
    else if (chosen === "keeper" && position && position !== "G") wrong("Keeper is for position G");
    // Keepers play training free, whatever the file says (ADR 0007)
    const plan: Plan = position === "G" ? "keeper" : (chosen ?? "payg");

    const roleValue = get("roles");
    const given = (Array.isArray(roleValue) ? roleValue.map(String) : raw("roles").split(/[;|]/))
      .map((r) => r.trim())
      .filter((r) => r && r.toLowerCase() !== "member");
    const named = given.map((r) => roles.find((k) => k.name.toLowerCase() === r.toLowerCase())?.name ?? r);
    for (const r of named) if (!roles.some((k) => k.name === r)) wrong(`No role called ${r}`);
    // Every role given must do no more than the importer can (as when editing a member)
    const actions = roleActions.filter((a) => named.includes(a.name)).map((a) => a.action);
    if (!canGrant(caller, actions)) wrong("You can't give a role that can do more than you");

    // Twice in the file is a mistake; already in the club is fine, and skipped
    const twiceName = seenName.get(name.toLowerCase());
    if (twiceName) wrong(`That name is on row ${twiceName} too`);
    const twiceEmail = email ? seenEmail.get(email) : undefined;
    if (twiceEmail) wrong(`That email is on row ${twiceEmail} too`);
    seenName.set(name.toLowerCase(), row);
    if (email) seenEmail.set(email, row);

    if (out.problems.some((p) => p.row === row)) continue;
    if (names.has(name.toLowerCase()) || (email && emails.has(email)))
      out.skip.push({ row, name, why: "Already in the club" });
    else out.add.push({ row, name, email, position, rating, cougar, roles: named, plan });
  }
  return out;
}

/** Adds everyone the file would add, all at once. Refuses a file with any problem. */
export async function importMembers(db: D1Database, file: unknown, caller: ReadonlySet<Action>, now: Date) {
  const check = await checkImport(db, file, caller);
  if (check.problems.length)
    throw new HttpError(
      400,
      `Fix the file first: ${check.problems.length} problem${check.problems.length > 1 ? "s" : ""}.`,
    );
  if (!check.add.length) return { added: [] as string[], skipped: check.skip.length };

  const on = londonToday(now);
  const at = now.toISOString();
  // The member just made is the newest: ids only go up (AUTOINCREMENT), and a batch runs in order, alone
  const newest = "id = (SELECT max(id) FROM members)";
  const statements = check.add.flatMap((p) => {
    const { sql, candidates } = assignReferenceSql(p.name, newest);
    const roles = ["Member", ...p.roles];
    return [
      db
        .prepare(
          `INSERT INTO members (name, email, position, rating, cougar, status, joined_on, created_at)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
        )
        .bind(p.name, p.email, p.position, p.rating, p.cougar ? 1 : 0, on, at),
      db.prepare(sql).bind(...candidates),
      db
        .prepare(
          `INSERT OR IGNORE INTO member_roles (member_id, role_id)
           SELECT (SELECT max(id) FROM members), id FROM roles WHERE name IN (${roles.map(() => "?").join(", ")})`,
        )
        .bind(...roles),
    ];
  });
  // Quarterly Members from today, as when an admin ticks Quarterly (setQuarterly): one statement for them all, so the
  // batch stays three a member. Who's new is known by name (none was in the club) and this import's created_at.
  const quarterly = check.add.filter((p) => p.plan === "quarterly").map((p) => p.name);
  if (quarterly.length)
    statements.push(
      db
        .prepare(
          `INSERT INTO subscriptions (member_id, starts_on, created_at)
           SELECT id, ?, ? FROM members WHERE created_at = ? AND name IN (SELECT value FROM json_each(?))`,
        )
        .bind(on, at, at, JSON.stringify(quarterly)),
    );
  await db.batch(statements);
  return { added: check.add.map((p) => p.name), skipped: check.skip.length };
}
