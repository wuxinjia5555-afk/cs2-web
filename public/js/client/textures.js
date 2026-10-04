// 程序生成贴图（Canvas），无需任何外部图片素材
import * as THREE from 'three';
import { mulberry32 } from '../shared/util.js';

let maxAniso = 4;
export function setMaxAnisotropy(n) { maxAniso = n; }

// 每张贴图覆盖的世界尺寸（米）
export const TEX_SCALE = {
  sand: 3, road: 4, tiles: 2, site_d: 2, concrete: 3, asphalt: 4, site_i: 4, metalfloor: 2,
  plaster: 3, brick: 2, concrete_wall: 4, metalwall: 2, container_r: 2.5, container_b: 2.5, container_g: 2.5,
  dev_floor: 2, dev_floor2: 2, dev_wall: 2, dev_crate: 2, dev_low: 2, roof: 3, metal: 2, barrier: 2, sandbag: 2, wood: 2,
  door: 1.6, iron: 1, stone: 2, darkwood: 2,
};

const cache = new Map();

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// 可平铺的值噪声
function noise(size, cells, rnd) {
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * cells, iy = Math.floor(fy), ty = fy - iy, sy = ty * ty * (3 - 2 * ty);
    const y0 = iy % cells, y1 = (iy + 1) % cells;
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells, ix = Math.floor(fx), tx = fx - ix, sx = tx * tx * (3 - 2 * tx);
      const x0 = ix % cells, x1 = (ix + 1) % cells;
      const a = g[y0 * cells + x0], b = g[y0 * cells + x1], c = g[y1 * cells + x0], d = g[y1 * cells + x1];
      const top = a + (b - a) * sx, bot = c + (d - c) * sx;
      out[y * size + x] = top + (bot - top) * sy;
    }
  }
  return out;
}

