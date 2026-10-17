// The log in a test (ADR 0031): every line written from here on is kept as an entry to look at, and nothing is printed.
// Each test file starts from the apps' console adapter again (testing/setup.ts).
import { scribe, type Entry, type Level, type Reporter } from "../scribe";

export function captureLogs({ level = "trace", report }: { level?: Level; report?: Reporter } = {}) {
  const entries: Entry[] = [];
  scribe.configure({ adapter: { write: (entry) => void entries.push(entry) }, level, report });
  return { entries, messages: () => entries.map((e) => e.msg) };
}
