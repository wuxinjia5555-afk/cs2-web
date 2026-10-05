// 场景回归：可见性、切刀/拔枪、架点分工、残局时间和存活武器继承。
import assert from 'node:assert/strict';
import { Room } from '../public/js/shared/room.js';
import { BotBrain, BOT_DIFF } from '../public/js/shared/bot.js';
import { defensePosts, bestDefuser, escapeRadius, routeDistance } from '../public/js/shared/bottactics.js';
import { World } from '../public/js/shared/physics.js';
import { P, TICK_RATE } from '../public/js/shared/constants.js';
import { mulberry32 } from '../public/js/shared/util.js';

function room(map = 'dust2', rules) {
  const r = new Room({ map, bots: false, warmup: false, rules }, { send() {}, broadcast() {} });
  r.players.clear(); r.rng = mulberry32(917); r.time = 10; r.phase = 'live'; r.phaseEnd = 110;
  return r;
}
function player(r, team, at, bot = true) {
  const p = r.newPlayer('scenario', bot); p.team = team; p.alive = true;
  Object.assign(p, at || r.map.spawns[team][0]);
  p.inv[1] = r.item(team === 'T' ? 'ak47' : 'm4a4'); p.inv[2] = r.item(team === 'T' ? 'glock' : 'usp'); p.slot = 1;
  r.players.set(p.id, p); if (bot) { p.bot = new BotBrain(r, p); p.bot.chooseRoute(); }
  return p;
}
function planted(r, at, seconds) {
  r.bomb = { st: 'planted', ...at, site: 'A', explodeAt: r.time + seconds, plantedAt: r.time, defuser: null };
  r.phaseEnd = r.bomb.explodeAt; return r.bomb;
}

// 70 米视线：所有难度都应索敌；反应/准度仍用原难度参数。
{
  const r = room('range'); const p = player(r, 'CT', { x: 29, y: 0, z: 83, yaw: 0 });
  const e = player(r, 'T', { x: 29, y: 0, z: 15 }, false);
  assert(r.canSee(p, e), '测试靶道没有直线视野');
  for (const d of BOT_DIFF) { p.bot.d = d; p.bot.perceive(); assert(p.bot.visible && p.bot.enemy === e, d.name + ' 丢弃远处目标'); }
  p.bot.enemy = null; p.bot.lastSeenT = -99; p.bot.d = BOT_DIFF[2]; p.bot.perceive();
  assert(p.bot.reactAt > r.time + 0.4, '普通难度反应时间被无意提高');
  r.smokes = [{ x: 29, y: 0, z: 45, t0: r.time - 2, until: r.time + 10 }];
  p.bot.perceive(); assert(!p.bot.visible, '隔烟透视'); r.smokes = [];
  const oldWorld = r.world; r.world = new World([{ min: [26, 0, 70], max: [32, 4, 71], mat: 'stone' }]);
  p.bot.perceive(); assert(!p.bot.visible, '隔墙索敌');
  e.z = 62; e.lastShotT = r.time; p.bot.perceive();
  assert(!p.bot.visible && p.bot.alertPos, '墙后枪声没有转向提示'); r.world = oldWorld;
  e.lastShotT = -99; e.z = 90; p.bot.perceive(); assert(!p.bot.visible, '安静的背后目标被透视');
  console.log('通过：远距索敌、原难度反应、墙体/烟雾/视野/听觉');
}

