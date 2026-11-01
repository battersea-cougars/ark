// The secrets docs/secrets.md says are kept in Bitwarden Secrets Manager, read from its Overview table (#149): the
// names the Secrets page offers, beside whatever Bitwarden holds. A value that's committed (settings.mjs), kept in
// GitHub or the vault, or never stored isn't offered: it doesn't belong in Secrets Manager.

const NOT_IN_SECRETS_MANAGER = /settings\.mjs|in GitHub|your vault|vault, not Secrets Manager|never stored/;

/** Every documented Secrets Manager name: [{ name, system, env, used }], in the Overview's order. */
export function documentedNames(markdown) {
  const overview = markdown.split(/^## Overview\s*$/m)[1]?.split(/^## /m)[0] ?? "";
  const out = [];
  for (const row of overview.split("\n")) {
    const cells = row
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    const name = cells[0]?.match(/`([A-Z][A-Z0-9_]*)`/)?.[1];
    if (cells.length < 5 || !name || NOT_IN_SECRETS_MANAGER.test(`${cells[0]} ${cells[3]}`)) continue;
    out.push({ name, system: cells[1], env: cells[2], used: cells[4] });
  }
  return out;
}
