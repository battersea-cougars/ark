// The team Worker as built (dist/cougars_team/index.js), for a load run only (docs/load-testing.md): the same Worker
// with its D1 binding counted, so a run can say how many rows it read and wrote, as D1 bills them (each result's
// meta.rows_read and rows_written). GET /api/__load/d1 says the totals so far; POST resets them. Nothing else changes.
// Copied next to the built index.js by load.server.mjs; never deployed.
import app from "./index.js";

export { LiveHub } from "./index.js";

const totals = { queries: 0, rowsRead: 0, rowsWritten: 0 };
const add = (meta) => {
  totals.queries++;
  totals.rowsRead += meta?.rows_read ?? 0;
  totals.rowsWritten += meta?.rows_written ?? 0;
};

/** A statement whose results are counted. `first` is read as `all`, since only `all` and `run` say what they cost. */
function counted(stmt) {
  return {
    inner: stmt,
    bind: (...params) => counted(stmt.bind(...params)),
    async all() {
      const r = await stmt.all();
      add(r.meta);
      return r;
    },
    async run() {
      const r = await stmt.run();
      add(r.meta);
      return r;
    },
    async first(column) {
      const r = await stmt.all();
      add(r.meta);
      const row = r.results[0];
      if (row === undefined) return null;
      return column === undefined ? row : row[column];
    },
    raw: (...args) => stmt.raw(...args),
  };
}

function countedDb(db) {
  return {
    prepare: (sql) => counted(db.prepare(sql)),
    async batch(stmts) {
      const results = await db.batch(stmts.map((s) => s.inner ?? s));
      for (const r of results) add(r.meta);
      return results;
    },
    exec: (sql) => db.exec(sql),
    dump: () => db.dump(),
    withSession: (...args) => db.withSession(...args),
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/__load/d1") {
      if (request.method === "POST") Object.assign(totals, { queries: 0, rowsRead: 0, rowsWritten: 0 });
      return Response.json(totals);
    }
    return app.fetch(request, { ...env, DB: countedDb(env.DB) }, ctx);
  },
  async scheduled(controller, env, ctx) {
    return app.scheduled(controller, { ...env, DB: countedDb(env.DB) }, ctx);
  },
};
