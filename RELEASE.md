# Releasing PokéForge

PokéForge is an independently maintained fork of [PokeTokenBar](https://github.com/chattymin/PokeTokenBar).
Releases belong to **sacrezm/pokeforge**. The original project's Homebrew tap and
website do not distribute PokéForge.

Use the [release workflow](docs/reference/release-workflow.md) for the complete
signing, verification and publication procedure. Run it from a clean, pushed
`main` checkout on the Mac with the existing signing identity:

```bash
CODESIGN_IDENTITY="Your existing signing identity" \
PTB_SPARKLE_KEY_REF="op://AI/PokeTokenBar Sparkle update signing/password" \
PTB_NOTES_FILE="docs/reference/releases/v<version>.md" \
PTB_CONTRIBUTORS_FILE="docs/reference/releases/v<version>.contributors.txt" \
./scripts/release.sh <major.minor.patch>
```

Choose a version higher than the current release and align the plugin's version.
The script checks the notes and verified contributor roster, runs the native and
plugin tests, builds a universal app and verifies its signature. It publishes
`PokeForge-v<version>.zip`, `PokeForge-Codex-v<version>.zip` (the Codex and Claude Code plugin
marketplace), a signed `appcast.xml`
and `SHA256SUMS.txt`. It does not install the app on the release machine.

Before publishing:

- Update the README and translations to describe what actually ships. Keep future
  trainer battles and unfinished progression work labelled as planned.
- Review release notes and screenshots for accuracy, including fork attribution.
  Use sandbox data in new public screenshots. Include all verified contributors
  since the previous public release, including merged upstream contributions.
- Commit the plugin's built `dist` files, `hooks/pokeforge.mjs` (the Claude mod), signed `runtime` engine, icons and bundled dependency licenses;
  the release gate checks the extracted archive without its own `node_modules`.
- Run the isolated updater smoke test when changing updater or packaging behavior.
- Keep the existing signing certificate, Sparkle public key, bundle identifier,
  save format and trainer credentials. Rebranding must not reset a collection.

For the first PokéForge release, include the [manual upgrade instructions](docs/reference/pokeforge-identity.md).
Older PokeTokenBar builds cannot discover the renamed repository because they
validate the old URL exactly. Existing release assets keep their original names;
do not rewrite signed archives or signed feeds from past releases.
