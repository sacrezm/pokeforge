# PokéForge for Codex

Raise Pokémon, train your team, browse your collection, and track AI usage inside
Codex. The plugin connects to the PokéForge app on your Mac and uses its existing
save, including Pokémon received through trading.

## Install

Requires macOS 14+, a Codex desktop client with plugin extensions, Node.js 24+,
and the PokéForge app from the same release or newer. The app must be running.

1. Download `PokeForge-v<VERSION>.zip` from
   [GitHub Releases](https://github.com/sacrezm/pokeforge/releases), unzip it, and
   move `PokeForge.app` to `/Applications`. Existing users can use **Update & Restart**.
2. Install [Node.js 24 or newer](https://nodejs.org/en/download) if `node --version`
   reports an older version or is unavailable.
3. Add the marketplace and plugin:

   ```sh
   codex plugin marketplace add sacrezm/pokeforge
   codex plugin add pokeforge@pokeforge
   ```

4. Start a new Codex chat and ask **Open PokéForge**, or use the extension entrypoint.

The Git marketplace includes built files. No `npm install`, build step, API key or
new Pokémon save is needed. The panel offers companion progress, Catch / Train /
Balanced modes, individual Pokémon details, usage history and limits, and the bag
and token shop. Trading and advanced settings open in the native app.

### Install from the release ZIP

Download and extract `PokeForge-Codex-v<VERSION>.zip`. Add the extracted folder
(the one containing `.agents` and `plugins`) as the marketplace:

```sh
codex plugin marketplace add /absolute/path/to/PokeForge-Codex-v<VERSION>
codex plugin add pokeforge@pokeforge
```

### Update or remove

For a Git installation, refresh the marketplace and reinstall the latest plugin:

```sh
codex plugin marketplace upgrade pokeforge
codex plugin add pokeforge@pokeforge
```

Update the native app separately through **Update & Restart**. Restart Codex if an
existing chat still exposes older tool names. Remove the extension with
`codex plugin remove pokeforge@pokeforge`; this does not delete the app or your save.

## Your data

PokéForge remains the sole owner of progression, ownership and saves. The plugin
uses a private, owner-only Unix socket in the existing state directory. It never
imports a second collection or writes save files directly. Purchases require
confirmation and the current price; failed saves roll back. An uncertain action
is never retried automatically: check your inventory before repeating it.

No credentials, raw usage logs, prompts or project paths are sent to the plugin.
Pokémon sprites load from PokéAPI's public GitHub repository. The native app keeps
its existing provider, update and optional trading connections. No hosted plugin
service is required.

If the panel cannot connect, open the current PokéForge app and press **Refresh**.
An older app without the plugin bridge will not connect. Missing sprites can
indicate that GitHub's sprite host is unavailable; your save is still local.

## Development

From this directory, run `npm ci` and `npm test`. `npm run preview` serves the same
UI at `http://127.0.0.1:8766/index.html`. UI copy lives in `locales/en.json`.
Commit regenerated `dist/` after source changes; CI rejects stale bundles.
`dist/THIRD_PARTY_NOTICES.txt` contains bundled dependency licenses. The license
omitted by the `@cfworker/json-schema` npm archive is retained under `licenses/`
from its [4.1.1 source revision](https://github.com/cfworker/cfworker/blob/5409fdc2bd144f68e8b28c61c71fcb16600000a6/LICENSE.md).

Use the repository's isolated gameplay preview with a temporary `PTB_STATE_DIR`
for spending tests. Never run destructive or spending tests against your real save.
The repository's `scripts/test-gate.sh` covers the native engine and coverage floor;
`scripts/package-plugin.sh <version>` creates the distributable marketplace ZIP.
The release workflow tests the extracted ZIP without developer dependencies.

PokéForge is an unofficial Pokémon fan project and an independently maintained
fork of [PokeTokenBar](https://github.com/chattymin/PokeTokenBar). The [MIT license](LICENSE)
covers source code, not Pokémon trademarks, artwork or data.
