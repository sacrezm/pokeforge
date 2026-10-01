#!/usr/bin/env python3
"""Bundle the verified universal native engine for offline plugin startup."""
import hashlib
import json
import plistlib
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
plugin = root / "plugins/pokeforge"
app = root / "build/PokeForge.app"
version = json.loads((plugin / ".codex-plugin/plugin.json").read_text())["version"]
info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
assert info["CFBundleShortVersionString"] == version, "Engine and plugin versions must match"
assert (app / "Contents/Resources/Sparkle-LICENSE.txt").stat().st_size > 0
subprocess.run(["lipo", str(app / "Contents/MacOS/PokeForge"), "-verify_arch", "arm64", "x86_64"], check=True)
subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], check=True)
identity = subprocess.run(["codesign", "-dr", "-", str(app)], capture_output=True, text=True, check=True)
requirement = next(line.removeprefix("designated => ") for line in (identity.stdout + identity.stderr).splitlines() if line.startswith("designated => "))
assert requirement.startswith('identifier "io.github.chattymin.poketokenbar"') and "certificate" in requirement, "Stable signing required"
runtime = plugin / "runtime"
runtime.mkdir(exist_ok=True)
archive = runtime / "PokeForge.zip"
subprocess.run(["ditto", "-c", "-k", "--keepParent", "--norsrc", str(app), str(archive)], check=True)
(runtime / "engine.json").write_text(json.dumps({
    "version": version,
    "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
    "requirement": requirement,
}, indent=2) + "\n")
