import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile, cp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { prepareEngine } from './engine.mjs';

const serverPath = resolve(process.env.POKEFORGE_SERVER || 'dist/server.mjs');
const pluginRoot = dirname(dirname(serverPath));
const runtime = join(pluginRoot, 'runtime');

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
