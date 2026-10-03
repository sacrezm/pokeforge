import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import zlib, { deflateSync, crc32 } from 'node:zlib';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm, stat, symlink, chmod, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pixels, artwork, sprite } from './mod-sprite.mjs';

// ---- minimal PNG encoder (independent of the decoder under test) ----
const SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const chunk = (name, data = Buffer.alloc(0)) => {
  const head = Buffer.alloc(8); head.writeUInt32BE(data.length); head.write(name, 4, 'ascii');
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
  return Buffer.concat([head, data, tail]);
};
const ihdr = (width, height, depth, type, interlace = 0) => {
  const data = Buffer.alloc(13); data.writeUInt32BE(width); data.writeUInt32BE(height, 4); data[8] = depth; data[9] = type; data[12] = interlace;
  return chunk('IHDR', data);
};
const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};
// Scanlines -> zlib-ready bytes; filters[y % filters.length] is the filter type of row y.
const filtered = (rows, bpp, filters) => Buffer.concat(rows.map((row, y) => {
  const prev = rows[y - 1] ?? Buffer.alloc(row.length), out = Buffer.alloc(row.length + 1);
  out[0] = filters[y % filters.length];
  row.forEach((value, x) => {
    const a = x >= bpp ? row[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
    out[x + 1] = (value - [0, a, b, (a + b) >> 1, paeth(a, b, c)][out[0]]) & 255;
  });
  return out;
}));
const png = ({ width, height, depth = 8, type = 6, rows, palette, trns, filters = [0], idat, interlace }) => {
  const bpp = Math.max(1, { 2: 3, 3: 1, 6: 4 }[type] * depth / 8);
  return Buffer.concat([SIGNATURE, ihdr(width, height, depth, type, interlace),
    ...(palette ? [chunk('PLTE', palette)] : []), ...(trns ? [chunk('tRNS', trns)] : []),
    chunk('IDAT', idat ?? deflateSync(filtered(rows, bpp, filters))), chunk('IEND')]);
};
let seed = 12345;
const random = n => Buffer.from(Array.from({ length: n }, () => (seed = Math.imul(seed, 1103515245) + 12345 & 0x7fffffff) >> 16 & 255));
const rowsOf = (count, length) => Array.from({ length: count }, () => random(length));
const opaque = (width, height, color) => Buffer.concat(Array.from({ length: width * height }, () => Buffer.from([...color, 255])));
const rgbaPng = (width, height, rgba) => png({ width, height, rows: Array.from({ length: height }, (_, y) => rgba.subarray(y * width * 4, (y + 1) * width * 4)) });
const invalid = { message: 'sprite_invalid' };

// ---- decoder: exact RGBA for every supported format and filter ----
for (const filter of [0, 1, 2, 3, 4]) {
  test(`RGBA 8-bit, filter ${filter}`, () => {
    const rows = rowsOf(6, 7 * 4), decoded = pixels(png({ width: 7, height: 6, rows, filters: [filter] }));
    assert.equal(decoded.width, 7); assert.equal(decoded.height, 6);
    assert.deepEqual(decoded.rgba, Buffer.concat(rows));
  });
  test(`RGB 8-bit, filter ${filter}`, () => {
    const rows = rowsOf(6, 5 * 3), decoded = pixels(png({ width: 5, height: 6, type: 2, rows, filters: [filter] }));
    const expected = Buffer.concat(rows.flatMap(row => Array.from({ length: 5 }, (_, x) => Buffer.from([...row.subarray(x * 3, x * 3 + 3), 255]))));
    assert.deepEqual(decoded.rgba, expected);
  });
}
test('every filter with a 4-value alphabet (frequent Paeth/Average ties)', () => {
  for (const filter of [0, 1, 2, 3, 4]) {
    const rows = rowsOf(16, 16 * 4).map(row => row.map(value => value & 3));
    assert.deepEqual(pixels(png({ width: 16, height: 16, rows, filters: [filter] })).rgba, Buffer.concat(rows), `filter ${filter}`);
  }
});
test('mixed filters in one image', () => {
  const rows = rowsOf(10, 9 * 4);
  assert.deepEqual(pixels(png({ width: 9, height: 10, rows, filters: [4, 0, 3, 1, 2] })).rgba, Buffer.concat(rows));
});
for (const [depth, width] of [[1, 11], [2, 5], [4, 7], [8, 6]]) {
  test(`indexed ${depth}-bit with short tRNS`, () => {
    const colors = Math.min(2 ** depth, 200), palette = random(colors * 3), trns = random(Math.min(colors - 1, 3));
    const indices = Array.from({ length: 5 }, () => Array.from({ length: width }, () => random(1)[0] % colors));
    const rows = indices.map(line => { // pack MSB first, pad bits zero
      const row = Buffer.alloc(Math.ceil(width * depth / 8));
      line.forEach((index, x) => { row[Math.floor(x * depth / 8)] |= index << (8 - depth - x * depth % 8); });
      return row;
    });
    const expected = Buffer.concat(indices.flat().map(index => Buffer.from([...palette.subarray(index * 3, index * 3 + 3), trns[index] ?? 255])));
    assert.deepEqual(pixels(png({ width, height: 5, depth, type: 3, rows, palette, trns, filters: [1, 2, 3, 4, 0] })).rgba, expected);
  });
}
test('real PokéAPI shape: ancillary chunks and no tRNS are ignored', () => {
  const rows = [Buffer.from([0x01])], base = png({ width: 2, height: 1, depth: 4, type: 3, rows, palette: Buffer.from([1, 2, 3, 4, 5, 6]) });
  const withExtra = Buffer.concat([base.subarray(0, 33), chunk('gAMA', Buffer.alloc(4)), chunk('tEXt', Buffer.from('a\0b')), base.subarray(33)]);
  assert.deepEqual(pixels(withExtra).rgba, Buffer.from([1, 2, 3, 255, 4, 5, 6, 255]));
});
test('dimension and size caps are inclusive', () => {
  assert.equal(pixels(png({ width: 256, height: 256, rows: Array(256).fill(Buffer.alloc(1024)) })).width, 256);
  const small = png({ width: 1, height: 1, rows: [Buffer.alloc(4)] });
  const padded = size => Buffer.concat([small.subarray(0, 33), chunk('tEXt', Buffer.alloc(size - small.length - 12)), small.subarray(33)]);
  assert.equal(pixels(padded(131072)).width, 1);
  assert.throws(() => pixels(padded(131073)), invalid);
});

// ---- decoder: malformed or unsupported input fails closed with sprite_invalid ----
const valid = () => png({ width: 3, height: 2, rows: rowsOf(2, 12) });
const pal = Buffer.from([1, 2, 3, 4, 5, 6]);
const bomb = deflateSync(Buffer.alloc(64 * 2 ** 20));
for (const [name, input] of Object.entries({
  'bad signature': Buffer.concat([Buffer.from([0x88]), valid().subarray(1)]),
  'empty': Buffer.alloc(0),
  'truncated IDAT chunk': valid().subarray(0, -14),
  'no IDAT': Buffer.concat([SIGNATURE, ihdr(3, 2, 8, 6), chunk('IEND')]),
  'no IHDR': Buffer.concat([SIGNATURE, chunk('IDAT', deflateSync(Buffer.alloc(26))), chunk('IEND')]),
  'zero width': png({ width: 0, height: 1, rows: [Buffer.alloc(0)] }),
  'zero height': png({ width: 1, height: 0, rows: [] }),
  'width 257': png({ width: 257, height: 1, idat: deflateSync(Buffer.alloc(1029)) }),
  'height 257': png({ width: 1, height: 257, idat: deflateSync(Buffer.alloc(257 * 5)) }),
  'bad filter byte': png({ width: 1, height: 1, idat: deflateSync(Buffer.from([5, 0, 0, 0, 0])) }),
  'palette index out of range': png({ width: 3, height: 1, depth: 2, type: 3, rows: [Buffer.from([0b00011100])], palette: pal }),
  'indexed without PLTE': png({ width: 1, height: 1, depth: 8, type: 3, rows: [Buffer.from([0])] }),
  'PLTE not a multiple of 3': png({ width: 1, height: 1, depth: 8, type: 3, rows: [Buffer.from([0])], palette: Buffer.alloc(4) }),
  'corrupt zlib stream': png({ width: 1, height: 1, idat: Buffer.from('not a zlib stream') }),
  'too few decoded rows': png({ width: 2, height: 2, idat: deflateSync(Buffer.alloc(9)) }),
  'trailing decoded bytes': png({ width: 1, height: 1, idat: deflateSync(Buffer.alloc(6)) }),
  'compressed bomb': png({ width: 1, height: 1, idat: bomb }),
  'compressed bomb at the dimension cap': png({ width: 256, height: 256, idat: bomb }),
  'interlaced (absent from PokéAPI, unsupported)': png({ width: 1, height: 1, rows: [Buffer.alloc(4)], interlace: 1 }),
  '16-bit (absent from PokéAPI, unsupported)': png({ width: 1, height: 1, depth: 16, rows: [Buffer.alloc(8)] }),
  'grayscale (absent from PokéAPI, unsupported)': png({ width: 1, height: 1, type: 0, rows: [Buffer.alloc(1)] }),
  'indexed 3-bit': png({ width: 1, height: 1, depth: 3, type: 3, rows: [Buffer.alloc(1)], palette: pal }),
})) test(`pixels rejects ${name}`, () => assert.throws(() => pixels(input), invalid));
test('the bomb fits the input cap, so inflation itself must be bounded to the exact expected size', () => {
  assert.ok(png({ width: 1, height: 1, idat: bomb }).length < 131072);
  const real = zlib.inflateSync, calls = [];
  zlib.inflateSync = (data, options) => { calls.push(options); return real(data, options); }; syncBuiltinESMExports();
  try { pixels(valid()); } finally { zlib.inflateSync = real; syncBuiltinESMExports(); }
  assert.deepEqual(calls, [{ maxOutputLength: 2 * (3 * 4 + 1) }]);
});
test('artwork rejects zero opaque pixels', () => {
  assert.throws(() => artwork(pixels(rgbaPng(2, 2, Buffer.alloc(16)))), invalid);
  assert.throws(() => artwork(pixels(rgbaPng(1, 1, Buffer.from([9, 9, 9, 127])))), invalid);
  assert.doesNotThrow(() => artwork(pixels(rgbaPng(1, 1, Buffer.from([9, 9, 9, 128])))));
});

// ---- artwork: terminal cells and SVG ----
const DEFAULT = 0x01000000, grid = (artCells) => {
  const bytes = Buffer.from(artCells, 'base64'), out = Array.from({ length: 32 }, () => Array(32).fill(DEFAULT));
  for (let at = 0; at < bytes.length; at += 12) {
    const cell = at / 12, x = cell % 32, y = Math.floor(cell / 32), glyph = bytes.readUInt32LE(at), fg = bytes.readUInt32LE(at + 4), bg = bytes.readUInt32LE(at + 8);
    if (glyph === 0x2580) { out[y * 2][x] = fg; out[y * 2 + 1][x] = bg; } else if (glyph === 0x2584) out[y * 2 + 1][x] = fg;
  }
  return out;
};
const cellAt = (art, x, y) => { const bytes = Buffer.from(art.cells, 'base64'), at = (y * 32 + x) * 12; return [0, 4, 8].map(o => bytes.readUInt32LE(at + o)); };
function assertArtwork(art) {
  assert.equal(art.columns, 32); assert.equal(art.rows, 16);
  const bytes = Buffer.from(art.cells, 'base64');
  assert.equal(bytes.toString('base64'), art.cells); assert.equal(bytes.length, 32 * 16 * 12);
  for (let at = 0; at < bytes.length; at += 12) {
    const [glyph, fg, bg] = [0, 4, 8].map(offset => bytes.readUInt32LE(at + offset)), color = value => value === DEFAULT || value <= 0xffffff;
    assert.ok([0x20, 0x2580, 0x2584].includes(glyph), `glyph ${glyph}`); assert.ok(color(fg) && color(bg));
    if (glyph === 0x20) assert.deepEqual([fg, bg], [DEFAULT, DEFAULT]);
    if (glyph === 0x2584) assert.deepEqual([fg === DEFAULT, bg], [false, DEFAULT]);
    if (glyph === 0x2580) assert.notEqual(fg, DEFAULT);
  }
  assert.ok(art.svg.length <= 131072);
  const match = art.svg.match(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 32 32" shape-rendering="crispEdges">((?:<path fill="#[0-9a-f]{6}" d="(?:M\d+,\d+h1v1h-1z)+"\/>)+)<\/svg>$/);
  assert.ok(match, 'SVG contains only crisp path elements');
  const fromSvg = Array.from({ length: 32 }, () => Array(32).fill(DEFAULT));
  for (const [, color, d] of match[1].matchAll(/<path fill="#([0-9a-f]{6})" d="([^"]*)"/g)) for (const [, x, y] of d.matchAll(/M(\d+),(\d+)h1v1h-1z/g)) fromSvg[y][x] = parseInt(color, 16);
  assert.deepEqual(fromSvg, grid(art.cells), 'SVG and terminal cells show the same 32x32 picture');
}
test('solid square is centred, padded and half-block exact', () => {
  const art = artwork(pixels(rgbaPng(4, 4, opaque(4, 4, [0x10, 0x20, 0x30]))));
  assertArtwork(art);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++)
    assert.deepEqual(cellAt(art, x, y), x >= 8 && x < 24 && y >= 4 && y < 12 ? [0x2580, 0x102030, 0x102030] : [0x20, DEFAULT, DEFAULT], `cell ${x},${y}`);
});
test('odd boundaries use the lower and upper half blocks with a default background', () => {
  const art = artwork(pixels(rgbaPng(3, 3, opaque(3, 3, [255, 0, 0]))));
  assertArtwork(art);
  assert.deepEqual(cellAt(art, 9, 4), [0x2584, 0xff0000, DEFAULT]); assert.deepEqual(cellAt(art, 22, 11), [0x2580, 0xff0000, DEFAULT]);
  assert.deepEqual(cellAt(art, 15, 7), [0x2580, 0xff0000, 0xff0000]); assert.deepEqual(cellAt(art, 8, 4), [0x20, DEFAULT, DEFAULT]);
});
test('an off-centre sprite in a large canvas is cropped to its bounding box and centred', () => {
  const rgba = Buffer.alloc(96 * 96 * 4); // opaque 10x10 in the top-left corner
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) rgba.set([1, 2, 3, 255], (y * 96 + x) * 4);
  const art = artwork(pixels(rgbaPng(96, 96, rgba))), lit = grid(art.cells).map(row => row.map(c => c !== DEFAULT));
  const xs = lit.flatMap(row => row.flatMap((on, x) => on ? [x] : [])), ys = lit.flatMap((row, y) => row.some(Boolean) ? [y] : []);
  assertArtwork(art);
  assert.equal(Math.min(...xs) + Math.max(...xs), 31); assert.equal(Math.min(...ys) + Math.max(...ys), 31);
});
test('alpha below 128 is transparent', () => {
  const rgba = Buffer.from([5, 5, 5, 127, 6, 6, 6, 128]), art = artwork(pixels(rgbaPng(2, 1, rgba)));
  assertArtwork(art);
  assert.ok(!art.svg.includes('#050505')); assert.ok(art.svg.includes('#060606'));
});
test('hundreds of distinct colours stay inside the SVG cap and consistent with the cells', () => {
  const rgba = Buffer.alloc(28 * 28 * 4); // 28 + 4 padding = 32: sampled 1:1, 784 distinct opaque cells
  for (let i = 0; i < 784; i++) rgba.set([(i >> 5) * 8, (i & 31) * 8, 50, 255], i * 4);
  const art = artwork(pixels(rgbaPng(28, 28, rgba)));
  assertArtwork(art); assert.equal(art.svg.match(/<path /g).length, 784);
});
test('indexed, tRNS-transparent background becomes default-coloured cells', () => {
  const art = artwork(pixels(png({ width: 2, height: 2, depth: 4, type: 3, rows: [Buffer.from([0x01]), Buffer.from([0x10])], palette: Buffer.from([0, 0, 0, 9, 8, 7]), trns: Buffer.from([0]) })));
  assertArtwork(art);
  assert.ok(art.svg.includes('#090807')); assert.ok(!art.svg.includes('#000000'));
});

