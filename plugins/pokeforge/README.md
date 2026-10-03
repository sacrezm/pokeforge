# PokéForge for Codex and Claude Code

Raise Pokémon, train your team, browse your collection, and track AI usage inside
Codex or Claude Code. The plugin includes its own local engine: no menu-bar app installation or
running toolbar is required. Existing PokéForge saves are used automatically,
including Pokémon received through trading.

## Install in Codex

Requires macOS 14+, a Codex desktop client with plugin extensions and Node.js 24+.
The plugin includes a signed universal Apple Silicon + Intel engine.

1. Install [Node.js 24 or newer](https://nodejs.org/en/download) if `node --version`
   reports an older version or is unavailable.
2. Add the marketplace and plugin:

   ```sh
   codex plugin marketplace add sacrezm/pokeforge
   codex plugin add pokeforge@pokeforge
   ```

3. Start a new Codex chat and ask **Open PokéForge**, or use the extension entrypoint.

The Git marketplace includes built files. No `npm install`, build step, API key or
new Pokémon save is needed. The panel offers companion progress, Catch / Train /
Balanced modes, individual Pokémon details, usage history and limits, and the bag
and token shop. Trading and advanced settings open in an on-demand window, without
a menu-bar icon. The normal PokéForge desktop app remains an optional alternative.

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

The engine is updated with the plugin and takes effect on its next start. Restart
Codex after upgrading. To restart the engine immediately, open **Trading** and use
the window's power button, then refresh the plugin. Otherwise it exits after five
minutes without a connected host or open window. If you also
use the optional desktop app, update it through **Update & Restart**. Remove the extension with
`codex plugin remove pokeforge@pokeforge`; this does not delete the app or your save.

## Install in Claude Code

Requires macOS 14+, Claude Code with Mods support and Node.js 24+ on `PATH`. The same
bundled engine runs as in Codex; there is no second save.

```sh
claude plugin marketplace add sacrezm/pokeforge
claude plugin install pokeforge@pokeforge
```

Start a new Claude Code session. In the terminal, a toolbar band above the prompt shows
your companion and its progress, and **/pokeforge** opens a pane with Companion, Collection,
Activity and Bag & shop. In Claude Code Desktop's Code tab and in VS Code there is no toolbar:
the PokéForge pane opens when the app connects. Close it and it stays closed until you run
**/pokeforge**. Purchases ask for confirmation first.

Claude Code Mods are early access, and Anthropic enables plugin mods per account through a
server-side rollout that no local setting overrides. If **/pokeforge** is missing, mods are not
enabled for your account yet; the plugin's MCP tools still work.

The plugin also loads the local MCP server it shares with the Codex plugin
(`get_pokeforge`, `update_pokeforge`, `open_pokeforge`).

### Install from the release ZIP

From the first release that includes Claude Code support, the same `PokeForge-Codex-v<VERSION>.zip`
serves Codex and Claude Code. Extract it and add the folder containing `.claude-plugin` and `plugins`
as the marketplace:

```sh
claude plugin marketplace add /absolute/path/to/PokeForge-Codex-v<VERSION>
claude plugin install pokeforge@pokeforge
```

### Update or remove

```sh
claude plugin marketplace update pokeforge
claude plugin update pokeforge@pokeforge
```

Restart Claude Code to apply an update. For a ZIP installation, run
`claude plugin marketplace remove pokeforge` and add the newer extracted folder instead.
Remove the plugin with `claude plugin uninstall pokeforge@pokeforge`; this does not delete the app
or your save. Engine updates behave as described for Codex.

## Your data

The same native engine owns progression, ownership and saves. The plugin
uses a private, owner-only Unix socket in the existing state directory. It never
imports a second collection or writes save files directly. Purchases require
confirmation and the current price; failed saves roll back. An uncertain action
is never retried automatically: check your inventory before repeating it.

The engine reads local usage using the existing provider integrations. Only totals,
limits and Pokémon state are sent to the panel; credentials, raw logs, prompts and
project paths are not exposed to it.
Pokémon sprites load from PokéAPI's public GitHub repository. The engine keeps
its existing provider, update and optional trading connections. No hosted plugin
service is required.

On first use, the plugin verifies and unpacks its bundled engine in the existing
Application Support directory, then runs it without a menu-bar icon or login item.
If a compatible desktop app is already running, the plugin connects to it instead.
A kernel lock prevents updated desktop and plugin processes from writing the same
save simultaneously. Keep older apps closed when using the standalone plugin.
The engine stays alive while Codex or Claude Code is connected; after the host disconnects and
all engine windows close, it exits after five minutes of inactivity. Reopening
the plugin resumes from the same save.

If startup fails, quit an older PokéForge/PokeTokenBar app and retry. This release
uses the existing self-signed identity; macOS Privacy & Security may require
approval. No security setting is disabled. Missing sprites can indicate that
GitHub's sprite host is unavailable; your save is still local. The Claude Code mod
caches sprite art in the `mod-sprites` folder of the state directory and retries an
unreachable sprite host after ten minutes.

## Development

From this directory, run `npm ci` and `npm test`. `npm run preview` serves the same
UI at `http://127.0.0.1:8766/index.html`. UI copy lives in `locales/en.json`.
Commit regenerated `dist/`, `hooks/pokeforge.mjs` and `tests/fixtures/copy.ts` after source
changes; CI rejects stale bundles. The Claude mod (`mod*.mjs`) is tested by `tests/*.test.ts`: run
`claude plugin validate .` and `claude plugin test .` (CI pins Claude Code 2.1.287; run the tests
with an empty `CLAUDE_CONFIG_DIR` while your account's mods rollout is off).
`dist/THIRD_PARTY_NOTICES.txt` contains bundled dependency licenses. The license
omitted by the `@cfworker/json-schema` npm archive is retained under `licenses/`
from its [4.1.1 source revision](https://github.com/cfworker/cfworker/blob/5409fdc2bd144f68e8b28c61c71fcb16600000a6/LICENSE.md).

Use the repository's isolated gameplay preview with a temporary `PTB_STATE_DIR`
for spending tests. Never run destructive or spending tests against your real save.
The repository's `scripts/test-gate.sh` covers the native engine and coverage floor;
`scripts/package-plugin.sh <version>` creates the distributable marketplace ZIP
(Codex and Claude Code).
After native changes, build a signed universal app at the plugin version and run
`python3 scripts/package-plugin-engine.py` from the repository root. Commit
`runtime/` together with the source: Git installations must include that engine.
`node --test standalone.test.mjs` tests two clients, fresh startup, save persistence
and restart using the isolated native preview. The release workflow also runs it
against the extracted ZIP without developer dependencies.

PokéForge is an unofficial Pokémon fan project and an independently maintained
fork of [PokeTokenBar](https://github.com/chattymin/PokeTokenBar). The [MIT license](LICENSE)
covers source code, not Pokémon trademarks, artwork or data.
