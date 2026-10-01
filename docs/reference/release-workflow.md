# PokéForge releases

This fork uses GitHub Releases in **sacrezm/pokeforge**. No upstream tap,
Pages deployment, update server, or CI signing secrets are needed. Sparkle provides
the native download, signature verification, app replacement and relaunch UI.

## Publish

Commit and push the intended changes to this fork's `main`, then run on the
Mac that holds the existing signing identity:

```bash
CODESIGN_IDENTITY="Your existing signing identity" \
PTB_SPARKLE_KEY_REF="op://AI/PokeTokenBar Sparkle update signing/password" \
PTB_NOTES_FILE="docs/reference/releases/v2.7.0.md" \
PTB_CONTRIBUTORS_FILE="docs/reference/releases/v2.7.0.contributors.txt" \
./scripts/release.sh 2.7.0
```

Replace the identity placeholder with the existing fork signing identity and the
example version with a higher major.minor.patch. Other release machines must
securely have the **same certificate and private key**, not create a replacement
with the same name. Never put private keys or certificates containing private keys in Git.

Prepare the English notes and verified contributor roster from the previous public
release first. Update the plugin version in its manifest, package metadata and
MCP/UI entrypoints to match the release, run `npm ci && npm test` in
`plugins/pokeforge`, and commit its `dist` output. Git marketplace installs use those
bundles without running npm. Build the signed universal engine and run
`python3 scripts/package-plugin-engine.py`; commit `plugins/pokeforge/runtime/`
so fresh Git installs are standalone too. Keep `.agents/plugins/marketplace.json` in the repository.

The command validates the notes before any build or publication, checks the clean
checkout and exact origin, runs the release-metadata tests, plugin tests and full native test gate,
bumps the bundled version, builds a universal Apple Silicon + Intel app with the
pinned Sparkle framework, verifies its stable signature, and packages a ZIP.
It reads the Ed25519 signing seed directly from 1Password through a pipe and generates
a signed `appcast.xml` pointing at that ZIP. Both feed and archive are authenticated
by the public key in `scripts/sparkle-public-key.txt`; never replace that key casually.
No private key is written to disk, committed, or stored in the macOS Keychain.
It also packages `PokeForge-Codex-v<version>.zip` as a local plugin marketplace,
extracts it into a clean directory and runs the MCP contract against the extracted
server, including standalone startup and restart recovery. It includes the signed engine, icons and dependency licenses, without developer dependencies
or user data. `SHA256SUMS.txt` covers both archives.
It then commits/pushes the native version bump and bundled engine, creates a draft release containing
both ZIPs, the feed and checksums, and publishes it as Latest. It does
not install the build or interrupt the running app. A build/test failure does
not publish. A failure after creating the draft leaves it unpublished: inspect
the existing draft and attached ZIP before publishing or retrying.

There is no new Apple Developer enrollment/notarization setup here: releases
remain self-signed like the current fork. Downloaded apps may require explicit
approval in macOS Privacy & Security. Stable signing is not Apple notarization.

## User flow

The installed app checks the fork's latest stable release at launch, every hour,
and on popover opening (the latter throttled to 30 minutes). A persistent banner,
Settings, and a menu-bar arrow show an available update. **Update & Restart** opens
Sparkle's native progress window inside the app: download, validate, install and relaunch
after that one click, with cancellation during download and errors shown in-app.
Discovery never installs silently. Saves and trainer credentials are not part of the
app ZIP and are not replaced. Settings offers a
manual check, including skipped versions, and distinguishes failed checks from
"up to date".

Pre-PokéForge builds (including 2.6.3) validate the old repository URL and cannot
discover releases after the repository rename. They need one manual installation
of the first PokéForge release. Subsequent PokéForge updates use the in-app flow.
See [the identity and upgrade notes](pokeforge-identity.md) for installation details. No existing
release is overwritten. Do not use upstream Homebrew upgrade; it removes trading.

## Verify a published release

Before publishing updater changes, run the real isolated install/relaunch test on
the signing Mac (a GUI session is required):

```bash
CODESIGN_IDENTITY="Your existing signing identity" \
PTB_SPARKLE_KEY_REF="op://AI/PokeTokenBar Sparkle update signing/password" \
bash scripts/test-updater-e2e.sh
```

This uses a localhost-only signed feed and a disposable app under `Scratch`, with
no user save or trading code. Both `SURequireSignedFeed` and
`SUVerifyUpdateBeforeExtraction` must be enabled in the real bundle.

- Confirm the release is public, not a draft/prerelease, with both ZIPs, signed `appcast.xml` and `SHA256SUMS.txt`.
- Check its version matches the app's CFBundleShortVersionString.
- Download the published archives and verify their checksums; check the plugin from a fresh checkout or extracted archive.
- On an older fork-channel build, use Settings → Updates → Check now.
- Follow Update & Restart and confirm Sparkle downloads this fork's signed ZIP.
- Check the version and retained collection on restart. Test install failures on a
  disposable app copy, never by damaging the user's live app or save.

GitHub documentation: [Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)
and [latest-release API](https://docs.github.com/en/rest/releases/releases#get-the-latest-release).
