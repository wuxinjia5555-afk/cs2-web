// 地面（高度场）：每个格子 4 个角各有一个高度，格子里面按双线性插值。
// 相邻两格在公共边上高度对得上，就是连成一片的坡面（人顺着走、不会一顿一顿）；对不上就是一道坎（竖直的面，挡人也挡子弹）
export const NO_GROUND = -1e9;

const mark = new Uint8Array(64), queue = new Int32Array(64);

export class Terrain {
  // y：每格 4 个角的高度 [x0z0, x1z0, x0z1, x1z1]（米）；on：这一格有没有地面；mat：每格的材质编号（mats 是名字表）
  constructor(W, H, S, y, on, mat, mats) {
    this.W = W; this.H = H; this.S = S; this.y = y; this.on = on; this.mat = mat; this.mats = mats;
    const e = (this.edge = new Uint8Array(W * H)); // 位 1：和右边（+x）那格连着；位 2：和下面（+z）那格连着
    const EPS = 2e-3;
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const i = r * W + c, o = i * 4;
      if (!on[i]) continue;
      if (c + 1 < W && on[i + 1] && Math.abs(y[o + 1] - y[o + 4]) < EPS && Math.abs(y[o + 3] - y[o + 6]) < EPS) e[i] |= 1;
      if (r + 1 < H && on[i + W] && Math.abs(y[o + 2] - y[(i + W) * 4]) < EPS && Math.abs(y[o + 3] - y[(i + W) * 4 + 1]) < EPS) e[i] |= 2;
    }
  }

  // 格子 i 里 (u, v) 处的高度（u、v 是格子内 0~1 的位置）
  _h(i, u, v) {
    const y = this.y, o = i * 4;
    const a = y[o] + (y[o + 1] - y[o]) * u, b = y[o + 2] + (y[o + 3] - y[o + 2]) * u;
    return a + (b - a) * v;
  }

  // (x, z) 处的地面高度；没有地面（墙里、地图外）返回 NO_GROUND
  height(x, z) {
    const S = this.S, c = Math.floor(x / S), r = Math.floor(z / S);
    if (c < 0 || r < 0 || c >= this.W || r >= this.H) return NO_GROUND;
    const i = r * this.W + c;
    return this.on[i] ? this._h(i, x / S - c, z / S - r) : NO_GROUND;
  }

  matAt(x, z) {
    const S = this.S, c = Math.floor(x / S), r = Math.floor(z / S);
    if (c < 0 || r < 0 || c >= this.W || r >= this.H) return '';
    return this.mats[this.mat[r * this.W + c]] || '';
  }

  // 人（半宽 rad）站在 (x, z) 时脚下的地面高度：身体中心踩着的那片坡面，
  // 再加上身体范围内「和它隔着一道坎、又不比 lim 高」的格子 —— 站在台子边上、半个身子悬空也掉不下去，迈得上去的矮坎也在这里踩上去
  support(x, z, rad, lim) {
    const S = this.S, W = this.W, H = this.H, on = this.on, edge = this.edge;
    const cc = Math.floor(x / S), cr = Math.floor(z / S);
    const inside = cc >= 0 && cr >= 0 && cc < W && cr < H;
    let g = inside && on[cr * W + cc] ? this._h(cr * W + cc, x / S - cc, z / S - cr) : NO_GROUND;
    const c0 = Math.max(0, Math.floor((x - rad) / S)), c1 = Math.min(W - 1, Math.floor((x + rad) / S));
    const r0 = Math.max(0, Math.floor((z - rad) / S)), r1 = Math.min(H - 1, Math.floor((z + rad) / S));
    const nc = c1 - c0 + 1, nr = r1 - r0 + 1;
    if (nc < 1 || nr < 1 || (nc === 1 && nr === 1) || nc * nr > 64) return g;
    // 从中心那格出发，沿着连着的边找出同一片坡面上的格子
    for (let k = nc * nr - 1; k >= 0; k--) mark[k] = 0;
    if (g !== NO_GROUND) {
      let qn = 0;
      const k0 = (cr - r0) * nc + (cc - c0);
      mark[k0] = 1; queue[qn++] = k0;
      for (let q = 0; q < qn; q++) {
        const k = queue[q], lc = k % nc, lr = (k / nc) | 0, i = (r0 + lr) * W + c0 + lc;
        if (lc + 1 < nc && !mark[k + 1] && (edge[i] & 1)) { mark[k + 1] = 1; queue[qn++] = k + 1; }
        if (lc > 0 && !mark[k - 1] && (edge[i - 1] & 1)) { mark[k - 1] = 1; queue[qn++] = k - 1; }
        if (lr + 1 < nr && !mark[k + nc] && (edge[i] & 2)) { mark[k + nc] = 1; queue[qn++] = k + nc; }
        if (lr > 0 && !mark[k - nc] && (edge[i - W] & 2)) { mark[k - nc] = 1; queue[qn++] = k - nc; }
      }
    }
    for (let lr = 0; lr < nr; lr++) for (let lc = 0; lc < nc; lc++) {
      if (mark[lr * nc + lc]) continue;
      const c = c0 + lc, r = r0 + lr, i = r * W + c;
      if (!on[i]) continue;
      // 这一格被身体盖住的那一块里最高的地方（双线性的最大值一定在矩形的角上）
      const ua = Math.max(0, (x - rad) / S - c), ub = Math.min(1, (x + rad) / S - c);
      const va = Math.max(0, (z - rad) / S - r), vb = Math.min(1, (z + rad) / S - r);
      const top = Math.max(this._h(i, ua, va), this._h(i, ub, va), this._h(i, ua, vb), this._h(i, ub, vb));
      if (top <= lim && top > g) g = top;
    }
    return g;
  }

  // 沿 x 方向走：身体的前沿从 e0 挪到 e1（z 方向占 zlo~zhi），跨过格子边界时，对面那格要是隔着一道坎、又比脚（feet）高，就被挡住。
  // 返回挡住人的那条边界的 x；没被挡住返回 NaN
  blockX(e0, e1, zlo, zhi, feet) {
    const S = this.S, W = this.W, H = this.H, y = this.y, on = this.on, edge = this.edge;
    const k0 = Math.floor(e0 / S), k1 = Math.floor(e1 / S);
    if (k0 === k1) return NaN;
    const fwd = e1 > e0;
    const ra = Math.max(0, Math.floor((zlo + 1e-6) / S)), rb = Math.min(H - 1, Math.floor((zhi - 1e-6) / S));
    for (let k = fwd ? k0 + 1 : k0; fwd ? k <= k1 : k > k1; k += fwd ? 1 : -1) {
      const cB = fwd ? k : k - 1, cA = fwd ? k - 1 : k; // 从 A 那列进到 B 那列，边界在 x = k * S
      if (cB < 0 || cB >= W) continue;
      for (let r = ra; r <= rb; r++) {
        const iB = r * W + cB;
        if (!on[iB]) continue;
        if (cA >= 0 && cA < W && (edge[r * W + Math.min(cA, cB)] & 1)) continue; // 连着的坡面
        const o = iB * 4, ya = fwd ? y[o] : y[o + 1], yb = fwd ? y[o + 2] : y[o + 3]; // B 在这条边界上的两个角
        const va = Math.max(0, zlo / S - r), vb = Math.min(1, zhi / S - r);
        if (Math.max(ya + (yb - ya) * va, ya + (yb - ya) * vb) > feet) return k * S;
      }
    }
    return NaN;
  }

  blockZ(e0, e1, xlo, xhi, feet) {
    const S = this.S, W = this.W, H = this.H, y = this.y, on = this.on, edge = this.edge;
    const k0 = Math.floor(e0 / S), k1 = Math.floor(e1 / S);
    if (k0 === k1) return NaN;
    const fwd = e1 > e0;
    const ca = Math.max(0, Math.floor((xlo + 1e-6) / S)), cb = Math.min(W - 1, Math.floor((xhi - 1e-6) / S));
    for (let k = fwd ? k0 + 1 : k0; fwd ? k <= k1 : k > k1; k += fwd ? 1 : -1) {
      const rB = fwd ? k : k - 1, rA = fwd ? k - 1 : k;
      if (rB < 0 || rB >= H) continue;
      for (let c = ca; c <= cb; c++) {
        const iB = rB * W + c;
        if (!on[iB]) continue;
        if (rA >= 0 && rA < H && (edge[Math.min(rA, rB) * W + c] & 2)) continue;
        const o = iB * 4, ya = fwd ? y[o] : y[o + 2], yb = fwd ? y[o + 1] : y[o + 3];
        const ua = Math.max(0, xlo / S - c), ub = Math.min(1, xhi / S - c);
        if (Math.max(ya + (yb - ya) * ua, ya + (yb - ya) * ub) > feet) return k * S;
      }
    }
    return NaN;
  }

  // 射线打地面（dir 要归一化）：返回命中的距离，没打中返回 -1；法线和命中的格子写进 out（nx, ny, nz, i）
  raycast(ox, oy, oz, dx, dy, dz, maxT, out) {
    const S = this.S, W = this.W, H = this.H, y = this.y, on = this.on;
    let c = Math.floor(ox / S), r = Math.floor(oz / S);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const hasX = Math.abs(dx) > 1e-12, hasZ = Math.abs(dz) > 1e-12;
    let tMaxX = hasX ? ((c + (dx > 0 ? 1 : 0)) * S - ox) / dx : Infinity;
    let tMaxZ = hasZ ? ((r + (dz > 0 ? 1 : 0)) * S - oz) / dz : Infinity;
    const tDX = hasX ? S / Math.abs(dx) : Infinity, tDZ = hasZ ? S / Math.abs(dz) : Infinity;
    const du = dx / S, dv = dz / S;
    let t0 = 0, axis = -1; // axis：刚才是跨过哪个方向的边界进到这一格的（-1 = 起点所在的格子）
    for (let guard = 0; guard < 8192; guard++) {
      const t1 = Math.min(tMaxX, tMaxZ, maxT);
      if (c >= 0 && r >= 0 && c < W && r < H) {
        const i = r * W + c;
        if (on[i]) {
          const o = i * 4, y00 = y[o], y10 = y[o + 1], y01 = y[o + 2], y11 = y[o + 3];
          const top = Math.max(y00, y10, y01, y11);
          const ya = oy + dy * t0;
          if (ya < top || oy + dy * t1 < top) {
            const U0 = ox / S - c, V0 = oz / S - r;
            const b = y10 - y00, cc = y01 - y00, d = y00 - y10 - y01 + y11;
            let u = U0 + du * t0, v = V0 + dv * t0;
            u = u < 0 ? 0 : u > 1 ? 1 : u; v = v < 0 ? 0 : v > 1 ? 1 : v;
            if (ya < y00 + b * u + cc * v + d * u * v - 1e-4) {
              // 进这一格的时候已经在地面下面了：撞在坎的侧面上（起点本身就在地面下面：算打在地面上）
              out.i = i;
              if (axis === 0) { out.nx = -stepX; out.ny = 0; out.nz = 0; }
              else if (axis === 2) { out.nx = 0; out.ny = 0; out.nz = -stepZ; }
              else { out.nx = 0; out.ny = 1; out.nz = 0; }
              return t0;
            }
            // 在这一格里和坡面的交点：高度差是 t 的二次式
            const C = oy - y00 - b * U0 - cc * V0 - d * U0 * V0;
            const Bq = dy - b * du - cc * dv - d * (U0 * dv + V0 * du);
            const A = -d * du * dv;
            let t = -1;
            if (Math.abs(A) < 1e-10) {
              if (Bq < -1e-12) t = -C / Bq;
            } else {
              const disc = Bq * Bq - 4 * A * C;
              if (disc >= 0) {
                const sq = Math.sqrt(disc), ta = (-Bq - sq) / (2 * A), tb = (-Bq + sq) / (2 * A);
                const lo = Math.min(ta, tb), hi = Math.max(ta, tb);
                t = lo >= t0 - 1e-6 ? lo : hi;
              }
            }
            if (t >= t0 - 1e-6 && t <= t1 + 1e-6) {
              if (t < t0) t = t0;
              u = U0 + du * t; v = V0 + dv * t;
              const hx = (b + d * v) / S, hz = (cc + d * u) / S, il = 1 / Math.sqrt(hx * hx + 1 + hz * hz);
              out.i = i; out.nx = -hx * il; out.ny = il; out.nz = -hz * il;
              return t;
            }
          }
        }
      } else if ((c < 0 && (stepX < 0 || !hasX)) || (c >= W && (stepX > 0 || !hasX)) || (r < 0 && (stepZ < 0 || !hasZ)) || (r >= H && (stepZ > 0 || !hasZ))) break;
      if (t1 >= maxT) break;
      t0 = t1;
      if (tMaxX < tMaxZ) { tMaxX += tDX; c += stepX; axis = 0; } else { tMaxZ += tDZ; r += stepZ; axis = 2; }
    }
    return -1;
  }
}

