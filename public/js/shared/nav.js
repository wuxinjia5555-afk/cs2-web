// 机器人寻路：基于地图格子的 A*（8 方向）+ 路径平滑
import { LEVEL_H } from './constants.js';

const DC = [1, -1, 0, 0, 1, 1, -1, -1];
const DR = [0, 0, 1, -1, 1, -1, 1, -1];
const CORNERS = [[0.45, 0.45], [-0.45, 0.45], [0.45, -0.45], [-0.45, -0.45], [0, 0]];

export class Nav {
  constructor(W, H, S, walk, level) {
    this.W = W; this.H = H; this.S = S;
    this.walk = walk; this.level = level;
    const n = W * H;
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.gen = 0;
    this.heap = new Int32Array(n * 8 + 16);
    this.walkList = [];
    for (let i = 0; i < n; i++) if (walk[i]) this.walkList.push(i);
  }

  cellOf(x, z) {
    const c = Math.floor(x / this.S), r = Math.floor(z / this.S);
    if (c < 0 || r < 0 || c >= this.W || r >= this.H) return -1;
    return r * this.W + c;
  }

  center(i, out = {}) {
    const c = i % this.W, r = (i / this.W) | 0;
    out.x = (c + 0.5) * this.S;
    out.z = (r + 0.5) * this.S;
    out.y = this.level[i] * LEVEL_H;
    return out;
  }

  canStep(a, b) {
    return !!this.walk[b] && this.level[b] - this.level[a] <= 1;
  }

  // 从格子 i 能走到的相邻格子（和 A* 同一套规则：斜着走要两边都能走）
  eachStep(i, fn) {
    const W = this.W, c = i % W, r = (i / W) | 0;
    for (let d = 0; d < 8; d++) {
      const nc = c + DC[d], nr = r + DR[d];
      if (nc < 0 || nr < 0 || nc >= W || nr >= this.H) continue;
      const j = nr * W + nc;
      if (!this.canStep(i, j)) continue;
      if (d >= 4 && (!this.canStep(i, r * W + nc) || !this.canStep(i, nr * W + c))) continue;
      fn(j);
    }
  }

  // 只保留「从 seed 走得到、也走得回 seed」的格子，其余的都标成不可走
  keepMain(seed) {
    const n = this.W * this.H;
    if (seed < 0 || !this.walk[seed]) return;
    const rev = new Array(n);
    for (let i = 0; i < n; i++) if (this.walk[i]) this.eachStep(i, (j) => { (rev[j] || (rev[j] = [])).push(i); });
    const flood = (next) => {
      const seen = new Uint8Array(n), q = [seed];
      seen[seed] = 1;
      for (let k = 0; k < q.length; k++) next(q[k], (j) => { if (!seen[j]) { seen[j] = 1; q.push(j); } });
      return seen;
    };
    const fwd = flood((i, fn) => this.eachStep(i, fn));
    const back = flood((i, fn) => { if (rev[i]) for (const j of rev[i]) fn(j); });
    this.walkList.length = 0;
    for (let i = 0; i < n; i++) {
      if (!this.walk[i]) continue;
      if (fwd[i] && back[i]) this.walkList.push(i);
      else this.walk[i] = 0;
    }
  }

  // 出口：标出哪些格子算「走出去了」，并从出口往回推，算好每个格子朝最近出口走的下一步
  setExits(isExit) {
    const n = this.W * this.H;
    const rev = new Array(n);
    for (let i = 0; i < n; i++) if (this.walk[i]) this.eachStep(i, (j) => { (rev[j] || (rev[j] = [])).push(i); });
    const next = (this.exitNext = new Int32Array(n).fill(-1));
    const q = [];
    for (let i = 0; i < n; i++) if (this.walk[i] && isExit(i)) { next[i] = i; q.push(i); }
    for (let k = 0; k < q.length; k++) {
      const j = q[k];
      if (!rev[j]) continue;
      for (const i of rev[j]) if (next[i] < 0) { next[i] = j; q.push(i); }
    }
  }

  // 从 (x, z, 脚高 y) 走到最近出口的格子路径；走不出去返回 null
  wayOut(x, z, y) {
    if (!this.exitNext) return null;
    let cur = this.nearestWalkable(x, z, y, true);
    if (cur < 0 || this.exitNext[cur] < 0) return null;
    const cells = [cur];
    while (this.exitNext[cur] !== cur && cells.length < 800) { cur = this.exitNext[cur]; cells.push(cur); }
    return cells;
  }

