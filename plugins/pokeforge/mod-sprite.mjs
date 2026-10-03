import { inflateSync } from 'node:zlib';
import { readFile, writeFile, mkdir, lstat, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { stateDirectory } from './bridge.mjs';

// Bounded decoding of non-interlaced 8-bit RGBA/RGB or 1-8 bit indexed PNGs. Surveyed 2026-10: all 2051 PokéAPI
// files (1025 + 1025 shiny + egg) are 96x96, <=15.5 KB, indexed (4 or 8 bit) or RGBA 8-bit, so the caps below have 8x headroom.
export function pixels(png) {
  if (png.length > 131072 || !png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw new Error('sprite_invalid');
  let width, height, depth, type, palette, alpha;
  const data = [];
  for (let at = 8; at + 12 <= png.length;) {
    const length = png.readUInt32BE(at), name = png.toString('ascii', at + 4, at + 8);
    if (at + length + 12 > png.length) throw new Error('sprite_invalid');
    const chunk = png.subarray(at + 8, at + 8 + length);
    if (name === 'IHDR') {
      if (length !== 13) throw new Error('sprite_invalid');
      width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4); depth = chunk[8]; type = chunk[9];
      if (!width || !height || width > 256 || height > 256 || chunk[10] || chunk[11] || chunk[12] ||
          !((type === 3 && [1, 2, 4, 8].includes(depth)) || ([2, 6].includes(type) && depth === 8))) throw new Error('sprite_invalid');
    } else if (name === 'PLTE') palette = chunk;
    else if (name === 'tRNS') alpha = chunk;
    else if (name === 'IDAT') data.push(chunk);
    else if (name === 'IEND') break;
    at += length + 12;
  }
  if (!width || !data.length || (type === 3 && (!palette || palette.length % 3))) throw new Error('sprite_invalid');
  const channels = type === 6 ? 4 : type === 2 ? 3 : 1;
  const stride = Math.ceil(width * channels * depth / 8), bpp = Math.max(1, channels * depth / 8);
  let raw;
  try { raw = inflateSync(Buffer.concat(data), { maxOutputLength: (stride + 1) * height }); } catch { throw new Error('sprite_invalid'); }
  if (raw.length !== (stride + 1) * height) throw new Error('sprite_invalid');
  const decoded = Buffer.alloc(stride * height), rgba = Buffer.alloc(width * height * 4);
  const paeth = (a, b, c) => {
    const p = a + b - c, x = Math.abs(p - a), y = Math.abs(p - b), z = Math.abs(p - c);
    return x <= y && x <= z ? a : y <= z ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) throw new Error('sprite_invalid');
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x, a = x >= bpp ? decoded[at - bpp] : 0,
        b = y ? decoded[at - stride] : 0, c = y && x >= bpp ? decoded[at - stride - bpp] : 0;
      decoded[at] = raw[y * (stride + 1) + 1 + x] + [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
    }
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      if (type === 3) {
        const index = (decoded[y * stride + Math.floor(x * depth / 8)] >> (8 - depth - x * depth % 8)) & ((1 << depth) - 1);
        if (index * 3 + 2 >= palette.length) throw new Error('sprite_invalid');
        palette.copy(rgba, at, index * 3, index * 3 + 3); rgba[at + 3] = alpha?.[index] ?? 255;
      } else {
        const source = y * stride + x * channels;
        decoded.copy(rgba, at, source, source + 3); rgba[at + 3] = channels === 4 ? decoded[source + 3] : 255;
      }
    }
  }
  return { width, height, rgba };
}

export function artwork({ width, height, rgba }) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (rgba[(y * width + x) * 4 + 3] >= 128) {
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  if (right < left) throw new Error('sprite_invalid');
  const side = Math.max(right - left + 1, bottom - top + 1) + 4, size = 32;
  const startX = (left + right + 1 - side) / 2, startY = (top + bottom + 1 - side) / 2;
  const colors = [];
  const paths = new Map();
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sx = Math.floor(startX + (x + .5) * side / size), sy = Math.floor(startY + (y + .5) * side / size);
    const at = (sy * width + sx) * 4;
    const color = sx < 0 || sy < 0 || sx >= width || sy >= height || rgba[at + 3] < 128 ? 0x01000000
      : rgba[at] << 16 | rgba[at + 1] << 8 | rgba[at + 2];
    colors.push(color);
    if (color !== 0x01000000) paths.set(color, `${paths.get(color) ?? ''}M${x},${y}h1v1h-1z`);
  }
  const cells = Buffer.alloc(size * size / 2 * 12);
  for (let y = 0; y < size / 2; y++) for (let x = 0; x < size; x++) {
    const a = colors[y * 2 * size + x], b = colors[(y * 2 + 1) * size + x], at = (y * size + x) * 12;
    cells.writeUInt32LE(a === 0x01000000 ? b === 0x01000000 ? 32 : 0x2584 : 0x2580, at);
    cells.writeUInt32LE(a === 0x01000000 ? b : a, at + 4);
    cells.writeUInt32LE(a === 0x01000000 ? 0x01000000 : b, at + 8);
  }
  return { columns: size, rows: size / 2, cells: cells.toString('base64'),
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" shape-rendering="crispEdges">${[...paths].map(([c, d]) => `<path fill="#${c.toString(16).padStart(6, '0')}" d="${d}"/>`).join('')}</svg>` };
}

export async function sprite(speciesID, shiny = false) {
  if (speciesID !== null && (!Number.isInteger(speciesID) || speciesID < 1 || speciesID > 1025)) return null;
  if (typeof shiny !== 'boolean') return null;
  const name = speciesID === null ? 'egg' : `${shiny ? 'shiny/' : ''}${speciesID}`;
  try {
    const directory = join(stateDirectory(), 'mod-sprites');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o077)) return null;
    const file = join(directory, `${name.replace('/', '-')}.png.base64`);
    try { return artwork(pixels(Buffer.from(await readFile(file, 'utf8'), 'base64'))); } catch {}
    // Every snapshot asks for art: after a failed fetch, wait ten minutes instead of paying the timeout each poll.
    const miss = `${file}.miss`;
    if (Date.now() - (await lstat(miss).catch(() => null))?.mtimeMs < 600000) return null;
    let png, art;
    try {
      const response = await fetch(`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${name}.png`, { signal: AbortSignal.timeout(3000) });
      if (!response.ok || Number(response.headers.get('content-length')) > 131072) throw new Error('sprite_invalid');
      const chunks = []; let length = 0;
      for await (const chunk of response.body) { length += chunk.length; if (length > 131072) throw new Error('sprite_invalid'); chunks.push(chunk); }
      png = Buffer.concat(chunks); art = artwork(pixels(png));
    } catch { await writeFile(miss, '', { mode: 0o600 }).catch(() => {}); return null; }
    // Temp + rename replaces a corrupt cache file ('wx' would fail on it and refetch forever) and never exposes a partial one.
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, png.toString('base64'), { mode: 0o600 }).then(() => rename(temp, file)).catch(() => rm(temp, { force: true })).catch(() => {});
    return art;
  } catch { return null; }
}
