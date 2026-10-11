// Thin helpers over a D1 binding. No ORM: write SQL, keep it in one place per
// domain (e.g. apps/web/src/lib/server/enquiries.ts). Pattern borrowed from
// gwenda-hackney/ark packages/shared/d1.js.
// Each call is a round trip to D1, and each costs the Worker CPU time (ADR 0059): a job that writes several rows
// builds its statements and sends them with `batch`, never `run` in a loop.

export type Param = string | number | null;

export async function all<T>(db: D1Database, sql: string, params: Param[] = []): Promise<T[]> {
  const { results } = await db
    .prepare(sql)
    .bind(...params)
    .all<T>();
  return results;
}

export async function first<T>(db: D1Database, sql: string, params: Param[] = []): Promise<T | null> {
  return db
    .prepare(sql)
    .bind(...params)
    .first<T>();
}

export async function run(db: D1Database, sql: string, params: Param[] = []) {
  return db
    .prepare(sql)
    .bind(...params)
    .run();
}

/** A statement to send with others in one `batch`. */
export function statement(db: D1Database, sql: string, params: Param[] = []): D1PreparedStatement {
  return db.prepare(sql).bind(...params);
}

/**
 * Statements in one round trip: in order, in one transaction, all or nothing. Nothing to send costs nothing. A
 * statement's rows (for a SELECT) or changes are in its result, in the same place.
 */
export async function batch<T = unknown>(db: D1Database, statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
  return statements.length ? db.batch<T>(statements) : [];
}

/** How many rows a batch changed, all told. */
export const changesOf = (results: D1Result[]) => results.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
