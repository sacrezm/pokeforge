#!/usr/bin/env bash
# A ready-to-install local marketplace, with no developer dependencies or saves.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="${1:?Usage: package-plugin.sh <major.minor.patch>}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
[[ "$(node -p "JSON.parse(require('fs').readFileSync('plugins/pokeforge/.codex-plugin/plugin.json')).version")" == "$VERSION" ]]
ROOT="build/PokeForge-Codex-v$VERSION"
[[ ! -e "$ROOT" && ! -e "$ROOT.zip" ]] || { echo "Package already exists; inspect it before retrying" >&2; exit 1; }
mkdir -p "$ROOT/.agents/plugins" "$ROOT/plugins/pokeforge"
cp .agents/plugins/marketplace.json "$ROOT/.agents/plugins/"
for entry in .codex-plugin .mcp.json dist runtime assets LICENSE README.md; do
    cp -R "plugins/pokeforge/$entry" "$ROOT/plugins/pokeforge/"
done
ditto -c -k --keepParent --norsrc "$ROOT" "$ROOT.zip"
echo "$ROOT.zip"
