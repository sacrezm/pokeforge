#!/usr/bin/env bash
# Publish PokéForge from a clean, pushed main checkout on the signing Mac.
# See docs/reference/release-workflow.md for the signing identity and 1Password reference.
set -euo pipefail
cd "$(dirname "$0")/.."

REPO="sacrezm/pokeforge"
VERSION="${1:?Usage: release.sh <major.minor.patch>}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Invalid version"; exit 1; }
python3 scripts/release-metadata.py check-notes "${PTB_NOTES_FILE:-}" "${PTB_CONTRIBUTORS_FILE:-}"
[[ "$(git branch --show-current)" == "main" ]] || { echo "Run on main"; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo "Commit and push your changes first"; exit 1; }
case "$(git remote get-url origin)" in
  "https://github.com/$REPO.git"|"git@github.com:$REPO.git") ;;
  *) echo "origin must be $REPO; refusing to publish elsewhere"; exit 1 ;;
esac
REMOTE_HEAD=$(git ls-remote origin refs/heads/main | cut -f1)
[[ "$(git rev-parse HEAD)" == "$REMOTE_HEAD" ]] || { echo "Sync main with origin first"; exit 1; }
PREVIOUS=$(sed -nE 's/^VERSION="\$\{PTB_VERSION:-([0-9.]+)\}"/\1/p' scripts/build-app.sh)
[[ "$PREVIOUS" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Cannot read current version"; exit 1; }
[[ -z "$(git ls-remote origin "refs/tags/v$VERSION")" ]] || { echo "Tag already exists; choose a new version"; exit 1; }
# Numeric comparison, not lexical (2.5.10 is newer than 2.5.9).
awk -v a="$VERSION" -v b="$PREVIOUS" 'BEGIN {
  split(a,x,"."); split(b,y,".");
  for(i=1;i<=3;i++) { if(x[i]+0>y[i]+0) exit 0; if(x[i]+0<y[i]+0) exit 1 }
  exit 1
}' || { echo "Version must be newer than $PREVIOUS"; exit 1; }
: "${CODESIGN_IDENTITY:?Set CODESIGN_IDENTITY to the same identity used for previous fork builds}"
: "${PTB_SPARKLE_KEY_REF:?Set PTB_SPARKLE_KEY_REF to the 1Password reference for the Sparkle signing seed}"
[[ "$PTB_SPARKLE_KEY_REF" == op://* ]] || { echo "Sparkle key must come from 1Password"; exit 1; }
op read "$PTB_SPARKLE_KEY_REF" >/dev/null
security find-identity -v -p codesigning | grep -F "\"$CODESIGN_IDENTITY\"" >/dev/null \
  || { echo "Signing identity unavailable; no ad-hoc releases"; exit 1; }
gh repo view "$REPO" --json visibility --jq .visibility | grep -qx PUBLIC \
  || { echo "Public releases are required for unauthenticated update checks"; exit 1; }
if gh release view "v$VERSION" --repo "$REPO" >/dev/null 2>&1; then
  echo "Release already exists; choose a new version"; exit 1
fi
command -v claude >/dev/null || { echo "Claude Code CLI required to validate the Claude mod"; exit 1; }

echo "Testing and building v$VERSION. No app installation or save changes."
python3 -m unittest discover -s scripts/tests -p 'test_release_metadata.py'
npm --prefix plugins/pokeforge ci
npm --prefix plugins/pokeforge test
git diff --exit-code -- plugins/pokeforge/dist plugins/pokeforge/hooks plugins/pokeforge/tests/fixtures/copy.ts
claude plugin test plugins/pokeforge
./scripts/test-gate.sh
# Only the version default is changed; a failed build leaves it uncommitted for inspection.
perl -pi -e "s/PTB_VERSION:-[0-9.]+/PTB_VERSION:-$VERSION/" scripts/build-app.sh
PTB_INSTALL=0 PTB_UNIVERSAL=1 PTB_REQUIRE_STABLE_SIGN=1 PTB_VERSION="$VERSION" ./scripts/build-app.sh
APP="build/PokeForge.app"
BUILT=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$APP/Contents/Info.plist")
[[ "$BUILT" == "$VERSION" ]] || { echo "Built version mismatch"; exit 1; }
codesign --verify --strict "$APP"
lipo "$APP/Contents/MacOS/PokeForge" -verify_arch arm64 x86_64
ZIP="build/PokeForge-v$VERSION.zip"
[[ ! -e "$ZIP" ]] || { echo "$ZIP already exists; inspect it before retrying"; exit 1; }
ditto -c -k --keepParent "$APP" "$ZIP"
python3 scripts/package-plugin-engine.py
bash scripts/package-plugin.sh "$VERSION"
PLUGIN_ZIP="build/PokeForge-Codex-v$VERSION.zip"
PLUGIN_CHECK=$(mktemp -d "$PWD/build/plugin-install-XXXXXXXX")
ditto -x -k "$PLUGIN_ZIP" "$PLUGIN_CHECK"
(cd plugins/pokeforge && POKEFORGE_SERVER="$PLUGIN_CHECK/PokeForge-Codex-v$VERSION/plugins/pokeforge/dist/server.mjs" node --test test.mjs)
(cd plugins/pokeforge && POKEFORGE_SERVER="$PLUGIN_CHECK/PokeForge-Codex-v$VERSION/plugins/pokeforge/dist/server.mjs" node --test standalone.test.mjs)
CLAUDE_ROOT="$PLUGIN_CHECK/PokeForge-Codex-v$VERSION"
claude plugin validate --strict "$CLAUDE_ROOT/plugins/pokeforge"
claude plugin validate --strict "$CLAUDE_ROOT"

# Publish a signed Sparkle feed beside the archive. Private keys never enter Git
# or plaintext files. The private signing seed is read directly from 1Password.
FEED_DIR="build/updates-v$VERSION"
[[ ! -e "$FEED_DIR" ]] || { echo "$FEED_DIR already exists; inspect before retrying"; exit 1; }
mkdir -p "$FEED_DIR"
ditto "$ZIP" "$FEED_DIR/$(basename "$ZIP")"
APPCAST_ARGS=(--maximum-deltas 0 --download-url-prefix "https://github.com/$REPO/releases/download/v$VERSION/" "$FEED_DIR")
op read "$PTB_SPARKLE_KEY_REF" | .build/artifacts/sparkle/Sparkle/bin/generate_appcast --ed-key-file - "${APPCAST_ARGS[@]}"
[[ -s "$FEED_DIR/appcast.xml" ]] || { echo "Signed update feed missing"; exit 1; }
CHECKSUMS="build/SHA256SUMS.txt"
(cd build && shasum -a 256 "$(basename "$ZIP")" "$(basename "$PLUGIN_ZIP")") > "$CHECKSUMS"

git add scripts/build-app.sh plugins/pokeforge/runtime
git commit -m "release: PokéForge v$VERSION"
git push origin main
# A draft prevents update alerts before the binary upload completes.
gh release create "v$VERSION" "$ZIP" "$PLUGIN_ZIP" "$FEED_DIR/appcast.xml" "$CHECKSUMS" --repo "$REPO" --target "$(git rev-parse HEAD)" \
  --draft --title "PokéForge v$VERSION" --notes-file "$PTB_NOTES_FILE"
gh release edit "v$VERSION" --repo "$REPO" --draft=false --latest
echo "Published https://github.com/$REPO/releases/tag/v$VERSION"
