// The apps' logger behind scribe (ADR 0110): each line as one JSON object through the console method of its level, so
// Workers Logs keeps the fields and shows errors as errors. Configured at each app's entry, and in tests
// (testing/setup.ts); the facade itself writes nothing.
import type { Adapter } from "./scribe";

export const consoleAdapter: Adapter = {
  write({ level, name, msg, fields }) {
    const line = JSON.stringify({ level, name, msg, ...fields });
    if (level === "fatal" || level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else if (level === "info") console.log(line);
    else console.debug(line);
  },
};
