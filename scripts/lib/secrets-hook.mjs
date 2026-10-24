// What the agents' secrets guard lets through (#149, docs/secrets.md "Agents and secrets"): a Claude Code PreToolUse
// hook (scripts/secrets-hook.mjs, .claude/settings.json) that refuses a Bash command, Read or Grep that would show a
// secret: .env*, .dev.vars*, the Bitwarden session, Bitwarden's values, the environment (env, printenv, process.env,
// /proc/*/environ) or the Secrets page. Presence checks stay allowed (test -s .env, grep -c '^NAME=' .env), as do
// names (npm run secrets) and reading code that merely mentions process.env.
//
// It reads a command the way a shell roughly would (quotes, pipes, ;, &&, $( ), heredocs): good enough for an agent's
// commands, not a sandbox. Anything it can't make sense of is allowed.

const SECRET_NAME = /TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|API_KEY|_KEY\b|BW_SESSION|ROSTER/;

/** A path whose contents are secret: .env*, .dev.vars* (not their .example), the vault session, a process's environ. */
export function secretPath(word) {
  const path = word
    .replace(/^[^@]*@(?=[^@]*$)/, "")
    .replace(/^file:\/\//, "")
    .replace(/^[\w.~^-]+:(?!\/)/, ""); // @file, file=@file, HEAD:file
  const base = path.split("/").pop() ?? "";
  if (/^\/proc\/[^/\s]+\/environ$/.test(path)) return true;
  if (/bw-session|\/dev\/shm\/ark-secrets/.test(path)) return true;
  if (/^\.env(\.|\*|$)/.test(base)) return !/^\.env\.(example|sample|template)$/.test(base);
  if (/^\.dev\.vars(\.|\*|$)/.test(base)) return base !== ".dev.vars.example";
  return false;
}

// Commands that show (or copy, or send) a file they're given
const READERS = new Set(
  (
    "cat tac less more most head tail sed awk gawk mawk nl bat batcat xxd od hexdump strings base64 base32 cut sort " +
    "uniq tr diff cmp comm column paste fold fmt pr expand rev vim vi nvim view nano emacs code jq yq cp scp rsync dd " +
    "source . python python3 node bun deno tsx perl ruby php openssl iconv zip tar gzip bzip2 xz zcat zless split " +
    "csplit envsubst dotenv curl wget nc http grep egrep fgrep rg ag ack git"
  ).split(" "),
);
const GIT_SHOWS = new Set(["show", "diff", "log", "blame", "cat-file", "grep", "archive"]);
const INTERPRETERS = /^(node|bun|deno|tsx|python3?|perl|ruby|php)$/;
const SHELLS = /^(ba|z|da|k)?sh$/;
const WRAPPERS = new Set(["sudo", "command", "exec", "time", "nice", "nohup", "builtin", "stdbuf", "ionice"]);

/** The hook's answer for one tool call: undefined to allow it, or why it's refused. */
export function refusal(tool, input = {}) {
  if (tool === "Bash") return commandRefusal(String(input.command ?? ""));
  if (tool === "Read" && secretPath(String(input.file_path ?? ""))) return "that file holds secrets";
  if (tool === "Grep" && input.output_mode === "content") {
    if (secretPath(String(input.path ?? "")) || secretPath(String(input.glob ?? ""))) return "that file holds secrets";
  }
  return undefined;
}

/** Why a shell command would show a secret, if it would. */
export function commandRefusal(command) {
  const { text, heredocs } = withoutHeredocs(command);
  for (const segment of segments(text)) {
    const why = segmentRefusal(segment);
    if (why) return why;
  }
  for (const { runner, body } of heredocs) {
    const why = SHELLS.test(runner) ? commandRefusal(body) : INTERPRETERS.test(runner) ? codeRefusal(body) : undefined;
    if (why) return why;
  }
  return undefined;
}

// ---- reading a command ------------------------------------------------------------------------------------------

/** The command without its heredocs' bodies, and each body with the command it's fed to. */
function withoutHeredocs(command) {
  const lines = command.split("\n");
  const kept = [];
  const heredocs = [];
  for (let i = 0; i < lines.length; i++) {
    kept.push(lines[i]);
    const marker = lines[i].match(/<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1/);
    if (!marker) continue;
    const runner = commandWord(segments(lines[i].slice(0, marker.index)).at(-1) ?? []).word;
    const body = [];
    for (i++; i < lines.length && lines[i].trim() !== marker[2]; i++) body.push(lines[i]);
    heredocs.push({ runner, body: body.join("\n") });
  }
  return { text: kept.join("\n"), heredocs };
}

/** A command's simple commands, each a list of words with the quotes taken off; redirections are words of their own. */
export function segments(s) {
  const out = [];
  let words = [];
  let word = null;
  const push = () => (word !== null && words.push(word), (word = null));
  const end = () => (push(), words.length && out.push(words), (words = []));
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === "'") {
      const j = s.indexOf("'", i + 1);
      word = (word ?? "") + s.slice(i + 1, j < 0 ? s.length : j);
      i = j < 0 ? s.length : j + 1;
    } else if (c === '"') {
      let j = i + 1;
      let quoted = "";
      for (; j < s.length && s[j] !== '"'; j++) quoted += s[j] === "\\" && j + 1 < s.length ? s[++j] : s[j];
      word = (word ?? "") + quoted;
      i = j + 1;
    } else if (c === "\\" && i + 1 < s.length) {
      word = (word ?? "") + (s[i + 1] === "\n" ? "" : s[i + 1]);
      i += 2;
    } else if (c === "\n" || ";|&()`".includes(c)) {
      end();
      i++;
    } else if (c === "$" && s[i + 1] === "(") {
      end();
      i += 2;
    } else if (/\s/.test(c)) {
      push();
      i++;
    } else if (c === "<" || c === ">") {
      push();
      let op = "";
      while (i < s.length && "<>&".includes(s[i])) op += s[i++];
      words.push(op);
    } else {
      word = (word ?? "") + c;
      i++;
    }
  }
  end();
  return out;
}

