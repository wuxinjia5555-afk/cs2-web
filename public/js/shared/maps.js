// 地图：用"挖掘式"构建器描述（默认全是墙，再挖出地面/坡道/掩体），生成碰撞盒、出生点、包点和寻路网格
import { World } from './physics.js';
import { Nav } from './nav.js';
import { LEVEL_H } from './constants.js';
import { DUST2_ROWS, decodeRows } from './dust2.js';
import { MIRAGE_ROWS } from './mirage.js';

export const CELL = { WALL: 0, FLOOR: 1, CRATE: 2, CRATE2: 3, LOW: 4, BARREL: 5 };
const OBJ_CHAR = { x: CELL.CRATE, X: CELL.CRATE2, h: CELL.LOW, o: CELL.BARREL };

class Builder {
  constructor(def) {
    this.def = def;
    this.W = def.w; this.H = def.h; this.S = def.cell;
    const n = this.W * this.H;
    this.type = new Uint8Array(n);
    this.level = new Uint8Array(n);
    this.fmat = new Array(n).fill(def.floorMat);
    this.wmat = new Array(n).fill(def.wallMat);
    this.wh = new Float32Array(n);
    this.roofs = []; this.doors = []; this.extra = [];
    this.sites = {}; this.spawns = { T: null, CT: null }; this.buy = { T: [], CT: [] };
    this.dummies = [];
    this.blocked = new Set();
    this.bridges = []; this.ladders = [];
  }
  rect(c0, r0, c1, r1, fn) {
    for (let r = Math.max(0, r0); r <= Math.min(this.H - 1, r1); r++)
      for (let c = Math.max(0, c0); c <= Math.min(this.W - 1, c1); c++) fn(r * this.W + c, c, r);
  }
  floor(c0, r0, c1, r1, level = 0, mat) {
    this.rect(c0, r0, c1, r1, (i) => { this.type[i] = CELL.FLOOR; this.level[i] = level; if (mat) this.fmat[i] = mat; });
  }
  ramp(c0, r0, c1, r1, axis, l0, l1, mat) {
    this.rect(c0, r0, c1, r1, (i, c, r) => {
      const t = axis === 'x' ? (c1 === c0 ? 0 : (c - c0) / (c1 - c0)) : (r1 === r0 ? 0 : (r - r0) / (r1 - r0));
      this.type[i] = CELL.FLOOR;
      this.level[i] = Math.round(l0 + (l1 - l0) * t);
      if (mat) this.fmat[i] = mat;
    });
  }
  wall(c0, r0, c1, r1, mat, h) {
    this.rect(c0, r0, c1, r1, (i) => { this.type[i] = CELL.WALL; if (mat) this.wmat[i] = mat; this.wh[i] = h || 0; });
  }
  wallMat(c0, r0, c1, r1, mat) {
    this.rect(c0, r0, c1, r1, (i) => { if (this.type[i] === CELL.WALL && !this.wh[i]) this.wmat[i] = mat; });
  }
  objs(ch, list) {
    const t = OBJ_CHAR[ch];
    for (const [c, r] of list) {
      const i = r * this.W + c;
      if (this.type[i] === CELL.FLOOR) this.type[i] = t;
    }
  }
  roof(c0, r0, c1, r1, h = 3.4, mat) { this.roofs.push({ c0, r0, c1, r1, h, mat }); }
  door(c0, r0, c1, r1, h = 3.2) { this.doors.push({ c0, r0, c1, r1, h }); }
  site(name, c0, r0, c1, r1) { this.sites[name] = { c0, r0, c1, r1 }; }
  spawn(team, cells, yaw) { this.spawns[team] = { cells, yaw }; }
  buyzone(team, c0, r0, c1, r1) { this.buy[team].push({ c0, r0, c1, r1 }); }
  // 按字符图建图：# 墙；a-z 地面高度级（太高的当障碍物）；A-Z 箱子（字母为顶部高度级）
  ascii(rows, boxMat = 'crate') {
    rows.forEach((row, r) => {
      for (let c = 0; c < row.length && c < this.W; c++) {
        const ch = row[c], i = r * this.W + c;
        if (ch === '#') continue;
        if (ch >= 'a' && ch <= 'z') {
          const lv = ch.charCodeAt(0) - 97;
          if (lv >= 9) { this.type[i] = CELL.WALL; this.wh[i] = lv * LEVEL_H + 0.8; this.wmat[i] = boxMat; continue; }
          this.type[i] = CELL.FLOOR;
          this.level[i] = lv;
        } else {
          this.type[i] = CELL.WALL;
          this.wh[i] = Math.max(1.0, (ch.charCodeAt(0) - 65) * LEVEL_H);
          this.wmat[i] = boxMat;
        }
      }
    });
  }
  // 按字符图建图（高度不封顶，0~25 级）：# 墙；a-z 地面高度级；A-Z 箱子（字母为顶部高度级）
  heights(rows, boxMat = 'crate') {
    rows.forEach((row, r) => {
      for (let c = 0; c < row.length && c < this.W; c++) {
        const ch = row[c], i = r * this.W + c;
        if (ch === '#') continue;
        if (ch >= 'a' && ch <= 'z') { this.type[i] = CELL.FLOOR; this.level[i] = ch.charCodeAt(0) - 97; continue; }
        this.type[i] = CELL.WALL;
        this.wh[i] = Math.max(1.0, (ch.charCodeAt(0) - 65) * LEVEL_H);
        this.wmat[i] = boxMat;
      }
    });
  }
  // 去掉单格的细脊 / 小坑（雷达图描边留下的杂点）：比左右或上下两边都高（低）2 级以上的格子，拉平到四周的平均高度
  despeckle(passes = 2) {
    const { W, H } = this;
    const fl = (i) => this.type[i] === CELL.FLOOR;
    for (let p = 0; p < passes; p++) {
      for (let r = 1; r < H - 1; r++) for (let c = 1; c < W - 1; c++) {
        const i = r * W + c;
        if (!fl(i)) continue;
        const lv = this.level[i], L = i - 1, R = i + 1, U = i - W, D = i + W;
        const ridge = (a, b) => fl(a) && fl(b) && (lv - Math.max(this.level[a], this.level[b]) >= 2 || Math.min(this.level[a], this.level[b]) - lv >= 2);
        if (!ridge(L, R) && !ridge(U, D)) continue;
        let sum = 0, n = 0;
        for (const j of [L, R, U, D]) if (fl(j)) { sum += this.level[j]; n++; }
        this.level[i] = Math.round(sum / n);
      }
    }
  }
  // 楼板（桥）：下面是通道，上面能走人；寻路按楼板上面那层算。holes：楼板上留的洞（梯子口）[[c0, r0, c1, r1]]
  bridge(c0, r0, c1, r1, level, mat, holes = []) { this.bridges.push({ c0, r0, c1, r1, level, mat, holes }); }
  // 梯子：格子范围 + 高度级范围，nx/nz 是梯子朝外（人站的那边）的方向
  ladder(c0, r0, c1, r1, lv0, lv1, nx, nz) { this.ladders.push({ c0, r0, c1, r1, lv0, lv1, nx, nz }); }
  // 清理误识别的箱子：1 格宽的细线、零星的单格都还原成地面（高度取周围地面的中位数）
  cleanBoxes(boxMat = 'crate') {
    const { W, H } = this, seen = new Uint8Array(W * H);
    const isBox = (i) => this.type[i] === CELL.WALL && this.wh[i] > 0 && this.wmat[i] === boxMat;
    for (let i0 = 0; i0 < W * H; i0++) {
      if (seen[i0] || !isBox(i0)) continue;
      const comp = [], st = [i0];
      seen[i0] = 1;
      while (st.length) {
        const i = st.pop();
        comp.push(i);
        const c = i % W, r = (i / W) | 0;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const cc = c + dc, rr = r + dr, j = rr * W + cc;
          if (cc >= 0 && rr >= 0 && cc < W && rr < H && !seen[j] && isBox(j)) { seen[j] = 1; st.push(j); }
        }
      }
      // 只保留实心部分：格子在横竖两个方向都有邻居（2x2 以上的块）；伸出来的细线、零星单格都还原成地面
      const set = new Set(comp);
      const solid = new Set(comp.filter((i) => {
        const c = i % W;
        return ((set.has(i - 1) && c > 0) || (set.has(i + 1) && c < W - 1)) && (set.has(i - W) || set.has(i + W));
      }));
      const remove = solid.size >= 4 ? comp.filter((i) => !solid.has(i)) : comp;
      for (const i of remove) {
        const lv = [];
        const c = i % W, r = (i / W) | 0;
        for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
          const j = (r + dr) * W + c + dc;
          if (this.type[j] === CELL.FLOOR) lv.push(this.level[j]);
        }
        if (!lv.length) continue;
        lv.sort((a, b) => a - b);
        this.type[i] = CELL.FLOOR;
        this.level[i] = lv[lv.length >> 1];
        this.wh[i] = 0;
      }
    }
  }
  // 只改地面材质
  floorMat(c0, r0, c1, r1, mat) {
    this.rect(c0, r0, c1, r1, (i) => { if (this.type[i] === CELL.FLOOR) this.fmat[i] = mat; });
  }
  // 在 (c, r) 附近找 n 个分散的地面格做出生点
  spawnNear(team, c, r, n, yaw) {
    const cells = [], lv0 = this.level[r * this.W + c];
    for (let rad = 0; rad <= 8 && cells.length < n; rad++) {
      for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== rad || cells.length >= n) continue;
        const cc = c + dc, rr = r + dr, i = rr * this.W + cc;
        if (cc < 1 || rr < 1 || cc >= this.W - 1 || rr >= this.H - 1 || this.type[i] !== CELL.FLOOR) continue;
        if (Math.abs(this.level[i] - lv0) > 1) continue;
        if (cells.some(([x, y]) => Math.abs(x - cc) < 2 && Math.abs(y - rr) < 2)) continue;
        cells.push([cc, rr]);
      }
    }
    this.spawn(team, cells, yaw);
  }
  // 靶场假人：kind = static 站着 / strafe 左右来回（w 为来回半宽，格） / crouch 蹲着
  dummy(c, r, kind = 'static', w = 0, walk = false) { this.dummies.push({ c, r, kind, w, walk }); }
  box(x0, y0, z0, x1, y1, z1, mat, kind = 'wall') { this.extra.push({ min: [x0, y0, z0], max: [x1, y1, z1], mat, kind }); }
  // 只对寻路生效的“不可走”格子（用于自由尺寸的方块，比如门扇）
  noWalk(c0, r0, c1, r1) { this.rect(c0, r0, c1, r1, (i) => { this.blocked.add(i); }); }
}