function fbm(size, rnd, oct = [[4, 0.45], [8, 0.27], [16, 0.16], [32, 0.12]]) {
  const out = new Float32Array(size * size);
  let tw = 0;
  for (const [c, w] of oct) {
    const n = noise(size, c, rnd);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * w;
    tw += w;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tw;
  return out;
}

function pixels(ctx, size, fn) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  const col = [0, 0, 0];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      col[0] = d[i * 4]; col[1] = d[i * 4 + 1]; col[2] = d[i * 4 + 2];
      fn(x, y, i, col);
      d[i * 4] = col[0]; d[i * 4 + 1] = col[1]; d[i * 4 + 2] = col[2]; d[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// 在已有底色上叠加噪声明暗
function grain(ctx, size, rnd, amt, oct) {
  const n = fbm(size, rnd, oct);
  pixels(ctx, size, (x, y, i, c) => {
    const k = 1 + (n[i] - 0.5) * amt + (rnd() - 0.5) * amt * 0.25;
    c[0] *= k; c[1] *= k; c[2] *= k;
  });
}

const rgb = (r, g, b) => `rgb(${r | 0},${g | 0},${b | 0})`;
const vary = (rnd, base, amt) => {
  const k = 1 + (rnd() - 0.5) * amt;
  return base.map((v) => Math.max(0, Math.min(255, v * k * (1 + (rnd() - 0.5) * 0.04))));
};

function toTexture(c, opts = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = opts.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  if (opts.nomip) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
  return t;
}

// 砖/瓷砖类：网格 + 缝隙
function tiled(ctx, size, rnd, cols, rows, base, grout, groutW, varAmt, offsetRows = false) {
  ctx.fillStyle = rgb(...grout);
  ctx.fillRect(0, 0, size, size);
  const cw = size / cols, rh = size / rows;
  for (let r = 0; r < rows; r++) {
    const off = offsetRows && r % 2 ? cw / 2 : 0;
    for (let c = -1; c < cols; c++) {
      const x = c * cw + off;
      ctx.fillStyle = rgb(...vary(rnd, base, varAmt));
      ctx.fillRect(x + groutW / 2, r * rh + groutW / 2, cw - groutW, rh - groutW);
      if (x + cw > size) { ctx.fillRect(x - size + groutW / 2, r * rh + groutW / 2, cw - groutW, rh - groutW); }
    }
  }
}

function corrugated(ctx, size, rnd, base, ribs = 16) {
  pixels(ctx, size, (x, y, i, c) => {
    const s = Math.sin((x / size) * Math.PI * 2 * ribs);
    const k = 0.82 + 0.18 * s;
    c[0] = base[0] * k; c[1] = base[1] * k; c[2] = base[2] * k;
  });
  grain(ctx, size, rnd, 0.25);
  // 锈迹
  for (let k = 0; k < 18; k++) {
    const x = rnd() * size, y = rnd() * size, r = 4 + rnd() * 14;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(110,60,25,0.55)');
    g.addColorStop(1, 'rgba(110,60,25,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, size, 5);
  ctx.fillRect(0, size - 5, size, 5);
}

function devGrid(ctx, size, base, line, fine) {
  ctx.fillStyle = rgb(...base);
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = fine;
  ctx.lineWidth = 1;
  for (let k = 0; k <= 8; k++) {
    const p = (k / 8) * size;
    ctx.beginPath(); ctx.moveTo(p + 0.5, 0); ctx.lineTo(p + 0.5, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p + 0.5); ctx.lineTo(size, p + 0.5); ctx.stroke();
  }
  ctx.strokeStyle = line;
  ctx.lineWidth = 3;
  for (let k = 0; k <= 2; k++) {
    const p = (k / 2) * size;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
  }
}

const PAINTERS = {
  sand(ctx, s, rnd) {
    ctx.fillStyle = rgb(200, 176, 132);
    ctx.fillRect(0, 0, s, s);
    grain(ctx, s, rnd, 0.32);
    pixels(ctx, s, (x, y, i, c) => {
      const r = rnd();
      if (r < 0.03) { c[0] *= 0.8; c[1] *= 0.8; c[2] *= 0.8; } else if (r > 0.975) { c[0] *= 1.12; c[1] *= 1.1; c[2] *= 1.08; }
    });
  },
  road(ctx, s, rnd) {
    ctx.fillStyle = rgb(120, 108, 90);
    ctx.fillRect(0, 0, s, s);
    const rows = 4;
    for (let r = 0; r < rows; r++) {
      let x = -rnd() * 40;
      while (x < s) {
        const w = 44 + rnd() * 40;
        ctx.fillStyle = rgb(...vary(rnd, [178, 162, 134], 0.16));
        ctx.fillRect(x + 2, r * (s / rows) + 2, w - 4, s / rows - 4);
        if (x + w > s) ctx.fillRect(x + 2 - s, r * (s / rows) + 2, w - 4, s / rows - 4);
        x += w;
      }
    }
    grain(ctx, s, rnd, 0.3);
  },
  tiles(ctx, s, rnd) { tiled(ctx, s, rnd, 4, 4, [206, 196, 172], [135, 124, 104], 4, 0.08); grain(ctx, s, rnd, 0.2); },
  site_d(ctx, s, rnd) { tiled(ctx, s, rnd, 8, 8, [188, 132, 96], [120, 92, 70], 3, 0.14); grain(ctx, s, rnd, 0.22); },
  concrete(ctx, s, rnd) {
    ctx.fillStyle = rgb(150, 150, 146);
    ctx.fillRect(0, 0, s, s);
    grain(ctx, s, rnd, 0.28, [[3, 0.4], [8, 0.3], [32, 0.3]]);
    ctx.strokeStyle = 'rgba(60,60,60,0.35)';
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      let x = rnd() * s, y = rnd() * s;
      ctx.moveTo(x, y);
      for (let j = 0; j < 6; j++) { x += (rnd() - 0.5) * 40; y += (rnd() - 0.5) * 40; ctx.lineTo(x, y); }
      ctx.stroke();
    }
  },
  asphalt(ctx, s, rnd) {
    ctx.fillStyle = rgb(74, 76, 80);
    ctx.fillRect(0, 0, s, s);
    grain(ctx, s, rnd, 0.3);
    pixels(ctx, s, (x, y, i, c) => { if (rnd() < 0.05) { c[0] += 30; c[1] += 30; c[2] += 30; } });
  },
  site_i(ctx, s, rnd) {
    ctx.fillStyle = rgb(128, 132, 136);
    ctx.fillRect(0, 0, s, s);
    grain(ctx, s, rnd, 0.25);
    ctx.fillStyle = 'rgba(40,40,40,0.5)';
    ctx.fillRect(0, 0, s, 3);
    ctx.fillRect(0, 0, 3, s);
    ctx.fillStyle = 'rgba(210,170,40,0.55)';
    ctx.fillRect(s / 2 - 6, 0, 12, s);
  },
  metalfloor(ctx, s, rnd) {
    ctx.fillStyle = rgb(118, 122, 126);
    ctx.fillRect(0, 0, s, s);
    grain(ctx, s, rnd, 0.22);
    for (let y = 0; y < s; y += 16) {
      for (let x = (y / 16) % 2 ? 8 : 0; x < s; x += 16) {
        ctx.save();
        ctx.translate(x + 4, y + 4);
        ctx.rotate(((y / 16) % 2 ? 1 : -1) * 0.7);
        ctx.fillStyle = 'rgba(210,215,220,0.45)';
        ctx.fillRect(-5, -1.5, 10, 3);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(-5, 1.5, 10, 1.5);
        ctx.restore();
      }
    }
  },
  plaster(ctx, s, rnd) {
    ctx.fillStyle = rgb(214, 196, 160);
    ctx.fillRect(0, 0, s, s);
    grain(ctx, s, rnd, 0.22, [[2, 0.5], [6, 0.25], [24, 0.25]]);
    for (let k = 0; k < 6; k++) {
      const x = rnd() * s, y = rnd() * s, r = 20 + rnd() * 50;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(150,120,80,0.18)');
      g.addColorStop(1, 'rgba(150,120,80,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.strokeStyle = 'rgba(90,70,50,0.35)';
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      let x = rnd() * s, y = rnd() * s;
      ctx.moveTo(x, y);
      for (let j = 0; j < 5; j++) { x += (rnd() - 0.5) * 30; y += rnd() * 25; ctx.lineTo(x, y); }
      ctx.stroke();
    }
  },
  brick(ctx, s, rnd) { tiled(ctx, s, rnd, 4, 10, [150, 82, 60], [184, 172, 150], 4, 0.2, true); grain(ctx, s, rnd, 0.25); },
  concrete_wall(ctx, s, rnd) {
    ctx.fillStyle = rgb(170, 170, 164);
    ctx.fillRect(0, 0, s, s);
    grain(ctx, s, rnd, 0.22);
    for (let k = 0; k < 10; k++) {
      const x = rnd() * s;
      const g = ctx.createLinearGradient(0, 0, 0, s);
      g.addColorStop(0, 'rgba(70,70,65,0.18)');
      g.addColorStop(1, 'rgba(70,70,65,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 3 + rnd() * 8, s * (0.3 + rnd() * 0.7));
    }
    ctx.fillStyle = 'rgba(60,60,60,0.5)';
    ctx.fillRect(0, s / 2 - 1, s, 2);
    ctx.fillRect(s / 2 - 1, 0, 2, s);
    for (const [x, y] of [[20, 20], [s - 20, 20], [20, s - 20], [s - 20, s - 20], [s / 2 + 20, s / 2 + 20], [s / 2 - 20, s / 2 - 20]]) {
      ctx.fillStyle = 'rgba(80,80,80,0.5)';
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    }
  },
  metalwall(ctx, s, rnd) { corrugated(ctx, s, rnd, [122, 132, 142], 18); },
  // 木板门（竖条木板）
  wood(ctx, s, rnd) { tiled(ctx, s, rnd, 6, 1, [128, 86, 50], [62, 40, 22], 4, 0.16); grain(ctx, s, rnd, 0.3); },
  // 大木门：竖条的厚木板，刷过一层蓝绿色的漆，下半截磨掉了露出木头
  door(ctx, s, rnd) {
    const planks = 5, pw = s / planks;
    ctx.fillStyle = rgb(38, 30, 22);
    ctx.fillRect(0, 0, s, s);
    for (let k = 0; k < planks; k++) {
      const wood = vary(rnd, [118, 84, 52], 0.18), paint = vary(rnd, [70, 112, 108], 0.14);
      const g = ctx.createLinearGradient(0, 0, 0, s);
      g.addColorStop(0, rgb(...paint)); g.addColorStop(0.45 + rnd() * 0.2, rgb(...paint)); g.addColorStop(0.8 + rnd() * 0.15, rgb(...wood)); g.addColorStop(1, rgb(wood[0] * 0.8, wood[1] * 0.8, wood[2] * 0.8));
      ctx.fillStyle = g;
      ctx.fillRect(k * pw + 1.5, 0, pw - 3, s);
      // 掉漆的划痕
      for (let j = 0; j < 9; j++) {
        ctx.fillStyle = `rgba(${wood[0] | 0},${wood[1] | 0},${wood[2] | 0},${0.35 + rnd() * 0.4})`;
        ctx.fillRect(k * pw + 3 + rnd() * (pw - 8), rnd() * s, 1 + rnd() * 3, 6 + rnd() * 40);
      }
    }
    pixels(ctx, s, (x, y, i, c) => {
      const k = 0.93 + 0.07 * Math.sin(y * 0.09 + Math.sin(x * 0.21) * 2.5 + (x % 37) * 0.5);
      c[0] *= k; c[1] *= k; c[2] *= k;
    });
    grain(ctx, s, rnd, 0.22);
  },
  // 生了锈的黑铁（门上的铁箍、合页）
  iron(ctx, s, rnd) {
    ctx.fillStyle = rgb(54, 50, 47);
    ctx.fillRect(0, 0, s, s);
    grain(ctx, s, rnd, 0.3);
    for (let k = 0; k < 26; k++) {
      const x = rnd() * s, y = rnd() * s, r = 6 + rnd() * 22;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(120,66,30,0.5)');
      g.addColorStop(1, 'rgba(120,66,30,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  },
  // 砂岩石块（门框、台阶、矮墙）
  stone(ctx, s, rnd) { tiled(ctx, s, rnd, 2, 4, [198, 180, 142], [128, 112, 86], 5, 0.12, true); grain(ctx, s, rnd, 0.24, [[3, 0.4], [10, 0.3], [40, 0.3]]); },
  darkwood(ctx, s, rnd) { tiled(ctx, s, rnd, 6, 1, [84, 58, 36], [36, 24, 14], 4, 0.16); grain(ctx, s, rnd, 0.3); },
  container_r(ctx, s, rnd) { corrugated(ctx, s, rnd, [156, 48, 36], 14); },
  container_b(ctx, s, rnd) { corrugated(ctx, s, rnd, [40, 82, 142], 14); },
  container_g(ctx, s, rnd) { corrugated(ctx, s, rnd, [52, 112, 62], 14); },
  dev_floor(ctx, s) { devGrid(ctx, s, [112, 112, 112], 'rgba(220,220,220,0.75)', 'rgba(200,200,200,0.3)'); },
  dev_floor2(ctx, s) { devGrid(ctx, s, [86, 98, 112], 'rgba(220,230,240,0.75)', 'rgba(200,210,220,0.3)'); },
  dev_wall(ctx, s) { devGrid(ctx, s, [214, 122, 44], 'rgba(255,240,220,0.85)', 'rgba(255,230,200,0.35)'); },
  dev_crate(ctx, s) { devGrid(ctx, s, [70, 110, 170], 'rgba(230,240,255,0.85)', 'rgba(220,230,255,0.35)'); },
  dev_low(ctx, s) { devGrid(ctx, s, [80, 140, 90], 'rgba(230,255,230,0.85)', 'rgba(220,255,220,0.35)'); },
  roof(ctx, s, rnd) {
    ctx.fillStyle = rgb(92, 84, 76);
    ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += s / 8) {
      ctx.fillStyle = rgb(...vary(rnd, [104, 90, 74], 0.2));
      ctx.fillRect(0, y + 2, s, s / 8 - 4);
    }
    grain(ctx, s, rnd, 0.3);
  },
  metal(ctx, s, rnd) {
    ctx.fillStyle = rgb(92, 98, 104);
    ctx.fillRect(0, 0, s, s);
    grain(ctx, s, rnd, 0.25);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    for (let k = 0; k < 30; k++) {
      ctx.beginPath();
      const x = rnd() * s, y = rnd() * s;
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rnd() - 0.5) * 60, y + (rnd() - 0.5) * 10);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(40,40,40,0.6)';
    ctx.fillRect(0, 0, s, 3);
    ctx.fillRect(0, 0, 3, s);
    for (let x = 12; x < s; x += 40) { ctx.beginPath(); ctx.arc(x, 10, 3, 0, 7); ctx.fill(); }
  },
  barrier(ctx, s, rnd) {
    ctx.fillStyle = rgb(176, 174, 166);
    ctx.fillRect(0, 0, s, s);
    grain(ctx, s, rnd, 0.22);
    for (let x = -s; x < s * 2; x += 48) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, s * 0.55, s, s * 0.2);
      ctx.clip();
      ctx.fillStyle = 'rgba(225,180,40,0.9)';
      ctx.beginPath();
      ctx.moveTo(x, s * 0.75); ctx.lineTo(x + 24, s * 0.55); ctx.lineTo(x + 48, s * 0.55); ctx.lineTo(x + 24, s * 0.75); ctx.fill();
      ctx.restore();
    }
  },
  sandbag(ctx, s, rnd) {
    ctx.fillStyle = rgb(120, 104, 74);
    ctx.fillRect(0, 0, s, s);
    const rows = 5, bh = s / rows;
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? s / 6 : 0;
      for (let x = -s / 3 + off; x < s; x += s / 3) {
        const cx = x + s / 6, cy = r * bh + bh / 2;
        const g = ctx.createRadialGradient(cx - 6, cy - 6, 2, cx, cy, s / 5);
        const b = vary(rnd, [186, 164, 118], 0.12);
        g.addColorStop(0, rgb(b[0] * 1.08, b[1] * 1.08, b[2] * 1.08));
        g.addColorStop(1, rgb(b[0] * 0.62, b[1] * 0.62, b[2] * 0.62));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(cx, cy, s / 6 - 2, bh / 2 - 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    grain(ctx, s, rnd, 0.2);
  },
  crate(ctx, s, rnd) {
    ctx.fillStyle = rgb(166, 120, 70);
    ctx.fillRect(0, 0, s, s);
    const planks = 5;
    for (let k = 0; k < planks; k++) {
      ctx.fillStyle = rgb(...vary(rnd, [170, 124, 72], 0.14));
      ctx.fillRect(0, (k * s) / planks + 1, s, s / planks - 2);
    }
    // 木纹
    pixels(ctx, s, (x, y, i, c) => {
      const k = 0.92 + 0.08 * Math.sin(x * 0.12 + Math.sin(y * 0.05) * 3 + (y % 51) * 0.4);
      c[0] *= k; c[1] *= k; c[2] *= k;
    });
    const fw = s * 0.1;
    ctx.fillStyle = rgb(122, 84, 44);
    ctx.fillRect(0, 0, s, fw); ctx.fillRect(0, s - fw, s, fw); ctx.fillRect(0, 0, fw, s); ctx.fillRect(s - fw, 0, fw, s);
    ctx.save();
    ctx.translate(s / 2, s / 2);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-s * 0.7, -fw / 2, s * 1.4, fw);
    ctx.restore();
    ctx.strokeStyle = 'rgba(40,25,10,0.6)';
    ctx.lineWidth = 2;
    ctx.strokeRect(fw, fw, s - fw * 2, s - fw * 2);
    ctx.fillStyle = 'rgba(40,40,40,0.8)';
    for (const [x, y] of [[fw / 2, fw / 2], [s - fw / 2, fw / 2], [fw / 2, s - fw / 2], [s - fw / 2, s - fw / 2]]) { ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill(); }
    grain(ctx, s, rnd, 0.15);
  },
  barrel(ctx, s, rnd) {
    const base = [142, 44, 32];
    pixels(ctx, s, (x, y, i, c) => {
      const k = 0.85 + 0.15 * Math.sin((x / s) * Math.PI * 2 * 3);
      c[0] = base[0] * k; c[1] = base[1] * k; c[2] = base[2] * k;
    });
    ctx.fillStyle = 'rgba(30,30,30,0.5)';
    ctx.fillRect(0, s * 0.3, s, 8);
    ctx.fillRect(0, s * 0.68, s, 8);
    grain(ctx, s, rnd, 0.3);
  },
};

export function getTexture(name) {
  if (cache.has(name)) return cache.get(name);
  const painter = PAINTERS[name] || PAINTERS.concrete;
  const size = name === 'crate' ? 512 : 256;
  const c = canvas(size);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  let seed = 7;
  for (let i = 0; i < name.length; i++) seed = (seed * 31 + name.charCodeAt(i)) >>> 0;
  painter(ctx, size, mulberry32(seed));
  const t = toTexture(c);
  cache.set(name, t);
  return t;
}

// 小地图/菜单预览用的颜色
export const TEX_COLOR = {
  sand: '#c8b084', road: '#b2a286', tiles: '#cec4ac', site_d: '#bc8460', concrete: '#96968f', asphalt: '#4a4c50',
  site_i: '#80868a', metalfloor: '#767a7e', dev_floor: '#707070', dev_floor2: '#566270',
};

// ---------- 精灵/特效贴图 ----------
function sprite(name, size, draw) {
  if (cache.has(name)) return cache.get(name);
  const c = canvas(size);
  draw(c.getContext('2d'), size);
  const t = toTexture(c, { clamp: true });
  cache.set(name, t);
  return t;
}

export const softDot = () => sprite('softdot', 64, (ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
});

export const cloud = () => sprite('cloud', 128, (ctx, s) => {
  const rnd = mulberry32(99);
  for (let k = 0; k < 26; k++) {
    const a = rnd() * Math.PI * 2, d = rnd() * s * 0.22;
    const x = s / 2 + Math.cos(a) * d, y = s / 2 + Math.sin(a) * d, r = s * (0.15 + rnd() * 0.2);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }
});

export const flame = () => sprite('flame', 64, (ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s * 0.6, 0, s / 2, s * 0.55, s / 2);
  g.addColorStop(0, 'rgba(255,250,200,1)');
  g.addColorStop(0.25, 'rgba(255,190,60,0.9)');
  g.addColorStop(0.6, 'rgba(230,80,10,0.5)');
  g.addColorStop(1, 'rgba(120,20,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
});

export const flare = () => sprite('flare', 128, (ctx, s) => {
  ctx.translate(s / 2, s / 2);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s / 2);
  g.addColorStop(0, 'rgba(255,255,230,1)');
  g.addColorStop(0.2, 'rgba(255,210,120,0.9)');
  g.addColorStop(1, 'rgba(255,140,40,0)');
  ctx.fillStyle = g;
  for (let k = 0; k < 6; k++) {
    ctx.rotate(Math.PI / 3);
    ctx.beginPath();
    ctx.moveTo(0, -5); ctx.lineTo(s / 2, 0); ctx.lineTo(0, 5);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.2, 0, 7);
  ctx.fill();
});

export const bulletHole = () => sprite('hole', 64, (ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(10,8,6,1)');
  g.addColorStop(0.25, 'rgba(20,16,12,0.95)');
  g.addColorStop(0.45, 'rgba(60,50,40,0.5)');
  g.addColorStop(1, 'rgba(60,50,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
});

export function siteLetter(letter) {
  return sprite('site_' + letter, 256, (ctx, s) => {
    ctx.font = `900 ${s * 0.82}px Impact, "Arial Black", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(200,30,20,0.85)';
    ctx.fillText(letter, s / 2, s / 2 + 8);
    const rnd = mulberry32(letter.charCodeAt(0));
    for (let k = 0; k < 8; k++) {
      const x = s * 0.3 + rnd() * s * 0.4;
      ctx.fillRect(x, s * 0.75, 3, 10 + rnd() * 30);
    }
    ctx.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 300; k++) { ctx.fillStyle = `rgba(0,0,0,${rnd() * 0.5})`; ctx.fillRect(rnd() * s, rnd() * s, 3, 3); }
  });
}

export function textSprite(text, color = '#fff', size = 256) {
  const c = canvas(size, size / 4);
  const ctx = c.getContext('2d');
  ctx.font = `700 ${size / 8}px "Segoe UI", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.strokeText(text, size / 2, size / 8);
  ctx.fillStyle = color;
  ctx.fillText(text, size / 2, size / 8);
  return toTexture(c, { clamp: true, nomip: true });
}
