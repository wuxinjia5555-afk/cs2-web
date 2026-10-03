// 找机器人卡住的地方：纯机器人对局，记下「想走却走不动」和「找不到路」的位置，按格子汇总
// 用法：node tools/stuck.js [地图] [模式 bomb/dm] [分钟] [随机种子个数]
import { Room } from '../public/js/shared/room.js';
import { TICK_RATE, LEVEL_H } from '../public/js/shared/constants.js';
import { getMap } from '../public/js/shared/maps.js';

const mapId = process.argv[2] || 'mirage';
const mode = process.argv[3] || 'bomb';
const minutes = +(process.argv[4] || 10);
const runs = +(process.argv[5] || 3);

const map = getMap(mapId);
const S = map.nav.S, W = map.nav.W;
const stuck = new Map(); // 格子（按 2x2 米合并）-> { n, samples: [] }
const noPath = new Map();
let stuckSecs = 0, aliveSecs = 0, noPathN = 0;

const keyOf = (x, z) => `${Math.floor(x / 2) * 2},${Math.floor(z / 2) * 2}`;

for (let run = 0; run < runs; run++) {
  const room = new Room({ map: mapId, mode, bots: true, botDiff: 2, teamSize: 5, maxRounds: 16, warmup: false }, { send() {}, broadcast() {} });
  room.rebalanceBots();
  if (mode !== 'dm') room.startMatch();
  // 记下找不到路的起点
  const nav = room.nav, fp = nav.findPath.bind(nav);
  nav.findPath = (s, g, mi) => {
    const r = fp(s, g, mi);
    if (!r && s >= 0 && g >= 0) {
      noPathN++;
      const c = nav.center(s, {}), k = keyOf(c.x, c.z);
      const e = noPath.get(k) || { n: 0, from: [s % W, (s / W) | 0], lv: nav.level[s], to: [g % W, (g / W) | 0], glv: nav.level[g] };
      e.n++;
      noPath.set(k, e);
    }
    return r;
  };
  const tr = new Map(); // 玩家 -> { x, z, want, ticks, run }
  const ticks = minutes * 60 * TICK_RATE;
  for (let i = 0; i < ticks; i++) {
    room.tick();
    const live = room.phase === 'live' || room.phase === 'dm';
    for (const p of room.players.values()) {
      if (!p.alive || !p.bot || !live) { tr.delete(p.id); continue; }
      let t = tr.get(p.id);
      if (!t) { t = { x: p.x, z: p.z, want: 0, ticks: 0, run: 0 }; tr.set(p.id, t); }
      const c = p.bot.cmd;
      if (Math.abs(c.fwd) + Math.abs(c.side) > 0.1 && !p.planting && !p.defusing) t.want++;
      if (++t.ticks >= TICK_RATE) {
        aliveSecs++;
        const moved = Math.hypot(p.x - t.x, p.z - t.z);
        if (t.want >= TICK_RATE * 0.8 && moved < 0.35) {
          t.run++;
          stuckSecs++;
          if (t.run === 3) {
            const k = keyOf(p.x, p.z);
            const e = stuck.get(k) || { n: 0, samples: [] };
            e.n++;
            if (e.samples.length < 3) {
              const b = p.bot, ci = nav.cellOf(p.x, p.z);
              const wp = b.path ? b.path[Math.min(b.pathIdx, b.path.length - 1)] : null;
              e.samples.push({
                pos: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)], cell: [Math.floor(p.x / S), Math.floor(p.z / S)],
                navWalk: ci >= 0 ? nav.walk[ci] : -1, navY: ci >= 0 ? +(nav.level[ci] * LEVEL_H).toFixed(2) : null,
                onGround: p.onGround, vis: !!b.visible, goal: b.goalKey, wp: wp ? [+wp.x.toFixed(1), +wp.z.toFixed(1), +(wp.y ?? 0).toFixed(1)] : null,
                cmd: [+c.fwd.toFixed(1), +c.side.toFixed(1)], team: p.team,
              });
            }
            stuck.set(k, e);
          }
        } else t.run = 0;
        t.x = p.x; t.z = p.z; t.want = 0; t.ticks = 0;
      }
    }
  }
}

console.log(`地图 ${map.name}（${mode}），${runs} 局 × ${minutes} 分钟`);
console.log(`想走却走不动的时间：${stuckSecs} 秒 / 机器人存活 ${aliveSecs} 秒（${((stuckSecs / Math.max(1, aliveSecs)) * 100).toFixed(2)}%）`);
const top = [...stuck.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 12);
console.log(`卡住超过 3 秒的地点（共 ${[...stuck.values()].reduce((s, e) => s + e.n, 0)} 次，${stuck.size} 处），前 ${top.length} 处：`);
for (const [k, e] of top) {
  console.log(`  (${k}) 米  ${e.n} 次`);
  for (const s of e.samples) console.log('     ', JSON.stringify(s));
}
const np = [...noPath.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 8);
console.log(`找不到路 ${noPathN} 次，前 ${np.length} 处起点：`);
for (const [k, e] of np) console.log(`  (${k}) 米  ${e.n} 次  起点格 ${e.from} 高度级 ${e.lv} → 目标格 ${e.to} 高度级 ${e.glv}`);