// 贪心合并矩形
function greedy(W, H, keyFn, emit) {
  const used = new Uint8Array(W * H);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const i = r * W + c;
      if (used[i]) continue;
      const k = keyFn(i);
      if (k === null) continue;
      let c1 = c;
      while (c1 + 1 < W && !used[r * W + c1 + 1] && keyFn(r * W + c1 + 1) === k) c1++;
      let r1 = r;
      outer: while (r1 + 1 < H) {
        for (let cc = c; cc <= c1; cc++) {
          const j = (r1 + 1) * W + cc;
          if (used[j] || keyFn(j) !== k) break outer;
        }
        r1++;
      }
      for (let rr = r; rr <= r1; rr++) for (let cc = c; cc <= c1; cc++) used[rr * W + cc] = 1;
      emit(c, r, c1, r1, k);
    }
  }
}

export function buildMap(id) {
  const def = MAPS[id];
  if (!def) throw new Error('未知地图 ' + id);
  const B = new Builder(def);
  def.build(B);
  const { W, H, S } = B;
  const wallH = def.wallH || 6;
  const boxes = [];

  // 地面
  greedy(W, H, (i) => (B.type[i] !== CELL.WALL ? B.level[i] + '|' + B.fmat[i] : null), (c0, r0, c1, r1, k) => {
    const [lv, mat] = k.split('|');
    boxes.push({ min: [c0 * S, -1, r0 * S], max: [(c1 + 1) * S, +lv * LEVEL_H, (r1 + 1) * S], mat, kind: 'floor' });
  });
  // 墙
  greedy(W, H, (i) => (B.type[i] === CELL.WALL ? B.wmat[i] + '|' + (B.wh[i] || wallH) : null), (c0, r0, c1, r1, k) => {
    const [mat, h] = k.split('|');
    boxes.push({ min: [c0 * S, -1, r0 * S], max: [(c1 + 1) * S, +h, (r1 + 1) * S], mat, kind: 'wall' });
  });
  // 矮墙 / 沙袋
  greedy(W, H, (i) => (B.type[i] === CELL.LOW ? String(B.level[i]) : null), (c0, r0, c1, r1, k) => {
    const base = +k * LEVEL_H;
    boxes.push({ min: [c0 * S, base, r0 * S], max: [(c1 + 1) * S, base + 1.05, (r1 + 1) * S], mat: def.lowMat, kind: 'low' });
  });
  // 箱子、油桶
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const i = r * W + c, t = B.type[i], base = B.level[i] * LEVEL_H;
      if (t === CELL.CRATE || t === CELL.CRATE2) {
        const m = (S - 1.7) / 2;
        boxes.push({ min: [c * S + m, base, r * S + m], max: [(c + 1) * S - m, base + (t === CELL.CRATE ? 1.1 : 2.2), (r + 1) * S - m], mat: def.crateMat, kind: t === CELL.CRATE ? 'crate' : 'crate2' });
      } else if (t === CELL.BARREL) {
        const m = (S - 0.8) / 2;
        boxes.push({ min: [c * S + m, base, r * S + m], max: [(c + 1) * S - m, base + 1.0, (r + 1) * S - m], mat: 'barrel', kind: 'barrel' });
      }
    }
  }
  // 屋顶（地道）
  for (const rf of B.roofs) {
    let lv = 0;
    B.rect(rf.c0, rf.r0, rf.c1, rf.r1, (i) => { lv = Math.max(lv, B.level[i]); });
    const y = lv * LEVEL_H + rf.h;
    boxes.push({ min: [rf.c0 * S, y, rf.r0 * S], max: [(rf.c1 + 1) * S, y + 0.4, (rf.r1 + 1) * S], mat: rf.mat || def.roofMat, kind: 'roof' });
  }
  // 门梁
  for (const d of B.doors) {
    let lv = 0;
    B.rect(d.c0, d.r0, d.c1, d.r1, (i) => { lv = Math.max(lv, B.level[i]); });
    const y = lv * LEVEL_H + d.h;
    boxes.push({ min: [d.c0 * S, y, d.r0 * S], max: [(d.c1 + 1) * S, wallH, (d.r1 + 1) * S], mat: def.wallMat, kind: 'wall' });
  }
  for (const e of B.extra) boxes.push(e);
  // 楼板（桥）：按格子合并成几块板，洞口不盖；寻路时这些格子按楼板上面的高度算
  const navLevel = B.level.slice();
  for (const br of B.bridges) {
    const inHole = (c, r) => br.holes.some(([a0, b0, a1, b1]) => c >= a0 && c <= a1 && r >= b0 && r <= b1);
    const cover = (i) => {
      const c = i % W, r = (i / W) | 0;
      return c >= br.c0 && c <= br.c1 && r >= br.r0 && r <= br.r1 && !inHole(c, r) ? 1 : null;
    };
    const top = br.level * LEVEL_H;
    greedy(W, H, cover, (c0, r0, c1, r1) => {
      boxes.push({ min: [c0 * S, top - 0.35, r0 * S], max: [(c1 + 1) * S, top, (r1 + 1) * S], mat: br.mat || def.floorMat, kind: 'roof' });
    });
    B.rect(br.c0, br.r0, br.c1, br.r1, (i, c, r) => { if (!inHole(c, r)) navLevel[i] = br.level; });
  }
  // 梯子：碰撞范围给物理用；外观（两根竖杆 + 横档）单独画，不挡人
  const ladders = [], decos = [];
  for (const l of B.ladders) {
    const x0 = l.c0 * S, x1 = (l.c1 + 1) * S, z0 = l.r0 * S, z1 = (l.r1 + 1) * S, y0 = l.lv0 * LEVEL_H, y1 = l.lv1 * LEVEL_H;
    ladders.push({ min: [x0, y0, z0], max: [x1, y1 + 0.3, z1], nx: l.nx, nz: l.nz });
    // 贴墙的那一面
    const wallX = l.nx < 0 ? x1 : l.nx > 0 ? x0 : null, wallZ = l.nz < 0 ? z1 : l.nz > 0 ? z0 : null;
    const along = wallX != null ? 'z' : 'x';
    const a0 = along === 'z' ? z0 : x0, a1 = along === 'z' ? z1 : x1, mid = (a0 + a1) / 2, half = Math.min(0.28, (a1 - a0) / 2 - 0.05);
    const put = (p0, p1, yy0, yy1, d0, d1) => {
      if (along === 'z') { const wx = wallX + l.nx * d0, wx2 = wallX + l.nx * d1; decos.push({ min: [Math.min(wx, wx2), yy0, p0], max: [Math.max(wx, wx2), yy1, p1], mat: 'metal' }); }
      else { const wz = wallZ + l.nz * d0, wz2 = wallZ + l.nz * d1; decos.push({ min: [p0, yy0, Math.min(wz, wz2)], max: [p1, yy1, Math.max(wz, wz2)], mat: 'metal' }); }
    };
    put(mid - half - 0.03, mid - half + 0.03, y0, y1 + 0.9, 0.02, 0.1);
    put(mid + half - 0.03, mid + half + 0.03, y0, y1 + 0.9, 0.02, 0.1);
    for (let y = y0 + 0.3; y < y1 + 0.6; y += 0.32) put(mid - half, mid + half, y, y + 0.04, 0.03, 0.09);
  }

  const world = new World(boxes);
  world.ladders = ladders;

  const cellPos = (c, r) => {
    const i = r * W + c;
    return { x: (c + 0.5) * S, y: B.level[i] * LEVEL_H + 0.02, z: (r + 0.5) * S };
  };
  const spawns = { T: [], CT: [] };
  for (const team of ['T', 'CT']) {
    const sp = B.spawns[team];
    for (const [c, r] of sp.cells) {
      if (B.type[r * W + c] !== CELL.FLOOR) console.warn('[map]', id, '出生点不在地面上', team, c, r);
      spawns[team].push({ ...cellPos(c, r), yaw: sp.yaw });
    }
  }
  const sites = {};
  for (const [name, s] of Object.entries(B.sites)) {
    const cc = Math.floor((s.c0 + s.c1) / 2), rc = Math.floor((s.r0 + s.r1) / 2);
    sites[name] = {
      name, x0: s.c0 * S, z0: s.r0 * S, x1: (s.c1 + 1) * S, z1: (s.r1 + 1) * S,
      cx: ((s.c0 + s.c1 + 1) / 2) * S, cz: ((s.r0 + s.r1 + 1) / 2) * S, y: B.level[rc * W + cc] * LEVEL_H,
      cells: [],
    };
    B.rect(s.c0, s.r0, s.c1, s.r1, (i) => { if (B.type[i] === CELL.FLOOR) sites[name].cells.push(i); });
  }
  const buy = { T: [], CT: [] };
  for (const team of ['T', 'CT']) for (const z of B.buy[team]) buy[team].push({ x0: z.c0 * S, z0: z.r0 * S, x1: (z.c1 + 1) * S, z1: (z.r1 + 1) * S });

  // 死斗出生点：周围 8 格都不是墙的开阔地面
  const dmSpawns = [];
  for (let r = 1; r < H - 1; r++) {
    for (let c = 1; c < W - 1; c++) {
      if (B.type[r * W + c] !== CELL.FLOOR) continue;
      let ok = true;
      for (let dr = -1; dr <= 1 && ok; dr++) for (let dc = -1; dc <= 1; dc++) if (B.type[(r + dr) * W + c + dc] === CELL.WALL) { ok = false; break; }
      if (ok) dmSpawns.push({ ...cellPos(c, r), yaw: 0 });
    }
  }

  const dummies = B.dummies.map((d) => ({ ...cellPos(d.c, d.r), yaw: Math.PI, kind: d.kind, crouch: d.kind === 'crouch', w: d.w * S, walk: d.walk }));

  const walk = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) walk[i] = B.type[i] === CELL.FLOOR && !B.blocked.has(i) ? 1 : 0;
  // 小格子地图（半米一格）：挨着墙 / 箱子的格子不给机器人走，留出人的身位（不然会往人过不去的窄缝里钻）
  if (S < 0.8) {
    const solid = (i) => B.type[i] !== CELL.FLOOR;
    const keep = new Uint8Array(W * H);
    for (let r = 1; r < H - 1; r++) for (let c = 1; c < W - 1; c++) {
      const i = r * W + c;
      if (!walk[i]) continue;
      let ok = 1;
      for (let dr = -1; dr <= 1 && ok; dr++) for (let dc = -1; dc <= 1; dc++) if (solid(i + dr * W + dc)) { ok = 0; break; }
      keep[i] = ok;
    }
    walk.set(keep);
  }
  // 屋顶下的格子也可走；门梁不影响
  const nav = new Nav(W, H, S, walk, navLevel);

  return {
    id, name: def.name, theme: def.theme, def, W, H, S, wallH,
    type: B.type, level: B.level, wh: B.wh,
    boxes, world, nav, spawns, sites, buy, dmSpawns, dummies, ladders, decos,
    bounds: { x0: 0, z0: 0, x1: W * S, z1: H * S },
  };
}

