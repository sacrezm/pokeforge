import { createConnection } from 'node:net';
import { lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
export const actionSchema = z.object({
  action: z.enum(['refresh', 'mode', 'focus', 'target', 'candy', 'mint', 'buyItem', 'buyBall', 'queueBall', 'openNative']),
  value: z.string().max(160).optional(),
  expectedPrice: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
}).strict();
export const stateDirectory = () => process.env.PTB_STATE_DIR || join(homedir(), 'Library/Application Support/PokeTokenBar');
export async function bridgeCall(input = { action: 'snapshot' }, directory = stateDirectory()) {
  const path = join(directory, 'plugin.sock');
  try {
    const info = await lstat(path);
    if (!info.isSocket() || info.uid !== process.getuid() || (info.mode & 0o077)) return { error: 'unsafe_socket' };
  } catch { return { error: 'engine_offline' }; }
  return new Promise(resolve => {
    let done = false, data = '', connected = false;
    const socket = createConnection(path);
    const finish = result => { if (!done) { done = true; socket.destroy(); resolve(result); } };
    const failed = () => finish({ error: connected && input.action !== 'snapshot' ? 'outcome_unknown' : 'engine_offline' });
    socket.setTimeout(8000, failed);
    socket.on('error', failed); socket.on('end', failed);
    socket.on('connect', () => { connected = true; socket.write(JSON.stringify({ ...input, nonce: randomUUID(), expires: Date.now() / 1000 + 10 }) + '\n'); });
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      data += chunk;
      if (data.length > 8_000_000) return finish({ error: 'invalid_response' });
      if (!data.includes('\n')) return;
      try {
        const result = JSON.parse(data.slice(0, data.indexOf('\n')));
        if (result.error || (result.schemaVersion === 1 && Array.isArray(result.collection) && result.usage && result.training)) finish(result);
        else finish({ error: 'invalid_response' });
      } catch { finish({ error: 'invalid_response' }); }
    });
  });
}