// 由每格的「高度级」算出每格 4 个角的高度。
//   ground[i]：这一格有地面；level[i]：高度级（可以是小数）；hard[i]：硬边（顶是平的，不和旁边的格子连成坡）；
//   exp：手写的坡（格子 → 4 个角的高度级）；LH：每级多少米；
//   half：等高线两边各拿出几格来做坡（0 = 只把相邻两格连成坡）。离等高线更远的格子保持水平
// 相邻两格高度差不超过一级就连成坡，超过一级就是一道坎
export function buildHeights(W, H, ground, level, hard, exp, LH, half = 0) {
  const n = W * H;
  const auto = new Uint8Array(n), lk = new Uint8Array(n);
  for (let i = 0; i < n; i++) auto[i] = ground[i] && !hard[i] && !exp.has(i) ? 1 : 0;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const i = r * W + c;
    if (!auto[i]) continue;
    if (c + 1 < W && auto[i + 1] && Math.abs(level[i] - level[i + 1]) <= 1.001) lk[i] |= 1;
    if (r + 1 < H && auto[i + W] && Math.abs(level[i] - level[i + W]) <= 1.001) lk[i] |= 2;
  }
  const hc = Float32Array.from(level);
  if (half > 0) {
    // 离等高线（连着、但高度不一样的两格之间）有多远
    const dist = new Int16Array(n).fill(30000), q = [];
    const nbs = (i, fn) => {
      const c = i % W;
      if (c + 1 < W && (lk[i] & 1)) fn(i + 1);
      if (c > 0 && (lk[i - 1] & 1)) fn(i - 1);
      if (lk[i] & 2) fn(i + W);
      if (i >= W && (lk[i - W] & 2)) fn(i - W);
    };
    for (let i = 0; i < n; i++) {
      if (!auto[i]) continue;
      let edge = false;
      nbs(i, (j) => { if (Math.abs(level[j] - level[i]) > 1e-3) edge = true; });
      if (edge) { dist[i] = 1; q.push(i); }
    }
    for (let k = 0; k < q.length; k++) {
      const i = q[k];
      if (dist[i] >= half) continue;
      nbs(i, (j) => { if (dist[j] > dist[i] + 1) { dist[j] = dist[i] + 1; q.push(j); } });
    }
    // 等高线附近的格子反复取邻居的平均（离得远的格子不动），坡就被摊平成均匀的斜面；每格最多偏离自己的高度级半级
    const free = q, iters = 8 + half * half * 10;
    for (let it = 0; it < iters; it++) {
      for (let k = 0; k < free.length; k++) {
        const i = free[k];
        let sum = 0, cnt = 0;
        nbs(i, (j) => { sum += hc[j]; cnt++; });
        if (!cnt) continue;
        const v = sum / cnt, lo = level[i] - 0.5, hi = level[i] + 0.5;
        hc[i] = v < lo ? lo : v > hi ? hi : v;
      }
    }
  }
  // 每个格点周围最多 4 格：连着的归成一组，组里取平均，就是这一组在这个角上的高度
  const y = new Float32Array(n * 4);
  const id = [0, 0, 0, 0], grp = [0, 0, 0, 0];
  const find = (a) => { while (grp[a] !== a) a = grp[a]; return a; };
  for (let r = 0; r <= H; r++) for (let c = 0; c <= W; c++) {
    // 左上、右上、左下、右下
    id[0] = c > 0 && r > 0 ? (r - 1) * W + c - 1 : -1;
    id[1] = c < W && r > 0 ? (r - 1) * W + c : -1;
    id[2] = c > 0 && r < H ? r * W + c - 1 : -1;
    id[3] = c < W && r < H ? r * W + c : -1;
    for (let k = 0; k < 4; k++) { grp[k] = k; if (id[k] >= 0 && !auto[id[k]]) id[k] = -1; }
    if (id[0] >= 0 && id[1] >= 0 && (lk[id[0]] & 1)) grp[find(1)] = find(0);
    if (id[2] >= 0 && id[3] >= 0 && (lk[id[2]] & 1)) grp[find(3)] = find(2);
    if (id[0] >= 0 && id[2] >= 0 && (lk[id[0]] & 2)) grp[find(2)] = find(0);
    if (id[1] >= 0 && id[3] >= 0 && (lk[id[1]] & 2)) grp[find(3)] = find(1);
    for (let k = 0; k < 4; k++) {
      if (id[k] < 0) continue;
      const g = find(k);
      let sum = 0, cnt = 0;
      for (let j = 0; j < 4; j++) if (id[j] >= 0 && find(j) === g) { sum += hc[id[j]]; cnt++; }
      y[id[k] * 4 + (3 - k)] = (sum / cnt) * LH; // 左上那格用的是它的右下角（3），右上 → 左下角（2），左下 → 右上角（1），右下 → 左上角（0）
    }
  }
  for (let i = 0; i < n; i++) {
    if (!ground[i] || auto[i]) continue;
    const e = exp.get(i), o = i * 4;
    if (e) { y[o] = e[0] * LH; y[o + 1] = e[1] * LH; y[o + 2] = e[2] * LH; y[o + 3] = e[3] * LH; }
    else y[o] = y[o + 1] = y[o + 2] = y[o + 3] = level[i] * LH;
  }
  return y;
}
