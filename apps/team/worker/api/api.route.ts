// A route of the team app's API, as each feature declares it (ADR 0024, ADR 0095, ADR 0105): its method and path, the
// action it needs, what it changes and what it puts on the record; and the small helpers every feature's routes share.
// The routes themselves live with their feature ({feature}.routes.ts); api.ts mounts them.
import { type Action } from "../../src/access/actions";
import type { Slice } from "./api.slices";
import { type AuthEnv } from "../auth/auth";
import { HttpError, body, json } from "./api.http";
import { all, first } from "@cougars/shared/d1";
import { type WebsiteEnv } from "../website/website";

export interface Env extends AuthEnv, Omit<WebsiteEnv, "DB" | "TEAM_ENV"> {
  /** "1", and only with TEAM_ENV "local" (tests, `TEAM_AUTO_ADMIN=1 npm run dev`): no session means the first admin. */
  TEAM_AUTO_ADMIN?: string;
  /** This deploy's version (wrangler.jsonc version_metadata): part of the bootstrap's ETag. */
  CF_VERSION_METADATA?: { id: string };
  /** Read-only (Account Analytics: Read), for the Usage page and the hourly check (ADR 0059). */
  CLOUDFLARE_ANALYTICS_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  /** The live hub (ADR 0072), wrangler.jsonc durable_objects; a server without one falls back to checking. */
  LIVE?: DurableObjectNamespace;
}

export interface Ctx {
  env: Env;
  request: Request;
  params: string[];
  memberId: number;
  actions: Set<Action>;
  today: string;
  now: string;
}

export interface Route {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: RegExp;
  /** The action this route needs; "authenticated" for any signed-in member. */
  action: Action | "authenticated";
  /**
   * A change: the parts of the club it can touch. They come back with the reply, as `changed`, so the app puts them
   * in place without reloading the whole club. Every route that isn't a GET says.
   */
  changes?: readonly Slice[];
  /**
   * On the record (ADR 0095): a change says what it does to the club's record, or `{ none: "why" }` for nothing,
   * saying why (a member's own sign-up, a pick that's the draft's own record). Every route that isn't a GET says
   * (security.test.ts). The wrapper reads `subject` before the handler and again after; when the two differ it writes
   * `event` to the audit log, with who did it, both sides, and `about`.
   */
  audit?: Audit | { none: string };
  handle: (c: Ctx) => Promise<Response>;
}

/** What a change puts on the record (ADR 0095). */
export interface Audit {
  /** The entry's name: "member.updated". The audit page says each in plain words. */
  event: string;
  /** The state the change is to, read the same way before and after. `reply` (the handler's JSON) only after. */
  subject: (c: Ctx, reply?: Record<string, unknown>) => Promise<unknown>;
  /** Which member or role it's about ({ memberId } or { roleId }), so the page can name them. */
  about?: (c: Ctx, reply: Record<string, unknown>) => Record<string, unknown>;
}

/** A route's member, or the one the reply says was made. */
export const theMember = (c: Ctx, reply?: Record<string, unknown>) => (reply?.id as number | undefined) ?? id(c);

export const id = (c: Ctx) => Number(c.params[0]);

/**
 * An audit subject that's one row, read the same way before and after (ADR 0095): `sql` takes one key, the route's id
 * (its first path number) or, for a new one, the id the reply says was made. Nothing to read (before a create): null.
 */
export const rowOf =
  (sql: string, key: (c: Ctx, reply?: Record<string, unknown>) => number | undefined = defaultKey) =>
  async (c: Ctx, reply?: Record<string, unknown>) => {
    const k = key(c, reply);
    return k === undefined || Number.isNaN(k) ? null : ((await first(c.env.DB, sql, [k])) ?? null);
  };
const defaultKey = (c: Ctx, reply?: Record<string, unknown>) =>
  typeof reply?.id === "number" ? reply.id : c.params[0] ? Number(c.params[0]) : undefined;
/** The same, for a subject that's a list of rows (a session's register, a team's players): `sql` takes one key. */
export const rowsOf =
  (sql: string, key: (c: Ctx) => number = (c) => Number(c.params[0])) =>
  (c: Ctx) =>
    all(c.env.DB, sql, [key(c)]);
export const ok = () => json({ ok: true });

/** The member a request's body names, checked. */
export async function memberIdIn(c: Ctx) {
  const b = await body(c.request);
  const memberId = Number(b.memberId);
  if (!Number.isInteger(memberId) || memberId <= 0) throw new HttpError(400, "Which member?");
  return { b, memberId };
}
