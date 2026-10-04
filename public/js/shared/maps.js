// 地图：用"挖掘式"构建器描述（默认全是墙，再挖出地面/坡道/掩体），生成地面（高度场）、碰撞盒、出生点、包点和寻路网格
import { World } from './physics.js';
import { Nav } from './nav.js';
import { Terrain, buildHeights } from './terrain.js';
import { LEVEL_H, P } from './constants.js';
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
    this.level = new Float32Array(n);          // 地面高度级（可以是小数）；一级多高看地图的 levelH（默认 0.4 米）
    this.fmat = new Array(n).fill(def.floorMat);
    this.wmat = new Array(n).fill(def.wallMat);
    this.wh = new Float32Array(n);             // 墙 / 箱子的顶有多高（米，0 = 用默认墙高）
    this.boxLv = new Float32Array(n).fill(NaN); // 字符图里的箱子：顶部高度级（建图时再按旁边的地面折算成米）
    this.hardC = new Uint8Array(n);            // 硬边的格子：顶是平的，不和旁边的格子连成坡
    this.hide = new Uint8Array(n);             // 不画地面的格子（上面画的是台阶）
    this.exp = new Map();                      // 手写的坡：格子 → 4 个角的高度级
    this.flights = [];                         // 楼梯：走起来是斜坡，看起来是一级一级的台阶
    this.roofs = []; this.doors = []; this.extra = []; this.deco = [];
    this.sites = {}; this.spawns = { T: null, CT: null }; this.buy = { T: [], CT: [] };
    this.dummies = [];
    this.blocked = new Set();
    this.bridges = []; this.ladders = [];
  }
  rect(c0, r0, c1, r1, fn) {
    for (let r = Math.max(0, r0); r <= Math.min(this.H - 1, r1); r++)
      for (let c = Math.max(0, c0); c <= Math.min(this.W - 1, c1); c++) fn(r * this.W + c, c, r);
  }
  _ground(i, level, mat) {
    this.type[i] = CELL.FLOOR; this.level[i] = level; this.wh[i] = 0; this.boxLv[i] = NaN;
    this.hardC[i] = 0; this.hide[i] = 0; this.exp.delete(i);
    if (mat) this.fmat[i] = mat;
  }
  floor(c0, r0, c1, r1, level = 0, mat) {
    this.rect(c0, r0, c1, r1, (i) => this._ground(i, level, mat));
  }
  // 平台：和 floor 一样，但边是硬的（不和旁边高一级 / 低一级的地面连成坡，边上是一道坎）
  flat(c0, r0, c1, r1, level = 0, mat) {
    this.rect(c0, r0, c1, r1, (i) => { this._ground(i, level, mat); this.hardC[i] = 1; });
  }
  hard(c0, r0, c1, r1) {
    this.rect(c0, r0, c1, r1, (i) => { if (this.type[i] !== CELL.WALL) this.hardC[i] = 1; });
  }
  // 坡道（按格子给高度级，从 l0 均匀变到 l1）：和两头的地面自动连成一片
  ramp(c0, r0, c1, r1, axis, l0, l1, mat) {
    this.rect(c0, r0, c1, r1, (i, c, r) => {
      const t = axis === 'x' ? (c1 === c0 ? 0 : (c - c0) / (c1 - c0)) : (r1 === r0 ? 0 : (r - r0) / (r1 - r0));
      this._ground(i, l0 + (l1 - l0) * t, mat);
    });
  }
  // 精确的斜面：这块矩形在 axis 方向上从这头（c0 / r0 那条边）的 l0 级均匀升 / 降到那头的 l1 级，两头正好和 l0、l1 级的平地接上
  slope(c0, r0, c1, r1, axis, l0, l1, mat) {
    const n = axis === 'x' ? c1 - c0 + 1 : r1 - r0 + 1;
    this.rect(c0, r0, c1, r1, (i, c, r) => {
      const k = axis === 'x' ? c - c0 : r - r0;
      const a = l0 + ((l1 - l0) * k) / n, b = l0 + ((l1 - l0) * (k + 1)) / n;
      this._ground(i, (a + b) / 2, mat);
      this.exp.set(i, axis === 'x' ? [a, b, a, b] : [a, a, b, b]);
    });
  }
  // 楼梯：碰撞和 slope 一样是斜面（走起来不颠），外观是一级一级的台阶
  stairs(c0, r0, c1, r1, axis, l0, l1, mat, stepMat) {
    this.slope(c0, r0, c1, r1, axis, l0, l1, mat);
    this.rect(c0, r0, c1, r1, (i) => { this.hide[i] = 1; });
    this.flights.push({ c0, r0, c1, r1, axis, l0, l1, mat: stepMat || mat });
  }
  wall(c0, r0, c1, r1, mat, h) {
    this.rect(c0, r0, c1, r1, (i) => { this.type[i] = CELL.WALL; this.wmat[i] = mat || this.def.wallMat; this.wh[i] = h || 0; this.boxLv[i] = NaN; });
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
  door(c0, r0, c1, r1, h = 3.2, mat) { this.doors.push({ c0, r0, c1, r1, h, mat }); }
  site(name, c0, r0, c1, r1) { this.sites[name] = { c0, r0, c1, r1 }; }
  spawn(team, cells, yaw) { this.spawns[team] = { cells, yaw }; }
  buyzone(team, c0, r0, c1, r1) { this.buy[team].push({ c0, r0, c1, r1 }); }
  _box(i, lv, mat) { this.type[i] = CELL.WALL; this.wh[i] = 1; this.boxLv[i] = lv; this.wmat[i] = mat; }
  // 按字符图建图：# 墙；a-z 地面高度级（太高的当障碍物）；A-Z 箱子（字母为顶部高度级）
  ascii(rows, boxMat = 'crate') {
    rows.forEach((row, r) => {
      for (let c = 0; c < row.length && c < this.W; c++) {
        const ch = row[c], i = r * this.W + c;
        if (ch === '#') continue;
        if (ch >= 'a' && ch <= 'z') {
          const lv = ch.charCodeAt(0) - 97;
          if (lv >= 9) { this._box(i, lv + 2, boxMat); continue; }
          this.type[i] = CELL.FLOOR;
          this.level[i] = lv;
        } else this._box(i, ch.charCodeAt(0) - 65, boxMat);
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
        this._box(i, ch.charCodeAt(0) - 65, boxMat);
      }
    });
  }
  // 去掉单格的细脊 / 小坑（雷达图描边留下的杂点）：比左右或上下两边都高（低）min 级以上的格子，拉平到四周的平均高度
  despeckle(passes = 2, min = 2) {
    const { W, H } = this;
    const fl = (i) => this.type[i] === CELL.FLOOR;
    for (let p = 0; p < passes; p++) {
      for (let r = 1; r < H - 1; r++) for (let c = 1; c < W - 1; c++) {
        const i = r * W + c;
        if (!fl(i)) continue;
        const lv = this.level[i], L = i - 1, R = i + 1, U = i - W, D = i + W;
        const ridge = (a, b) => fl(a) && fl(b) && (lv - Math.max(this.level[a], this.level[b]) >= min || Math.min(this.level[a], this.level[b]) - lv >= min);
        if (!ridge(L, R) && !ridge(U, D)) continue;
        let sum = 0, n = 0;
        for (const j of [L, R, U, D]) if (fl(j)) { sum += this.level[j]; n++; }
        this.level[i] = Math.round(sum / n);
      }
    }
  }
  // 中值滤波：每格地面取周围 (2r+1)² 范围里「和它差不到 3 级」的地面的中位数。毛边、零星的高低被抹平；整片的坡（楼梯）和断崖不受影响
  median(r = 2, passes = 1) {
    const { W, H } = this, buf = [];
    for (let p = 0; p < passes; p++) {
      const out = Float32Array.from(this.level);
      for (let rr = 0; rr < H; rr++) for (let c = 0; c < W; c++) {
        const i = rr * W + c;
        if (this.type[i] !== CELL.FLOOR) continue;
        const lv = this.level[i];
        buf.length = 0;
        for (let dr = -r; dr <= r; dr++) for (let dc = -r; dc <= r; dc++) {
          const c2 = c + dc, r2 = rr + dr;
          if (c2 < 0 || r2 < 0 || c2 >= W || r2 >= H) continue;
          const j = r2 * W + c2;
          if (this.type[j] === CELL.FLOOR && Math.abs(this.level[j] - lv) < 3) buf.push(this.level[j]);
        }
        buf.sort((a, b) => a - b);
        out[i] = buf[buf.length >> 1];
      }
      this.level.set(out);
    }
  }
  // 把一块地面整平：这一块里和中位高度差不超过 tol 级的地面，都拉到中位高度（包点这种本来就该是平的地方）
  flatten(c0, r0, c1, r1, tol = 1) {
    const lv = [];
    this.rect(c0, r0, c1, r1, (i) => { if (this.type[i] === CELL.FLOOR) lv.push(this.level[i]); });
    if (!lv.length) return;
    lv.sort((a, b) => a - b);
    const m = lv[lv.length >> 1], W = this.W;
    // 挨着更高 / 更低的坡的格子不动（不然会把本来连着的坡切出一道坎）
    const todo = [];
    this.rect(c0, r0, c1, r1, (i) => {
      if (this.type[i] !== CELL.FLOOR || this.level[i] === m || Math.abs(this.level[i] - m) > tol) return;
      for (const j of [i + 1, i - 1, i + W, i - W]) if (this.type[j] === CELL.FLOOR && Math.abs(this.level[j] - m) > 1 && Math.abs(this.level[j] - this.level[i]) <= 1) return;
      todo.push(i);
    });
    for (const i of todo) this.level[i] = m;
  }
  // 去掉小块的鼓包 / 小坑（雷达图的杂点）：一小片同样高度的地面，四周的地面全都比它高（或者全都比它低），就把它拉到四周最接近的高度。
  // 楼梯的每一级都是「一边高一边低」，不会被动到
  denoise(maxCells = 30, passes = 3) {
    const { W, H } = this, n = W * H;
    const fl = (i) => this.type[i] === CELL.FLOOR;
    for (let p = 0; p < passes; p++) {
      const seen = new Uint8Array(n);
      let changed = 0;
      for (let i0 = 0; i0 < n; i0++) {
        if (seen[i0] || !fl(i0)) continue;
        const lv = this.level[i0], comp = [i0];
        let up = Infinity, down = -Infinity;
        seen[i0] = 1;
        for (let k = 0; k < comp.length; k++) {
          const i = comp[k], c = i % W;
          for (const j of [c + 1 < W ? i + 1 : -1, c > 0 ? i - 1 : -1, i + W < n ? i + W : -1, i >= W ? i - W : -1]) {
            if (j < 0 || !fl(j)) continue;
            const l2 = this.level[j];
            if (l2 === lv) { if (!seen[j]) { seen[j] = 1; comp.push(j); } }
            else if (l2 > lv) up = Math.min(up, l2);
            else down = Math.max(down, l2);
          }
        }
        if (comp.length > maxCells) continue;
        const to = up < Infinity && down === -Infinity ? up : down > -Infinity && up === Infinity ? down : null;
        if (to == null || Math.abs(to - lv) > 2) continue;
        for (const i of comp) this.level[i] = to;
        changed++;
      }
      if (!changed) break;
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
        this.boxLv[i] = NaN;
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
  // 自由尺寸的长方体（米）：挡人、挡子弹
  box(x0, y0, z0, x1, y1, z1, mat, kind = 'wall') { this.extra.push({ min: [x0, y0, z0], max: [x1, y1, z1], mat, kind }); }
  // 只画不挡人的长方体（门上的铁箍、门环这些小零碎）
  decor(x0, y0, z0, x1, y1, z1, mat) { this.deco.push({ min: [x0, y0, z0], max: [x1, y1, z1], mat }); }
  // 一扇大木门：一块挡人的厚木板，加上四周的边框、三道铁箍、铆钉和门环（这些只是画出来的）。
  // axis = 'x'：门扇沿 x 方向摆（厚度在 z 方向），a0~a1 是门扇的两头，p 是门扇中心线的位置；axis = 'z' 反过来。y0~y1 是门的下沿和上沿
  leaf(axis, a0, a1, p, y0, y1, o = {}) {
    const th = o.th || 0.11, mat = o.mat || 'door';
    const put = (fn, u0, u1, v0, v1, d0, d1, m) => {
      // u：沿门扇方向；v：高度；d：厚度方向（相对 p）
      const mn = axis === 'x' ? [u0, v0, p + d0] : [p + d0, v0, u0], mx = axis === 'x' ? [u1, v1, p + d1] : [p + d1, v1, u1];
      fn.call(this, mn[0], mn[1], mn[2], mx[0], mx[1], mx[2], m);
    };
    put(this.box, a0, a1, y0, y1, -th / 2, th / 2, mat);
    const e = th / 2 + 0.035, fw = 0.14;
    for (const sgn of [-1, 1]) {
      const d0 = sgn < 0 ? -e : th / 2, d1 = sgn < 0 ? -th / 2 : e;
      // 边框
      put(this.decor, a0, a1, y1 - fw, y1, d0, d1, 'darkwood'); put(this.decor, a0, a1, y0, y0 + fw, d0, d1, 'darkwood');
      put(this.decor, a0, a0 + fw, y0 + fw, y1 - fw, d0, d1, 'darkwood'); put(this.decor, a1 - fw, a1, y0 + fw, y1 - fw, d0, d1, 'darkwood');
      // 铁箍 + 铆钉
      const d2 = sgn < 0 ? -e - 0.012 : th / 2, d3 = sgn < 0 ? -th / 2 : e + 0.012, d4 = sgn < 0 ? -e - 0.04 : e, d5 = sgn < 0 ? -e : e + 0.04;
      for (const f of [0.14, 0.5, 0.86]) {
        const yb = y0 + (y1 - y0) * f;
        put(this.decor, a0, a1, yb - 0.07, yb + 0.07, d2, d3, 'iron');
        for (let u = a0 + 0.22; u < a1 - 0.1; u += 0.42) put(this.decor, u - 0.035, u + 0.035, yb - 0.035, yb + 0.035, d4, d5, 'iron');
      }
      // 门环（靠着开合的那一头）
      const hu = o.hinge === 'a1' ? a0 + 0.3 : a1 - 0.3, hy = y0 + 1.1;
      put(this.decor, hu - 0.07, hu + 0.07, hy - 0.11, hy + 0.11, sgn < 0 ? -e - 0.06 : e, sgn < 0 ? -e : e + 0.06, 'iron');
    }
  }
  // 给临街的墙面挂上窗户（关着的百叶窗 + 石窗台）和几扇关着的木门：纯装饰，贴在墙面上，不挡人。
  // 只挂在「挨着地面的高墙」上；every：大约隔几格挂一个；rows：挂几层
  facade(o = {}) {
    const { W, H, S } = this, LH = this.def.levelH || LEVEL_H, every = o.every || 4;
    const mats = o.mats || ['shutter', 'shutter', 'shutter_b'];
    const isWall = (c, r) => c >= 0 && r >= 0 && c < W && r < H && this.type[r * W + c] === CELL.WALL && !this.wh[r * W + c];
    const rnd = (c, r, k) => { const v = Math.sin(c * 127.1 + r * 311.7 + k * 74.7) * 43758.5453; return v - Math.floor(v); };
    for (let r = 1; r < H - 1; r++) for (let c = 1; c < W - 1; c++) {
      if (!isWall(c, r)) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = (r + dz) * W + c + dx;
        if (this.type[j] !== CELL.FLOOR || this.exp.has(j)) continue;
        // 这面墙要够宽（左右两格也是同一面墙），而且按位置隔几格挑一个
        const tx = dz ? 1 : 0, tz = dx ? 1 : 0;
        if (!isWall(c + tx, r + tz) || !isWall(c - tx, r - tz)) continue;
        if (this.type[(r + dz + tz) * W + c + dx + tx] !== CELL.FLOOR || this.type[(r + dz - tz) * W + c + dx - tx] !== CELL.FLOOR) continue;
        const along = dz ? c : r;
        if ((along + Math.floor(rnd(dz ? r : c, 0, 1) * every)) % every !== 0) continue;
        const gy = this.level[j] * LH, px = (c + 0.5 + dx * 0.5) * S, pz = (r + 0.5 + dz * 0.5) * S; // 墙面的中点
        const put = (y0, y1, half, out, mat, uv) => {
          const mn = dx ? [Math.min(px, px + dx * out), y0, pz - half] : [px - half, y0, Math.min(pz, pz + dz * out)];
          const mx = dx ? [Math.max(px, px + dx * out), y1, pz + half] : [px + half, y1, Math.max(pz, pz + dz * out)];
          this.deco.push({ min: mn, max: mx, mat, uv });
        };
        const door = rnd(c, r, 2) < (o.doors ?? 0.16);
        if (door) put(gy, gy + 2.25, 0.62, 0.05, 'housedoor', 'box');
        for (let k = door ? 1 : 0; k < (o.rows || 2); k++) {
          const y0 = gy + (k === 0 ? 1.15 : 3.75) + (door ? 0 : 0);
          if (k === 0 && door) continue;
          const mat = mats[Math.floor(rnd(c, r, 3 + k) * mats.length)];
          put(y0, y0 + 1.35, 0.52, 0.05, mat, 'box');
          put(y0 - 0.1, y0, 0.62, 0.13, 'stone');
        }
      }
    }
  }
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

// 一维滑动窗口取最大值（半宽 R 格）
function maxFilter(src, dst, n, stride, count, R) {
  for (let line = 0; line < count; line++) {
    const base = stride === 1 ? line * n : line;
    for (let k = 0; k < n; k++) {
      let m = -Infinity;
      for (let j = Math.max(0, k - R); j <= Math.min(n - 1, k + R); j++) { const v = src[base + j * stride]; if (v > m) m = v; }
      dst[base + k * stride] = m;
    }
  }
}

export function buildMap(id) {
  const def = MAPS[id];
  if (!def) throw new Error('未知地图 ' + id);
  const B = new Builder(def);
  def.build(B);
  const { W, H, S } = B, n = W * H;
  const LH = def.levelH || LEVEL_H;
  const wallH = def.wallH || 6;
  const boxes = [];

  // ---------- 地面（高度场）----------
  const ground = new Uint8Array(n);
  for (let i = 0; i < n; i++) ground[i] = B.type[i] !== CELL.WALL ? 1 : 0;
  const y4 = buildHeights(W, H, ground, B.level, B.hardC, B.exp, LH, def.rampHalf || 0);
  const mats = [], matIdx = new Map(), cellMat = new Uint8Array(n);
  const gy = new Float32Array(n), gLo = new Float32Array(n), gHi = new Float32Array(n).fill(-Infinity);
  for (let i = 0; i < n; i++) {
    if (!ground[i]) continue;
    let k = matIdx.get(B.fmat[i]);
    if (k == null) { k = mats.length; mats.push(B.fmat[i]); matIdx.set(B.fmat[i], k); }
    cellMat[i] = k;
    const o = i * 4;
    gy[i] = (y4[o] + y4[o + 1] + y4[o + 2] + y4[o + 3]) / 4;
    gLo[i] = Math.min(y4[o], y4[o + 1], y4[o + 2], y4[o + 3]);
    gHi[i] = Math.max(y4[o], y4[o + 1], y4[o + 2], y4[o + 3]);
  }
  // 走不到、也跳不上去的高台（雷达图里把屋顶也当成了地面）：改成实心的墙
  {
    const mvOf = (i, j, side) => { // 能不能从 i 迈到相邻的 j（side：0 右 1 左 2 下 3 上），和后面寻路用的是同一条规矩
      const o = i * 4, p = j * 4;
      const a = side === 0 ? [y4[o + 1], y4[o + 3]] : side === 1 ? [y4[o], y4[o + 2]] : side === 2 ? [y4[o + 2], y4[o + 3]] : [y4[o], y4[o + 1]];
      const b2 = side === 0 ? [y4[p], y4[p + 2]] : side === 1 ? [y4[p + 1], y4[p + 3]] : side === 2 ? [y4[p], y4[p + 1]] : [y4[p + 2], y4[p + 3]];
      return Math.max(b2[0] - a[0], b2[1] - a[1]);
    };
    const reach = new Uint8Array(n), q = [];
    for (const team of ['T', 'CT']) for (const [c, r] of (B.spawns[team] ? B.spawns[team].cells : [])) { const i = r * W + c; if (ground[i] && !reach[i]) { reach[i] = 1; q.push(i); } }
    const JUMP = 1.9; // 蹲跳够得着的高度
    for (let k = 0; k < q.length; k++) {
      const i = q[k], c = i % W, r = (i / W) | 0;
      const go = (j, side) => { if (ground[j] && !reach[j] && mvOf(i, j, side) <= JUMP) { reach[j] = 1; q.push(j); } };
      if (c + 1 < W) go(i + 1, 0);
      if (c > 0) go(i - 1, 1);
      if (r + 1 < H) go(i + W, 2);
      if (r > 0) go(i - W, 3);
    }
    if (q.length) for (let i = 0; i < n; i++) {
      if (!ground[i] || reach[i] || B.type[i] !== CELL.FLOOR) continue;
      // 楼板底下的通道、梯子通着的地方不算
      ground[i] = 0; B.type[i] = CELL.WALL; B.wh[i] = 0; B.wmat[i] = def.wallMat; gHi[i] = -Infinity;
    }
  }
  const hf = new Terrain(W, H, S, y4, ground, cellMat, mats);
  hf.hide = B.hide;
  const rectHi = (c0, r0, c1, r1) => { let m = -Infinity; B.rect(c0, r0, c1, r1, (i) => { if (ground[i] && gHi[i] > m) m = gHi[i]; }); return m === -Infinity ? 0 : m; };

  // ---------- 墙有多高 ----------
  // 给了 wallAbove：墙顶 = 附近最高的地面 + wallAbove（地势高的地方墙跟着高，洼地里的墙矮），再按街区加一点高低变化；没给就全图一样高
  const wtop = new Float32Array(n).fill(wallH);
  if (def.wallAbove) {
    const R = Math.max(1, Math.round((def.wallR || 7) / S)), tmp = new Float32Array(n), near = new Float32Array(n);
    maxFilter(gHi, tmp, W, 1, H, R);
    maxFilter(tmp, near, H, W, W, R);
    // 离地面太远的墙（一大片实心的中间）：从边上一圈一圈往里填
    let q = [];
    for (let i = 0; i < n; i++) if (near[i] > -Infinity) q.push(i);
    while (q.length) {
      const nq = [];
      for (const i of q) {
        const c = i % W, r = (i / W) | 0;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const cc = c + dc, rr = r + dr, j = rr * W + cc;
          if (cc < 0 || rr < 0 || cc >= W || rr >= H || near[j] > -Infinity) continue;
          near[j] = near[i]; nq.push(j);
        }
      }
      q = nq;
    }
    const blk = (def.wallBlock || 12) / S, vary = def.wallVar || 0;
    for (let i = 0; i < n; i++) {
      const c = i % W, r = (i / W) | 0;
      const hsh = Math.abs(Math.sin(Math.floor(c / blk) * 127.1 + Math.floor(r / blk) * 311.7) * 43758.5453) % 1;
      wtop[i] = Math.ceil((near[i] + def.wallAbove) * 2) / 2 + Math.round(hsh * vary * 2) / 2;
    }
  }
  // 字符图里的箱子（大写字母）：字母级比旁边的地面高的，顶 = 旁边最高的地面 + 每级 0.4 米；不比旁边的地面高的，是和高处地面差不多齐平的台子
  const wh = B.wh, boxLo = new Float32Array(n).fill(Infinity);
  {
    const ref = new Array(n), q = [];
    for (let i = 0; i < n; i++) {
      if (!(B.boxLv[i] === B.boxLv[i])) continue;
      const c = i % W, r = (i / W) | 0;
      let lvMax = -Infinity, hi = -Infinity, lo = Infinity;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const cc = c + dc, rr = r + dr, j = rr * W + cc;
        if (cc < 0 || rr < 0 || cc >= W || rr >= H || !ground[j]) continue;
        if (B.level[j] > lvMax) lvMax = B.level[j];
        if (gHi[j] > hi) hi = gHi[j];
        if (gLo[j] < lo) lo = gLo[j];
      }
      if (lvMax > -Infinity) { ref[i] = { lvMax, hi, lo }; q.push(i); }
    }
    // 箱子堆（包括手摆的）下面的地面有多高：画的时候从这里往上一层一层码
    for (let i = 0; i < n; i++) {
      if (B.type[i] !== CELL.WALL || !wh[i] || B.wmat[i] !== def.crateMat) continue;
      if (ref[i]) { boxLo[i] = ref[i].lo; continue; }
      const c = i % W, r = (i / W) | 0;
      let lo = Infinity;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const cc = c + dc, rr = r + dr, j = rr * W + cc;
        if (cc >= 0 && rr >= 0 && cc < W && rr < H && ground[j] && gLo[j] < lo) lo = gLo[j];
      }
      boxLo[i] = lo;
    }
    for (let k = 0; k < q.length; k++) {
      const i = q[k], c = i % W, r = (i / W) | 0;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const cc = c + dc, rr = r + dr, j = rr * W + cc;
        if (cc < 0 || rr < 0 || cc >= W || rr >= H || ref[j] || !(B.boxLv[j] === B.boxLv[j])) continue;
        ref[j] = ref[i]; q.push(j);
      }
    }
    for (let i = 0; i < n; i++) {
      const t = B.boxLv[i];
      if (!(t === t)) continue;
      const f = ref[i];
      if (!f) { wh[i] = Math.max(1, t * LH); continue; }
      const top = t <= f.lvMax ? t * LH : f.hi + (t - f.lvMax) * LEVEL_H;
      wh[i] = Math.round(Math.max(top, f.lo + 1.0) * 20) / 20;
    }
  }
  // 墙；箱子堆（材质是箱子的矮墙）单独标出来，画的时候切成一个一个的箱子
  greedy(W, H, (i) => (B.type[i] === CELL.WALL ? B.wmat[i] + '|' + (wh[i] || wtop[i]) : null), (c0, r0, c1, r1, k) => {
    const [mat, h] = k.split('|');
    const bx = { min: [c0 * S, -1, r0 * S], max: [(c1 + 1) * S, +h, (r1 + 1) * S], mat, kind: 'wall' };
    if (mat === def.crateMat && wh[r0 * W + c0]) {
      let base = Infinity;
      B.rect(c0, r0, c1, r1, (i) => { if (boxLo[i] < base) base = boxLo[i]; });
      if (base < Infinity) { bx.kind = 'crates'; bx.base = base; }
    }
    boxes.push(bx);
  });
  // 矮墙 / 沙袋
  greedy(W, H, (i) => (B.type[i] === CELL.LOW ? gLo[i].toFixed(2) + '|' + gy[i].toFixed(2) : null), (c0, r0, c1, r1, k) => {
    const [lo, mid] = k.split('|');
    boxes.push({ min: [c0 * S, +lo, r0 * S], max: [(c1 + 1) * S, +mid + 1.05, (r1 + 1) * S], mat: def.lowMat, kind: 'low' });
  });
  // 箱子、油桶
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const i = r * W + c, t = B.type[i];
      if (t === CELL.CRATE || t === CELL.CRATE2) {
        const m = (S - 1.7) / 2;
        boxes.push({ min: [c * S + m, gLo[i], r * S + m], max: [(c + 1) * S - m, gy[i] + (t === CELL.CRATE ? 1.1 : 2.2), (r + 1) * S - m], mat: def.crateMat, kind: t === CELL.CRATE ? 'crate' : 'crate2' });
      } else if (t === CELL.BARREL) {
        const m = (S - 0.8) / 2;
        boxes.push({ min: [c * S + m, gLo[i], r * S + m], max: [(c + 1) * S - m, gy[i] + 1.0, (r + 1) * S - m], mat: 'barrel', kind: 'barrel' });
      }
    }
  }
  // 屋顶（地道）
  for (const rf of B.roofs) {
    const y = rectHi(rf.c0, rf.r0, rf.c1, rf.r1) + rf.h;
    boxes.push({ min: [rf.c0 * S, y, rf.r0 * S], max: [(rf.c1 + 1) * S, y + 0.4, (rf.r1 + 1) * S], mat: rf.mat || def.roofMat, kind: 'roof' });
  }
  // 门梁
  for (const d of B.doors) {
    const y = rectHi(d.c0, d.r0, d.c1, d.r1) + d.h;
    let top = 0;
    B.rect(d.c0, d.r0, d.c1, d.r1, (i) => { top = Math.max(top, wtop[i]); });
    if (top > y + 0.05) boxes.push({ min: [d.c0 * S, y, d.r0 * S], max: [(d.c1 + 1) * S, top, (d.r1 + 1) * S], mat: d.mat || def.wallMat, kind: 'wall' });
  }
  for (const e of B.extra) boxes.push(e);
  for (let i = 0; i < n; i++) if (wh[i]) wtop[i] = wh[i]; // 每格墙 / 箱子顶的高度（画坎的侧面要用）
  // 楼板（桥）：按格子合并成几块板，洞口不盖；寻路时这些格子按楼板上面的高度算
  const navY = gy.slice(), bridged = new Uint8Array(n);
  for (const br of B.bridges) {
    const inHole = (c, r) => br.holes.some(([a0, b0, a1, b1]) => c >= a0 && c <= a1 && r >= b0 && r <= b1);
    const cover = (i) => {
      const c = i % W, r = (i / W) | 0;
      return c >= br.c0 && c <= br.c1 && r >= br.r0 && r <= br.r1 && !inHole(c, r) ? 1 : null;
    };
    const top = br.level * LH;
    greedy(W, H, cover, (c0, r0, c1, r1) => {
      boxes.push({ min: [c0 * S, top - 0.35, r0 * S], max: [(c1 + 1) * S, top, (r1 + 1) * S], mat: br.mat || def.floorMat, kind: 'roof' });
    });
    B.rect(br.c0, br.r0, br.c1, br.r1, (i, c, r) => { if (!inHole(c, r)) { navY[i] = top; bridged[i] = 1; } });
  }
  // 梯子：碰撞范围给物理用；外观（两根竖杆 + 横档）单独画，不挡人
  const ladders = [], decos = B.deco.slice();
  for (const l of B.ladders) {
    const x0 = l.c0 * S, x1 = (l.c1 + 1) * S, z0 = l.r0 * S, z1 = (l.r1 + 1) * S, y0 = l.lv0 * LH, y1 = l.lv1 * LH;
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
  // 楼梯的台阶（只是外观）：台阶的棱正好贴着走路的那个斜面，所以脚不会陷进台阶里
  for (const f of B.flights) {
    const ax = f.axis === 'x', a0 = (ax ? f.c0 : f.r0) * S, a1 = (ax ? f.c1 + 1 : f.r1 + 1) * S;
    const b0 = (ax ? f.r0 : f.c0) * S, b1 = (ax ? f.r1 + 1 : f.c1 + 1) * S;
    const ya = f.l0 * LH, yb = f.l1 * LH, rise = Math.abs(yb - ya);
    const steps = Math.max(1, Math.round(rise / 0.19)), up = yb > ya, lowY = Math.min(ya, yb);
    for (let k = 0; k < steps; k++) {
      // 从低的那头数第 k 级：顶面比斜面在这一级前沿（低的那一边）的高度一样高
      const p0 = up ? a0 + ((a1 - a0) * k) / steps : a1 - ((a1 - a0) * (k + 1)) / steps;
      const p1 = up ? a0 + ((a1 - a0) * (k + 1)) / steps : a1 - ((a1 - a0) * k) / steps;
      const top = lowY + (rise * k) / steps;
      if (k === 0) continue; // 最低的一级和下面的地面一样平，不用画
      const mn = ax ? [p0, lowY - 0.3, b0] : [b0, lowY - 0.3, p0], mx = ax ? [p1, top, b1] : [b1, top, p1];
      decos.push({ min: mn, max: mx, mat: f.mat || def.floorMat, kind: 'step' });
    }
  }

  const world = new World(boxes, hf);
  world.ladders = ladders;

  const cellPos = (c, r) => {
    const i = r * W + c;
    return { x: (c + 0.5) * S, y: gy[i] + 0.02, z: (r + 0.5) * S };
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
      cx: ((s.c0 + s.c1 + 1) / 2) * S, cz: ((s.r0 + s.r1 + 1) / 2) * S, y: 0,
      cells: [],
    };
    B.rect(s.c0, s.r0, s.c1, s.r1, (i) => { if (B.type[i] === CELL.FLOOR && !B.blocked.has(i)) sites[name].cells.push(i); });
    // 包点的高度：正中间那格的地面；正中间是箱子就取整块的平均
    const mid = rc * W + cc, cs = sites[name].cells;
    sites[name].y = ground[mid] ? gy[mid] : cs.length ? cs.reduce((a, i) => a + gy[i], 0) / cs.length : 0;
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
      if (ok) dmSpawns.push({ ...cellPos(c, r), y: navY[r * W + c] + 0.02, yaw: 0 });
    }
  }

  const dummies = B.dummies.map((d) => ({ ...cellPos(d.c, d.r), yaw: Math.PI, kind: d.kind, crouch: d.kind === 'crouch', w: d.w * S, walk: d.walk }));

  // ---------- 寻路 ----------
  // 每个格子能不能迈到上下左右四个邻居：连着的坡面随便走；隔着一道坎的，只能往下跳，或者迈上不到一步高的矮坎
  const STEP = P.stepH - 0.03, maxRise = LH * 1.25;
  const edgeH = (i, side, upper) => { // 格子 i 在某条边（0 右 1 左 2 下 3 上）两个端点的高度
    if (upper && bridged[i]) return [navY[i], navY[i]];
    const o = i * 4;
    return side === 0 ? [y4[o + 1], y4[o + 3]] : side === 1 ? [y4[o], y4[o + 2]] : side === 2 ? [y4[o + 2], y4[o + 3]] : [y4[o], y4[o + 1]];
  };
  const movesOf = (upper) => {
    const mv = new Uint8Array(n);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const i = r * W + c;
      if (!ground[i]) continue;
      const tryDir = (j, side, bit) => {
        if (!ground[j]) return;
        const a = edgeH(i, side, upper), b = edgeH(j, side ^ 1, upper);
        if (Math.max(b[0] - a[0], b[1] - a[1]) <= STEP) mv[i] |= bit;
      };
      if (c + 1 < W) tryDir(i + 1, 0, 1);
      if (c > 0) tryDir(i - 1, 1, 2);
      if (r + 1 < H) tryDir(i + W, 2, 4);
      if (r > 0) tryDir(i - W, 3, 8);
    }
    return mv;
  };
  // 小格子地图（半米一格）：人比格子宽，挨着墙 / 箱子的格子不给机器人走，留出人的身位（不然会往人过不去的窄缝里钻）。
  // 挨着「比自己高出一大截的台子」也一样：人上不去，贴着走会被台子边卡住，等于一堵矮墙
  const thin = (walk, ys) => {
    if (S >= 0.8) return;
    const blocks = (i, j) => B.type[j] !== CELL.FLOOR || ys[j] - ys[i] > maxRise;
    const keep = new Uint8Array(n);
    for (let r = 1; r < H - 1; r++) for (let c = 1; c < W - 1; c++) {
      const i = r * W + c;
      if (!walk[i]) continue;
      let ok = 1;
      for (let dr = -1; dr <= 1 && ok; dr++) for (let dc = -1; dc <= 1; dc++) if (blocks(i, i + dr * W + dc)) { ok = 0; break; }
      keep[i] = ok;
    }
    walk.set(keep);
  };
  const walk = new Uint8Array(n);
  for (let i = 0; i < n; i++) walk[i] = B.type[i] === CELL.FLOOR && !B.blocked.has(i) ? 1 : 0;
  thin(walk, navY);
  // 屋顶下的格子也可走；门梁不影响
  const nav = new Nav(W, H, S, walk, navY, movesOf(true), maxRise);
  // 只留「从出生点走得到、也走得回来」的格子：走不到的角落、只能下不能上的坑都不给机器人走，也不会被选成目标
  const seed = spawns.T[0] || spawns.CT[0];
  if (seed) nav.keepMain(nav.nearestWalkable(seed.x, seed.z));
  // 死斗出生点也只用走得出来的地方（免得出生在下不来的屋顶上）
  const okSpawns = dmSpawns.filter((s) => nav.walk[nav.cellOf(s.x, s.z)]);
  if (okSpawns.length >= 12) { dmSpawns.length = 0; dmSpawns.push(...okSpawns); }
  // 楼板下面那一层（地下通道）和只能下不能上的坑：机器人不会主动走进去，但万一掉下去了，要能自己走出来。
  // 这一层单独做一张寻路网格（高度用最底下那层地面），并算好每个格子往「回到主区域」方向的下一步
  if (B.bridges.length) {
    const walk2 = new Uint8Array(n);
    for (let i = 0; i < n; i++) walk2[i] = B.type[i] === CELL.FLOOR ? 1 : 0;
    thin(walk2, gy);
    nav.lower = new Nav(W, H, S, walk2, gy, movesOf(false), maxRise);
    nav.lower.setExits((i) => !!nav.walk[i] && !bridged[i]);
  }

  return {
    id, name: def.name, theme: def.theme, def, W, H, S, wallH, levelH: LH,
    type: B.type, level: B.level, wh, wtop, gy, hf,
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
  // 沙二：Dust II 的布局（1 格 = 1 米，高度每级 0.8 米）
  dust2: {
    name: '沙二', desc: 'Dust II 布局：A 大、A 小（猫道）、中路、中门、B 洞、上下地道', theme: 'desert',
    w: 114, h: 114, cell: 1, wallH: 8, levelH: 0.8, rampHalf: 2, wallAbove: 5.5, wallVar: 2, wallBlock: 13,
    floorMat: 'sand', wallMat: 'plaster', crateMat: 'crate', lowMat: 'sandbag', roofMat: 'roof', cliffMat: 'stone',
    build(b) {
      const Y = (lv) => lv * 0.8;
      b.ascii(decodeRows(DUST2_ROWS));
      b.cleanBoxes();
      b.despeckle(2, 1);
      // 把某一块里的地面统一成一个高度（箱子、墙不动）
      const level = (c0, r0, c1, r1, lv) => b.rect(c0, r0, c1, r1, (i) => { if (b.type[i] === CELL.FLOOR) b.level[i] = lv; });

      // ---- T 出生点：高台，清掉雷达图上的杂点 ----
      b.floor(17, 87, 20, 87, 7);

      // ---- CT 出生点：全图最低的洼地（一个大坑），往东是上 A 点的大坡，往西南上去是中门，往西是去 B 点的路 ----
      level(69, 11, 93, 20, 5); level(89, 23, 93, 23, 3);
      b.wall(76, 23, 88, 30); b.wall(76, 21, 93, 22);
      b.floor(63, 17, 68, 22, 0); level(56, 23, 68, 29, 0);
      b.wall(62, 22, 64, 24, 'crate', Y(0) + 2.2);                 // 坑边的一摞箱子
      // 上 A 点的大坡：从坑底一路斜上到 A 点的平台，两边是挡土墙
      b.slope(69, 17, 77, 22, 'x', 0, 5, 'tiles');
      b.floor(78, 17, 80, 22, 5);
      // A 小道尽头（和 A 点一样高）：往西是直落 CT 出生点的断崖
      b.floor(69, 23, 75, 30, 5);
      // A 大拐角的蓝色集装箱
      b.floor(79, 51, 86, 53, 3);
      b.wall(81, 51, 85, 52, 'container_b', Y(3) + 2.6);
      // A 点的箱子（默认包位）
      b.floor(85, 16, 93, 20, 5);
      b.wall(88, 17, 89, 18, 'crate', Y(5) + 2.3); b.wall(90, 17, 90, 17, 'crate', Y(5) + 1.15); b.wall(87, 19, 87, 19, 'crate', Y(5) + 1.15);

      // ---- A 小道（猫道）：从中路顶上一路平着过来，尽头几级台阶上到 A 点那一层 ----
      level(68, 37, 75, 42, 3);
      b.wall(68, 36, 68, 36); b.wall(75, 36, 75, 36);
      b.stairs(69, 36, 74, 38, 'z', 5, 3, 'tiles', 'stone');
      // 猫道靠中路的一边是硬边（中路往下走，猫道不跟着往下斜）
      b.floor(55, 43, 55, 47, 3);
      b.hard(55, 43, 58, 48); b.hard(56, 49, 58, 58);
      // 中路的大箱子（xbox）：从中路跳上箱子，再迈上猫道
      b.floor(53, 44, 54, 46, 1);
      b.box(53.6, Y(1), 44.3, 55.0, Y(1) + 1.2, 45.9, 'crate', 'crate');
      b.noWalk(53, 44, 54, 45);

      // ---- 中门：两扇大木门半开着，中间留一条能过人的缝；两边石门框，上面石门楣 ----
      b.wall(47, 32, 47, 32, 'stone'); b.wall(54, 32, 54, 32, 'stone');
      b.door(48, 32, 53, 32, 3.45, 'stone');
      b.leaf('x', 48.02, 50.35, 32.5, Y(1), Y(1) + 3.4, { hinge: 'a0' });
      b.leaf('x', 52.05, 53.98, 32.5, Y(1), Y(1) + 3.4, { hinge: 'a1' });
      b.noWalk(48, 32, 50, 32); b.noWalk(52, 32, 53, 32);

      // ---- A 大门：一座小门楼，从西边的门进去、往北的门出来（两道门错开，一眼看不穿），门扇都是敞开的 ----
      b.wall(75, 62, 81, 74);
      b.flat(76, 63, 80, 73, 3, 'tiles');
      b.flat(75, 70, 75, 73, 3, 'tiles'); b.door(75, 70, 75, 73, 3.4, 'stone');
      b.flat(77, 62, 80, 62, 3, 'tiles'); b.door(77, 62, 80, 62, 3.4, 'stone');
      b.roof(75, 62, 81, 74, 4.3);
      b.leaf('x', 76.02, 77.95, 70.07, Y(3), Y(3) + 3.35, { hinge: 'a0' });
      b.leaf('x', 76.02, 77.95, 73.93, Y(3), Y(3) + 3.35, { hinge: 'a0' });
      b.leaf('z', 60.05, 61.98, 77.07, Y(3), Y(3) + 3.35, { hinge: 'a1' });
      b.leaf('z', 60.05, 61.98, 80.93, Y(3), Y(3) + 3.35, { hinge: 'a1' });
      b.noWalk(76, 70, 77, 70); b.noWalk(76, 73, 77, 73); b.noWalk(77, 60, 77, 61); b.noWalk(80, 60, 80, 61);

      // ---- B 门（CT 那边进 B 点的门）：两扇门朝 CT 那边敞开 ----
      b.wall(29, 23, 29, 23, 'stone'); b.wall(29, 28, 29, 28, 'stone');
      b.door(29, 24, 29, 27, 3.4, 'stone');
      b.leaf('x', 30.02, 31.9, 24.07, Y(3), Y(3) + 3.35, { hinge: 'a0' });
      b.leaf('x', 30.02, 31.9, 27.93, Y(3), Y(3) + 3.35, { hinge: 'a0' });
      b.noWalk(30, 24, 31, 24); b.noWalk(30, 27, 31, 27);
      b.floor(28, 13, 29, 13, 5); b.floor(28, 15, 28, 15, 5);

      // ---- 地道 ----
      // 上层地道（B1）：T 那头几级台阶进洞，洞里是平的，尽头几级台阶下到 B 点
      b.wall(10, 64, 17, 67); b.wall(23, 64, 29, 67);
      b.stairs(18, 64, 22, 67, 'z', 5, 3, 'concrete', 'stone');
      b.door(18, 67, 22, 67, 3.0, 'stone');
      b.floor(8, 36, 25, 36, 3);
      b.stairs(11, 35, 13, 37, 'z', 3, 5, 'concrete', 'stone');
      b.wall(7, 46, 9, 48, 'crate', Y(5) + 2.2); b.floor(10, 46, 10, 48, 5);
      // B1 → B2 的转角楼梯：从上层地道的东墙出去，先往东下一段，在平台上左拐，再往北下一段，到下层地道（B2）
      b.wall(30, 49, 36, 55);
      b.floor(29, 55, 29, 55, 5);
      b.flat(29, 52, 29, 54, 5);
      b.stairs(30, 52, 32, 54, 'x', 5, 3, 'concrete', 'stone');
      b.flat(33, 52, 35, 54, 3);
      b.stairs(33, 49, 35, 51, 'z', 1, 3, 'concrete', 'stone');
      // 下层地道（B2）：平着通到中路
      b.floor(31, 43, 48, 48, 1);
      b.wall(31, 43, 32, 43); b.wall(31, 48, 32, 48);
      // 洞顶
      b.roof(7, 46, 29, 57, 3.3); b.roof(18, 58, 22, 67, 3.3); b.roof(10, 37, 14, 45, 3.0);
      b.roof(30, 49, 36, 55, 3.3); b.roof(31, 43, 48, 48, 3.1);

      b.floorMat(56, 16, 84, 32, 'tiles');      // CT 出生点
      b.floorMat(45, 30, 57, 97, 'road');       // 中路
      b.floorMat(8, 37, 48, 67, 'concrete');    // 地道
      b.floorMat(84, 4, 102, 20, 'site_d');     // A 点
      b.floorMat(9, 8, 28, 26, 'site_d');       // B 点
      b.site('A', 85, 5, 101, 19);
      b.site('B', 12, 9, 27, 24);
      b.spawnNear('T', 41, 102, 10, 0);
      b.spawnNear('CT', 64, 25, 10, Math.PI);
      b.buyzone('T', 28, 94, 56, 108);
      b.buyzone('CT', 56, 16, 70, 30);
    },
  },
  mirage: {
    name: '荒漠迷城', desc: 'Mirage 布局：A 坡道 / Palace / A 点、中路 / 窗口 / 连接、B 公寓、B 小道、地下通道和梯子间', theme: 'desert',
    w: 256, h: 256, cell: 0.508, wallH: 14, rampHalf: 2, wallAbove: 5, wallVar: 2, wallBlock: 12,
    floorMat: 'sand', wallMat: 'plaster', crateMat: 'crate', lowMat: 'sandbag', roofMat: 'roof', cliffMat: 'stone',
    build(b) {
      b.heights(decodeRows(MIRAGE_ROWS));
      b.cleanBoxes();
      b.despeckle();
      b.median(2);
      b.denoise(40);
      // 两个包点、两边出生点本来就是平地
      b.flatten(100, 172, 142, 206); b.flatten(28, 58, 98, 96); b.flatten(60, 146, 90, 204); b.flatten(196, 76, 236, 126);
      // 室内：宫殿（Palace）、B 公寓，铺地砖、盖屋顶
      b.floorMat(176, 182, 224, 206, 'tiles'); b.roof(176, 182, 224, 206, 3.4);
      b.floorMat(100, 42, 158, 68, 'tiles'); b.roof(114, 42, 158, 58, 3.4); b.roof(100, 42, 113, 58, 3.4); b.roof(126, 59, 158, 68, 3.4);
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
  // 炼狱小镇：Inferno 的布局（1 格 = 1 米，高度每级 0.4 米）。意大利小镇：石块路、各色灰泥墙的房子
  inferno: {
    name: '炼狱小镇', desc: 'Inferno 布局：香蕉道、B 点喷泉、中路、A 小、拱门 / 图书馆 / 长廊、公寓阳台、A 点的坑', theme: 'village',
    w: 108, h: 100, cell: 1, wallH: 9, wallAbove: 6, wallVar: 3, wallBlock: 11,
    floorMat: 'cobble', wallMat: 'stucco_y', crateMat: 'crate', lowMat: 'sandbag', roofMat: 'darkwood', cliffMat: 'stone',
    build(b) {
      const Y = (lv) => lv * 0.4;
      // ---- T 出生点（西南角的小广场）和上去的坡 ----
      b.floor(4, 78, 18, 92, 0);
      b.slope(19, 81, 32, 88, 'x', 0, 4);                 // T 坡：往东上坡
      b.floor(33, 72, 44, 88, 4);                         // 坡顶的小广场
      b.floor(36, 60, 44, 71, 4);                         // 小广场往北的街，通到中路西头

      // ---- 中路、二道（alt mid）----
      b.slope(45, 60, 60, 66, 'x', 4, 6);                 // 中路：一路缓缓上坡
      b.floor(61, 52, 67, 68, 6);                         // 中路东头的路口：往东上 A 小，往北过拱门，往南去二道
      b.floor(45, 74, 66, 80, 4);                         // 二道（和 T 坡错开，出生点看不穿）
      b.slope(62, 69, 66, 73, 'z', 6, 4);                 // 路口 ↔ 二道 的小巷

      // ---- A 小、A 点 ----
      b.slope(68, 52, 76, 56, 'x', 6, 8);                 // A 小：上坡进 A 点（和中路错开，中路西头看不进 A 点）
      b.floor(77, 52, 99, 74, 8, 'tiles');
      b.flat(93, 67, 99, 74, 5);                          // 坑：A 点东南角凹下去的一块
      b.slope(89, 69, 92, 73, 'x', 8, 5);
      b.floor(94, 46, 100, 51, 8, 'grass');               // 墓地：A 点东北角矮墙后面的草地
      b.objs('h', [[94, 52], [95, 52], [96, 52], [97, 52]]);

      // ---- 公寓：二道东头上楼梯，楼上一条走廊，北墙开门出去是俯瞰 A 点的阳台 ----
      b.stairs(67, 78, 74, 80, 'x', 4, 14, 'woodfloor', 'stone');
      b.floor(75, 78, 91, 84, 14, 'woodfloor');
      b.floor(84, 77, 85, 77, 14, 'woodfloor'); b.door(84, 77, 85, 77, 2.5, 'stone');
      b.floor(79, 75, 90, 76, 14, 'woodfloor');           // 阳台
      b.objs('h', [[79, 75], [80, 75], [81, 75], [82, 75], [87, 75], [88, 75], [89, 75], [90, 75]]);
      b.roof(67, 78, 91, 84, 3.2);
      b.wall(79, 80, 80, 82, 'crate', Y(14) + 1.2);       // 走廊里的箱子
      b.wall(87, 83, 88, 84, 'stone', Y(14) + 2.2);       // 锅炉

      // ---- 拱门、图书馆、长廊（A 大）----
      b.floor(61, 44, 67, 51, 6);
      b.wall(61, 48, 61, 48, 'stone'); b.wall(67, 48, 67, 48, 'stone'); b.door(62, 48, 66, 48, 3.9, 'stone');   // 拱门
      b.floor(61, 36, 83, 43, 6);                         // 拱门北边的小广场
      b.floor(69, 44, 82, 49, 6, 'woodfloor');            // 图书馆
      b.floor(68, 46, 68, 47, 6, 'woodfloor'); b.door(68, 46, 68, 47, 2.6, 'stone');
      b.floor(83, 46, 83, 47, 6, 'woodfloor'); b.door(83, 46, 83, 47, 2.6, 'stone');
      b.roof(68, 44, 83, 49, 3.3);
      b.wall(72, 44, 78, 44, 'darkwood', Y(6) + 2.2);     // 书架
      b.wall(74, 48, 76, 49, 'darkwood', Y(6) + 0.9);     // 书桌
      b.floor(84, 36, 91, 47, 6);                         // 长廊
      b.slope(84, 48, 91, 51, 'z', 6, 8);

      // ---- CT 出生点、去 B 点的街 ----
      b.floor(76, 16, 100, 31, 5);
      b.slope(76, 32, 91, 35, 'z', 5, 6);
      // 往西一路上坡到 B 点：中间拐一个弯（B 点一眼看不到 CT 出生点）
      b.slope(64, 16, 75, 22, 'x', 7, 5);
      b.floor(58, 16, 63, 30, 7);
      b.slope(46, 24, 57, 30, 'x', 9, 7);

      // ---- B 点：喷泉广场 ----
      b.floor(16, 6, 45, 31, 9);
      // 喷泉：一圈矮石沿，中间一根柱子
      const fy = Y(9);
      b.box(27.5, fy, 15.5, 32.5, fy + 0.55, 16.1, 'stone', 'low'); b.box(27.5, fy, 19.9, 32.5, fy + 0.55, 20.5, 'stone', 'low');
      b.box(27.5, fy, 16.1, 28.1, fy + 0.55, 19.9, 'stone', 'low'); b.box(31.9, fy, 16.1, 32.5, fy + 0.55, 19.9, 'stone', 'low');
      b.box(29.5, fy, 17.5, 30.5, fy + 1.7, 18.5, 'stone', 'low');
      b.decor(28.1, fy + 0.02, 16.1, 31.9, fy + 0.4, 19.9, 'water');
      b.decor(29.2, fy + 1.7, 17.2, 30.8, fy + 1.9, 18.8, 'stone');
      b.noWalk(27, 15, 32, 20);
      // 棺材（北墙根的几个矮石台）、新箱子、暗角
      for (const x of [19, 23, 27]) b.box(x, fy, 6.3, x + 2.2, fy + 0.7, 7.3, 'stone', 'low');
      b.noWalk(19, 6, 29, 7);
      b.wall(40, 8, 41, 9, 'crate', fy + 2.3); b.wall(42, 8, 42, 8, 'crate', fy + 1.15);
      b.wall(18, 26, 19, 27, 'crate', fy + 1.2); b.wall(36, 28, 37, 29, 'crate', fy + 1.2);
      b.objs('o', [[17, 12], [44, 30]]);

      // ---- 香蕉道：从底下拐个弯一路上坡到 B 点 ----
      b.slope(26, 32, 33, 41, 'z', 9, 6);                 // 上半段
      b.floor(12, 42, 33, 46, 6);                         // 中间横着的一段（上下两段错开，从 B 点一眼看不到底）
      b.slope(12, 47, 19, 57, 'z', 6, 3);                 // 下半段
      b.floor(6, 58, 26, 70, 3);                          // 香蕉道口
      b.slope(8, 71, 14, 77, 'z', 3, 0);                  // 香蕉道口 ↔ T 出生点
      // 香蕉道口 ↔ 坡顶小广场：一条拐弯的小巷
      b.floor(27, 66, 30, 68, 3); b.slope(28, 69, 30, 73, 'z', 3, 4); b.floor(28, 74, 32, 76, 4);
      b.objs('h', [[15, 51], [16, 51], [17, 51], [22, 43], [23, 43]]);   // 沙袋
      b.objs('o', [[13, 45], [32, 36]]);
      b.wall(27, 37, 27, 38, 'crate', Y(7.5) + 1.2);
      // 香蕉道口的小汽车
      const cy = Y(3);
      b.box(17.2, cy + 0.25, 60.4, 19.0, cy + 0.95, 64.6, 'container_r', 'low'); b.box(17.35, cy + 0.95, 61.4, 18.85, cy + 1.5, 63.7, 'container_r', 'low');
      b.noWalk(17, 60, 18, 64);

      // ---- 掩体 ----
      b.wall(86, 60, 87, 61, 'crate', Y(8) + 2.4); b.wall(88, 61, 88, 61, 'crate', Y(8) + 1.2);   // A 点的箱子
      b.wall(81, 66, 82, 66, 'crate', Y(8) + 1.2); b.wall(95, 56, 96, 57, 'crate', Y(8) + 1.2);
      b.objs('o', [[78, 73], [98, 53]]);
      b.wall(52, 60, 53, 60, 'crate', Y(5) + 1.2);                       // 中路
      b.objs('o', [[61, 67], [44, 61]]);
      b.wall(34, 73, 35, 74, 'crate', Y(4) + 1.2); b.wall(55, 79, 56, 80, 'crate', Y(4) + 1.2);
      b.wall(97, 17, 99, 18, 'crate', Y(5) + 1.2); b.wall(77, 30, 78, 31, 'crate', Y(5) + 2.3);
      b.objs('o', [[5, 79], [18, 91], [61, 37], [90, 37]]);
      b.wall(5, 90, 6, 92, 'crate', Y(0) + 1.2);

      // ---- 大木门（装饰）：公寓楼梯口、图书馆 ----
      b.leaf('z', 76.05, 77.9, 66.93, Y(4), Y(4) + 2.6, { hinge: 'a0' });
      b.leaf('x', 69.05, 70.6, 46.06, Y(6), Y(6) + 2.5, { hinge: 'a0' }); b.leaf('x', 81.4, 82.95, 47.94, Y(6), Y(6) + 2.5, { hinge: 'a1' });

      b.facade({ every: 4, rows: 2 });
      // ---- 各片房子的墙面颜色 ----
      b.wallMat(0, 0, 52, 38, 'stucco_p'); b.wallMat(53, 0, 107, 34, 'stucco_w');
      b.wallMat(56, 35, 107, 99, 'stucco_o'); b.wallMat(28, 46, 55, 70, 'stucco_w');

      b.site('A', 80, 56, 92, 67);
      b.site('B', 22, 10, 40, 26);
      b.spawnNear('T', 11, 85, 10, -Math.PI / 2);
      b.spawnNear('CT', 88, 23, 10, Math.PI);
      b.buyzone('T', 4, 78, 18, 92);
      b.buyzone('CT', 76, 16, 100, 31);
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
