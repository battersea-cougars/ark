// The run's one summary (ADR 0031): every check that failed, by journey and step, what was expected and what happened,
// as markdown, the body of the run's issue. A journey is a `test.describe.serial`, each step of it a test. Nothing
// failed: no file (journeys.mjs reads that as a clean run).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import type { FullResult, Reporter, TestCase, TestResult, TestStep } from "@playwright/test/reporter";

interface Failure {
  /** The test, so a step's failures are found again when it ends. */
  id: string;
  journey: string;
  step: string;
  /** What failed in it: the person's `does` or `checks`, or "(outside a check)". */
  check: string;
  error: string;
}

// eslint-disable-next-line no-control-regex
const plain = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");

/** The useful part of an error: its message, without the call log and the source excerpt. */
const said = (message = "") =>
  plain(message)
    .split("\n")
    .filter((line) => line.trim() && !/^\s*(at |\d+ \||>)/.test(line))
    .slice(0, 8)
    .join("\n");

/** The journey a step is in: its describe's title (a file with a bare test: the test's own). */
const journeyOf = (test: TestCase) => test.parent.title || test.title;

/** Why a step's expected to fail (`test.fail(true, why)`). */
const knownBugOf = (test: TestCase, result: TestResult) =>
  [...result.annotations, ...test.annotations].find((a) => a.type === "fail")?.description ?? "a known bug";

export default class JourneySummary implements Reporter {
  private failures: Failure[] = [];
  private known: string[] = [];
  /** The journeys a failed step stopped: the step, and how many after it were skipped. */
  private stopped = new Map<string, { step: string; skipped: number }>();
  private traces: string[] = [];

  constructor(private options: { summary: string }) {}

  onStepEnd(test: TestCase, _result: TestResult, step: TestStep) {
    // Only the check that failed itself, not the steps it's in
    if (step.category !== "test.step" || !step.error) return;
    if (step.steps.some((s) => s.category === "test.step" && s.error)) return;
    this.failures.push({
      id: test.id,
      journey: journeyOf(test),
      step: test.title,
      check: step.title,
      error: said(step.error.message ?? step.error.value),
    });
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const journey = journeyOf(test);
    if (result.status === "skipped") return this.skipped(test, result, journey);
    if (test.expectedStatus === "failed") return this.knownBug(test, result, journey);
    if (result.status === "passed") return;
    // A failure no check owned (a timeout, a crash, an expect between checks)
    const first = result.errors[0];
    if (!this.failures.some((f) => f.id === test.id) && first)
      this.failures.push({
        id: test.id,
        journey,
        step: test.title,
        check: "(outside a check)",
        error: said(first.message),
      });
    if (!this.stopped.has(journey)) this.stopped.set(journey, { step: test.title, skipped: 0 });
    const trace = result.attachments.find((a) => a.name === "trace")?.path;
    if (trace)
      this.traces.push(`${journey} › ${test.title}: its trace is in ${relative(process.cwd(), dirname(trace))}`);
  }

  /** Skipped by a step before it failing (serial), or on purpose (`test.skip`, said why). */
  private skipped(test: TestCase, result: TestResult, journey: string) {
    const why = [...result.annotations, ...test.annotations].find((a) => a.type === "skip");
    if (why) return console.log(`journeys: skipped "${journey} › ${test.title}": ${why.description}`);
    const stop = this.stopped.get(journey);
    if (stop) stop.skipped++;
  }

  /** A step with `test.fail()`: failing is expected (its failures aren't the run's); passing means it's fixed. */
  private knownBug(test: TestCase, result: TestResult, journey: string) {
    const why = knownBugOf(test, result);
    if (result.status !== "passed") {
      this.failures = this.failures.filter((f) => f.id !== test.id);
      this.known.push(`${journey} › ${test.title}: ${why}`);
      return;
    }
    this.failures.push({
      id: test.id,
      journey,
      step: test.title,
      check: "(known bug)",
      error: `Expected: still failing (${why})\nReceived: it passed. Fixed? Take test.fail() off this step.`,
    });
  }

  onEnd(result: FullResult) {
    for (const k of this.known) console.log(`journeys: known bug, failing as expected: ${k}`);
    if (!this.failures.length) return;
    const lines = [
      `## Journeys: ${this.failures.length} failing check${this.failures.length === 1 ? "" : "s"}`,
      "",
      `Run ${new Date().toISOString()}, ${result.status}.`,
      "",
    ];
    let at = "";
    for (const f of this.failures) {
      const heading = `${f.journey} › ${f.step}`;
      if (heading !== at) lines.push(`### ${(at = heading)}`, "");
      lines.push(`- **${f.check}**`, "", "  ```", ...f.error.split("\n").map((l) => `  ${l}`), "  ```", "");
    }
    const notes = [
      ...[...this.stopped]
        .filter(([, s]) => s.skipped)
        .map(([journey, s]) => `${journey}: stopped at "${s.step}" (the ${s.skipped} step(s) after it didn't run)`),
      ...this.traces,
    ];
    if (notes.length) lines.push("### Notes", "", ...notes.map((s) => `- ${s}`), "");
    if (this.known.length) lines.push("### Known bugs (failing as expected)", "", ...this.known.map((k) => `- ${k}`));
    mkdirSync(dirname(this.options.summary), { recursive: true });
    writeFileSync(this.options.summary, `${lines.join("\n")}\n`);
  }

  printsToStdio() {
    return false;
  }
}