/** The command a simple command runs, past assignments and wrappers (sudo, env X=1, timeout 5, xargs, env-pull --). */
export function commandWord(words) {
  let i = 0;
  const skipOptions = () => {
    while (i < words.length && /^-/.test(words[i]) && words[i] !== "--") i++;
  };
  for (;;) {
    while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++;
    const w = words[i];
    if (WRAPPERS.has(w)) {
      i++;
    } else if (w === "timeout") {
      i++;
      skipOptions();
      i++; // its duration
    } else if (w === "xargs") {
      i++;
      skipOptions();
    } else if (w === "env" && words.slice(i + 1).some((x) => !/^-|=/.test(x))) {
      i++;
      while (i < words.length && (/^-/.test(words[i]) || /=/.test(words[i]))) i += words[i] === "-u" ? 2 : 1;
    } else if (envPull(words, i) >= 0) {
      if (words.slice(i).includes("--github-env")) return { word: "env-pull --github-env", args: [] };
      const at = envPull(words, i);
      const npms = words[at] === "env:pull" ? words.indexOf("--", at) + 1 : at; // npm run env:pull -- … -- cmd
      const dashes = words.indexOf("--", npms);
      if (dashes < 0) break;
      i = dashes + 1;
    } else break;
  }
  return { word: words[i] ?? "", args: words.slice(i + 1) };
}

/** Where env-pull is named in the words that start at `i` (node scripts/env-pull.mjs, npm run env:pull), or -1. */
function envPull(words, i) {
  const at = words.findIndex((w, k) => k >= i && k <= i + 2 && /(^|\/)env-pull\.mjs$|^env:pull$/.test(w));
  return at;
}

// ---- what's refused ---------------------------------------------------------------------------------------------