const cache = {};
export function getMap(id) {
  if (!MAPS[id]) id = 'sandstorm';
  return cache[id] || (cache[id] = buildMap(id));
}

export function inRect(rc, x, z) {
  return x >= rc.x0 && x <= rc.x1 && z >= rc.z0 && z <= rc.z1;
}

// ====================== 地图定义 ======================
export const MAPS = {
  // 沙二：Dust II 的布局（1 格 = 1 米）
  dust2: {
    name: '沙二', desc: 'Dust II 布局：A 大、A 小（猫道）、中路、中门、B 洞、上下地道', theme: 'desert',
    w: 114, h: 114, cell: 1, wallH: 8,
    floorMat: 'sand', wallMat: 'plaster', crateMat: 'crate', lowMat: 'sandbag', roofMat: 'roof',
    build(b) {
      b.ascii(decodeRows(DUST2_ROWS));
      b.cleanBoxes();
      // 中门：两扇大木门，中间留 1.9 米能过人的口子；门扇和门框之间各有一条 12 厘米的细缝（能看穿、不能过人）
      const dy = 0.4, dTop = 3.8, z0 = 32.35, z1 = 32.65;
      b.box(47.12, dy, z0, 50.3, dTop, z1, 'wood');
      b.box(52.2, dy, z0, 54.88, dTop, z1, 'wood');
      b.door(47, 32, 54, 32, 3.4); // 门楣：门上方是石墙
      b.noWalk(47, 32, 50, 32);
      b.noWalk(52, 32, 54, 32);
      b.floorMat(58, 16, 84, 32, 'tiles');      // CT 出生点
      b.floorMat(45, 30, 57, 97, 'road');       // 中路
      b.floorMat(8, 37, 31, 76, 'concrete');    // 地道
      b.floorMat(84, 12, 100, 30, 'site_d');    // A 点
      b.floorMat(9, 8, 28, 26, 'site_d');       // B 点
      b.site('A', 84, 16, 99, 29);
      b.site('B', 12, 9, 27, 24);
      b.spawnNear('T', 41, 102, 10, 0);
      b.spawnNear('CT', 68, 25, 10, Math.PI);
      b.buyzone('T', 28, 94, 56, 108);
      b.buyzone('CT', 58, 16, 82, 32);
    },
  },
  mirage: {
    name: '荒漠迷城', desc: 'Mirage 布局：A 坡道 / Palace / A 点、中路 / 窗口 / 连接、B 公寓、B 小道、地下通道和梯子间', theme: 'desert',
    w: 256, h: 256, cell: 0.508, wallH: 14,
    floorMat: 'sand', wallMat: 'plaster', crateMat: 'crate', lowMat: 'sandbag', roofMat: 'roof',
    build(b) {
      b.heights(decodeRows(MIRAGE_ROWS));
      b.cleanBoxes();
      b.despeckle();
      // 地下通道：后巷那头的台阶下到底 → 往南从 B 小道下面穿过（上面盖楼板）→ 梯子间 → 台阶上到中路窗口下面
      b.floor(106, 60, 113, 99, 1, 'concrete');
      b.ramp(106, 100, 113, 111, 'y', 1, 5, 'concrete');
      b.bridge(106, 68, 113, 99, 8, 'concrete', [[110, 87, 113, 92]]);
      // 梯子间：梯子挂在通道东墙上，从通道爬到 B 小道那一层
      b.ladder(113, 88, 113, 91, 1, 9, -1, 0);
      b.floorMat(126, 184, 147, 206, 'site_d');   // A 点
      b.floorMat(47, 59, 71, 85, 'site_d');       // B 点
      b.floorMat(100, 104, 160, 126, 'road');     // 中路
      b.site('A', 126, 184, 147, 206);
      b.site('B', 47, 59, 71, 85);
      b.spawnNear('T', 225, 92, 10, Math.PI / 2);
      b.spawnNear('CT', 79, 178, 10, -Math.PI / 2);
      b.buyzone('T', 212, 76, 238, 110);
      b.buyzone('CT', 66, 158, 92, 198);
    },
  },
  // 靶场（训练场）：不出现在普通地图列表里
  range: {
    name: '靶场', desc: '训练场：固定 / 移动 / 下蹲假人，10 ~ 70 米靶道', theme: 'dev', hidden: true,
    w: 30, h: 46, cell: 2, wallH: 5,
    floorMat: 'dev_floor', wallMat: 'dev_wall', crateMat: 'dev_crate', lowMat: 'dev_low', roofMat: 'dev_wall',
    build(b) {
      b.floor(1, 1, 28, 44, 0, 'dev_floor');
      b.floor(1, 38, 28, 44, 0, 'dev_floor2');
      // 距离线（约 10 / 20 / 30 / 40 / 50 / 70 米）
      for (const r of [34, 29, 24, 19, 14, 4]) b.floor(1, r, 28, r, 0, 'dev_floor2');
      // 射击台：中间和两边留出口
      const bench = [];
      for (let c = 3; c <= 26; c++) if (c < 13 || c > 16) bench.push([c, 37]);
      b.objs('h', bench);
      // 掩体
      b.objs('x', [[9, 31], [19, 31], [6, 21], [23, 21], [14, 16]]);
      b.objs('X', [[3, 26], [26, 26], [10, 11], [18, 11]]);
      b.objs('h', [[12, 8], [13, 8], [15, 8], [16, 8]]);
      // 假人
      b.dummy(5, 33); b.dummy(11, 33, 'strafe', 2); b.dummy(18, 33); b.dummy(24, 33, 'strafe', 2);
      b.dummy(8, 28); b.dummy(14, 28, 'strafe', 4); b.dummy(21, 28, 'crouch');
      b.dummy(4, 23); b.dummy(12, 23, 'strafe', 3, true); b.dummy(18, 23); b.dummy(25, 23, 'crouch');
      b.dummy(9, 18, 'crouch'); b.dummy(20, 18, 'strafe', 4);
      b.dummy(6, 13); b.dummy(14, 13); b.dummy(22, 13, 'strafe', 3);
      b.dummy(10, 3); b.dummy(18, 3);
      b.spawn('CT', [[9, 41], [11, 41], [13, 41], [15, 41], [17, 41], [19, 41], [10, 43], [14, 43], [18, 43], [12, 42]], 0);
      b.spawn('T', [[14, 1]], Math.PI);
      b.buyzone('CT', 1, 1, 28, 44);
      b.buyzone('T', 1, 1, 28, 44);
    },
  },

  sandstorm: {
    name: '沙城', desc: '经典双包点沙漠地图：A 大、A 小、中路、B 洞', theme: 'desert',
    w: 40, h: 40, cell: 2, wallH: 6,
    floorMat: 'sand', wallMat: 'plaster', crateMat: 'crate', lowMat: 'sandbag', roofMat: 'roof',
    build(b) {
      // T 出生点（南）
      b.floor(13, 32, 26, 38, 0, 'sand');
      // CT 出生点（北）
      b.floor(15, 2, 24, 8, 0, 'tiles');
      // A 点（高台）
      b.floor(27, 2, 37, 11, 3, 'site_d');
      b.ramp(25, 3, 26, 7, 'x', 1, 2, 'tiles');
      // A 大道
      b.ramp(32, 12, 37, 13, 'z', 2, 1, 'sand');
      b.floor(32, 14, 37, 23, 0, 'sand');
      // A 大门：门洞开在东侧，门后一道墙挡住直线，要拐个弯才进得了 A 大
      b.floor(36, 24, 37, 24, 0, 'sand'); b.door(36, 24, 37, 24, 3.2);
      b.wall(35, 22, 37, 22);
      b.floor(27, 25, 37, 30, 0, 'sand');
      b.floor(27, 31, 30, 34, 0, 'sand');
      // 中路
      b.floor(17, 12, 21, 25, 0, 'road');
      b.floor(16, 26, 22, 31, 0, 'road');
      b.floor(18, 9, 20, 11, 0, 'tiles'); b.door(18, 10, 20, 10, 3.2);
      // A 小道（连廊）
      b.ramp(22, 14, 24, 16, 'x', 0, 2, 'tiles');
      b.floor(25, 12, 28, 16, 3, 'tiles');
      // B 点
      b.floor(2, 2, 12, 11, 0, 'site_d');
      b.floor(13, 4, 14, 6, 0, 'tiles'); b.door(13, 4, 13, 6, 3.2);
      // B 洞（地道）
      b.floor(4, 12, 7, 32, 0, 'concrete');
      b.floor(4, 33, 12, 36, 0, 'concrete');
      b.roof(4, 18, 7, 32, 3.4);
      b.roof(4, 33, 12, 36, 3.4);
      b.floor(8, 25, 8, 29, 0, 'concrete'); b.roof(8, 25, 8, 29, 3.4);
      b.wall(4, 26, 6, 26); b.wall(6, 28, 8, 28);
      b.floor(8, 20, 16, 22, 0, 'concrete');
      b.roof(8, 20, 16, 22, 3.4);
      b.wallMat(0, 12, 16, 39, 'brick');
      // 中门：中路这一段加宽，两道墙的门洞（各 3 格宽）一左一右错开，中间是个宽敞的隔间，远处看不穿
      b.floor(16, 17, 23, 22, 0, 'road');
      b.wall(19, 18, 23, 18); b.door(16, 18, 18, 18, 3.4);
      b.wall(16, 21, 20, 21); b.door(21, 21, 23, 21, 3.4);
      // 掩体：A 点
      b.objs('X', [[31, 6], [32, 6], [36, 3]]);
      b.objs('x', [[30, 6], [35, 4], [36, 4], [33, 10]]);
      b.objs('h', [[28, 9], [29, 9]]);
      b.objs('o', [[28, 3], [37, 10]]);
      // A 大道
      b.objs('X', [[36, 17], [31, 27]]);
      b.objs('x', [[33, 20], [32, 27], [36, 26]]);
      b.objs('h', [[34, 29], [35, 29]]);
      b.objs('o', [[37, 20], [37, 15], [28, 29]]);
      // 中路 / A 小
      b.objs('X', [[22, 29]]);
      b.objs('x', [[21, 23], [17, 13], [16, 27], [28, 15]]);
      // B 点
      b.objs('X', [[5, 4], [6, 4], [9, 8]]);
      b.objs('x', [[7, 4], [9, 9], [11, 7]]);
      b.objs('h', [[3, 9], [4, 9]]);
      b.objs('o', [[11, 2], [2, 7]]);
      // 地道与出生点
      b.objs('o', [[4, 25], [7, 29], [13, 38]]);
      b.objs('x', [[7, 16], [10, 33], [14, 33], [16, 7]]);
      b.objs('X', [[25, 33], [23, 2]]);

      b.site('A', 29, 3, 36, 9);
      b.site('B', 3, 3, 10, 9);
      b.spawn('T', [[15, 36], [17, 36], [19, 36], [21, 36], [23, 36], [16, 37], [18, 37], [20, 37], [22, 37], [24, 37]], 0);
      b.spawn('CT', [[16, 3], [18, 3], [20, 3], [22, 3], [17, 4], [19, 4], [21, 4], [23, 4], [18, 5], [22, 5]], Math.PI);
      b.buyzone('T', 13, 31, 30, 38);
      b.buyzone('CT', 14, 2, 26, 8);
    },
  },

  depot: {
    name: '仓库', desc: '工业仓库与集装箱，中央大仓库连通两点', theme: 'industrial',
    w: 34, h: 34, cell: 2, wallH: 6,
    floorMat: 'concrete', wallMat: 'concrete_wall', crateMat: 'crate', lowMat: 'barrier', roofMat: 'metal',
    build(b) {
      b.floor(12, 1, 21, 5, 0, 'concrete');          // CT 出生点
      b.floor(12, 28, 21, 32, 0, 'asphalt');         // T 出生点
      b.floor(23, 7, 31, 16, 0, 'site_i');           // A 点
      b.floor(2, 7, 10, 16, 2, 'site_i');            // B 点（装卸平台）
      // 中央仓库
      b.floor(13, 10, 20, 22, 0, 'metalfloor');
      b.roof(13, 10, 20, 22, 5.0, 'metal');
      b.floor(15, 6, 18, 8, 0, 'concrete'); b.floor(16, 9, 17, 9, 0, 'concrete'); b.door(16, 9, 17, 9, 3.5);
      b.floor(15, 24, 18, 27, 0, 'asphalt'); b.floor(16, 23, 17, 23, 0, 'asphalt'); b.door(16, 23, 17, 23, 3.5);
      b.floor(7, 19, 12, 20, 0, 'concrete'); b.door(12, 19, 12, 20, 3.2);
      b.floor(21, 11, 22, 12, 0, 'concrete'); b.door(21, 11, 21, 12, 3.2);
      // 仓库中间的错位隔墙：北门洞在东、南门洞在西，各 3 格宽
      b.wall(13, 15, 17, 15, 'metalwall', 4.2); b.wall(16, 17, 20, 17, 'metalwall', 4.2);
      // A 路线
      b.floor(22, 25, 31, 29, 0, 'asphalt');
      b.floor(27, 17, 31, 24, 0, 'asphalt');
      b.wall(27, 23, 29, 23); b.wall(29, 21, 31, 21);
      b.floor(22, 2, 26, 6, 0, 'concrete');
      // B 路线
      b.floor(2, 25, 11, 29, 0, 'asphalt');
      b.floor(2, 19, 6, 24, 0, 'asphalt');
      b.wall(2, 23, 4, 23); b.wall(4, 21, 6, 21);
      b.ramp(2, 17, 6, 18, 'z', 1, 0, 'concrete');
      b.floor(5, 2, 11, 4, 0, 'concrete');
      b.ramp(5, 5, 11, 6, 'z', 0, 1, 'concrete');
      b.wallMat(12, 9, 21, 23, 'metalwall');
      // 集装箱
      b.wall(25, 9, 26, 11, 'container_r', 2.6);
      b.wall(29, 12, 30, 13, 'container_b', 2.6);
      b.wall(3, 10, 4, 12, 'container_g', 3.4);
      b.wall(28, 26, 30, 27, 'container_b', 2.6);
      b.wall(5, 26, 7, 27, 'container_r', 2.6);
      // 仓库内
      b.objs('X', [[14, 12], [19, 20], [14, 19]]);
      b.objs('x', [[18, 12], [15, 20]]);
      b.objs('o', [[13, 10], [20, 22]]);
      // A 点
      b.objs('x', [[27, 9], [24, 14], [30, 8]]);
      b.objs('X', [[28, 14]]);
      b.objs('h', [[24, 14], [25, 14]]);
      // B 点
      b.objs('x', [[7, 9], [8, 13]]);
      b.objs('X', [[8, 12]]);
      b.objs('h', [[5, 15], [6, 15]]);
      // 路上
      b.objs('o', [[27, 19], [31, 24], [2, 19], [6, 24]]);
      b.objs('x', [[24, 27], [9, 27], [13, 2], [20, 4], [12, 31]]);
      b.objs('X', [[21, 32]]);

      b.site('A', 24, 8, 30, 15);
      b.site('B', 3, 8, 9, 15);
      b.spawn('T', [[13, 30], [15, 30], [17, 30], [19, 30], [14, 31], [16, 31], [18, 31], [20, 31], [13, 32], [19, 32]], 0);
      b.spawn('CT', [[14, 2], [16, 2], [18, 2], [15, 3], [17, 3], [19, 3], [14, 4], [16, 4], [18, 4], [20, 2]], Math.PI);
      b.buyzone('T', 12, 27, 21, 32);
      b.buyzone('CT', 12, 1, 21, 5);
    },
  },

  arena: {
    name: '竞技场', desc: '对称小地图，适合死斗、练枪与 1v1', theme: 'dev',
    w: 26, h: 26, cell: 2, wallH: 5,
    floorMat: 'dev_floor', wallMat: 'dev_wall', crateMat: 'dev_crate', lowMat: 'dev_low', roofMat: 'dev_wall',
    build(b) {
      b.floor(1, 1, 24, 24, 0, 'dev_floor');
      b.wall(12, 9, 13, 16, 'dev_wall');
      b.wall(11, 4, 11, 8, 'dev_wall'); b.wall(14, 1, 14, 5, 'dev_wall');
      b.wall(11, 17, 11, 21, 'dev_wall'); b.wall(14, 20, 14, 24, 'dev_wall');
      // 出生区挡墙与柱子
      b.wall(4, 7, 4, 18, 'dev_wall'); b.wall(21, 7, 21, 18, 'dev_wall');
      b.wall(7, 6, 8, 7, 'dev_wall'); b.wall(17, 6, 18, 7, 'dev_wall');
      b.wall(7, 18, 8, 19, 'dev_wall'); b.wall(17, 18, 18, 19, 'dev_wall');
      b.objs('h', [[8, 11], [8, 12], [8, 13], [8, 14], [15, 11], [15, 14]]);
      b.objs('x', [[6, 3], [9, 9], [9, 16], [6, 22], [20, 5], [20, 20], [19, 2], [19, 23]]);
      b.objs('X', [[3, 3], [3, 22], [22, 2], [22, 23], [16, 5], [16, 20]]);
      b.site('A', 15, 1, 20, 5);
      b.site('B', 15, 20, 20, 24);
      b.spawn('T', [[1, 9], [1, 11], [1, 13], [1, 15], [2, 10], [2, 12], [2, 14], [2, 16], [1, 17], [1, 8]], -Math.PI / 2);
      b.spawn('CT', [[24, 9], [24, 11], [24, 13], [24, 15], [23, 10], [23, 12], [23, 14], [23, 16], [24, 17], [24, 8]], Math.PI / 2);
      b.buyzone('T', 1, 7, 4, 18);
      b.buyzone('CT', 21, 7, 24, 18);
    },
  },
};

export const MAP_LIST = Object.entries(MAPS).filter(([, m]) => !m.hidden).map(([id, m]) => ({ id, name: m.name, desc: m.desc }));
