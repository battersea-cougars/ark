// The run's one summary (ADR 0031): every step that failed, by stage and role, what was expected and what happened,
// as markdown, the body of the run's issue. Nothing failed: no file (journeys.mjs reads that as a clean run).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import type { FullResult, Reporter, TestCase, TestResult, TestStep } from "@playwright/test/reporter";

interface Failure {
  journey: string;
  stage: string;
  step: string;
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

export default class JourneySummary implements Reporter {
  private failures: Failure[] = [];
  private known: string[] = [];
  private stopped: string[] = [];

  constructor(private options: { summary: string }) {}

  onStepEnd(test: TestCase, _result: TestResult, step: TestStep) {
    // Only the step that failed itself, not the stages it's in
    if (step.category !== "test.step" || !step.error) return;
    if (step.steps.some((s) => s.category === "test.step" && s.error)) return;
    const path = step.titlePath();
    this.failures.push({
      journey: test.title,
      stage: path.length > 1 ? path[0] : "",
      step: path[path.length - 1],
      error: said(step.error.message ?? step.error.value),
    });
  }

  onTestEnd(test: TestCase, result: TestResult) {
    for (const a of result.annotations) if (a.type === "known bug") this.known.push(a.description ?? "");
    if (result.status === "skipped")
      console.log(
        `journeys: skipped "${test.title}": ${[...result.annotations, ...test.annotations].find((a) => a.type === "skip")?.description}`,
      );
    if (result.status === "passed" || result.status === "skipped") return;
    // A failure no step owned (a timeout, a crash between steps)
    const first = result.errors[0];
    if (!this.failures.some((f) => f.journey === test.title) && first)
      this.failures.push({ journey: test.title, stage: "", step: "(outside a step)", error: said(first.message) });
    // A failed `does` ends the journey: the stages after it didn't run
    const last = this.failures.filter((f) => f.journey === test.title).at(-1);
    if (last && !said(first?.message).includes("check(s) failed"))
      this.stopped.push(`${test.title}: stopped at "${last.step}" (the steps after it didn't run)`);
    const trace = result.attachments.find((a) => a.name === "trace")?.path;
    if (trace)
      this.stopped.push(`${test.title}: its trace is in the run's output, ${relative(process.cwd(), dirname(trace))}`);
  }

  onEnd(result: FullResult) {
    for (const k of this.known) console.log(`journeys: known bug, failing as expected: ${k}`);
    if (!this.failures.length) return;
    const lines = [
      `## Journeys: ${this.failures.length} failing step${this.failures.length === 1 ? "" : "s"}`,
      "",
      `Run ${new Date().toISOString()}, ${result.status}.`,
      "",
    ];
    let at = "";
    for (const f of this.failures) {
      const heading = `${f.journey}${f.stage ? ` › ${f.stage}` : ""}`;
      if (heading !== at) lines.push(`### ${(at = heading)}`, "");
      lines.push(`- **${f.step}**`, "", "  ```", ...f.error.split("\n").map((l) => `  ${l}`), "  ```", "");
    }
    if (this.stopped.length) lines.push("### Notes", "", ...this.stopped.map((s) => `- ${s}`), "");
    if (this.known.length) lines.push("### Known bugs (failing as expected)", "", ...this.known.map((k) => `- ${k}`));
    mkdirSync(dirname(this.options.summary), { recursive: true });
    writeFileSync(this.options.summary, `${lines.join("\n")}\n`);
  }

  printsToStdio() {
    return false;
  }
}
