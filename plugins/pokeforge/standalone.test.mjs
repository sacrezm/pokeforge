import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile, readdir, access, cp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { prepareEngine } from './engine.mjs';

const serverPath = resolve(process.env.POKEFORGE_SERVER || 'dist/server.mjs');
const pluginRoot = dirname(dirname(serverPath));
const runtime = join(pluginRoot, 'runtime');
const modHost = join(pluginRoot, 'dist/mod-host.mjs');
const run = promisify(execFile);

// The mod's real host CLI, run exactly as the hook runs it: argv only, no shell. A non-zero exit still prints JSON.
async function host(env, input) {
  const argv = input === undefined ? [] : [typeof input === 'string' ? input : JSON.stringify(input)];
  const result = await run(process.execPath, [modHost, ...argv], { env, timeout: 60000 }).catch(error => error);
  assert.ok(!result.killed, 'mod-host timed out');
  return { code: result.code ?? 0, out: JSON.parse(result.stdout) };
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function stop(pid, signal = 'SIGTERM') {
  try { process.kill(pid, signal); } catch {}
  for (let n = 0; n < 150 && alive(pid); n++) await delay(20);
}
const text = async (command, args) => (await run(command, args).catch(() => ({ stdout: '' }))).stdout;
// Processes holding this state directory's socket: the one native writer.
const holders = async directory => (await text('/usr/sbin/lsof', ['-t', join(directory, 'plugin.sock')])).split('\n').filter(Boolean).map(Number);
// Kill only isolated preview engines (never the installed app), even when a failed assertion lost track of one.
async function reap(directory, pids) {
  for (const pid of new Set([...pids, ...await holders(directory)])) {
    if (pid !== process.pid && (await text('/bin/ps', ['-p', String(pid), '-o', 'command='])).includes('--gameplay-preview')) await stop(pid);
  }
}

test('standalone plugin starts its bundled engine, shares one writer and preserves progress on restart', { skip: process.platform !== 'darwin', timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pf-'));
  const env = { ...process.env, PTB_STATE_DIR: directory, POKEFORGE_ENGINE_PREVIEW: '1' };
  const clients = [];
  const pids = new Set();
  async function call(client, name, input = {}) {
    const result = await client.callTool({ name, arguments: input });
    assert.equal(result.isError, false, JSON.stringify(result));
    const state = result.structuredContent;
    if (state.enginePID) pids.add(state.enginePID);
    return state;
  }
  try {
    for (let n = 0; n < 2; n++) {
      const client = new Client({ name: 'standalone-test', version: '1' });
      await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath], cwd: pluginRoot, env }));
      clients.push(client);
    }
    const [first, second] = await Promise.all(clients.map(client => call(client, 'get_pokeforge')));
    assert.equal(first.headless, true);
    assert.equal(first.sandbox, true);
    assert.equal(first.enginePID, second.enginePID);
    assert.equal(first.collection[0].id, 'preview-pikachu');
    const executable = await prepareEngine(runtime, directory);
    const extra = spawn(executable, ['--plugin-engine', '--gameplay-preview'], { env, stdio: 'ignore' });
    assert.equal((await once(extra, 'exit'))[0], 0);
    assert.equal((await call(clients[0], 'get_pokeforge')).enginePID, first.enginePID);
    await call(clients[0], 'update_pokeforge', { action: 'mode', value: 'training' });
    const spent = await call(clients[1], 'update_pokeforge', { action: 'candy', value: 'preview-pikachu' });
    assert.equal(spent.collection[0].level, 6);
    assert.equal(spent.items.find(item => item.id === 'rareCandy').count, 2);
    process.kill(first.enginePID, 'SIGTERM');
    for (let n = 0; n < 100; n++) {
      try { process.kill(first.enginePID, 0); await delay(20); } catch { break; }
    }
    const restored = await call(clients[0], 'get_pokeforge');
    assert.notEqual(restored.enginePID, first.enginePID);
    assert.equal(restored.collection[0].level, 6);
    assert.equal(restored.items.find(item => item.id === 'rareCandy').count, 2);
    assert.equal(restored.training.mode, 'training');
    assert.equal(JSON.parse(await readFile(join(directory, 'companion-state.json'))).trainingMode, 'training');
  } finally {
    await Promise.all(clients.map(client => client.close()));
    for (const pid of pids) { try { process.kill(pid, 'SIGTERM'); } catch {} }
    await delay(100);
    await rm(directory, { recursive: true, force: true });
  }
});

