import js from "@eslint/js";
import tseslint from "typescript-eslint";
import astro from "eslint-plugin-astro";
import svelte from "eslint-plugin-svelte";
import globals from "globals";

export default [
  {
    ignores: [".worktrees/", "**/dist/", "**/.astro/", "**/.wrangler/", "**/.sanity/", "**/worker-configuration.d.ts"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
  ...svelte.configs.recommended,
  {
    // TypeScript inside .svelte files and Svelte runes modules (team app, ADR 0022)
    files: ["**/*.svelte", "**/*.svelte.ts"],
    languageOptions: { parserOptions: { parser: tseslint.parser, extraFileExtensions: [".svelte"] } },
  },
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // How code reads (ADR 0125): warnings, never failures yet. Each is a prompt to look, not a rule a build enforces.
    files: ["**/*.ts", "**/*.js", "**/*.mjs", "**/*.svelte", "**/*.astro"],
    rules: {
      "max-depth": ["warn", 3],
      "max-lines-per-function": ["warn", { max: 80, skipBlankLines: true, skipComments: true, IIFEs: true }],
      "no-else-return": ["warn", { allowElseIf: false }],
      // Off for now (2026-10-23): ~4,000 one-letter names drown the other warnings. Back on once a sweep has named
      // them (ADR 0125)
      "id-length": [
        "off",
        {
          min: 2,
          properties: "never",
          // Tiny conventional scopes: indexes, a sort's pair, a caught error, geometry, the unused
          exceptions: ["i", "j", "k", "n", "a", "b", "e", "x", "y", "_", "$"],
        },
      ],
    },
  },
  {
    // A test's describe block is a list of stories, not a function to split
    files: ["**/*.test.ts", "**/*.test.mjs", "**/testing.ts", "**/*.testing.ts", "**/testing/**"],
    rules: { "max-lines-per-function": "off" },
  },
  {
    // The apps write to the log through scribe (packages/shared/scribe.ts, ADR 0110), never the console itself
    files: ["apps/web/src/**", "apps/team/worker/**", "apps/team/src/**", "packages/shared/**"],
    ignores: [
      "**/*.test.ts",
      "packages/shared/testing/**",
      "packages/shared/scribe.ts",
      "packages/shared/scribe.console.ts",
    ],
    rules: { "no-console": "error" },
  },
];
