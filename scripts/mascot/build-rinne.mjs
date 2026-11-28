// Generates the vector mascot art for Rinne into public/mascot/*.svg
// Usage: node scripts/mascot/build-rinne.mjs
// Spec: docs/mascot/RINNE.md. AI-painted PNGs with the same base name take precedence in the app.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/mascot');

// ---------- palette (docs/mascot/RINNE.md) ----------
const C = {
  line: '#1a2350',
  hair: '#0f1c63',
  hairDeep: '#0a1240',
  hairSheen: '#3b52c9',
  skin: '#fdf1e7',
  skinShade: '#f3d9cc',
  blush: '#f4a5b8',
  white: '#f8fafc',
  whiteShade: '#dde3ee',
  cobalt: '#2a4de6',
  navy: '#121b4d',
  lemon: '#f4e27a',
  lemonDeep: '#d4a92a',
  violet: '#6a5cf6',
  pink: '#f1b8f6',
  red: '#ef4444',
};

// ---------- shared defs ----------
const defs = `
<defs>
  <linearGradient id="gHairBack" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${C.hairDeep}"/>
    <stop offset="0.58" stop-color="${C.hair}"/>
    <stop offset="0.76" stop-color="#3f86e0"/>
    <stop offset="0.87" stop-color="#8fe3c8"/>
    <stop offset="1" stop-color="#f4b8e4"/>
  </linearGradient>
  <linearGradient id="gHair" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#1b2c86"/>
    <stop offset="1" stop-color="${C.hair}"/>
  </linearGradient>
  <linearGradient id="gLock" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${C.hair}"/>
    <stop offset="0.62" stop-color="${C.hair}"/>
    <stop offset="0.82" stop-color="#4fa9e8"/>
    <stop offset="1" stop-color="#9fe8cf"/>
  </linearGradient>
  <linearGradient id="gIris" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${C.lemonDeep}"/>
    <stop offset="0.45" stop-color="${C.lemon}"/>
    <stop offset="1" stop-color="#fffbe0"/>
  </linearGradient>
  <linearGradient id="gJacket" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${C.white}"/>
    <stop offset="1" stop-color="${C.whiteShade}"/>
  </linearGradient>
  <radialGradient id="gEyeHalo" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#0a1240"/>
    <stop offset="0.52" stop-color="#0d1a66"/>
    <stop offset="0.64" stop-color="#2746e8"/>
    <stop offset="0.76" stop-color="${C.violet}"/>
    <stop offset="0.88" stop-color="#c26cf0"/>
    <stop offset="1" stop-color="${C.pink}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="gOrb" cx="0.42" cy="0.4" r="0.6">
    <stop offset="0" stop-color="#fffef2"/>
    <stop offset="0.45" stop-color="${C.lemon}"/>
    <stop offset="1" stop-color="${C.lemonDeep}" stop-opacity="0.15"/>
  </radialGradient>
  <radialGradient id="gCheek" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="${C.blush}" stop-opacity="0.75"/>
    <stop offset="1" stop-color="${C.blush}" stop-opacity="0"/>
  </radialGradient>
</defs>`;

const star4 = (x, y, s, fill, extra = '') =>
  `<path d="M ${x} ${y - s} C ${x + s * 0.12} ${y - s * 0.2}, ${x + s * 0.2} ${y - s * 0.12}, ${x + s} ${y} C ${x + s * 0.2} ${y + s * 0.12}, ${x + s * 0.12} ${y + s * 0.2}, ${x} ${y + s} C ${x - s * 0.12} ${y + s * 0.2}, ${x - s * 0.2} ${y + s * 0.12}, ${x - s} ${y} C ${x - s * 0.2} ${y - s * 0.12}, ${x - s * 0.12} ${y - s * 0.2}, ${x} ${y - s} Z" fill="${fill}" ${extra}/>`;

