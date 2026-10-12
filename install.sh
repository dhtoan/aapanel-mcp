#!/usr/bin/env bash
# aaPanel MCP installer — run on the machine where Claude Code runs (often the aaPanel server itself):
#   curl -fsSL https://raw.githubusercontent.com/dhtoan/aapanel-mcp/main/install.sh | bash
# Installs to ~/.aapanel-mcp, builds it, then (optionally) registers it with Claude Code.
# The API key is read from the terminal without echo and is only stored in Claude Code's own MCP config.
set -euo pipefail

REPO="https://github.com/dhtoan/aapanel-mcp.git"
DIR="${AAPANEL_MCP_DIR:-$HOME/.aapanel-mcp}"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

command -v git >/dev/null || die "git is required (apt install git / yum install git)."
command -v node >/dev/null || die "Node.js 20+ is required: https://nodejs.org (or aaPanel → App Store → Node.js version manager)."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node.js 20+ is required (found $(node -v))."

if [ -d "$DIR/.git" ]; then
  say "Updating $DIR"
  git -C "$DIR" pull --ff-only --quiet
else
  say "Downloading to $DIR"
  git clone --depth 1 --quiet "$REPO" "$DIR"
fi

say "Building"
(cd "$DIR" && npm install --no-audit --no-fund --silent && npm run build --silent)
ENTRY="$DIR/dist/index.js"
say "Installed: node $ENTRY"

# Default panel URL: when run on the aaPanel server, use its local port.
DEFAULT_URL=""
if [ -f /www/server/panel/data/port.pl ]; then
  PORT="$(tr -dc '0-9' < /www/server/panel/data/port.pl)"
  SCHEME="http"; [ -f /www/server/panel/data/ssl.pl ] && SCHEME="https"
  DEFAULT_URL="$SCHEME://127.0.0.1:$PORT"
fi

if ! command -v claude >/dev/null || ! { : </dev/tty; } 2>/dev/null; then
  cat <<EOF

Register it with Claude Code yourself (put your own values):

  claude mcp add aapanel --scope user \\
    -e AAPANEL_URL=${DEFAULT_URL:-https://YOUR_SERVER_IP:PANEL_PORT} \\
    -e AAPANEL_API_KEY=YOUR_API_KEY \\
    -e AAPANEL_INSECURE_TLS=1 \\
    -- node $ENTRY

Add -e AAPANEL_ALLOW_WRITE=1 / -e AAPANEL_ALLOW_SHELL=1 to enable changes / root shell.
EOF
  exit 0
fi

echo
echo "Before continuing: aaPanel → Settings → API interface → enable API, copy the key,"
echo "and add the IP that will call the panel to the whitelist (127.0.0.1 when Claude runs on this server)."
echo
read -r -p "Panel URL [${DEFAULT_URL:-https://YOUR_SERVER_IP:PANEL_PORT}]: " URL </dev/tty
URL="${URL:-$DEFAULT_URL}"
[ -n "$URL" ] || die "Panel URL is required."
read -r -s -p "API key (hidden): " KEY </dev/tty; echo
[ -n "$KEY" ] || die "API key is required."
read -r -p "Allow changes (create/delete sites, files, databases…)? [y/N]: " W </dev/tty
read -r -p "Allow root shell commands (run_command)? [y/N]: " S </dev/tty

ARGS=(mcp add aapanel --scope user -e "AAPANEL_URL=$URL" -e "AAPANEL_API_KEY=$KEY" -e "AAPANEL_INSECURE_TLS=1")
[[ "$W" =~ ^[Yy] ]] && ARGS+=(-e "AAPANEL_ALLOW_WRITE=1")
[[ "$S" =~ ^[Yy] ]] && ARGS+=(-e "AAPANEL_ALLOW_SHELL=1")
ARGS+=(-- node "$ENTRY")

claude mcp remove aapanel --scope user >/dev/null 2>&1 || true
claude "${ARGS[@]}" >/dev/null
unset KEY
say "Registered with Claude Code as \"aapanel\". Start a new Claude Code session and ask: \"How is my server doing?\""
