// 无头模拟：纯机器人对局，用来检验服务端逻辑（node tools/sim.js [地图] [模式] [分钟]）
import { Room } from '../public/js/shared/room.js';
import { TICK_RATE } from '../public/js/shared/constants.js';
import { getMap } from '../public/js/shared/maps.js';

const mapId = process.argv[2] || 'sandstorm';
const mode = process.argv[3] || 'bomb';
const minutes = +(process.argv[4] || 12);

const map = getMap(mapId);
console.log(`地图 ${map.name}: ${map.W}x${map.H} 格, ${map.boxes.length} 个碰撞盒, 可走格 ${map.nav.walkList.length}`);

// 连通性检查：从 T/CT 出生点能否到达两个包点
for (const team of ['T', 'CT']) {
  const s = map.spawns[team][0];
  for (const [name, site] of Object.entries(map.sites)) {
    const a = map.nav.nearestWalkable(s.x, s.z), b = site.cells[0];
    const path = map.nav.findPath(a, b);
    console.log(`  ${team} 出生点 -> ${name} 点: ${path ? path.length + ' 格' : '不可达!!'}`);
  }
}

const stats = { kills: 0, hs: 0, rounds: [], planted: 0, defused: 0, exploded: 0, shots: 0, nades: 0, errors: 0, byWeapon: {} };
let room;
const io = {
  send() {},
  broadcast(msg) {
    switch (msg.t) {
      case 'kill': stats.kills++; if (msg.hs) stats.hs++; stats.byWeapon[msg.w] = (stats.byWeapon[msg.w] || 0) + 1; break;
      case 'rend': stats.rounds.push(`${msg.w}:${msg.r}`); break;
      case 'msg': if (msg.k === 'planted') stats.planted++; if (msg.k === 'defused') stats.defused++; break;
      case 'bomb': if (msg.b && msg.b.st === 'exploded') stats.exploded++; break;
      case 'shot': stats.shots++; break;
      case 'gthrow': stats.nades++; break;
      case 'mend': console.log('  比赛结束', JSON.stringify(msg.sc), '胜者', msg.w); break;
    }
  },
};
room = new Room({ map: mapId, mode, bots: true, botDiff: 1, teamSize: 5, maxRounds: 16, warmup: false }, io);
room.rebalanceBots();
if (mode !== 'dm') room.startMatch();

const ticks = minutes * 60 * TICK_RATE;
const t0 = Date.now();
let stuckSamples = 0, stuckBad = 0;
const lastPos = new Map();
for (let i = 0; i < ticks; i++) {
  try {
    room.tick();
  } catch (e) {
    stats.errors++;
    if (stats.errors < 5) console.error('tick 异常', e);
  }
  if (i % (TICK_RATE * 5) === 0 && room.phase === 'live') {
    for (const p of room.players.values()) {
      if (!p.alive) continue;
      const lp = lastPos.get(p.id);
      if (lp) { stuckSamples++; if (Math.hypot(p.x - lp[0], p.z - lp[1]) < 0.5 && !p.planting && !p.defusing && !p.bot.visible) stuckBad++; }
      lastPos.set(p.id, [p.x, p.z]);
      if (p.y < -1 || !Number.isFinite(p.x)) console.log('  !! 玩家掉出地图', p.name, p.x, p.y, p.z);
    }
  }
}
const ms = Date.now() - t0;
console.log(`模拟 ${minutes} 分钟游戏时间用时 ${ms} ms（每 tick ${(ms / ticks).toFixed(3)} ms）`);
console.log(`回合 ${stats.rounds.length}: ${stats.rounds.join(' ')}`);
console.log(`比分 T ${room.scores.T} : CT ${room.scores.CT}, 第 ${room.round} 回合, 阶段 ${room.phase}`);
console.log(`击杀 ${stats.kills}（爆头 ${stats.hs}）, 开枪 ${stats.shots}, 投掷物 ${stats.nades}, 下包 ${stats.planted}, 拆包 ${stats.defused}, 爆炸 ${stats.exploded}`);
console.log('武器击杀', JSON.stringify(stats.byWeapon));
console.log(`静止采样 ${stuckBad}/${stuckSamples}，异常 ${stats.errors}`);
const top = [...room.players.values()].sort((a, b) => b.kills - a.kills).slice(0, 5);
console.log('击杀榜', top.map((p) => `${p.name}(${p.team}) ${p.kills}/${p.deaths} $${p.money}`).join(', '));
