// 极简二维码生成器：字节模式、纠错等级 M、版本 1-10（够用于网址）
const EC_M = [
  null,
  [10, [1, 16]],
  [16, [1, 28]],
  [26, [1, 44]],
  [18, [2, 32]],
  [24, [2, 43]],
  [16, [4, 27]],
  [18, [4, 31]],
  [22, [2, 38], [2, 39]],
  [22, [3, 36], [2, 37]],
  [26, [4, 43], [1, 44]],
];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const gmul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function rsGenerator(n) {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const ng = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      ng[j] ^= g[j];
      ng[j + 1] ^= gmul(g[j], EXP[i]);
    }
    g = ng;
  }
  return g;
}

function rsEncode(data, n) {
  const gen = rsGenerator(n);
  const r = new Array(n).fill(0);
  for (const d of data) {
    const f = d ^ r[0];
    r.shift();
    r.push(0);
    for (let j = 0; j < n; j++) r[j] ^= gmul(gen[j + 1], f);
  }
  return r;
}

const dataCapacity = (ver) => EC_M[ver].slice(1).reduce((s, [nb, nd]) => s + nb * nd, 0);

function encodeData(bytes, ver) {
  const ec = EC_M[ver];
  const cap = dataCapacity(ver);
  const bits = [];
  const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(4, 4);
  put(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  for (let i = 0; i < 4 && bits.length < cap * 8; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let k = 0; k < 8; k++) v = (v << 1) | bits[i + k];
    data.push(v);
  }
  for (let pad = 0xec; data.length < cap; pad ^= 0xec ^ 0x11) data.push(pad);
  const blocks = [];
  let k = 0;
  for (const [nb, nd] of ec.slice(1)) {
    for (let b = 0; b < nb; b++) {
      const d = data.slice(k, k + nd);
      k += nd;
      blocks.push({ d, e: rsEncode(d, ec[0]) });
    }
  }
  const out = [];
  const maxD = Math.max(...blocks.map((b) => b.d.length));
  for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
  for (let i = 0; i < ec[0]; i++) for (const b of blocks) out.push(b.e[i]);
  return out;
}

function drawFormat(M, F, size, mask) {
  const data = mask; // 纠错等级 M 的格式位为 00
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const g = (i) => ((bits >>> i) & 1) === 1;
  const set = (x, y, v) => { M[y][x] = v; F[y][x] = true; };
  for (let i = 0; i <= 5; i++) set(8, i, g(i));
  set(8, 7, g(6));
  set(8, 8, g(7));
  set(7, 8, g(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, g(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, g(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, g(i));
  set(8, size - 8, true);
}

function drawVersion(M, F, size, ver) {
  if (ver < 7) return;
  let rem = ver;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (ver << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const v = ((bits >>> i) & 1) === 1;
    const a = size - 11 + (i % 3), b = Math.floor(i / 3);
    M[b][a] = v; F[b][a] = true;
    M[a][b] = v; F[a][b] = true;
  }
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function penalty(M, size) {
  let p = 0;
  const lineRuns = (get) => {
    for (let a = 0; a < size; a++) {
      let run = 1;
      for (let b = 1; b <= size; b++) {
        if (b < size && get(a, b) === get(a, b - 1)) run++;
        else { if (run >= 5) p += 3 + (run - 5); run = 1; }
      }
    }
  };
  lineRuns((r, c) => M[r][c]);
  lineRuns((c, r) => M[r][c]);
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = M[y][x];
      if (c === M[y][x + 1] && c === M[y + 1][x] && c === M[y + 1][x + 1]) p += 3;
    }
  }
  const pat = [true, false, true, true, true, false, true];
  const finderLike = (get) => {
    for (let a = 0; a < size; a++) {
      for (let b = 0; b + 7 <= size; b++) {
        let ok = true;
        for (let k = 0; k < 7 && ok; k++) if (get(a, b + k) !== pat[k]) ok = false;
        if (!ok) continue;
        const lightBefore = b >= 4 && [1, 2, 3, 4].every((k) => !get(a, b - k));
        const lightAfter = b + 11 <= size && [7, 8, 9, 10].every((k) => !get(a, b + k));
        if (lightBefore || lightAfter) p += 40;
      }
    }
  };
  finderLike((r, c) => M[r][c]);
  finderLike((c, r) => M[r][c]);
  let dark = 0;
  for (const row of M) for (const v of row) if (v) dark++;
  p += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
  return p;
}

export function qrMatrix(text) {
  const bytes = Array.from(new TextEncoder().encode(text));
  let ver = 1;
  while (ver <= 10 && 4 + (ver < 10 ? 8 : 16) + bytes.length * 8 > dataCapacity(ver) * 8) ver++;
  if (ver > 10) throw new Error('二维码内容太长');
  const size = ver * 4 + 17;
  const M = Array.from({ length: size }, () => new Array(size).fill(false));
  const F = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, v) => { M[y][x] = v; F[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
    }
  }
  const al = ALIGN[ver];
  for (let i = 0; i < al.length; i++) {
    for (let j = 0; j < al.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  drawFormat(M, F, size, 0);
  drawVersion(M, F, size, ver);
  const data = encodeData(bytes, ver);
  const total = data.length * 8;
  let bit = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const up = ((right + 1) & 2) === 0;
        const y = up ? size - 1 - vert : vert;
        if (F[y][x]) continue;
        M[y][x] = bit < total ? ((data[bit >>> 3] >>> (7 - (bit & 7))) & 1) === 1 : false;
        bit++;
      }
    }
  }
  let best = null, bestPen = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const T = M.map((r) => r.slice());
    const fn = MASKS[mask];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!F[y][x] && fn(x, y)) T[y][x] = !T[y][x];
    drawFormat(T, F.map((r) => r.slice()), size, mask);
    const pen = penalty(T, size);
    if (pen < bestPen) { bestPen = pen; best = T; }
  }
  return best;
}

// 画到 canvas 上（带 4 格白边）
export function drawQR(canvas, text, px = 6) {
  const M = qrMatrix(text);
  const n = M.length, q = 4;
  canvas.width = canvas.height = (n + q * 2) * px;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (M[y][x]) ctx.fillRect((x + q) * px, (y + q) * px, px, px);
  return canvas;
}