// ---------- parts ----------
function backHair() {
  return `<path d="M 200 58 C 104 58, 66 122, 70 202 C 73 268, 58 334, 48 400 L 352 400 C 342 334, 327 268, 330 202 C 334 122, 296 58, 200 58 Z" fill="url(#gHairBack)" stroke="${C.line}" stroke-width="2.2" stroke-linejoin="round"/>
  <path d="M 92 300 C 88 340, 80 370, 74 400 M 312 300 C 316 340, 322 372, 328 400" stroke="${C.hairSheen}" stroke-width="2" fill="none" opacity="0.5"/>`;
}

function body({ long = false } = {}) {
  const H = long ? 480 : 400;
  // bodysuit
  let s = `<path d="M 182 236 L 218 236 L 221 270 L 179 270 Z" fill="${C.skinShade}" stroke="${C.line}" stroke-width="2"/>
  <path d="M 172 256 C 180 249, 220 249, 228 256 L 236 292 L 164 292 Z" fill="${C.navy}" stroke="${C.line}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M 118 304 C 140 284, 260 284, 282 304 L 300 ${H} L 100 ${H} Z" fill="${C.navy}" stroke="${C.line}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M 200 292 L 200 ${H}" stroke="#2a3780" stroke-width="1.6"/>`;
  // jacket halves (oversized, cropped), cobalt lining along the inner edge
  s += `<path d="M 54 ${H} C 58 336, 88 296, 148 282 C 160 300, 168 334, 170 ${H} Z" fill="url(#gJacket)" stroke="${C.line}" stroke-width="2.2" stroke-linejoin="round"/>
  <path d="M 346 ${H} C 342 336, 312 296, 252 282 C 240 300, 232 334, 230 ${H} Z" fill="url(#gJacket)" stroke="${C.line}" stroke-width="2.2" stroke-linejoin="round"/>
  <path d="M 148 282 C 160 300, 168 334, 170 ${H} L 158 ${H} C 156 340, 149 308, 140 288 Z" fill="${C.cobalt}"/>
  <path d="M 252 282 C 240 300, 232 334, 230 ${H} L 242 ${H} C 244 340, 251 308, 260 288 Z" fill="${C.cobalt}"/>
  <path d="M 148 282 L 126 330 L 150 322 Z" fill="${C.white}" stroke="${C.line}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M 252 282 L 274 330 L 250 322 Z" fill="${C.white}" stroke="${C.line}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M 74 352 C 96 344, 130 344, 152 352" stroke="${C.cobalt}" stroke-width="1.6" fill="none" stroke-dasharray="4 3"/>
  <path d="M 326 352 C 304 344, 270 344, 248 352" stroke="${C.cobalt}" stroke-width="1.6" fill="none" stroke-dasharray="4 3"/>`;
  // technical straps with buckles
  s += `<rect x="92" y="364" width="62" height="9" rx="2" fill="${C.white}" stroke="${C.line}" stroke-width="1.6"/>
  <rect x="140" y="361" width="12" height="15" rx="2" fill="#cfd6e4" stroke="${C.line}" stroke-width="1.6"/>
  <rect x="246" y="364" width="62" height="9" rx="2" fill="${C.white}" stroke="${C.line}" stroke-width="1.6"/>
  <rect x="248" y="361" width="12" height="15" rx="2" fill="#cfd6e4" stroke="${C.line}" stroke-width="1.6"/>`;
  if (long) {
    // skirt waistband with the lemon trim, armband hint
    s += `<path d="M 112 430 L 288 430 L 296 ${H} L 104 ${H} Z" fill="#14151c" stroke="${C.line}" stroke-width="2"/>
    <path d="M 108 446 L 292 446" stroke="${C.lemon}" stroke-width="2.4"/>
    <path d="M 128 430 L 126 ${H} M 166 430 L 164 ${H} M 234 430 L 236 ${H} M 272 430 L 274 ${H}" stroke="#2b2d3a" stroke-width="1.6"/>`;
  }
  return s;
}

