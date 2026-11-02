import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A fresh clone's `npm ci` runs only the install scripts package.json's "allowScripts" allows, each pinned to a
// version, and warns about any it hasn't decided. A dependency bump that leaves the pin behind (workerd, Dependabot)
// quietly skips that package's script; this keeps every pin on the lockfile's version. Optional platform packages
// (fsevents, macOS only) are left to npm. better-sqlite3 is pinned to false: it ships prebuilt binaries, but npm still
// guesses a `node-gyp rebuild` from its binding.gyp (not in the lockfile), which would need a compiler.
const root = new URL("../", import.meta.url).pathname;
const { allowScripts } = JSON.parse(readFileSync(`${root}package.json`, "utf8"));
const { packages } = JSON.parse(readFileSync(`${root}package-lock.json`, "utf8"));

const withScripts = Object.entries(packages)
  .filter(([path, p]) => path && p.hasInstallScript && !p.optional)
  .map(([path, p]) => ({ name: path.split("node_modules/").at(-1), version: p.version }));
const decided = (name, version) => `${name}@${version}` in allowScripts || name in allowScripts;

describe("a fresh clone's npm ci", () => {
  it("has decided every install script in the lockfile, at the lockfile's version", () => {
    const undecided = withScripts.filter(({ name, version }) => !decided(name, version));
    expect(undecided, 'add them to package.json "allowScripts" (true to run, false not to)').toEqual([]);
  });

  it("pins only versions the lockfile has", () => {
    const pinned = Object.keys(allowScripts).filter((key) => key.lastIndexOf("@") > 0);
    const locked = new Set(
      Object.entries(packages).map(([path, p]) => `${path.split("node_modules/").at(-1)}@${p.version}`),
    );
    const stale = pinned.filter((key) => !locked.has(key));
    expect(stale, 'remove or update these in package.json "allowScripts"').toEqual([]);
  });
});
