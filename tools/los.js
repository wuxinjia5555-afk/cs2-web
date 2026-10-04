// 地图视线检查：双方从出生点出发，最早几秒能互相看到？最早几秒能看到对方出生区？
// 用法：node tools/los.js [地图id ...] [--limit 秒] [--fine]
import { getMap, MAPS, CELL } from '../public/js/shared/maps.js';
import { P } from '../public/js/shared/constants.js';

const RUN = 250 * 0.0254; // 拿刀奔跑速度 m/s
const args = process.argv.slice(2);
const li = args.indexOf('--limit');
const LIMIT = li >= 0 ? +args[li + 1] : 12;
const si = args.indexOf('--step');
const STEP = si >= 0 ? +args[si + 1] : 1; // 隔几格取一个点（大地图用，算得快）
const ids = args.filter((a, i) => !a.startsWith('--') && (li < 0 || i !== li + 1) && (si < 0 || i !== si + 1));
// --fine：每个格子再取 4 个角附近的点（更严格，也更慢）
const OFF = args.includes('--fine') ? [[0, 0], [-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]] : [[0, 0]];

// 从出生点出发到每个格子的最短时间（8 方向，和机器人寻路同一套「能不能迈过去」的规则）
function reachTimes(map, team) {
  const { W, H, S, type, nav } = map;
  const t = new Float64Array(W * H).fill(Infinity);
  const walk = (c, r) => c >= 0 && r >= 0 && c < W && r < H && type[r * W + c] === CELL.FLOOR;
  const open = [];
  for (const sp of map.spawns[team]) {
    const i = Math.floor(sp.z / S) * W + Math.floor(sp.x / S);
    t[i] = 0;
    open.push(i);
  }
  while (open.length) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (t[open[k]] < t[open[bi]]) bi = k;
    const i = open[bi];
    open[bi] = open[open.length - 1];
    open.pop();
    const c = i % W, r = (i / W) | 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const nc = c + dc, nr = r + dr;
      if (!walk(nc, nr)) continue;
      if (dr && dc && (!walk(c + dc, r) || !walk(c, r + dr))) continue;
      const j = nr * W + nc;
      if (!(nav.moves[i] & (dc > 0 ? 1 : dc < 0 ? 2 : 0) || !dc) || !(nav.moves[i] & (dr > 0 ? 4 : dr < 0 ? 8 : 0) || !dr)) continue;
      const nt = t[i] + ((dr && dc ? Math.SQRT2 : 1) * S) / RUN;
      if (nt < t[j]) { t[j] = nt; open.push(j); }
    }
  }
  return t;
}

// a 处的人（站立视线）能否看到 b 处的人（头或胸）
function visible(map, a, b) {
  const { W, S, gy, world } = map;
  const ca = a % W, ra = (a / W) | 0, cb = b % W, rb = (b / W) | 0;
  const ya = gy[a] + P.standEye, yb = gy[b];
  for (const [ox, oz] of OFF) {
    const ax = (ca + 0.5) * S + ox, az = (ra + 0.5) * S + oz;
    for (const [px, pz] of OFF) {
      const bx = (cb + 0.5) * S + px, bz = (rb + 0.5) * S + pz;
      for (const h of [P.standEye, 1.1]) {
        let dx = bx - ax, dy = yb + h - ya, dz = bz - az;
        const d = Math.hypot(dx, dy, dz);
        dx /= d; dy /= d; dz /= d;
        const hit = world.raycast(ax, ya, az, dx, dy, dz, d);
        if (!hit || hit.t >= d - 0.05) return true;
      }
    }
  }
  return false;
}

function inZone(map, team, i) {
  const { W, S } = map;
  const x = (i % W + 0.5) * S, z = (((i / W) | 0) + 0.5) * S;
  return map.buy[team].some((b) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1);
}

export function analyze(id, quiet = false) {
  const map = getMap(id);
  const { W } = map;
  const cell = (i) => `(${i % W},${(i / W) | 0})`;
  const tT = reachTimes(map, 'T'), tC = reachTimes(map, 'CT');
  const A = [], B = [];
  for (let i = 0; i < tT.length; i++) {
    if ((i % W) % STEP || (((i / W) | 0) % STEP)) continue;
    if (tT[i] <= LIMIT) A.push(i);
    if (tC[i] <= LIMIT) B.push(i);
  }
  // 1) 双方都在跑，最早相遇
  const pairs = [];
  for (const a of A) for (const b of B) {
    const m = Math.max(tT[a], tC[b]);
    if (m <= LIMIT) pairs.push([m, a, b]);
  }
  pairs.sort((x, y) => x[0] - y[0]);
  const found = [];
  for (const [m, a, b] of pairs) {
    if (found.length >= 8 && m > found[0][0] + 1) break;
    if (visible(map, a, b)) found.push([m, a, b]);
  }
  // 2) 最早几秒能看到对方出生区（对方站着不动）
  const peek = (mine, tm, enemy) => {
    const zone = [];
    for (let i = 0; i < tm.length; i++) if (map.type[i] === CELL.FLOOR && inZone(map, enemy, i) && !((i % W) % STEP) && !(((i / W) | 0) % STEP)) zone.push(i);
    const cand = mine.slice().sort((x, y) => tm[x] - tm[y]);
    for (const a of cand) for (const b of zone) if (visible(map, a, b)) return [tm[a], a, b];
    return null;
  };
  const pT = peek(A, tT, 'CT'), pC = peek(B, tC, 'T');
  const res = { id, contact: found.length ? found[0][0] : Infinity, peekT: pT ? pT[0] : Infinity, peekCT: pC ? pC[0] : Infinity };
  if (!quiet) {
    console.log(`\n[${id}] ${map.name}`);
    if (!found.length) console.log(`  ${LIMIT} 秒内双方碰不到面`);
    else {
      console.log(`  最早相遇：${found[0][0].toFixed(1)} 秒`);
      for (const [m, a, b] of found.slice(0, 8)) console.log(`    ${m.toFixed(1)}s  T${cell(a)} ${tT[a].toFixed(1)}s  ↔  CT${cell(b)} ${tC[b].toFixed(1)}s`);
    }
    console.log(`  T 最早看到 CT 出生区：${pT ? `${pT[0].toFixed(1)} 秒  T${cell(pT[1])} → ${cell(pT[2])}` : `${LIMIT} 秒内看不到`}`);
    console.log(`  CT 最早看到 T 出生区：${pC ? `${pC[0].toFixed(1)} 秒  CT${cell(pC[1])} → ${cell(pC[2])}` : `${LIMIT} 秒内看不到`}`);
  }
  return res;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/los.js')) {
  for (const id of ids.length ? ids : Object.keys(MAPS)) analyze(id);
}