function face() {
  return `<path d="M 200 92 C 262 92, 286 140, 284 190 C 282 238, 248 270, 200 272 C 152 270, 118 238, 116 190 C 114 140, 138 92, 200 92 Z" fill="${C.skin}" stroke="${C.line}" stroke-width="2.4" stroke-linejoin="round"/>
  <ellipse cx="152" cy="222" rx="20" ry="9" fill="url(#gCheek)"/>
  <ellipse cx="248" cy="222" rx="20" ry="9" fill="url(#gCheek)"/>`;
}

/** eyes: open | happy | sleep | focus | worried | look | hopeful */
function eye(cx, kind) {
  const L = C.line;
  if (kind === 'happy') {
    return `<path d="M ${cx - 17} 198 Q ${cx} 178, ${cx + 17} 198" stroke="${L}" stroke-width="4.4" fill="none" stroke-linecap="round"/>`;
  }
  if (kind === 'sleep') {
    return `<path d="M ${cx - 17} 194 Q ${cx} 205, ${cx + 17} 194" stroke="${L}" stroke-width="4" fill="none" stroke-linecap="round"/>
    <path d="M ${cx - 12} 200 l -3 5 M ${cx} 202 l 0 5 M ${cx + 12} 200 l 3 5" stroke="${L}" stroke-width="1.8" stroke-linecap="round"/>`;
  }
  const dx = kind === 'look' ? -5 : 0;
  const dy = kind === 'look' ? -5 : 0;
  const iy = 194;
  let s = `<ellipse cx="${cx}" cy="${iy}" rx="19" ry="23" fill="#ffffff"/>
  <ellipse cx="${cx + dx}" cy="${iy + 2 + dy}" rx="15" ry="19.5" fill="url(#gIris)"/>
  <ellipse cx="${cx + dx}" cy="${iy + 3 + dy}" rx="6.5" ry="9.5" fill="${L}"/>
  <ellipse cx="${cx + dx}" cy="${iy + 13 + dy}" rx="9" ry="3" fill="#fff8c8" opacity="0.8"/>`;
  const big = kind === 'hopeful' ? 1.5 : 1;
  s += star4(cx + dx + 5, iy - 5 + dy, 6 * big, '#ffffff');
  s += `<circle cx="${cx + dx - 6}" cy="${iy + 8 + dy}" r="${2.6 * big}" fill="#ffffff"/>`;
  if (kind === 'hopeful') s += `<circle cx="${cx + dx + 7}" cy="${iy + 10 + dy}" r="2" fill="#ffffff"/>`;
  // focus: lower the upper lid
  if (kind === 'focus') {
    s += `<path d="M ${cx - 22} 170 L ${cx + 22} 170 L ${cx + 22} 186 Q ${cx} 182, ${cx - 22} 188 Z" fill="${C.skin}"/>`;
  }
  // lash line + outer flick + lower lid
  const top = kind === 'focus' ? 186 : kind === 'worried' ? 176 : 174;
  s += `<path d="M ${cx - 21} ${top + 8} C ${cx - 12} ${top - 4}, ${cx + 12} ${top - 4}, ${cx + 22} ${top + 6}" stroke="${L}" stroke-width="4.6" fill="none" stroke-linecap="round"/>`;
  const flick = cx < 200 ? `M ${cx - 21} ${top + 8} l -6 -3` : `M ${cx + 22} ${top + 6} l 6 -4`;
  s += `<path d="${flick}" stroke="${L}" stroke-width="3" stroke-linecap="round"/>`;
  s += `<path d="M ${cx - 9} 218 Q ${cx} 220, ${cx + 9} 218" stroke="${L}" stroke-width="1.4" fill="none" stroke-linecap="round" opacity="0.6"/>`;
  return s;
}