// ---- sprite(): argument validation, cache and fetch (fetch is mocked) ----
const sample = rgbaPng(8, 8, opaque(8, 8, [0xaa, 0xbb, 0xcc]));
const art = artwork(pixels(sample));
async function withState(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'pokeforge-sprite-')), previous = process.env.PTB_STATE_DIR;
  process.env.PTB_STATE_DIR = directory;
  try { await callback(directory, join(directory, 'mod-sprites')); }
  finally { mock.restoreAll(); previous === undefined ? delete process.env.PTB_STATE_DIR : process.env.PTB_STATE_DIR = previous; await rm(directory, { recursive: true, force: true }); }
}
const serve = (body, init) => mock.method(globalThis, 'fetch', async () => new Response(body, init));
const exists = path => stat(path).then(() => true, () => false);

test('sprite() rejects invalid ids and shiny types without touching disk or network', () => withState(async directory => {
  const fetchMock = serve(sample);
  for (const [id, shiny] of [[0], [1026], [-1], [1.5], ['25'], [undefined], [NaN], [Infinity], [25, 'yes'], [25, 1], [25, null], [null, 'x']])
    assert.equal(await sprite(id, shiny), null, `${id} ${shiny}`);
  assert.equal(fetchMock.mock.callCount(), 0); assert.deepEqual(await readdir(directory), []);
}));
test('sprite() fetches once per sprite, caches owner-only and then serves from cache', () => withState(async (directory, cache) => {
  const fetchMock = serve(sample);
  for (const [id, shiny, file] of [[25, false, '25'], [25, true, 'shiny-25'], [null, false, 'egg'], [null, true, 'egg'], [1025, false, '1025']]) {
    assert.deepEqual(await sprite(id, shiny), art);
    assert.equal((await stat(join(cache, `${file}.png.base64`))).mode & 0o777, 0o600);
  }
  // the egg is shared between shiny true/false, so its second request is a cache hit
  assert.deepEqual(fetchMock.mock.calls.map(call => call.arguments[0].replace('https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/', '')),
    ['25.png', 'shiny/25.png', 'egg.png', '1025.png']);
  assert.deepEqual((await readdir(cache)).sort(), ['1025.png.base64', '25.png.base64', 'egg.png.base64', 'shiny-25.png.base64']);
  assert.deepEqual(Buffer.from(await readFile(join(cache, '25.png.base64'), 'utf8'), 'base64'), sample);
}));
for (const [name, content] of [['garbage', 'not base64 png'], ['truncated PNG', sample.subarray(0, 40).toString('base64')], ['empty', ''], ['oversize', 'A'.repeat(200000)]])
  test(`a corrupt cache file (${name}) is replaced once, not refetched forever`, () => withState(async (directory, cache) => {
    await mkdir(cache, { mode: 0o700 }); await writeFile(join(cache, '25.png.base64'), content, { mode: 0o600 });
    const fetchMock = serve(sample);
    assert.deepEqual(await sprite(25), art); assert.equal(fetchMock.mock.callCount(), 1);
    assert.deepEqual(await sprite(25), art); assert.equal(fetchMock.mock.callCount(), 1);
    assert.deepEqual(Buffer.from(await readFile(join(cache, '25.png.base64'), 'utf8'), 'base64'), sample);
    assert.equal((await stat(join(cache, '25.png.base64'))).mode & 0o777, 0o600); assert.deepEqual(await readdir(cache), ['25.png.base64']);
  }));
