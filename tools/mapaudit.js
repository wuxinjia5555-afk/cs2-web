// 地图回归：真实站立空间、包点连通、上下层出口、七张地图的确定性对局。
// node tools/mapaudit.js [地图id ...] [--minutes 8] [--runs 3]
import assert from 'node:assert/strict';
import { getMap, MAPS } from '../public/js/shared/maps.js';
import { MAP_VIEWS } from '../public/js/shared/mapdetails.js';
import { Room } from '../public/js/shared/room.js';
import { hullBlocked } from '../public/js/shared/physics.js';
import { P, TICK_RATE } from '../public/js/shared/constants.js';
import { mulberry32 } from '../public/js/shared/util.js';

const args = process.argv.slice(2), option = (key, fallback) => {
  const at = args.indexOf(key); return at < 0 ? fallback : Number(args[at + 1]);
};
const ids = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
const minutes = option('--minutes', 8), runs = option('--runs', 3);
assert(Number.isFinite(minutes) && minutes > 0 && minutes <= 60);
assert(Number.isInteger(runs) && runs > 0 && runs <= 20);
for (const id of ids) assert(MAPS[id], '未知地图：' + id);
const validHull = (m, s, height = P.standH) => !hullBlocked(m.world, s.x, s.y + 0.04, s.z, height - 0.04);
const realRandom = Math.random;
let failed = 0;
for (const id of ids.length ? ids : Object.keys(MAPS)) {
  try {
    const m = getMap(id);
    for (const team of ['T', 'CT']) {
      assert(m.spawns[team].length > 0, team + ' 没有出生点');
      for (const s of m.spawns[team]) {
        assert(validHull(m, s), team + ' 出生点卡在实体里');
        const start = m.nav.nearestWalkable(s.x, s.z);
        for (const site of Object.values(m.sites)) {
          assert(site.cells.length > 0, site.name + ' 没有可用包位');
          assert(m.nav.findPath(start, site.cells[0]), team + ' 无法到达 ' + site.name);
        }
      }
    }
    for (const s of m.dmSpawns) assert(validHull(m, s), '死斗出生点被碰撞盒挡住');
    for (const [name, v] of Object.entries(MAP_VIEWS[id] || {})) {
      assert(m.world.groundY(v[1], v[3]) > -100, name + ' 预览相机在地图外');
      const footY = v[2] == null ? m.world.groundY(v[1], v[3]) : v[2] - P.standEye;
      assert(validHull(m, { x: v[1], y: footY, z: v[3] }), name + ' 预览相机在实体里');
    }
    for (const bx of m.boxes) for (let axis = 0; axis < 3; axis++) {
      assert(Number.isFinite(bx.min[axis]) && Number.isFinite(bx.max[axis]) && bx.max[axis] > bx.min[axis], '无效碰撞盒');
    }
    if (id === 'inferno') {
      const bridge = m.nav.cellOf(61.5, 67.5), below = m.nav.cellOf(61.5, 66.5);
      assert(!m.nav.canStep(bridge, below), '匪二楼不应穿过下水道门梁');
      assert(!m.nav.walk[m.nav.cellOf(91.5, 57.5)], 'A 拱廊柱子旁没有留身位');
      assert(m.nav.lower.wayOut(61.5, 72.5, 0.4), '下水道没有可走出口');
      assert(validHull(m, { x: 50.3, y: 4.02, z: 14.3 }), '喷泉圆形外侧仍有方形空角碰撞');
      assert(!validHull(m, { x: 53, y: 4.02, z: 17 }), '喷泉盆底缺少碰撞');
      assert(validHull(m, { x: 65.5, y: m.world.groundY(65.5, 36.5) + 0.02, z: 36.5 }), '沙袋凹槽没有站立空间');
      assert(!validHull(m, { x: 64.8, y: 3.03, z: 33.5 }), '沙袋缺少实体碰撞');
      assert(!validHull(m, { x: 58.5, y: 4.82, z: 69.5 }), '厨房吧台缺少实体碰撞');
    }
    if (id === 'mirage') {
      assert(m.world.raycast(30, 4.9, 35, 0, 1, 0, 3), 'B 点棚架缺少屋顶');
      assert(m.world.raycast(35.8, 4.7, 46.5, 0, 1, 0, 3), '超市没有屋顶');
      const south = m.nav.nearestWalkable(64.5 * m.S, 98.5 * m.S), north = m.nav.nearestWalkable(76.5 * m.S, 85.5 * m.S);
      assert(m.nav.findPath(south, north), '超市门之间不通');
      assert(!validHull(m, { x: 60.5 * m.S, y: 3.22, z: 95 * m.S }), '收银台缺少实体碰撞');
      const floorHeights = m.sites.B.cells.filter(c => Math.floor(c / m.W) > 61).map(c => m.nav.ys[c]);
      assert(Math.max(...floorHeights) - Math.min(...floorHeights) < 0.01, 'B 点地面仍有雷达描边高台');
    }
    let kills = 0, rounds = 0, stalled = 0, alive = 0, longStalls = 0;
    const modes = id === 'range' ? ['range'] : ['bomb', 'dm'];
    for (const mode of modes) for (let seed = 0; seed < runs; seed++) {
      Math.random = mulberry32(137 + seed * 997);
      let matchKills = 0;
      const room = new Room({ map: id, mode, bots: true, botDiff: 2, warmup: false }, {
        send() {}, broadcast(msg) { if (msg.t === 'kill') { kills++; matchKills++; } if (msg.t === 'rend') rounds++; },
      });
      room.rebalanceBots(); if (mode === 'bomb') room.startMatch();
      const track = new Map(), targetMotion = new Map();
      for (let tick = 0; tick < minutes * 60 * TICK_RATE; tick++) {
        room.tick();
        for (const p of room.players.values()) {
          assert(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z), '玩家坐标无效');
          assert(p.y > -1, '玩家掉出地图');
          if (mode === 'range' && p.bot?.spot?.kind === 'strafe') {
            const motion = targetMotion.get(p.id) || { min: p.x, max: p.x };
            motion.min = Math.min(motion.min, p.x); motion.max = Math.max(motion.max, p.x); targetMotion.set(p.id, motion);
          }
          if (!p.alive || !p.bot || p.dummy || !['live', 'dm'].includes(room.phase)) { track.delete(p.id); continue; }
          let s = track.get(p.id);
          if (!s) { s = { x: p.x, z: p.z, want: 0, ticks: 0, streak: 0 }; track.set(p.id, s); }
          if (Math.abs(p.bot.cmd.fwd) + Math.abs(p.bot.cmd.side) > 0.1 && !p.planting && !p.defusing) s.want++;
          if (++s.ticks === TICK_RATE) {
            alive++;
            const stuck = s.want >= TICK_RATE * 0.8 && Math.hypot(p.x - s.x, p.z - s.z) < 0.35;
            if (stuck) { stalled++; if (++s.streak === 3) longStalls++; } else s.streak = 0;
            s.x = p.x; s.z = p.z; s.want = 0; s.ticks = 0;
          }
        }
      }
      if (mode === 'range') for (const motion of targetMotion.values()) assert(motion.max - motion.min > 0.75, '移动假人未正常移动');
      if (mode !== 'range') assert(matchKills > 0, '机器人对局没有交战，可能路线退化');
    }
    console.log(`${m.name}: 通过 | 出生 T${m.spawns.T.length}/CT${m.spawns.CT.length}, 包点 ${Object.keys(m.sites).join('/') || '训练'}, 击杀 ${kills}, 回合 ${rounds}, 卡住 ${(stalled / Math.max(1, alive) * 100).toFixed(2)}%（连续 3 秒 ${longStalls} 次）`);
  } catch (error) { failed++; console.error(`${id}: 失败 — ${error.message}`); }
  finally { Math.random = realRandom; }
}
console.log('失败地图数：' + failed);
process.exitCode = failed ? 1 : 0;