function brows(kind) {
  if (kind === 'worried') {
    return `<path d="M 144 160 Q 154 158, 166 150" stroke="${C.line}" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <path d="M 256 160 Q 246 158, 234 150" stroke="${C.line}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
  }
  if (kind === 'focus') {
    return `<path d="M 144 160 Q 156 162, 168 166" stroke="${C.line}" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <path d="M 256 160 Q 244 162, 232 166" stroke="${C.line}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
  }
  return `<path d="M 144 158 Q 156 152, 168 156" stroke="${C.line}" stroke-width="2.2" fill="none" stroke-linecap="round"/>
  <path d="M 256 158 Q 244 152, 232 156" stroke="${C.line}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
}

/** mouth: smile | open | o | flat | wavy | sleep */
function mouth(kind) {
  const L = C.line;
  switch (kind) {
    case 'open':
      return `<path d="M 186 236 Q 200 236, 214 236 Q 210 252, 200 252 Q 190 252, 186 236 Z" fill="#c4546c" stroke="${L}" stroke-width="2"/>
      <path d="M 192 246 Q 200 242, 208 246" stroke="#f3a0b0" stroke-width="2" fill="none"/>`;
    case 'o':
      return `<ellipse cx="200" cy="242" rx="5" ry="6" fill="#c4546c" stroke="${L}" stroke-width="1.8"/>`;
    case 'flat':
      return `<path d="M 192 241 L 208 241" stroke="${L}" stroke-width="2.2" stroke-linecap="round"/>`;
    case 'wavy':
      return `<path d="M 188 243 q 4 -5 8 0 t 8 0 t 8 0" stroke="${L}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
    case 'sleep':
      return `<path d="M 194 242 Q 200 246, 206 242" stroke="${L}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
    default:
      return `<path d="M 190 238 Q 200 246, 210 238" stroke="${L}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
  }
}

function frontHair() {
  const L = C.line;
  // side locks (viewer left long lock; viewer right = braid side)
  let s = `<path d="M 122 168 C 104 222, 106 284, 124 342 C 130 318, 136 270, 140 214 Z" fill="url(#gLock)" stroke="${L}" stroke-width="2.2" stroke-linejoin="round"/>
  <path d="M 278 168 C 292 200, 294 226, 288 250 C 284 232, 274 214, 262 206 Z" fill="url(#gHair)" stroke="${L}" stroke-width="2.2" stroke-linejoin="round"/>`;
  // fringe with pointed strands
  s += `<path d="M 116 178 C 110 110, 150 66, 206 66 C 262 66, 294 110, 286 180 C 278 152, 264 132, 250 124 C 252 142, 246 158, 238 168 C 234 148, 224 130, 212 122 C 210 142, 202 154, 190 162 C 192 142, 186 128, 178 122 C 168 138, 162 154, 152 162 C 152 144, 148 132, 142 126 C 132 142, 124 158, 116 178 Z" fill="url(#gHair)" stroke="${L}" stroke-width="2.4" stroke-linejoin="round"/>`;
  // ahoge + sheen
  s += `<path d="M 204 68 C 200 50, 214 38, 228 40 C 216 46, 212 56, 212 68" fill="url(#gHair)" stroke="${L}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M 150 96 C 172 82, 220 78, 252 92" stroke="${C.hairSheen}" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.55"/>
  <path d="M 166 92 l 6 -2 M 236 88 l 6 2" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" opacity="0.7"/>`;
  return s;
}

/** braid on the viewer-right side with three cobalt "rail tie" clips */
function braid() {
  let s = '';
  const pts = [
    [280, 238],
    [283, 260],
    [285, 282],
    [286, 304],
    [286, 326],
  ];
  pts.forEach(([x, y], i) => {
    s += `<ellipse cx="${x}" cy="${y}" rx="10" ry="13" fill="${i > 2 ? 'url(#gLock)' : 'url(#gHair)'}" stroke="${C.line}" stroke-width="2"/>
    <path d="M ${x - 7} ${y - 4} Q ${x} ${y + 2}, ${x + 7} ${y - 6}" stroke="${C.hairSheen}" stroke-width="1.6" fill="none" opacity="0.8"/>`;
  });
  [250, 272, 294].forEach((y, i) => {
    const x = 282 + i * 1.5;
    s += `<rect x="${x - 12}" y="${y - 3.5}" width="24" height="7" rx="1.5" fill="${C.cobalt}" stroke="${C.line}" stroke-width="1.4"/>
    <path d="M ${x - 6} ${y - 3.5} L ${x - 6} ${y + 3.5} M ${x} ${y - 3.5} L ${x} ${y + 3.5} M ${x + 6} ${y - 3.5} L ${x + 6} ${y + 3.5}" stroke="#ffffff" stroke-width="1.2" opacity="0.9"/>`;
  });
  s += `<path d="M 280 340 C 276 356, 288 366, 294 380 C 286 372, 282 366, 278 356" fill="url(#gLock)" stroke="${C.line}" stroke-width="1.8"/>`;
  return s;
}

