// The files past the size prompts (ADR 0125): a report, never a failure.
//
//   npm run sizes            code past ~400 lines, and a Svelte component's <style> past ~500
//   npm run sizes -- --tests the test files too
//
// A file on this list is a prompt to ask whether it holds more than one idea, not a rule. Lines are counted as they
// are in the file (blank lines and comments too), from the files git tracks.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const CODE_LINES = 400;
const STYLE_LINES = 500;
const CODE = /\.(ts|js|mjs|svelte|astro)$/;
const GENERATED = /(^|\/)(worker-configuration\.d\.ts|package-lock\.json)$|\.d\.ts$/;
const TEST = /\.test\.(ts|mjs)$|(^|\/)testing(\.[\w-]+)?\.ts$|\.testing\.ts$|\/testing\//;

const withTests = process.argv.includes("--tests");
const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n");
const files = tracked.filter((file) => CODE.test(file) && !GENERATED.test(file) && (withTests || !TEST.test(file)));

const lineCount = (text) => text.replace(/\n$/, "").split("\n").length;

/** A component's own CSS: the lines inside its <style> block. */
function styleLines(source) {
  const style = source.match(/<style[^>]*>([\s\S]*?)<\/style>/);
  return style ? lineCount(style[1].replace(/^\n/, "")) : 0;
}

const longFiles = [];
const longStyles = [];
for (const file of files) {
  const source = readFileSync(file, "utf8");
  const lines = lineCount(source);
  if (lines > CODE_LINES) longFiles.push({ file, lines });
  if (!file.endsWith(".svelte")) continue;
  const style = styleLines(source);
  if (style > STYLE_LINES) longStyles.push({ file, lines: style });
}

function print(title, rows) {
  console.log(`${title}: ${rows.length}`);
  for (const { file, lines } of rows.sort((one, other) => other.lines - one.lines))
    console.log(`  ${String(lines).padStart(5)}  ${file}`);
}

print(`Files past ${CODE_LINES} lines${withTests ? " (tests included)" : ""}`, longFiles);
print(`Component styles past ${STYLE_LINES} lines`, longStyles);