// 安全长直路持续持刀；看到敌人立即拿枪；不取消装填、不在拐角切刀。
{
  const r = room('range'); r.opts.mode = 'bomb'; const p = player(r, 'CT', { x: 29, y: 0, z: 83, yaw: 0 });
  const brain = p.bot; brain.moveGoal = { x: 29, z: 15 }; brain.path = [{ x: 29, z: 15, y: 0 }];
  brain.weaponMgmt(); assert.equal(p.slot, 3);
  for (let i = 0; i < 20; i++) { r.time += 1 / 30; brain.weaponMgmt(); assert.equal(p.slot, 3, '拔刀期间反复切枪'); }
  brain.visible = true; brain.weaponMgmt(); assert.equal(p.slot, 1, '遭遇敌人没有拔枪');
  brain.visible = false; r.time += 4; p.drawEnd = 0; p.reloadEnd = r.time + 2; brain.weaponMgmt(); assert.equal(p.slot, 1); assert(p.reloadEnd > r.time);
  p.reloadEnd = 0; brain.path = [{ x: 29, z: 78, y: 0 }, { x: 29, z: 15, y: 0 }]; brain.weaponMgmt(); assert.equal(p.slot, 1, '拐角前切刀');
  r.opts.mode = 'dm'; brain.path = [{ x: 29, z: 15, y: 0 }]; brain.weaponMgmt(); assert.equal(p.slot, 1, '死斗滥用切刀');
  console.log('通过：持刀转移、遭遇拔枪、装填保护、拐角持枪、死斗');
}

// 每张地图的站位看得到入口，队友分站，保持准星稳定。
for (const map of ['dust2', 'mirage', 'inferno', 'sandstorm', 'depot', 'arena']) {
  const r = room(map), p = player(r, 'CT'), q = player(r, 'CT');
  for (const name of ['A', 'B']) for (const team of ['T', 'CT']) {
    const posts = defensePosts(r, name, team); assert(posts.length);
    for (const post of posts) {
      assert(r.nav.findPath(r.nav.nearestWalkable(p.x, p.z), post.cell));
      assert(r.world.clear(post.point.x, post.point.y + P.standEye, post.point.z, post.watch.x, post.watch.y + 1.3, post.watch.z), '架点视线被墙挡住');
    }
  }
  p.bot.defend('A', 'T'); q.bot.defend('A', 'T');
  if (defensePosts(r, 'A', 'T').length > 1) assert.notEqual(p.bot.holdPost.cell, q.bot.holdPost.cell, '队友挤同一架点');
  Object.assign(p, p.bot.holdPost.point); p.bot.hold(); const yaw = p.bot.wantYaw;
  r.time += 3; p.bot.hold(); assert.equal(p.bot.wantYaw, yaw, '架点仍在无目标摇头');
  console.log('通过：' + map + ' 入口架点与分工');
}

// 已经进点的匪方持续架枪，不能下一帧又回到随机下包目标。
{
  const r = room('dust2'), p = player(r, 'T'); p.bot.via = -1;
  p.bot.defend('A', 'CT'); Object.assign(p, p.bot.holdPost.point);
  for (let i = 0; i < 30; i++) { r.time += 1 / 30; p.bot.objective(); assert(Math.abs(p.bot.cmd.fwd) + Math.abs(p.bot.cmd.side) < 0.01, '进点/架点目标反复切换'); }
  console.log('通过：匪方进点后保持架点');
}