test('a valid cache file is used without any network', () => withState(async (directory, cache) => {
  await mkdir(cache, { mode: 0o700 }); await writeFile(join(cache, 'shiny-6.png.base64'), sample.toString('base64'), { mode: 0o600 });
  const fetchMock = serve('unused');
  assert.deepEqual(await sprite(6, true), art); assert.equal(fetchMock.mock.callCount(), 0);
}));
for (const [name, body, init] of [
  ['HTTP 404', 'missing', { status: 404 }], ['non-PNG body', 'hello', {}], ['truncated PNG', sample.subarray(0, 30), {}],
  ['advertised oversize', sample, { headers: { 'content-length': '131073' } }], ['streamed oversize', Buffer.alloc(131073), {}],
]) test(`sprite() returns null and caches only a miss for ${name}`, () => withState(async (directory, cache) => {
  serve(body, init);
  assert.equal(await sprite(25), null); assert.deepEqual(await readdir(cache), ['25.png.base64.miss']);
}));
test('sprite() stops reading an endless body at the size cap', () => withState(async (directory, cache) => {
  let pulled = 0;
  serve(new ReadableStream({ pull(controller) { if (++pulled < 5000) controller.enqueue(new Uint8Array(1024)); else controller.close(); } }));
  assert.equal(await sprite(25), null); assert.ok(pulled < 300, `pulled ${pulled} KiB`); assert.deepEqual(await readdir(cache), ['25.png.base64.miss']);
}));
test('a failed fetch is not retried for ten minutes, then is', () => withState(async (directory, cache) => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => { throw new TypeError('fetch failed'); });
  assert.equal(await sprite(25), null); assert.equal(await sprite(25), null);
  assert.equal(fetchMock.mock.callCount(), 1, 'the second poll pays no timeout');
  assert.deepEqual(await readdir(cache), ['25.png.base64.miss']);
  const old = new Date(Date.now() - 601000); await utimes(join(cache, '25.png.base64.miss'), old, old);
  mock.restoreAll(); const retry = serve(sample);
  assert.deepEqual(await sprite(25), art); assert.equal(retry.mock.callCount(), 1);
}));
test('sprite() still returns the art when the cache cannot be written', () => withState(async (directory, cache) => {
  await mkdir(cache, { mode: 0o700 }); await mkdir(join(cache, '25.png.base64')); // a directory in the way: rename fails
  serve(sample);
  assert.deepEqual(await sprite(25), art); assert.deepEqual(await readdir(cache), ['25.png.base64']);
}));
test('sprite() refuses a cache directory that is not private or not a real directory', () => withState(async (directory, cache) => {
  const fetchMock = serve(sample);
  await mkdir(cache, { mode: 0o700 }); await chmod(cache, 0o755);
  assert.equal(await sprite(25), null);
  await rm(cache, { recursive: true }); await mkdir(join(directory, 'elsewhere'), { mode: 0o700 }); await symlink(join(directory, 'elsewhere'), cache);
  assert.equal(await sprite(25), null);
  assert.equal(fetchMock.mock.callCount(), 0); assert.deepEqual(await readdir(join(directory, 'elsewhere')), []);
}));

// ---- opt-in: the real PokéAPI sprites (POKEFORGE_NETWORK_TESTS=1) ----
test('real PokéAPI sprites: 25, shiny 25 and egg', { skip: process.env.POKEFORGE_NETWORK_TESTS !== '1' }, () => withState(async (directory, cache) => {
  const results = [];
  for (const [id, shiny] of [[25, false], [25, true], [null, false]]) { const result = await sprite(id, shiny); assert.ok(result, `${id} ${shiny}`); assertArtwork(result); results.push(result.svg); }
  assert.equal(new Set(results).size, 3);
  assert.deepEqual((await readdir(cache)).sort(), ['25.png.base64', 'egg.png.base64', 'shiny-25.png.base64']);
}));
