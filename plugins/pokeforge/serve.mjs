import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { bridgeCall, actionSchema } from './bridge.mjs';
const port = Number(process.env.PORT || 8766);
const html = await readFile(new URL('./index.html', import.meta.url));
const server = createServer(async (req, res) => {
  const origin = `http://127.0.0.1:${req.socket.localPort}`;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https://raw.githubusercontent.com data:; connect-src 'self'; frame-ancestors 'none'");
  if (req.headers.host !== `127.0.0.1:${req.socket.localPort}`) { res.writeHead(403).end(); return; }
  if (req.method === 'GET' && ['/', '/index.html'].includes(req.url)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return;
  }
  if (req.url !== '/api' || req.method !== 'POST' || req.headers.origin !== origin || req.headers['content-type'] !== 'application/json') { res.writeHead(403).end(); return; }
  try {
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 16384) { res.writeHead(413).end(); return; } }
    const input = JSON.parse(body);
    const action = Object.keys(input).length === 1 && input.action === 'snapshot' ? input : actionSchema.parse(input);
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(await bridgeCall(action)));
  } catch { res.writeHead(400).end(); }
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}`));