// 足够时间正常拆包；钳子队友优先，其他人掩护；时间不够保枪撤出爆炸区。
{
  const r = room('dust2'), at = r.nav.center(r.map.sites.A.cells[0]);
  const p = player(r, 'CT', at), q = player(r, 'CT', { ...at, x: at.x + 0.8 }); q.kit = true;
  planted(r, at, 12); assert.equal(bestDefuser(r), q);
  p.bot.updateTactics(); p.bot.objective(); assert(!p.defusing && p.bot.holdPost, '没有掩护拆包队友');
  q.bot.updateTactics(); q.bot.objective(); assert(q.defusing, '钳子队友没有拆包');
  r.bomb.explodeAt = r.time + 5.3; q.bot.updateTactics(); assert(!q.bot.tactic && q.defusing, '取消了能完成的拆包');
  const e = player(r, 'T', { ...at, z: at.z + 5 }, false); q.bot.enemy = e; q.bot.visible = true;
  q.bot.combat(1 / 30); assert(q.defusing, '松手后已来不及仍取消拆包');
  q.alive = false; p.alive = true; r.bomb.defuser = null; r.bomb.explodeAt = r.time + 2; p.bot.updateTactics();
  assert.equal(p.bot.tactic, 'save'); assert(p.bot.retreatGoal);
  assert(Math.hypot(p.bot.retreatGoal.point.x - at.x, p.bot.retreatGoal.point.z - at.z) >= escapeRadius(p), '保枪点仍在致死爆炸圈');
  assert(Number.isFinite(routeDistance(r, p, p.bot.retreatGoal.point.x, p.bot.retreatGoal.point.z)));
  p.bot.retreat(); const speed = Math.abs(p.bot.cmd.fwd) + Math.abs(p.bot.cmd.side); assert(speed > 0.1);
  Object.assign(p, p.bot.retreatGoal.point); const kept = p.inv[1].w; r.startRound(); assert.equal(p.inv[1].w, kept, '存活武器没继承');
  console.log('通过：拆包分工、紧迫拆包不中断、无法拆包撤退、武器继承');
}

// T 爆炸前撤离并保持安全位置；临近回合结束时保枪，但队友正在下包不放弃。
{
  const r = room('dust2'), at = r.nav.center(r.map.sites.A.cells[0]), p = player(r, 'T', at);
  const b = planted(r, at, 3); p.bot.updateTactics(); assert.equal(p.bot.tactic, 'escape');
  Object.assign(p, p.bot.retreatGoal.point); p.bot.updateTactics(); assert.equal(p.bot.tactic, 'escape', '撤出后又回爆炸圈');
  r.bomb = { st: 'carried', carrier: p.id }; p.inv[5] = true; Object.assign(p, r.map.spawns.T[0]); r.phaseEnd = r.time + 2;
  p.bot.updateTactics(); assert.equal(p.bot.tactic, 'save', '不可能下包仍冲锋');
  Object.assign(p, at); p.planting = true; p.plantEnd = r.time + 0.6; p.bot.updateTactics(); assert.equal(p.bot.tactic, null);
  r.opts.mode = 'dm'; p.bot.updateTactics(); assert.equal(p.bot.tactic, null);
  console.log('通过：T 爆炸撤离、回合时间判断、已在下包继续完成');
}

// 标准对局中行为确实发生；刀战和复活规则仍可完成对局。
const realRandom = Math.random;
try {
  for (const rules of [undefined, { weapons: 'knife', freeze: 0, roundTime: 40, hp: 50 }, { respawn: 'place', respawnTime: 1, bomb: false, freeze: 0, roundTime: 40 }]) {
    Math.random = mulberry32(714);
    const stats = { kills: 0, rounds: 0, knife: 0, held: 0, saved: 0 };
    const r = new Room({ map: rules ? 'arena' : 'dust2', bots: true, warmup: false, botDiff: 2, rules }, { send() {}, broadcast(m) { if (m.t === 'kill') stats.kills++; if (m.t === 'rend') stats.rounds++; } });
    r.rebalanceBots(); r.startMatch();
    for (let i = 0; i < 8 * 60 * TICK_RATE; i++) {
      r.tick();
      for (const p of r.players.values()) if (p.alive && r.phase === 'live') {
        assert(Number.isFinite(p.x) && Number.isFinite(p.y) && p.y > -1);
        if (p.slot === 3 && p.inv[1]) stats.knife++;
        if (p.bot.holdPost && !p.bot.moveGoal && !p.bot.visible) stats.held++;
        if (p.bot.tactic) stats.saved++;
      }
    }
    assert(stats.kills > 0 && stats.rounds > 0);
    if (!rules) { assert(stats.knife > 0, '实战没有切刀转移'); assert(stats.held > 0, '实战没有架点'); }
    console.log('通过：' + (rules ? JSON.stringify(rules) : '标准爆破') + ' ' + JSON.stringify(stats));
  }
} finally { Math.random = realRandom; }
