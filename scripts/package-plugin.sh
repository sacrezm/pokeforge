#!/usr/bin/env bash
# A ready-to-install local marketplace for Codex and Claude Code, with no developer dependencies or saves.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="${1:?Usage: package-plugin.sh <major.minor.patch>}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
for manifest in .codex-plugin .claude-plugin; do
    [[ "$(node -p "JSON.parse(require('fs').readFileSync('plugins/pokeforge/$manifest/plugin.json')).version")" == "$VERSION" ]] \
        || { echo "plugins/pokeforge/$manifest/plugin.json is not version $VERSION" >&2; exit 1; }
done
# Generated bundles: a missing one means 'npm run build' was skipped; CI rejects stale ones.
for bundle in hooks/pokeforge.mjs dist/mod-host.mjs; do
    [[ -s "plugins/pokeforge/$bundle" ]] || { echo "Missing plugins/pokeforge/$bundle; run npm run build" >&2; exit 1; }
done
ROOT="build/PokeForge-Codex-v$VERSION"
[[ ! -e "$ROOT" && ! -e "$ROOT.zip" ]] || { echo "Package already exists; inspect it before retrying" >&2; exit 1; }
mkdir -p "$ROOT/.agents/plugins" "$ROOT/.claude-plugin" "$ROOT/plugins/pokeforge"
cp .agents/plugins/marketplace.json "$ROOT/.agents/plugins/"
cp .claude-plugin/marketplace.json "$ROOT/.claude-plugin/"
for entry in .codex-plugin .claude-plugin hooks .mcp.json dist runtime assets LICENSE README.md; do
    cp -R "plugins/pokeforge/$entry" "$ROOT/plugins/pokeforge/"
done
ditto -c -k --keepParent --norsrc "$ROOT" "$ROOT.zip"
echo "$ROOT.zip"
