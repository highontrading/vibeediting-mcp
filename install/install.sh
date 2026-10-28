#!/bin/sh
# vibeediting installer for macOS and Linux.
#
#   curl -fsSL https://vibeediting.app/install.sh | sh
#
# What it does (nothing needs admin rights):
#   1. Uses your Node.js if it is version 22.12 or newer. Otherwise downloads a private
#      copy of Node.js (official build from nodejs.org, checksum verified) into
#      ~/.vibeediting/node. Your system is not changed.
#   2. Runs the vibeediting setup: asks for your license key, connects Claude Code,
#      Codex, Cursor and the Claude app, and downloads FFmpeg and the speech model.
#
# Pass options after "sh -s --", for example:
#   curl -fsSL https://vibeediting.app/install.sh | sh -s -- --license VIBE-XXXX-XXXX-XXXX-XXXX
set -eu

PKG="${VIBE_PACKAGE:-@vibeediting/mcp}"
VIBE_DIR="${VIBE_HOME:-$HOME/.vibeediting}"
NODE_DIR="$VIBE_DIR/node"
NODE_DIST="${VIBE_NODE_DIST:-https://nodejs.org/dist/latest-v24.x}"

say() { printf '%s\n' "$*"; }
fail() {
  say "vibeediting install failed: $*" >&2
  say "Help: https://vibeediting.app/support" >&2
  exit 1
}

# Node.js 22.12+ ?
node_ok() {
  v=$("$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.stdout.write(a>22||(a===22&&b>=12)?"yes":"no")' 2>/dev/null) || return 1
  [ "$v" = "yes" ]
}

sha256_of() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    fail "no shasum or sha256sum command found"
  fi
}

fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 3 -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$2" "$1"
  else
    fail "curl or wget is needed"
  fi
}

install_node() {
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) fail "this installer is for macOS and Linux (on Windows use install.ps1)" ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) arch=x64 ;;
    arm64 | aarch64) arch=arm64 ;;
    *) fail "unsupported processor: $(uname -m)" ;;
  esac
  # Rosetta: an Apple Silicon Mac running this shell as Intel still gets the native build.
  if [ "$os" = darwin ] && [ "$(sysctl -in sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then
    arch=arm64
  fi
  say "Getting Node.js (one time, about 50 MB)..."
  tmp=$(mktemp -d "${TMPDIR:-/tmp}/vibeediting.XXXXXX")
  fetch "$NODE_DIST/SHASUMS256.txt" "$tmp/SHASUMS256.txt" || fail "could not reach nodejs.org (check your internet connection)"
  line=$(grep " node-v[0-9.]*-$os-$arch.tar.gz\$" "$tmp/SHASUMS256.txt" | head -n 1)
  [ -n "$line" ] || fail "no Node.js build for $os-$arch"
  sum=${line%% *}
  file=${line##* }
  fetch "$NODE_DIST/$file" "$tmp/$file" || fail "Node.js download failed"
  [ "$(sha256_of "$tmp/$file")" = "$sum" ] || fail "Node.js download did not match its checksum"
  mkdir -p "$tmp/x" "$VIBE_DIR"
  tar -xzf "$tmp/$file" -C "$tmp/x"
  rm -rf "$NODE_DIR"
  mv "$tmp/x/${file%.tar.gz}" "$NODE_DIR"
  rm -rf "$tmp"
  say "Node.js $("$NODE_DIR/bin/node" --version) is ready (private copy in $NODE_DIR)."
}

say ""
say "Installing vibeediting..."

NODE=""
if [ -z "${VIBE_FORCE_PORTABLE_NODE:-}" ] && command -v node >/dev/null 2>&1 && node_ok node; then
  NODE=$(command -v node)
elif [ -x "$NODE_DIR/bin/node" ] && node_ok "$NODE_DIR/bin/node"; then
  NODE="$NODE_DIR/bin/node"
else
  install_node
  NODE="$NODE_DIR/bin/node"
fi
NODE_BIN=$(dirname "$NODE")
PATH="$NODE_BIN:$PATH"
export PATH

# Use the keyboard for questions even though this script arrives through a pipe.
if [ -t 0 ]; then
  exec "$NODE_BIN/npx" -y --package "$PKG" -- vibeediting-mcp --setup "$@"
elif (exec </dev/tty) 2>/dev/null; then
  exec "$NODE_BIN/npx" -y --package "$PKG" -- vibeediting-mcp --setup "$@" </dev/tty
else
  exec "$NODE_BIN/npx" -y --package "$PKG" -- vibeediting-mcp --setup --yes "$@"
fi
