// Scribe: the one way code writes to the log (ADR 0110), shaped like decohere's @decohere/scribe and made for Workers.
//
//   const log = scribe.logger("join");
//   log.info("enquiry.created", { id, source });       → {"level":"info","name":"join","msg":"enquiry.created","id":…}
//   log.error("enquiry.email_failed", error, { id });  → the error with its stack, and reported (Sentry, ADR 0111)
//
// The facade only shapes and cleans a line; an adapter writes it (scribe.console.ts: JSON for Workers Logs). The message is a dotted event name; the details go
// in fields. Nothing private reaches the log: secrets by key, phone numbers by key, email addresses wherever they are.
// Every error or fatal line also goes to the reporter, so logging an error is reporting it.

export type Level = "fatal" | "error" | "warn" | "info" | "debug" | "trace";
type Fields = Record<string, unknown>;

/** One line, before it's written. */
export interface Entry {
  level: Level;
  name: string;
  msg: string;
  fields: Fields;
}

/** Writes lines: JSON to the console in the apps (scribe.console.ts), a list in a test (testing/scribe.ts). */
export interface Adapter {
  write(entry: Entry): void;
}

/** Hears about every error and fatal line: the Error it carries (undefined for a line without one) and the line. */
export type Reporter = (error: unknown, entry: Entry) => void;

type LogFn = (msg: string | Error | Fields, ...args: unknown[]) => void;
export type Logger = Record<Level, LogFn> & {
  /** A logger whose every line carries these fields too (a route, a job). */
  with(fields: Fields): Logger;
  isLevelEnabled(level: Level): boolean;
};

const RANK: Record<Level, number> = { fatal: 60, error: 50, warn: 40, info: 30, debug: 20, trace: 10 };
const LEVELS = Object.keys(RANK) as Level[];

// Unconfigured, a line still goes somewhere, plainly, with one warning to configure an adapter (as decohere does). The
// facade has no logger of its own: each app's entry configures one (scribe.console.ts, ADR 0110).
let warned = false;
const fallback: Adapter = {
  write(entry) {
    if (!warned) {
      warned = true;
      console.warn("[scribe] No adapter configured; configure one at the app's entry (ADR 0110).");
    }
    console.log(entry);
  },
};

let config: { adapter: Adapter; level: Level; report?: Reporter } = { adapter: fallback, level: "info" };

export const scribe = {
  /** A logger for one part of the code. It reads the configuration on every line, so one made at module level follows
   *  a later configure(). */
  logger: (name = "default", bound: Fields = {}): Logger => {
    const write = (level: Level, args: unknown[]) => {
      if (RANK[level] < RANK[config.level]) return;
      const { msg, fields, error } = normalise(args);
      const entry: Entry = { level, name, msg: mask(msg), fields: clean({ ...bound, ...fields }) as Fields };
      config.adapter.write(entry);
      if (RANK[level] >= RANK.error) {
        try {
          config.report?.(error, entry);
        } catch {
          // A reporter that's down never breaks the code that logged
        }
      }
    };
    const log = Object.fromEntries(LEVELS.map((l) => [l, (...args: unknown[]) => write(l, args)])) as Record<
      Level,
      LogFn
    >;
    return {
      ...log,
      with: (fields) => scribe.logger(name, { ...bound, ...fields }),
      isLevelEnabled: (level) => RANK[level] >= RANK[config.level],
    };
  },

  /** Where lines go, from which level, and who hears about errors. Left out: unconfigured, info, no reporter. */
  configure({ adapter = fallback, level = "info", report }: { adapter?: Adapter; level?: Level; report?: Reporter }) {
    config = { adapter, level, report };
  },

  /** Adds a reporter (Sentry, ADR 0111) without changing where lines go. */
  report(report: Reporter | undefined) {
    config = { ...config, report };
  },
};

// decohere's argument rules: (error) · (msg) · (msg, error, fields?) · (msg, fields) · (msg, value) · (fields)
function normalise(args: unknown[]): { msg: string; fields: Fields; error?: unknown } {
  const [first, ...rest] = args;
  if (first instanceof Error)
    return { msg: first.message, fields: { err: serialise(first), ...merge(rest) }, error: first };
  if (isFields(first)) {
    const { msg, ...fields } = first;
    return { msg: String(msg ?? ""), fields: { ...fields, ...merge(rest) } };
  }
  const msg = String(first ?? "");
  const [second, ...more] = rest;
  if (second instanceof Error) return { msg, fields: { err: serialise(second), ...merge(more) }, error: second };
  return { msg, fields: merge(rest) };
}

const merge = (args: unknown[]): Fields =>
  Object.assign({}, ...args.map((a) => (a instanceof Error ? { err: serialise(a) } : isFields(a) ? a : { data: a })));

const isFields = (v: unknown): v is Fields =>
  typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Error);

/** An error as plain fields: name, message, stack, and its cause the same way. Anything thrown that isn't an Error is
 *  kept as its text. */
export function serialise(error: unknown, depth = 0): unknown {
  if (!(error instanceof Error)) return typeof error === "string" ? error : String(error);
  const out: Fields = { name: error.name, message: error.message, stack: error.stack };
  if (error.cause !== undefined && depth < 3) out.cause = serialise(error.cause, depth + 1);
  return out;
}

// Never in a log: decohere's secret keys, ours, and a phone number. Matched without case, at any depth.
const HIDDEN = new Set(["password", "secret", "token", "otp", "pw", "code", "authorization", "cookie", "phone"]);
const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

/** An address with only its first letter and its domain left: "a…@club.org". */
export const mask = (text: string) => text.replace(EMAIL, "$1…@$2");

/** A copy with nothing private left in it (secrets and phones by key, email addresses in any text). */
export function clean(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return mask(value);
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => clean(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, HIDDEN.has(k.toLowerCase()) ? "[redacted]" : clean(v, depth + 1)]),
  );
}
