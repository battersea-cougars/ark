#!/usr/bin/env bash
set -euo pipefail

# The cougars repo is bind-mounted at /src.
if [ -f /src/package-lock.json ] && [ -d /src/apps/web ]; then
  ROOT=/src
else
  echo "No cougars package-lock.json found in /src; skipping npm install."
  ROOT=""
fi

install_bw_session_bashrc() {
  local bashrc="/home/node/.bashrc"
  local snippet=""
  if [ -f /src/.devcontainer/bw-session.bashrc ]; then
    snippet=/src/.devcontainer/bw-session.bashrc
  fi
  if [ -z "$snippet" ] || [ ! -f "$bashrc" ]; then
    return 0
  fi
  # Replace the block every start, so a changed snippet reaches existing containers.
  sed -i '/>>> ark-bw-session >>>/,/<<< ark-bw-session <<</d' "$bashrc"
  [ -n "$(tail -c1 "$bashrc")" ] && printf '\n' >> "$bashrc"
  cat "$snippet" >> "$bashrc"
}

install_bw_session_bashrc
if [ -d /commandhistory ]; then
  sudo chown node:node /commandhistory 2>/dev/null || true
fi
# Claude Code chats live in ~/.claude; the named volume keeps them across rebuilds
if [ -d /home/node/.claude ]; then
  sudo chown node:node /home/node/.claude 2>/dev/null || true
fi

# Claude Code's settings file lives in the mounted ~/.claude (CLAUDE_CONFIG_DIR, docker-compose.yml), so trust and
# Remote Control survive a rebuild. The first start with it takes home's copy in.
claude_config="$HOME/.claude/.claude.json"
if [ ! -e "$claude_config" ] && [ -f "$HOME/.claude.json" ]; then
  cp -p "$HOME/.claude.json" "$claude_config"
  chmod 600 "$claude_config"
fi

# `claude` on the PATH: the VS Code extension brings Claude Code but keeps the binary under a versioned folder. The
# newest is picked at each run, so an extension update needs no restart. `claude remote-control --name
# cougars-container` makes the container a machine of its own in claude.ai/code: sessions started from the phone run
# in here, beside the others. .vscode/tasks.json starts it when VS Code opens the folder.
mkdir -p "$HOME/.local/bin"
cat >"$HOME/.local/bin/claude" <<'SH'
#!/bin/sh
bin=$(ls -d "$HOME"/.vscode-server/extensions/anthropic.claude-code-*/resources/native-binary/claude 2>/dev/null | sort -V | tail -n 1)
[ -n "$bin" ] || { echo "claude: the VS Code extension isn't installed in this container yet" >&2; exit 127; }
exec "$bin" "$@"
SH
chmod 755 "$HOME/.local/bin/claude"

# Cline keeps its settings (API keys included) in ~/.cline/data, which a rebuild wipes. Link them
# to the workspace's gitignored .cline-local/, moving home's copy in on the first start. A
# workspace copy always wins; a home copy beside it is kept as .bak. Chat history (sessions/, db/)
# stays in home.
cline_home="$HOME/.cline/data"
cline_local=/src/.cline-local
mkdir -p "$cline_home" "$cline_local/settings"
chmod 700 "$cline_local"
for name in settings globalState.json; do
  home_path="$cline_home/$name"
  local_path="$cline_local/$name"
  [ "$(readlink "$home_path" 2>/dev/null)" = "$local_path" ] && continue
  if [ -e "$home_path" ] || [ -L "$home_path" ]; then
    if [ "$name" = settings ] && [ -d "$home_path" ] && [ ! -L "$home_path" ] &&
      [ -z "$(ls -A "$local_path")" ]; then
      rmdir "$local_path"
      mv "$home_path" "$local_path"
    elif [ "$name" != settings ] && [ ! -e "$local_path" ]; then
      mv "$home_path" "$local_path"
    else
      bak="$home_path.bak"
      [ -e "$bak" ] || [ -L "$bak" ] && bak="$bak.$(date +%s)"
      mv -T "$home_path" "$bak"
    fi
  fi
  ln -sfn "$local_path" "$home_path"
done

if [ -z "$ROOT" ]; then
  exit 0
fi

# Install npm workspaces when package-lock changes
if [ ! -d "$ROOT/node_modules" ] || [ "$ROOT/package-lock.json" -nt "$ROOT/node_modules/.package-lock.json" ] 2>/dev/null; then
  echo "Installing monorepo dependencies..."
  (cd "$ROOT" && npm install)
fi

# Local D1 (apps/web/.wrangler): rebuilt from db/schema.sql, keeping its data (ADR 0050).
(cd "$ROOT" && npm run --silent db:rebuild:local >/dev/null) || echo "Local D1 rebuild failed; run: npm run db:rebuild:local"
# An empty club (a new container, a deleted database): seed it, so the team app has people and an admin to sign in as.
# Your own db/seed/roster.local.json if there is one, else the made-up example club. A club with members is left alone.
members=$(cd "$ROOT/apps/web" && npx --no-install wrangler d1 execute DB --local --json \
  --command "SELECT count(*) AS n FROM members" 2>/dev/null | node -e 'try { console.log(JSON.parse(require("fs").readFileSync(0))[0].results[0].n) } catch { console.log("?") }')
if [ "$members" = "0" ]; then
  echo "Local club is empty: seeding it."
  (cd "$ROOT" && npm run --silent db:seed:local) || echo "Local seed failed; run: npm run db:seed:local"
fi

echo "Cougars monorepo ready — web :4500 and the team app :4510 start automatically (.vscode/tasks.json). See docs/development.md"
# Cougars' own Bitwarden login (a volume, not the host's: that may be another org's account)
if [ -d "/home/node/.config/Bitwarden CLI" ]; then
  sudo chown -R node:node "/home/node/.config/Bitwarden CLI" 2>/dev/null || true
fi
if command -v bw >/dev/null 2>&1; then
  echo "Secrets: bw-unlock (first time: bw config server https://vault.bitwarden.eu && bw login). docs/setup.md"
fi
