## New

**PokéForge for Claude Code** — your companion, Pokémon collection, training, AI
usage and token shop as a Claude Code Mod. In the terminal, a toolbar band above the
prompt shows your companion, its progress and today's tokens, and **/pokeforge**
opens a pane with Companion, Collection, Activity and Bag & shop. In Claude Code
Desktop's Code tab and in VS Code, the pane opens when the app connects. It uses the
same bundled engine and save as the Codex plugin and connects to a running PokéForge
app. Purchases ask first and an uncertain purchase is never retried
([#6](https://github.com/sacrezm/pokeforge/pull/6)).

## Fixed

None.

## Other

- The plugin archive is also a Claude Code marketplace. Releases validate and test
  the mod with the Claude Code CLI
  ([#6](https://github.com/sacrezm/pokeforge/pull/6)).
- Claude Code installation, update and removal instructions in English, Korean and
  Japanese. Claude Code Mods are early access and are enabled per account by Anthropic.

## Contributors

No external contributors in this release.

---

**Install:** Download `PokeForge-v<VERSION>.zip` below and move `PokeForge.app` to `/Applications`.

**Codex plugin:** Install Node 24+, then run:

```sh
codex plugin marketplace add sacrezm/pokeforge
codex plugin add pokeforge@pokeforge
```

**Claude Code plugin:** Install Node 24+, then run:

```sh
claude plugin marketplace add sacrezm/pokeforge
claude plugin install pokeforge@pokeforge
```

**Upgrade:** Use PokéForge’s **Update & Restart**. Pre-PokéForge installations need one manual update. Existing saves and trainer credentials are retained.
