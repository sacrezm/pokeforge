import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile, mkdir, mkdtemp, rename, rm, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { bridgeCall, stateDirectory } from './bridge.mjs';

const run = promisify(execFile);
let starting;
// Keep an already-started engine alive while the host is connected. Never start one just to poll.
setInterval(() => { void bridgeCall(); }, 60000).unref();

// The signed universal engine ships with the plugin. No download or /Applications install.
export async function prepareEngine(runtime, directory) {
  const manifest = JSON.parse(await readFile(join(runtime, 'engine.json'), 'utf8'));
  const archive = join(runtime, 'PokeForge.zip');
  if (!/^[a-f0-9]{64}$/.test(manifest.sha256) || typeof manifest.requirement !== 'string' ||
      !manifest.requirement.startsWith('identifier "io.github.chattymin.poketokenbar"') ||
      createHash('sha256').update(await readFile(archive)).digest('hex') !== manifest.sha256) {
    throw new Error('engine_invalid');
  }
  const cache = join(directory, 'plugin-engines');
  await mkdir(cache, { recursive: true, mode: 0o700 });
  const info = await lstat(cache);
  if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o077)) throw new Error('engine_invalid');
  const destination = join(cache, manifest.sha256);
  const app = join(destination, 'PokeForge.app');
  const verify = target => run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--test-requirement', `=${manifest.requirement}`, target], { timeout: 15000 });
  try {
    await lstat(destination);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const temporary = await mkdtemp(join(cache, 'unpack-'));
    try {
      await run('/usr/bin/ditto', ['-x', '-k', archive, temporary], { timeout: 30000 });
      await verify(join(temporary, 'PokeForge.app'));
      try { await rename(temporary, destination); }
      catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error; }
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
  await verify(app);
  return join(app, 'Contents/MacOS/PokeForge');
}

async function startEngine(directory) {
  const runtime = fileURLToPath(new URL('../runtime/', import.meta.url));
  if (process.platform !== 'darwin') throw new Error('engine_platform');
  let executable;
  try { executable = await prepareEngine(runtime, directory); }
  catch { throw new Error('engine_invalid'); }
  const args = ['--plugin-engine'];
  // Reuse the native isolated preview for integration tests; never seed a real save.
  if (process.env.POKEFORGE_ENGINE_PREVIEW === '1') {
    if (!process.env.PTB_STATE_DIR) throw new Error('engine_invalid');
    args.push('--gameplay-preview');
  }
  const child = spawn(executable, args, { detached: true, stdio: 'ignore' });
  let failed = false;
  child.on('error', () => { failed = true; });
  child.unref();
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && !failed) {
    const state = await bridgeCall(undefined, directory);
    if (state.schemaVersion === 1) return;
    if (state.error !== 'engine_offline') throw new Error(state.error);
    await delay(100);
  }
  throw new Error('engine_start_failed');
}

export async function engineCall(input = { action: 'snapshot' }) {
  const directory = stateDirectory();
  const current = await bridgeCall(undefined, directory);
  if (current.error === 'engine_offline') {
    try { await (starting ??= startEngine(directory).finally(() => { starting = undefined; })); }
    catch (error) { return { error: error.message }; }
  } else if (current.error || input.action === 'snapshot') return current;
  // Only the read-only probe may trigger startup. Never repeat an attempted mutation.
  return bridgeCall(input, directory);
}