function segmentRefusal(words) {
  const { word, args } = commandWord(words);
  const all = [word, ...args];
  const name = word.split("/").pop();
  if (all.some((w) => /^\/proc\/[^/\s]+\/environ$/.test(w))) return "a process's environment holds secrets";
  if (all.some((w) => /\/__secrets\b/.test(w) && !/\s/.test(w)) && /^(curl|wget|http|https|nc)$/.test(name))
    return "the Secrets page is for the user's browser only";
  const dump = environmentDump(name, args);
  if (dump) return dump;
  const vault = bitwardenRefusal(name, args);
  if (vault) return vault;
  if (SHELLS.test(name) || name === "eval") {
    const script = name === "eval" ? args.join(" ") : args[args.indexOf("-c") + 1];
    if ((name === "eval" || args.includes("-c")) && script) return commandRefusal(script);
  }
  if (INTERPRETERS.test(name)) {
    const code = args.find((a, k) => k > 0 && /^(-e|-p|-c|--eval|--print|-pe|-ne|eval)$/.test(args[k - 1]));
    const why = code && codeRefusal(code, { inline: true });
    if (why) return why;
  }
  if (
    /^(echo|printf|print)$/.test(name) &&
    args.some((a) => [...a.matchAll(/\$\{?([A-Za-z_]\w*)/g)].some((m) => SECRET_NAME.test(m[1])))
  )
    return "that prints a secret's value";
  return fileRefusal(name, args, words);
}

/** env, printenv, export, set, declare -p with nothing to run or name: the whole environment. ps e: every process's. */
function environmentDump(name, args) {
  if (name === "printenv") return "printenv shows the environment, secrets included";
  if (name === "env" && args.every((a) => /^-/.test(a))) return "env shows the environment, secrets included";
  if (name === "export" && args.every((a) => a === "-p")) return "export -p shows the environment, secrets included";
  if ((name === "declare" || name === "typeset") && args.length && args.every((a) => /^-[a-z]*[px]/.test(a)))
    return `${name} ${args.join(" ")} shows the environment, secrets included`;
  if (name === "set" && !args.length) return "set shows every variable, secrets included";
  const bsd = args.filter((a, k) => !/^-[oOpuUCgGtq]$/.test(args[k - 1] ?? "") && /^[a-zA-Z]+$/.test(a));
  if (name === "ps" && bsd.some((a) => a.includes("e"))) return "ps e shows processes' environments";
  if (name === "env-pull --github-env") return "--github-env prints every secret (as CI masks); it's for CI only";
  return undefined;
}

/** bws secret …/run, bw get/list items/export/unlock/serve: Bitwarden's values or its session key. */
function bitwardenRefusal(name, args) {
  if (name === "bws" && /^(secret|secrets|run)$/.test(args.find((a) => !a.startsWith("-")) ?? ""))
    return "bws secret shows or changes Bitwarden's values; npm run secrets lists the names";
  if (name !== "bw") return undefined;
  const [sub, what] = args.filter((a) => !a.startsWith("-"));
  if (sub === "list" && /^(folders|organizations|collections|org-collections|org-members)$/.test(what ?? ""))
    return undefined;
  if (/^(get|list|export|unlock|serve|receive|send)$/.test(sub ?? ""))
    return `bw ${sub} shows the vault's items or its session key`;
  return undefined;
}

// The whole environment (not one name of it, nor only its names), and a secrets file read by its literal path
const WHOLE_ENV =
  /process\.env(?![.[\w'"`])|os\.environ(?![.[\w'"`])|os\.environ\.(items|values|copy)\(|%ENV\b|Deno\.env\.toObject/;
const ANY_ENV = /process\.env|os\.environ|getenv|Deno\.env|\$ENV\{|%ENV\b|\bENV\[/;
const READS_SECRET_FILE =
  /(readFileSync|readFile|open|read_text|load_dotenv|createReadStream|parseEnv|loadEnvFile)\(\s*(?:[\w.]+\s*,\s*)?["'`][^"'`]*(\.env(?!\.example)\b|\.dev\.vars|\/environ|bw-session)[^"'`]*["'`]/;

/**
 * Code that shows the environment or reads a secrets file. A one-liner (node -e, python -c) may not touch the
 * environment at all, bar listing its names; a script fed in on a heredoc only may not dump it whole.
 */
function codeRefusal(code, { inline = false } = {}) {
  const env = code.replace(/Object\.keys\(\s*process\.env\s*\)|os\.environ\.keys\(\)/g, "");
  if ((inline ? ANY_ENV : WHOLE_ENV).test(env)) return "that code shows the environment, secrets included";
  if (READS_SECRET_FILE.test(code)) return "that code reads a file that holds secrets";
  return undefined;
}

/** A file that holds secrets, given to a command that shows it or read in with <. */
function fileRefusal(name, args, words) {
  const counts =
    /^(grep|egrep|fgrep|rg|ag|ack)$/.test(name) &&
    args.some((a) => /^-[a-zA-Z]*[cqlL]|^--(count|quiet|silent|files-with(out)?-match)/.test(a));
  const harmless = counts || name === "wc";
  const input = words.findIndex((w, k) => /^<+$/.test(w) && secretPath(words[k + 1] ?? ""));
  if (input >= 0 && !harmless) return "that reads a file that holds secrets";
  if (harmless || !READERS.has(name)) return undefined;
  if (name === "git" && !GIT_SHOWS.has(args.find((a) => !a.startsWith("-")) ?? "")) return undefined;
  const target = args.find((a, k) => secretPath(a) && !/^>+$/.test(args[k - 1] ?? ""));
  return target
    ? `${target} holds secrets: test -s ${target} or grep -c '^NAME=' ${target} checks it without showing it`
    : undefined;
}
