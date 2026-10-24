#!/usr/bin/env node
// The agents' secrets guard (#149): a Claude Code PreToolUse hook (.claude/settings.json) that refuses a Bash command,
// Read or Grep that would show a secret. What it refuses and allows: scripts/lib/secrets-hook.mjs. It reads the tool
// call as JSON on stdin and answers on stdout; anything it can't read is allowed, so it never stops normal work.
import { refusal } from "./lib/secrets-hook.mjs";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
let call;
try {
  call = JSON.parse(raw);
} catch {
  process.exit(0);
}
const why = refusal(call.tool_name, call.tool_input);
if (why)
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          `Refused by the secrets guard (scripts/secrets-hook.mjs, ADR 0002): ${why}. Never show a secret's value. ` +
          "Check presence with test -s FILE or grep -c '^NAME=' FILE; list names with npm run secrets; the user hands " +
          "values over at http://localhost:4500/__secrets.",
      },
    }),
  );
