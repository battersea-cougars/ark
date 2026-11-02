// Every link in the repo's Markdown still goes somewhere, and every ADR the code or docs cite still exists (ADR 0001).
//
// - A relative link in a tracked .md file points at a file or folder that's there (#anchors aren't checked).
// - A feature's notes link each rule to its test as [file › "the test's name"](file): that file has a test of that
//   name, so a renamed test can't leave a rule pointing at nothing.
// - "ADR NNNN", "ADRs NNNN, NNNN", "adr/NNNN" and "[NNNN](NNNN-…)" anywhere tracked name a record in docs/adr/.
//
// Usage: node scripts/links-check.mjs (exit 1 on anything broken, each listed as file:line).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const tracked = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root })
  .toString()
  .split("\n")
  .filter((file) => file && existsSync(join(root, file)));
const records = new Set(
  readdirSync(join(root, "docs/adr"))
    .map((name) => name.match(/^(\d{4})-/)?.[1])
    .filter(Boolean),
);

const problems = [
  ...tracked.filter((file) => file.endsWith(".md")).flatMap(brokenLinks),
  ...tracked.flatMap(missingRecords),
];
for (const problem of problems) console.log(problem);
console.log(problems.length ? `${problems.length} broken` : "Every link and ADR reference resolves.");
process.exit(problems.length ? 1 : 0);

function brokenLinks(file) {
  const text = readFileSync(join(root, file), "utf8");
  const here = dirname(join(root, file));
  const problems = [];
  for (const [line, number] of lines(text)) {
    for (const [, label, target] of line
      .replace(/`[^`]*`/g, "")
      .matchAll(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      if (/^[a-z]+:|^#|^\/\//i.test(target)) continue;
      const path = resolve(here, decodeURI(target.split("#")[0]));
      if (!existsSync(path)) {
        problems.push(`${file}:${number}: no ${target}`);
        continue;
      }
      const name = label.match(/ › (["'])(.+)\1$/)?.[2];
      if (name && !name.split(" › ").every((part) => readFileSync(path, "utf8").includes(part)))
        problems.push(`${file}:${number}: no test "${name}" in ${target}`);
    }
  }
  return problems;
}

function missingRecords(file) {
  if (/\.(png|jpe?g|webp|ico|woff2?|ttf|otf|pdf|zip|gif)$/i.test(file) || file.endsWith("package-lock.json")) return [];
  const text = readFileSync(join(root, file), "utf8");
  const problems = [];
  for (const [line, number] of lines(text)) {
    const cited = [
      ...[...line.matchAll(/\bADRs? ((?:\d{4})(?:(?:,\s*|,? and |\/)(?:ADR )?\d{4})*)/g)].flatMap(([, list]) =>
        list.match(/\d{4}/g),
      ),
      ...[...line.matchAll(/adr\/(\d{4})/g)].map(([, number]) => number),
    ];
    for (const record of new Set(cited)) if (!records.has(record)) problems.push(`${file}:${number}: no ADR ${record}`);
  }
  return problems;
}

function* lines(text) {
  let number = 0;
  let fenced = false;
  for (const line of text.split("\n")) {
    number++;
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (!fenced) yield [line, number];
  }
}
