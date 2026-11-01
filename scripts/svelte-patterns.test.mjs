import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "svelte/compiler";

// A pattern in a Svelte attribute is a template, not a string: `pattern="\d{8}"` reaches the browser as `\d8`, as
// Svelte reads `{8}` as an expression, and the field then refuses everything (#166: the bank details sheet could
// never save). A pattern with braces is written as an expression, `pattern={"\\d{8}"}`. Each pattern in the team
// app is compiled and read back as the browser would get it.
const root = new URL("../apps/team/src/", import.meta.url).pathname;

function svelteFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return svelteFiles(path);
    return e.name.endsWith(".svelte") ? [path] : [];
  });
}

/** Each pattern attribute's value as the browser gets it: its text, and the strings written as expressions. */
function patternsOf(file) {
  const found = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.type === "Attribute" && node.name === "pattern") {
      const parts = Array.isArray(node.value) ? node.value : [node.value];
      found.push(parts.map((v) => (v.type === "Text" ? v.data : v.expression.value)).join(""));
    }
    for (const value of Object.values(node)) if (value && typeof value === "object") walk(value);
  };
  walk(parse(readFileSync(file, "utf8"), { modern: true }).fragment);
  return found;
}

describe("a field's pattern", () => {
  it("never has a {…} in its quoted text, where Svelte reads it as an expression", () => {
    const offenders = svelteFiles(root).filter((file) => /\spattern="[^"]*\{/.test(readFileSync(file, "utf8")));
    expect(offenders.map((f) => f.slice(root.length))).toEqual([]);
  });

  it("the bank details sheet's reach the browser as written: a sort code, and 8 digits", () => {
    expect(patternsOf(join(root, "lib/BankSheet.svelte"))).toEqual([String.raw`\d\d-?\d\d-?\d\d`, String.raw`\d{8}`]);
  });
});