/** headphones: band over the head, eye ear cup (viewer left) + white RN-∞ cup (viewer right) */
function headphones({ onNeck = false, error = false } = {}) {
  if (onNeck) {
    return `<path d="M 140 296 C 156 326, 244 326, 260 296" stroke="${C.line}" stroke-width="15" fill="none" stroke-linecap="round"/>
    <path d="M 140 296 C 156 326, 244 326, 260 296" stroke="${C.white}" stroke-width="10" fill="none" stroke-linecap="round"/>
    ${eyeCup(140, 300, 21, error)}
    <circle cx="260" cy="300" r="20" fill="${C.white}" stroke="${C.line}" stroke-width="2.2"/>
    <circle cx="260" cy="300" r="13" fill="none" stroke="#c7cfdf" stroke-width="1.6"/>`;
  }
  return `<path d="M 104 176 C 96 72, 304 72, 296 176" stroke="${C.line}" stroke-width="17" fill="none" stroke-linecap="round"/>
  <path d="M 104 176 C 96 72, 304 72, 296 176" stroke="${C.white}" stroke-width="12" fill="none" stroke-linecap="round"/>
  <path d="M 130 112 C 150 88, 180 80, 200 79" stroke="#ffffff" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.9"/>
  ${eyeCup(100, 192, 29, error)}
  <circle cx="300" cy="192" r="28" fill="${C.white}" stroke="${C.line}" stroke-width="2.4"/>
  <circle cx="300" cy="192" r="20" fill="none" stroke="#c7cfdf" stroke-width="1.8"/>
  <text x="300" y="196" text-anchor="middle" font-family="Consolas, 'Cascadia Code', monospace" font-size="9" font-weight="700" fill="${C.cobalt}">RN-∞</text>`;
}

function eyeCup(x, y, r, error) {
  const k = r / 33;
  return `<circle cx="${x}" cy="${y}" r="${r * 1.24}" fill="url(#gEyeHalo)" opacity="0.8"/>
  <circle cx="${x}" cy="${y}" r="${r}" fill="${C.white}" stroke="${C.line}" stroke-width="2.4"/>
  <circle cx="${x}" cy="${y}" r="${r * 0.74}" fill="#0a1240" stroke="${error ? C.red : '#9db4ff'}" stroke-width="${error ? 2.6 : 1.6}"/>
  ${error ? `<circle cx="${x}" cy="${y}" r="${r * 0.74}" fill="${C.red}" opacity="0.45"/>` : ''}
  <circle cx="${x - 7 * k}" cy="${y - 5 * k}" r="${1.2 * k}" fill="#ffffff" opacity="0.8"/>
  <circle cx="${x + 8 * k}" cy="${y + 6 * k}" r="${1 * k}" fill="#ffffff" opacity="0.7"/>
  <circle cx="${x + 4 * k}" cy="${y - 10 * k}" r="${0.9 * k}" fill="#ffffff" opacity="0.6"/>
  <rect x="${x - r * 1.05}" y="${y - 0.8}" width="${r * 2.1}" height="1.6" fill="#ffffff" opacity="0.95"/>
  <circle cx="${x}" cy="${y}" r="${3.2 * k}" fill="#ffffff"/>`;
}