test('a damaged engine archive fails verification before it can run', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pf-bad-'));
  try {
    const bad = join(directory, 'runtime');
    await cp(runtime, bad, { recursive: true });
    await writeFile(join(bad, 'PokeForge.zip'), 'damaged archive');
    await assert.rejects(prepareEngine(bad, directory), /engine_invalid/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('mod host rejects invalid input without starting an engine or touching state', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pf-input-'));
  const env = { ...process.env, PTB_STATE_DIR: directory, POKEFORGE_ENGINE_PREVIEW: '1' };
  const long = '$(touch pwned);'.repeat(20);
  try {
    for (const input of [
      { action: 'nope' }, { action: 'snapshot', extra: 1 }, { action: 'mode', value: 'training', extra: true },
      { action: 'mode', value: ['training; touch pwned'] }, { action: 'candy', value: long },
      { action: 'buyItem', value: 'mint', expectedPrice: '2000000' }, { action: 'buyItem', value: 'mint', expectedPrice: -1 },
      'snapshot; touch pwned', 'not json', '', 'null', '[]', 'true', '{"action":"snapshot"} trailing', undefined,
    ]) {
      const { code, out } = await host(env, input);
      assert.deepEqual([code, out], [1, { error: 'invalid_action' }], JSON.stringify(input));
    }
    // Nothing was started or written: no engine.lock, plugin.sock, engine cache or sprite cache.
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await reap(directory, []); // only matters if the guard broke and an engine started
    await rm(directory, { recursive: true, force: true });
  }
});

test('mod host shares one native engine, progress, the price guard and crash durability', { skip: process.platform !== 'darwin', timeout: 240000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pf-mod-'));
  const env = { ...process.env, PTB_STATE_DIR: directory, POKEFORGE_ENGINE_PREVIEW: '1' };
  const client = new Client({ name: 'standalone-mod-test', version: '1' });
  const pids = new Set();
  const seen = state => { if (state.enginePID) pids.add(state.enginePID); return state; };
  const ok = async input => {
    const { code, out } = await host(env, input);
    assert.equal(code, 0);
    assert.equal(out.error, undefined, JSON.stringify(out));
    return seen(out);
  };
  const read = async () => {
    const result = await client.callTool({ name: 'get_pokeforge', arguments: {} });
    assert.equal(result.isError, false, JSON.stringify(result));
    return seen(result.structuredContent);
  };
  const candies = state => state.items.find(item => item.id === 'rareCandy').count;
  const hero = state => state.collection.find(pokemon => pokemon.id === 'preview-pikachu');
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath], cwd: pluginRoot, env }));
    // (a) No engine running: two mod-host processes and an MCP client race to start it. One native writer wins.
    const [first, second, viaMcp] = await Promise.all([ok({ action: 'snapshot' }), ok({ action: 'snapshot' }), read()]);
    for (const state of [first, second, viaMcp]) {
      assert.equal(state.headless, true);
      assert.equal(state.sandbox, true);
      assert.equal(state.enginePID, first.enginePID);
    }
    assert.ok(first.enginePID > 0);
    assert.deepEqual(await holders(directory), [first.enginePID]);
    assert.ok(first.modArt === null || first.modArt.columns === 32); // art needs the network; its presence is not required
    assert.equal(hero(first).level, 5);
    assert.equal(candies(first), 3);
    // (b) Mutations through mod-host are the MCP client's progress too.
    assert.equal((await ok({ action: 'mode', value: 'training' })).training.mode, 'training');
    const spent = await ok({ action: 'candy', value: 'preview-pikachu' });
    assert.equal(hero(spent).level, 6);
    assert.equal(candies(spent), 2);
    const shared = await read();
    assert.deepEqual([hero(shared).level, candies(shared), shared.training.mode, shared.wallet], [6, 2, 'training', spent.wallet]);
    // (c) A stale or wrong price is rejected by the engine and changes nothing.
    const mint = shared.items.find(item => item.id === 'mint');
    assert.ok(mint.canBuy && mint.price > 0 && shared.wallet >= mint.price);
    for (const expectedPrice of [mint.price + 1, mint.price - 1, 0]) {
      const { code, out } = await host(env, { action: 'buyItem', value: 'mint', expectedPrice });
      assert.equal(code, 0);
      assert.equal(out.error, 'price_changed');
      assert.deepEqual([out.wallet, out.items], [shared.wallet, shared.items]);
    }
    const unchanged = await read();
    assert.deepEqual([unchanged.wallet, unchanged.items], [shared.wallet, shared.items]);
    // Control: the same purchase at the engine's price goes through, so the rejections above were about the price.
    const bought = await ok({ action: 'buyItem', value: 'mint', expectedPrice: mint.price });
    assert.equal(bought.wallet, shared.wallet - mint.price);
    assert.equal(bought.items.find(item => item.id === 'mint').count, 1);
    // A shell-looking string is inert data: it passes the host schema, the engine rejects it, nothing runs.
    const hostile = await host(env, { action: 'mode', value: `catching; touch ${directory}/pwned $(id) \`id\`` });
    assert.deepEqual([hostile.code, hostile.out.error, hostile.out.training.mode], [0, 'invalid_request', 'training']);
    await assert.rejects(access(join(directory, 'pwned')), { code: 'ENOENT' });
    // (e) Engine terminated: the next snapshot restarts it and the progress is still there.
    await stop(bought.enginePID);
    assert.equal(alive(bought.enginePID), false);
    const restored = await ok({ action: 'snapshot' });
    assert.notEqual(restored.enginePID, bought.enginePID);
    assert.deepEqual([hero(restored).level, candies(restored), restored.training.mode, restored.wallet], [6, 2, 'training', bought.wallet]);
    assert.equal(restored.items.find(item => item.id === 'mint').count, 1);
    assert.equal(JSON.parse(await readFile(join(directory, 'companion-state.json'))).trainingMode, 'training');
    // (f) Crash (stale plugin.sock left behind), then a mutation as the very first call. engineCall probes with a
    // read-only snapshot, sees the engine offline, starts it and sends the mutation exactly once (fresh nonce, no retry).
    // Safe: the caller asked for it once, the engine re-checks target and funds on the loaded save, and it is never repeated.
    await stop(restored.enginePID, 'SIGKILL');
    const applied = await ok({ action: 'candy', value: 'preview-pikachu' });
    assert.notEqual(applied.enginePID, restored.enginePID);
    assert.deepEqual([hero(applied).level, candies(applied)], [7, 1]);
    // The mutation survives an immediate crash too, and is not applied a second time.
    await stop(applied.enginePID, 'SIGKILL');
    const again = await read();
    assert.notEqual(again.enginePID, applied.enginePID);
    assert.deepEqual([hero(again).level, candies(again)], [7, 1]);
  } finally {
    await client.close().catch(() => {});
    await reap(directory, pids);
    await rm(directory, { recursive: true, force: true });
  }
});
