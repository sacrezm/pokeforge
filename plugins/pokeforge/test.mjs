import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { mkdtemp, chmod, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { bridgeCall, actionSchema } from './bridge.mjs';

const snapshot = { schemaVersion: 1, collection: [], usage: {}, training: {}, wallet: 42 };
async function withBridge(callback, reply = () => snapshot) {
  const directory = await mkdtemp(join(tmpdir(), 'pb-'));
  const path = join(directory, 'plugin.sock');
  const requests = [];
  const server = createServer(socket => {
    let data = ''; socket.setEncoding('utf8');
    socket.on('data', chunk => {
      data += chunk;
      if (!data.includes('\n')) return;
      const request = JSON.parse(data.split('\n')[0]); requests.push(request);
      const response = reply(request);
      if (response === null) { socket.end(); return; }
      const wire = JSON.stringify(response) + '\n';
      socket.write(wire.slice(0, 8)); setTimeout(() => socket.end(wire.slice(8)), 5);
    });
  });
  await new Promise(resolve => server.listen(path, resolve));
  await chmod(path, 0o600);
  try { await callback(directory, requests, path); }
  finally { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
}

test('private bridge handles split packets, bounded expiry and unique request IDs', async () => {
  await withBridge(async (directory, requests) => {
    assert.deepEqual(await bridgeCall(undefined, directory), snapshot);
    await bridgeCall({ action: 'mode', value: 'balanced' }, directory);
    assert.notEqual(requests[0].nonce, requests[1].nonce);
    assert.ok(requests[0].expires > Date.now() / 1000 && requests[0].expires < Date.now() / 1000 + 11);
    assert.equal(requests[1].value, 'balanced');
  });
});
test('missing engine and insecure permissions fail closed without fake data', async () => {
  assert.equal((await bridgeCall(undefined, '/nonexistent/pokeforge')).error, 'engine_offline');
  await withBridge(async (directory, requests, path) => {
    await chmod(path, 0o666);
    assert.equal((await bridgeCall(undefined, directory)).error, 'unsafe_socket');
    assert.equal(requests.length, 0);
  });
});
test('ambiguous mutation is surfaced and never retried', async () => {
  await withBridge(async (directory, requests) => {
    assert.equal((await bridgeCall({ action: 'candy', value: 'owned' }, directory)).error, 'outcome_unknown');
    assert.equal(requests.length, 1);
  }, () => null);
});
test('MCP exposes both UI entrypoints, live data, checked actions and a bundled UI', async () => {
  await withBridge(async (directory, requests) => {
    const serverPath = resolve(process.env.POKEFORGE_SERVER || 'dist/server.mjs');
    const pluginRoot = dirname(dirname(serverPath));
    const manifest = JSON.parse(await readFile(join(pluginRoot, '.codex-plugin/plugin.json'), 'utf8'));
    for (const file of [manifest.interface.logo, manifest.interface.composerIcon, 'LICENSE', 'dist/THIRD_PARTY_NOTICES.txt', 'runtime/PokeForge.zip']) {
      assert.ok((await readFile(join(pluginRoot, file))).length, `Missing packaged asset: ${file}`);
    }
    assert.equal(JSON.parse(await readFile(join(pluginRoot, 'runtime/engine.json'))).version, manifest.version);
    const client = new Client({ name: 'pokeforge-test', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath], cwd: pluginRoot, env: { ...process.env, PTB_STATE_DIR: directory } }));
    try {
      assert.equal(client.getServerVersion().version, manifest.version);
      const { tools } = await client.listTools();
      const open = tools.find(tool => tool.name === 'open_pokeforge');
      assert.deepEqual(open._meta['openai/ui'].entrypoints, [{ type: 'global' }, { type: 'thread' }]);
      assert.equal(tools.find(tool => tool.name === 'update_pokeforge').annotations.readOnlyHint, false);
      const resource = await client.readResource({ uri: open._meta.ui.resourceUri });
      assert.match(resource.contents[0].mimeType, /html/);
      assert.match(resource.contents[0].text, /data-page="collection"/);
      assert.ok(!resource.contents[0].text.includes('/* APP */'));
      const result = await client.callTool({ name: 'get_pokeforge', arguments: {} });
      assert.deepEqual(result.structuredContent, snapshot);
      assert.equal(result.isError, false);
      await client.callTool({ name: 'update_pokeforge', arguments: { action: 'buyItem', value: 'rareCandy', expectedPrice: 5_000_000 } });
      assert.equal(requests.at(-1).expectedPrice, 5_000_000);
      const before = requests.length;
      const invalid = await client.callTool({ name: 'update_pokeforge', arguments: { action: 'writeSave', path: '/tmp/anything' } });
      assert.equal(invalid.isError, true); assert.equal(requests.length, before);
    } finally { await client.close(); }
  });
});
test('tool input rejects extra capabilities and unsafe numeric prices', () => {
  assert.equal(actionSchema.safeParse({ action: 'buyItem', expectedPrice: Infinity }).success, false);
  assert.equal(actionSchema.safeParse({ action: 'mode', value: 'balanced', path: '/tmp/x' }).success, false);
});

test('local dashboard rejects cross-origin writes, unexpected hosts and invalid actions', async () => {
  await withBridge(async (directory, requests) => {
    const child = spawn(process.execPath, ['dist/serve.mjs'], { env: { ...process.env, PTB_STATE_DIR: directory, PORT: '0' } });
    try {
      const [data] = await once(child.stdout, 'data');
      const origin = data.toString().trim();
      const post = (headers, input = { action: 'snapshot' }) => fetch(origin + '/api', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(input),
      });
      assert.equal((await post({ Origin: 'https://untrusted.example' })).status, 403);
      assert.equal((await post({})).status, 403);
      const rejectedHost = await new Promise((resolve, reject) => {
        const req = httpRequest(origin, { headers: { Host: 'untrusted.example' } }, res => { res.resume(); resolve(res.statusCode); });
        req.on('error', reject); req.end();
      });
      assert.equal(rejectedHost, 403);
      assert.equal((await post({ Origin: origin }, { action: 'writeSave' })).status, 400);
      assert.equal(requests.length, 0);
      assert.deepEqual(await (await post({ Origin: origin })).json(), snapshot);
      assert.equal(requests.length, 1);
    } finally { child.kill(); await once(child, 'exit'); }
  });
});