// ---------- props per state ----------
const props = {
  listening: () =>
    [0, 1, 2]
      .map(
        (i) =>
          `<path d="M ${66 - i * 12} ${168 - i * 6} Q ${56 - i * 14} 190, ${66 - i * 12} ${212 + i * 6}" stroke="${C.cobalt}" stroke-width="2.4" fill="none" stroke-linecap="round" opacity="${0.8 - i * 0.22}"/>`,
      )
      .join(''),
  working: () => `<g>
    <ellipse cx="322" cy="322" rx="40" ry="11" fill="none" stroke="${C.cobalt}" stroke-width="1.6" transform="rotate(-18 322 322)" opacity="0.8"/>
    <circle cx="322" cy="322" r="24" fill="url(#gOrb)"/>
    <circle cx="322" cy="322" r="9" fill="#fffef0"/>
    <path d="M 290 276 h 30 v 14 h -30 Z" fill="none" stroke="${C.cobalt}" stroke-width="1.4"/>
    <path d="M 294 283 h 18" stroke="${C.cobalt}" stroke-width="1.4"/>
    <path d="M 350 286 h 22 v 10 h -22 Z" fill="none" stroke="${C.cobalt}" stroke-width="1.4" opacity="0.7"/>
    <path d="M 296 350 l -8 6 M 352 296 l 8 -6" stroke="${C.lemonDeep}" stroke-width="2" stroke-linecap="round"/>
  </g>`,
  approval: () => `<g transform="rotate(4 326 58)">
    <rect x="250" y="34" width="144" height="46" rx="3" fill="#fbfaf6" stroke="${C.lemonDeep}" stroke-width="3"/>
    <rect x="250" y="34" width="8" height="46" fill="${C.lemon}"/>
    <text x="326" y="65" text-anchor="middle" font-family="'Bodoni Moda', Didot, Georgia, serif" font-size="21" font-weight="700" fill="${C.line}">APPROVE?</text>
    <path d="M 300 80 L 288 98 L 314 80 Z" fill="#fbfaf6" stroke="${C.lemonDeep}" stroke-width="2.4" stroke-linejoin="round"/>
  </g>`,
  error: () => `<g>
    <path d="M 268 112 C 262 124, 262 132, 268 134 C 274 132, 274 124, 268 112 Z" fill="#bfe3ff" stroke="${C.line}" stroke-width="1.8"/>
    <path d="M 330 36 L 368 100 L 292 100 Z" fill="#fff1f1" stroke="${C.red}" stroke-width="3.4" stroke-linejoin="round"/>
    <path d="M 330 58 L 330 80" stroke="${C.red}" stroke-width="5" stroke-linecap="round"/>
    <circle cx="330" cy="90" r="3.2" fill="${C.red}"/>
  </g>`,
  done: () =>
    [
      [64, 92, 13, C.lemon],
      [336, 112, 10, C.cobalt],
      [330, 300, 15, C.lemon],
      [72, 300, 9, C.cobalt],
      [352, 220, 7, C.lemonDeep],
    ]
      .map(([x, y, s, f]) => star4(x, y, s, f, `stroke="${C.line}" stroke-width="1.2"`))
      .join(''),
  sleep: () => `<g font-family="'Bodoni Moda', Didot, Georgia, serif" font-style="italic" font-weight="700" fill="${C.cobalt}">
    <text x="298" y="96" font-size="34">z</text>
    <text x="326" y="66" font-size="46">Z</text>
  </g>`,
};

const EXPR = {
  idle: { eyes: 'open', brows: 'calm', mouth: 'smile', tilt: 0 },
  listening: { eyes: 'look', brows: 'calm', mouth: 'o', tilt: -3 },
  working: { eyes: 'focus', brows: 'focus', mouth: 'flat', tilt: 0 },
  approval: { eyes: 'hopeful', brows: 'calm', mouth: 'open', tilt: -5 },
  error: { eyes: 'worried', brows: 'worried', mouth: 'wavy', tilt: 3 },
  done: { eyes: 'happy', brows: 'calm', mouth: 'open', tilt: 4 },
  sleep: { eyes: 'sleep', brows: 'calm', mouth: 'sleep', tilt: 7 },
};

