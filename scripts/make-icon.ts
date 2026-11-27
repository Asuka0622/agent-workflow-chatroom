import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// Generates a crisp 256x256 PNG and multi-frame ICO icon with zero external dependencies
const SIZE = 256;
const rgba = Buffer.alloc(SIZE * SIZE * 4);

function setPixel(x: number, y: number, r: number, g: number, b: number, a = 255) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const idx = (y * SIZE + x) * 4;
  const alpha = a / 255;
  const inv = 1 - alpha;
  rgba[idx] = Math.round(r * alpha + rgba[idx] * inv);
  rgba[idx + 1] = Math.round(g * alpha + rgba[idx + 1] * inv);
  rgba[idx + 2] = Math.round(b * alpha + rgba[idx + 2] * inv);
  rgba[idx + 3] = Math.min(255, Math.round(a + rgba[idx + 3] * inv));
}

function fillRoundedRect(x0: number, y0: number, w: number, h: number, radius: number, colorFn: (x: number, y: number) => [number, number, number, number]) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      let inside = true;
      const rx = x < x0 + radius ? x0 + radius - x : x >= x0 + w - radius ? x - (x0 + w - radius - 1) : 0;
      const ry = y < y0 + radius ? y0 + radius - y : y >= y0 + h - radius ? y - (y0 + h - radius - 1) : 0;
      if (rx > 0 && ry > 0 && rx * rx + ry * ry > radius * radius) inside = false;
      if (inside) {
        const [r, g, b, a] = colorFn(x, y);
        setPixel(x, y, r, g, b, a);
      }
    }
  }
}

// Background rounded square gradient (deep slate to vibrant blue)
fillRoundedRect(12, 12, 232, 232, 48, (x, y) => {
  const t = (x + y) / (2 * SIZE);
  const r = Math.round(37 * (1 - t) + 15 * t);
  const g = Math.round(99 * (1 - t) + 23 * t);
  const b = Math.round(235 * (1 - t) + 42 * t);
  return [r, g, b, 255];
});

// Four miniature workflow cards representing the 4 swimlanes (Blue, Amber, Indigo, Emerald)
fillRoundedRect(38, 48, 76, 44, 12, () => [56, 189, 248, 255]); // Human
fillRoundedRect(136, 48, 82, 44, 12, () => [251, 191, 36, 255]); // Claude
fillRoundedRect(38, 114, 76, 44, 12, () => [255, 255, 255, 245]); // Parallel / Approve
fillRoundedRect(136, 114, 82, 44, 12, () => [52, 211, 153, 255]); // Codex
// Bottom release pipeline bar
fillRoundedRect(38, 178, 180, 32, 10, () => [248, 113, 113, 255]);
// Connectors
fillRoundedRect(114, 67, 22, 6, 3, () => [226, 232, 240, 230]);
fillRoundedRect(174, 92, 6, 22, 3, () => [226, 232, 240, 230]);
fillRoundedRect(114, 133, 22, 6, 3, () => [226, 232, 240, 230]);
fillRoundedRect(125, 158, 6, 20, 3, () => [226, 232, 240, 230]);

// Encode PNG
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crcBuf]);
}

const rawRows = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  rawRows[y * (SIZE * 4 + 1)] = 0;
  rgba.copy(rawRows, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  pngChunk('IHDR', ihdr),
  pngChunk('IDAT', zlib.deflateSync(rawRows)),
  pngChunk('IEND', Buffer.alloc(0)),
]);

// Wrap PNG inside a standard 256x256 Windows ICO container (supported since Windows Vista)
const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(0, 0); // reserved
icoHeader.writeUInt16LE(1, 2); // type: ICO
icoHeader.writeUInt16LE(1, 4); // count: 1

const icoEntry = Buffer.alloc(16);
icoEntry[0] = 0; // 256px
icoEntry[1] = 0; // 256px
icoEntry[2] = 0; // palette
icoEntry[3] = 0; // reserved
icoEntry.writeUInt16LE(1, 4); // color planes
icoEntry.writeUInt16LE(32, 6); // bpp
icoEntry.writeUInt32LE(png.length, 8); // size
icoEntry.writeUInt32LE(22, 12); // offset

const ico = Buffer.concat([icoHeader, icoEntry, png]);

const outDir = path.resolve(process.cwd(), 'build');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon.png'), png);
fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);
console.log('Generated build/icon.png and build/icon.ico');