  // 离 (x, z) 最近的可走格子。给了 y（脚的高度）就只找「不比脚高出一步以上」的格子，
  // 免得人站在台子下面，却被当成站在台子上面；strict：找不到合适高度的就返回 -1（不退而求其次）
  nearestWalkable(x, z, y, strict) {
    const hasY = y != null, maxLv = hasY ? (y + 0.5) / LEVEL_H : 0;
    const i0 = this.cellOf(x, z);
    if (i0 >= 0 && this.walk[i0] && (!hasY || this.level[i0] <= maxLv)) return i0;
    const c0 = Math.floor(x / this.S), r0 = Math.floor(z / this.S);
    for (let rad = 1; rad <= 8; rad++) {
      let best = -1, bd = Infinity;
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== rad) continue;
          const c = c0 + dc, r = r0 + dr;
          if (c < 0 || r < 0 || c >= this.W || r >= this.H) continue;
          const i = r * this.W + c;
          if (!this.walk[i] || (hasY && this.level[i] > maxLv)) continue;
          const d = dc * dc + dr * dr;
          if (d < bd) { bd = d; best = i; }
        }
      }
      if (best >= 0) return best;
    }
    return hasY && !strict ? this.nearestWalkable(x, z) : -1;
  }

  findPath(start, goal, maxIter = Math.max(8000, (this.W * this.H) >> 1)) {
    if (start < 0 || goal < 0 || !this.walk[goal]) return null;
    if (start === goal) return [goal];
    const W = this.W, H = this.H;
    const gen = ++this.gen;
    const g = this.g, f = this.f, par = this.parent, seen = this.seen, closed = this.closed, heap = this.heap;
    const gc = goal % W, gr = (goal / W) | 0;
    const heu = (i) => {
      const dc = Math.abs((i % W) - gc), dr = Math.abs(((i / W) | 0) - gr);
      return dc + dr - 0.5858 * Math.min(dc, dr);
    };
    let hs = 0;
    const push = (i) => {
      let k = hs++;
      heap[k] = i;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (f[heap[p]] <= f[heap[k]]) break;
        const t = heap[p]; heap[p] = heap[k]; heap[k] = t;
        k = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      heap[0] = heap[--hs];
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < hs && f[heap[l]] < f[heap[m]]) m = l;
        if (r < hs && f[heap[r]] < f[heap[m]]) m = r;
        if (m === k) break;
        const t = heap[m]; heap[m] = heap[k]; heap[k] = t;
        k = m;
      }
      return top;
    };
    seen[start] = gen; g[start] = 0; f[start] = heu(start); par[start] = -1;
    push(start);
    let iter = 0;
    while (hs > 0 && iter++ < maxIter) {
      const cur = pop();
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      if (cur === goal) {
        const path = [];
        for (let k = cur; k !== -1; k = par[k]) path.push(k);
        return path.reverse();
      }
      const c = cur % W, r = (cur / W) | 0;
      for (let d = 0; d < 8; d++) {
        const nc = c + DC[d], nr = r + DR[d];
        if (nc < 0 || nr < 0 || nc >= W || nr >= H) continue;
        const ni = nr * W + nc;
        if (closed[ni] === gen || !this.canStep(cur, ni)) continue;
        let cost = 1;
        if (d >= 4) {
          if (!this.canStep(cur, r * W + nc) || !this.canStep(cur, nr * W + c)) continue;
          cost = 1.4142;
        }
        if (this.level[cur] - this.level[ni] > 1) cost += 2;
        const ng = g[cur] + cost;
        if (seen[ni] !== gen || ng < g[ni]) {
          seen[ni] = gen; g[ni] = ng; f[ni] = ng + heu(ni); par[ni] = cur;
          if (hs < heap.length) push(ni);
        }
      }
    }
    return null;
  }

  // 直线是否可走（考虑玩家宽度与高差）
  lineWalkable(x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.sqrt(dx * dx + dz * dz);
    const n = Math.max(1, Math.ceil(len / 0.4));
    let prev = -1;
    for (let k = 0; k <= n; k++) {
      const t = k / n, x = x0 + dx * t, z = z0 + dz * t;
      const ci = this.cellOf(x, z);
      if (ci < 0 || !this.walk[ci]) return false;
      const lc = this.level[ci];
      if (prev >= 0 && lc - prev > 1) return false;
      prev = lc;
      for (let q = 0; q < 4; q++) {
        const i = this.cellOf(x + CORNERS[q][0], z + CORNERS[q][1]);
        if (i < 0 || !this.walk[i] || Math.abs(this.level[i] - lc) > 1) return false;
      }
    }
    return true;
  }

  // 把格子路径转为平滑的世界坐标路点
  smooth(cells, sx, sz) {
    const pts = cells.map((i) => this.center(i, {}));
    const out = [];
    let ax = sx, az = sz, k = 0;
    while (k < pts.length) {
      let j = Math.min(pts.length - 1, k + 10);
      for (; j > k; j--) if (this.lineWalkable(ax, az, pts[j].x, pts[j].z)) break;
      out.push(pts[j]);
      ax = pts[j].x; az = pts[j].z;
      k = j + 1;
    }
    return out;
  }

  randomCell(rnd) {
    return this.walkList[Math.floor(rnd() * this.walkList.length)];
  }
}