function head(state) {
  const e = EXPR[state];
  const eyeKind = e.eyes === 'worried' ? 'open' : e.eyes;
  const inner = `${face()}
    ${eye(162, eyeKind)}${eye(238, eyeKind)}
    ${brows(e.brows)}
    ${mouth(e.mouth)}
    ${frontHair()}
    ${braid()}
    ${state === 'sleep' ? '' : headphones({ error: state === 'error' })}`;
  return e.tilt ? `<g transform="rotate(${e.tilt} 200 230)">${inner}</g>` : `<g>${inner}</g>`;
}

function figure(state, { long = false } = {}) {
  return `${backHair()}
  ${body({ long })}
  ${head(state)}
  ${state === 'sleep' ? headphones({ onNeck: true }) : ''}
  ${props[state] ? props[state]() : ''}`;
}

/** waist-up hero: the bust on a longer torso, waving, holding the task orb */
function hero() {
  return `${backHair()}
  ${body({ long: true })}
  <g>
    <path d="M 318 330 C 340 300, 352 262, 356 226" stroke="${C.line}" stroke-width="36" fill="none" stroke-linecap="round"/>
    <path d="M 318 330 C 340 300, 352 262, 356 226" stroke="${C.white}" stroke-width="31" fill="none" stroke-linecap="round"/>
    <path d="M 340 244 C 352 250, 366 250, 376 242" stroke="${C.cobalt}" stroke-width="4" fill="none"/>
    <path d="M 344 214 C 340 196, 348 178, 358 176 C 360 166, 370 164, 374 172 C 380 164, 390 168, 388 178 C 396 176, 400 186, 394 196 C 398 206, 390 218, 378 222 C 366 226, 350 224, 344 214 Z" fill="${C.skin}" stroke="${C.line}" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="M 366 186 l 2 12 M 380 186 l 0 12" stroke="${C.line}" stroke-width="1.4" opacity="0.5" stroke-linecap="round"/>
    <path d="M 392 150 q 8 6 6 18 M 404 158 q 6 8 2 18" stroke="${C.cobalt}" stroke-width="2.4" fill="none" stroke-linecap="round"/>
  </g>
  ${head('idle').replace('<g>', '<g transform="rotate(-3 200 230)">')}
  <g>
    <ellipse cx="96" cy="412" rx="44" ry="12" fill="none" stroke="${C.cobalt}" stroke-width="1.6" transform="rotate(-14 96 412)" opacity="0.8"/>
    <circle cx="96" cy="410" r="26" fill="url(#gOrb)"/>
    <circle cx="96" cy="410" r="10" fill="#fffef0"/>
  </g>
  ${star4(58, 110, 12, C.lemon, `stroke="${C.line}" stroke-width="1.2"`)}
  ${star4(368, 300, 8, C.cobalt, `stroke="${C.line}" stroke-width="1.2"`)}`;
}

const svg = (viewBox, w, h, content) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${w}" height="${h}">${defs}${content}</svg>\n`;

fs.mkdirSync(OUT, { recursive: true });
const files = [];
for (const state of Object.keys(EXPR)) {
  const f = `rinne-${state}.svg`;
  fs.writeFileSync(path.join(OUT, f), svg('0 0 400 400', 800, 800, figure(state)));
  files.push(f);
}
fs.writeFileSync(path.join(OUT, 'rinne-hero.svg'), svg('-10 0 420 480', 1000, 1143, hero()));
fs.writeFileSync(path.join(OUT, 'rinne-avatar.svg'), svg('50 30 300 300', 512, 512, figure('idle')));
files.push('rinne-hero.svg', 'rinne-avatar.svg');
console.log(`wrote ${files.length} files to ${path.relative(process.cwd(), OUT)}: ${files.join(', ')}`);
