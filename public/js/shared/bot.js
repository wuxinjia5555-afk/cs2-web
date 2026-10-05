// 机器人 AI：购买、选路线、寻路、索敌（视野+听觉）、瞄准（反应时间/误差/压枪）、下包、拆包、守点
import { P, TIMES } from './constants.js';
import { WEAPONS } from './weapons.js';
import { angleDiff, anglesFromDir, clamp, dirFromAngles, pick } from './util.js';
import { choosePost, bestDefuser, routeDistance, retreatPost, escapeRadius } from './bottactics.js';

// 人机名字：照 CS:GO / CS2 里人机的起名风格（BOT Albert、BOT Vitaliy 这种）
export const BOT_NAMES = ['Albert', 'Allen', 'Bert', 'Bob', 'Cecil', 'Clarence', 'Elliot', 'Elmer', 'Ernie', 'Eugene', 'Fergus', 'Ferris',
  'Frank', 'Frasier', 'Fred', 'George', 'Graham', 'Harvey', 'Irwin', 'Larry', 'Lester', 'Marvin', 'Neil', 'Niles', 'Oliver', 'Opie',
  'Quinn', 'Ringo', 'Rex', 'Sam', 'Steve', 'Toby', 'Ulric', 'Vitaliy', 'Vladimir', 'Wade', 'Xander', 'Yanni', 'Yuri', 'Zach'];

// 机器人难度（6 档）：react 反应时间、turn 转向速度、aimErr 初始瞄准偏差、errDecay 偏差收敛速度、head 瞄头概率、
// burst 每次连发几枪、comp 压枪程度、range 旧版距离参数（不限制索敌）、fovCos 视野（越大越窄）、strafe 会不会左右晃、pause 两次连发的间隔
export const BOT_DIFF = [
  { name: '新手', react: 1.1, turn: 2.6, aimErr: 0.2, errDecay: 0.7, head: 0.02, burst: [1, 2], comp: 0.05, range: 28, fovCos: 0.6, strafe: false, pause: 0.9 },
  { name: '简单', react: 0.85, turn: 3.6, aimErr: 0.15, errDecay: 1.0, head: 0.05, burst: [1, 3], comp: 0.15, range: 36, fovCos: 0.45, strafe: false, pause: 0.65 },
  { name: '普通', react: 0.6, turn: 5, aimErr: 0.1, errDecay: 1.4, head: 0.08, burst: [2, 4], comp: 0.25, range: 45, fovCos: 0.35, strafe: false, pause: 0.45 },
  { name: '中等', react: 0.36, turn: 8, aimErr: 0.06, errDecay: 2.4, head: 0.2, burst: [3, 5], comp: 0.55, range: 65, fovCos: 0.2, strafe: true, pause: 0.3 },
  { name: '困难', react: 0.2, turn: 13, aimErr: 0.03, errDecay: 4, head: 0.45, burst: [4, 7], comp: 0.8, range: 90, fovCos: 0.0, strafe: true, pause: 0.2 },
  { name: '专家', react: 0.14, turn: 18, aimErr: 0.02, errDecay: 5.5, head: 0.6, burst: [5, 8], comp: 0.9, range: 110, fovCos: -0.2, strafe: true, pause: 0.12 },
];
export const BOT_DIFF_DEFAULT = 2;

export class BotBrain {
  constructor(room, p) {
    this.room = room;
    this.p = p;
    this.d = BOT_DIFF[room.opts.botDiff] || BOT_DIFF[BOT_DIFF_DEFAULT];
    this.cmd = { fwd: 0, side: 0, jump: false, crouch: false, walk: false, yaw: 0, speed: 6, frozen: false };
    this.tmpC = {};
    this.reset();
  }

  reset() {
    this.path = null; this.pathIdx = 0; this.goalKey = null; this.repathAt = 0;
    this.enemy = null; this.visible = false; this.reactAt = 0; this.errY = 0; this.errP = 0; this.aimHead = false;
    this.lastSeen = null; this.lastSeenT = -99; this.nextPerceive = 0;
    this.burst = 0; this.nextBurst = 0; this.nextTap = 0; this.strafeDir = 1; this.strafeUntil = 0; this.crouchUntil = 0;
    this.wantYaw = this.p.yaw; this.wantPitch = 0;
    this.lastPos = { x: this.p.x, z: this.p.z }; this.stuckCheckT = 0; this.stuckCount = 0;
    this.centerUntil = 0; this.centerX = 0; this.centerZ = 0;
    this.evadeUntil = 0; this.evadeDir = 1;
    this.alertT = -99; this.alertPos = null;
    this.guardCell = -1; this.roamCell = -1; this.via = -1;
    this.nadeT = 0;
    this.holdPost = null; this.moveGoal = null; this.retreatGoal = null;
    this.tactic = null; this.nextTactics = 0; this.nextKnifeAt = 0;
  }

  onSpawn() { this.reset(); this.wantYaw = this.p.yaw; }
  onDeath() { this.stopActions(); }
  onBombPlanted() { this.goalKey = null; this.path = null; this.guardCell = -1; this.holdPost = null; this.nextTactics = 0; }
  onHurt(a) {
    if (a && a !== this.p && this.room.isEnemy(this.p, a)) {
      this.alertT = this.room.time;
      this.alertPos = { x: a.x, y: a.y, z: a.z };
    }
  }
  stopActions() {
    if (this.p.planting) this.room.onPlant(this.p, false);
    if (this.p.defusing) this.room.onDefuse(this.p, false);
  }

  onRoundStart() {
    this.buy();
    this.chooseRoute();
  }

  buy() {
    const r = this.room, p = this.p, rnd = r.rng;
    if (r.opts.mode !== 'bomb' || r.phase !== 'freeze') return;
    const T = p.team === 'T';
    const pistolRound = r.round === 1 || r.round === r.opts.maxRounds / 2 + 1;
    if (!p.inv[1]) {
      const x = rnd();
      const rifle = T ? (x < 0.82 ? 'ak47' : 'sg553') : x < 0.42 ? 'm4a4' : x < 0.84 ? 'm4a1s' : 'aug';
      if (p.money >= 5750 && rnd() < 0.2) r.onBuy(p, 'awp');
      else if (p.money >= 6200 && rnd() < 0.04) r.onBuy(p, T ? 'g3sg1' : 'scar20');
      else if (p.money >= WEAPONS[rifle].price + 1000) r.onBuy(p, rifle);
      else if (!pistolRound && p.money >= 2300 && rnd() < 0.6) r.onBuy(p, T ? 'galil' : 'famas');
      else if (!pistolRound && p.money >= 2700 && rnd() < 0.35) r.onBuy(p, pick(['p90', 'negev'], rnd));
      else if (!pistolRound && p.money >= 1900 && rnd() < 0.55) r.onBuy(p, pick(T ? ['mac10', 'ump45', 'mp7', 'bizon', 'mp5sd', 'nova', 'sawedoff'] : ['mp9', 'ump45', 'mp7', 'bizon', 'mp5sd', 'nova', 'mag7'], rnd));
    }
    if (pistolRound && !p.inv[1]) {
      if (p.money >= 700 && rnd() < 0.25) r.onBuy(p, 'deagle');
      else if (p.money >= 650 && rnd() < 0.6) r.onBuy(p, 'vest');
      else if (p.money >= 500 && rnd() < 0.25) r.onBuy(p, pick(T ? ['tec9', 'cz75'] : ['fiveseven', 'cz75'], rnd));
      else if (p.money >= 300 && rnd() < 0.5) r.onBuy(p, pick(['p250', 'p250', 'elite'], rnd));
    }
    if (p.armor < 60 && !pistolRound) {
      if (p.money >= 1000) r.onBuy(p, 'vesthelm');
      else if (p.money >= 650) r.onBuy(p, 'vest');
    }
    if (!T && !p.kit && p.money >= 400 && rnd() < 0.6) r.onBuy(p, 'kit');
    if (p.money >= 300 && rnd() < 0.45) r.onBuy(p, 'he');
    r.onSlot(p, { s: p.inv[1] ? 1 : 2 });
  }

  chooseRoute() {
    const r = this.room, p = this.p, map = r.map, nav = r.nav, rnd = r.rng;
    if (r.opts.mode !== 'bomb') return;
    let name;
    if (p.team === 'T') name = r.plan.T;
    else name = r.plan.ct++ % 2 === 0 ? 'A' : 'B';
    const site = map.sites[name];
    if (!site || !site.cells.length) return;
    this.siteName = name;
    this.siteCell = pick(site.cells, rnd);
    this.via = -1;
    if (p.team === 'T' && rnd() < 0.5) {
      const s = { x: p.x, z: p.z }, g = nav.center(this.siteCell, {});
      const direct = Math.hypot(g.x - s.x, g.z - s.z);
      for (let k = 0; k < 24; k++) {
        const c = nav.randomCell(rnd);
        const m = nav.center(c, {});
        const dd = Math.hypot(m.x - s.x, m.z - s.z) + Math.hypot(g.x - m.x, g.z - m.z);
        if (dd < direct * 1.35 && dd > direct * 1.05) { this.via = c; break; }
      }
    }
    const ts = map.spawns.T[0];
    this.holdYaw = Math.atan2(-(ts.x - site.cx), -(ts.z - site.cz));
  }

  // ---------------- 每帧 ----------------
  update(dt) {
    const r = this.room, p = this.p, cmd = this.cmd, t = r.time;
    cmd.fwd = 0; cmd.side = 0; cmd.jump = false; cmd.walk = false; cmd.crouch = false;
    if (!p.alive) return;
    if (r.phase === 'freeze' || r.phase === 'idle') { this.turn(dt); return; }
    const blind = p.blindUntil > t;
    if (t >= this.nextPerceive) {
      this.nextPerceive = t + 0.1 + r.rng() * 0.05;
      if (blind) this.visible = false;
      else this.perceive();
    }
    if (this.enemy && !this.enemy.alive) { this.enemy = null; this.visible = false; }
    if (t >= this.nextTactics) { this.nextTactics = t + 0.6; this.updateTactics(); }
    if (this.tactic === 'save' || this.tactic === 'escape') {
      this.retreat(); this.weaponMgmt();
      if (this.visible && this.enemy) this.combat(dt, true);
    } else if (this.visible && this.enemy) { this.weaponMgmt(); this.combat(dt); }
    else { this.objective(); this.weaponMgmt(); }
    if (blind) {
      this.wantYaw += (r.rng() - 0.5) * 0.4;
      cmd.fwd = -0.6;
    }
    this.turn(dt);
  }

  perceive() {
    const r = this.room, p = this.p;
    let best = null, bd = Infinity;
    for (const e of r.players.values()) {
      if (!e.alive || !r.isEnemy(p, e)) continue;
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      // 枪械射线最远 200 米。难度只影响反应和准度，不再把远处可见目标删掉。
      if (d > 200) continue;
      const footsteps = r.opts.rules?.steps !== false && Math.hypot(e.vx, e.vz) > 2 && !e.walk && !e.crouched && d < 12;
      const heard = (r.time - e.lastShotT < 0.8 && d < 35) || footsteps;
      if (heard) { this.alertT = r.time; this.alertPos = { x: e.x, y: e.y, z: e.z }; }
      if (!r.canSee(p, e, heard ? -2 : this.d.fovCos)) continue;
      if (d < bd) { bd = d; best = e; }
    }
    if (best) {
      const fresh = this.enemy !== best || r.time - this.lastSeenT > 1.0;
      this.enemy = best;
      if (fresh) {
        this.reactAt = r.time + this.d.react * (0.75 + r.rng() * 0.5);
        const e = this.d.aimErr * (0.6 + r.rng() * 0.8), a = r.rng() * Math.PI * 2;
        this.errY = Math.cos(a) * e;
        this.errP = Math.sin(a) * e * 0.6;
        this.aimHead = r.rng() < this.d.head;
        this.burst = 0;
      }
      this.visible = true;
      this.lastSeen = { x: best.x, y: best.y, z: best.z };
      this.lastSeenT = r.time;
      if (r.intel[p.team]) r.intel[p.team].set(best.id, { x: best.x, y: best.y, z: best.z, t: r.time });
    } else {
      this.visible = false;
      if (this.enemy && r.time - this.lastSeenT > 4) this.enemy = null;
    }
  }

  weaponMgmt() {
    const r = this.room, p = this.p;
    if (p.planting || p.defusing) return;
    const has = (s) => p.inv[s] && p.inv[s].clip + p.inv[s].res > 0;
    const ready = has(1) ? 1 : has(2) ? 2 : 3;
    if (p.reloadEnd && !this.visible) return;
    const loaded = ready !== 3 && p.inv[ready].clip > 0 && (p.inv[ready].res === 0 || p.inv[ready].clip >= WEAPONS[p.inv[ready].w].mag * 0.4);
    if (loaded && this.safeToKnife()) {
      if (p.slot !== 3) r.onSlot(p, { s: 3 });
      return;
    }
    if (p.slot === 3 || p.slot === 4 || p.slot === 5) {
      if (ready !== p.slot) { r.onSlot(p, { s: ready }); this.nextKnifeAt = r.time + 2; }
      return;
    }
    const it = p.inv[p.slot];
    if (!it) return;
    if (it.clip === 0) {
      if (this.visible && p.slot === 1 && p.inv[2] && p.inv[2].clip > 0) r.onSlot(p, { s: 2 });
      else if (it.res > 0) { if (!p.reloadEnd) r.onReload(p); }
      else if (p.slot === 1 && has(2)) r.onSlot(p, { s: 2 });
      else if (!has(1) && !has(2)) r.onSlot(p, { s: 3 });
      return;
    }
    if (!this.visible && !p.reloadEnd && it.res > 0 && it.clip < WEAPONS[it.w].mag * 0.4 && r.time - this.lastSeenT > 2) r.onReload(p);
    if (!this.visible && !p.reloadEnd && p.slot === 2 && has(1) && r.time - this.lastSeenT > 1.5) r.onSlot(p, { s: 1 });
  }

  safeToKnife() {
    const r = this.room, p = this.p, t = r.time, path = this.path;
    if (r.opts.mode !== 'bomb' || r.phase !== 'live' || this.visible || p.reloadEnd || t < this.nextKnifeAt || (p.slot !== 3 && p.drawEnd > t)) return false;
    if (t - this.lastSeenT < 4 || t - this.alertT < 3 || !this.moveGoal || !path?.length) return false;
    if (Math.hypot(this.moveGoal.x - p.x, this.moveGoal.z - p.z) < 16) return false;
    const waypoint = path[Math.min(this.pathIdx, path.length - 1)];
    // 拐角前提前持枪，给拔枪和搜点留时间。
    if (Math.hypot(waypoint.x - p.x, waypoint.z - p.z) < (p.slot === 3 ? 7 : 11)) return false;
    for (const site of Object.values(r.map.sites)) if (Math.hypot(site.cx - p.x, site.cz - p.z) < 14 && this.tactic !== 'escape') return false;
    for (const e of r.intel[p.team]?.values() || []) if (t - e.t < 4 && Math.hypot(e.x - p.x, e.z - p.z) < 35) return false;
    return true;
  }

  combat(dt, retreating = false) {
    const r = this.room, p = this.p, e = this.enemy, cmd = this.cmd, t = r.time;
    if (p.planting) r.onPlant(p, false);
    // 最后一名队友、或松手就来不及再拆时，继续拆包；其他情况仍可自卫。
    if (p.defusing) {
      const remaining = r.bomb?.explodeAt - t, needed = p.kit ? TIMES.defuseKit : TIMES.defuse;
      const allies = [...r.players.values()].filter(q => q.alive && q.team === 'CT').length;
      if (p.defuseEnd - t <= 1 || remaining < needed + 1 || allies <= 1) { this.stop(); return; }
      r.onDefuse(p, false);
    }
    const eyeY = p.y + (p.crouched ? P.crouchEye : P.standEye);
    const hh = e.crouched ? (this.aimHead ? 1.22 : 0.78) : this.aimHead ? 1.66 : 1.16;
    const tx = e.x + e.vx * 0.06, ty = e.y + hh, tz = e.z + e.vz * 0.06;
    const [ay, ap] = anglesFromDir(tx - p.x, ty - eyeY, tz - p.z);
    const k = Math.exp(-this.d.errDecay * dt);
    this.errY *= k; this.errP *= k;
    this.wantYaw = ay + this.errY;
    this.wantPitch = ap + this.errP;
    const dist = Math.hypot(tx - p.x, tz - p.z);
    const w = r.curWeapon(p);
    if (w.type === 'sniper' && !p.scoped && !p.reloadEnd && t >= p.nextFire - 0.2) p.scoped = true;
    const off = Math.abs(angleDiff(p.yaw, this.wantYaw)) + Math.abs(p.pitch - this.wantPitch);
    const tol = Math.atan2(0.3, dist) + 0.01;
    let shooting = false;
    if (t >= this.reactAt && off < tol) {
      if (w.type === 'knife') {
        if (dist < 1.8) r.botShoot(p);
      } else if (w.auto && w.type !== 'sniper') {
        if (this.burst <= 0 && t >= this.nextBurst) {
          this.burst = dist > 25 ? 1 + Math.floor(r.rng() * 2) : this.d.burst[0] + Math.floor(r.rng() * (this.d.burst[1] - this.d.burst[0] + 1));
        }
        if (this.burst > 0) {
          shooting = true;
          if (r.botShoot(p)) {
            this.burst--;
            if (this.burst <= 0) this.nextBurst = t + this.d.pause + r.rng() * 0.3 + (dist > 25 ? 0.25 : 0);
          }
        }
      } else if (t >= this.nextTap && (w.type !== 'sniper' || p.scoped)) {
        if (r.botShoot(p)) {
          shooting = true;
          this.nextTap = t + Math.max(60 / w.rpm, dist > 20 ? 0.4 : 0.22) + r.rng() * 0.15;
        }
      }
    }
    if (!shooting && p.inv[4].includes('he') && dist > 8 && dist < 22 && t > this.nadeT && r.rng() < 0.01) {
      this.nadeT = t + 5;
      this.throwNade('he', e);
    }
    if (retreating) { cmd.crouch = false; return; }
    if (w.type === 'knife') {
      this.moveToward(e.x, e.z);
    } else if (!shooting && this.d.strafe && dist > 4) {
      if (t > this.strafeUntil) { this.strafeDir = r.rng() < 0.5 ? -1 : 1; this.strafeUntil = t + 0.35 + r.rng() * 0.5; }
      cmd.side = this.strafeDir;
    }
    if (this.d.strafe && shooting && dist > 14 && w.type === 'rifle' && t > this.crouchUntil && r.rng() < 0.03) this.crouchUntil = t + 1.2;
    cmd.crouch = t < this.crouchUntil;
  }

  throwNade(type, e) {
    const r = this.room, p = this.p;
    const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz);
    const yaw = Math.atan2(-dx, -dz);
    const pitch = clamp(0.12 + d * 0.013, 0.1, 0.55);
    const dir = dirFromAngles(yaw, pitch);
    const sp = clamp(8 + d * 0.35, 8, 17);
    const eyeY = p.y + (p.crouched ? P.crouchEye : P.standEye);
    const o = [p.x + dir[0] * 0.3, eyeY, p.z + dir[2] * 0.3];
    if (!r.world.clear(p.x, eyeY, p.z, o[0], o[1], o[2])) return;
    r.onThrow(p, { g: type, o, v: [dir[0] * sp, dir[1] * sp, dir[2] * sp] });
  }

  // ---------------- 战术目标 ----------------
  updateTactics() {
    const r = this.room, p = this.p, b = r.bomb, R = r.opts.rules;
    if (r.opts.mode !== 'bomb' || r.phase !== 'live') { this.tactic = null; this.retreatGoal = null; return; }
    let tactic = null;
    if (b?.st === 'planted') {
      const left = b.explodeAt - r.time;
      if (p.team === 'CT') {
        if (!bestDefuser(r)) tactic = 'save';
      } else if (b.defuser == null) {
        if (this.tactic === 'escape') return;
        const radius = escapeRadius(p), dist = Math.hypot(p.x - b.x, p.z - b.z);
        // 下包后先守，爆炸前才撤；按实际撤离路线决定什么时候走。
        if (dist < radius && left < 13) {
          const refuge = this.retreatGoal || retreatPost(this, b);
          if (refuge && left < refuge.route / 5.5 + 1.5) { this.retreatGoal = refuge; tactic = 'escape'; }
        }
      }
    } else if (p.team === 'T' && b && r.phaseEnd - r.time < 15 && p.inv[1] && (!R || R.respawn === 'none')) {
      const carrier = b.st === 'carried' ? r.players.get(b.carrier) : null;
      let travel = Infinity;
      if (carrier?.alive && carrier.planting && carrier.plantEnd + 0.15 < r.phaseEnd) { this.tactic = null; this.retreatGoal = null; return; }
      for (const site of Object.values(r.map.sites)) {
        let dist;
        if (carrier?.alive) dist = routeDistance(r, carrier, site.cx, site.cz);
        else if (b.st === 'dropped') dist = routeDistance(r, p, b.x, b.z) + routeDistance(r, { ...b, y: b.y }, site.cx, site.cz);
        else continue;
        travel = Math.min(travel, dist / 6.0 + TIMES.plant + 0.5);
      }
      if (travel >= r.phaseEnd - r.time) tactic = 'save';
    }
    if (tactic) {
      if (this.tactic !== tactic || !this.retreatGoal) this.retreatGoal = retreatPost(this, b?.st === 'planted' ? b : null);
      this.stopActions();
    } else this.retreatGoal = null;
    this.tactic = tactic;
  }

  retreat() {
    const goal = this.retreatGoal;
    if (!goal) { this.lookAround(); return; }
    if (this.goTo('retreat', goal.cell)) this.hold(goal);
  }

  objective() {
    const r = this.room, p = this.p, t = r.time;
    if (t - this.alertT < 1.5 && this.alertPos) this.wantYaw = anglesFromDir(this.alertPos.x - p.x, 0, this.alertPos.z - p.z)[0];
    if (r.opts.mode === 'dm' || r.phase === 'warmup') { this.roam(); return; }
    if (r.phase === 'over' || r.phase === 'matchover') { this.lookAround(); return; }
    const b = r.bomb;
    if (p.team === 'T') {
      if (p.inv[5]) {
        if (r.inSite(p) && r.phase === 'live') {
          this.stop();
          if (!p.planting && p.onGround) r.onPlant(p, true);
          return;
        }
        if (p.planting) return;
        if (this.siteCell != null) this.goTo('plant', this.siteCell);
        return;
      }
      if (b && b.st === 'dropped') { this.goToPos('bomb', b.x, b.z); return; }
      if (b && b.st === 'planted') { this.guard(b); return; }
      if (this.huntIntel(25)) return;
      if (this.holdPost) { this.defend(this.siteName, 'CT'); return; }
      if (this.via >= 0) { if (this.goTo('via', this.via)) this.via = -1; return; }
      if (this.siteCell != null && this.goTo('site', this.siteCell)) this.defend(this.siteName, 'CT');
    } else {
      if (b && b.st === 'planted') {
        const defuser = bestDefuser(r);
        if (defuser && defuser !== p) { this.guard(b, 'T'); return; }
        const d = Math.hypot(p.x - b.x, p.z - b.z);
        if (d < 1.3 && Math.abs(p.y - b.y) < 1.5) {
          this.stop();
          this.wantPitch = -0.7;
          if (!p.defusing) r.onDefuse(p, true);
          return;
        }
        if (p.defusing) return;
        this.goToPos('defuse', b.x, b.z);
        return;
      }
      // 守方先控制入口，只有近处的新情报才离开站位支援。
      if (this.huntIntel(16)) return;
      this.defend(this.siteName, 'T');
    }
  }

  // 根据队友情报前往最近发现敌人的位置
  huntIntel(maxDist) {
    const r = this.room, p = this.p;
    const intel = r.intel[p.team];
    if (!intel || !intel.size) return false;
    let best = null, bd = maxDist;
    for (const [id, e] of intel) {
      if (r.time - e.t > 5) continue;
      const q = r.players.get(id);
      if (!q || !q.alive) continue;
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      if (d < bd) { bd = d; best = e; }
    }
    if (!best || bd < 3) return false;
    this.goToPos('hunt', best.x, best.z);
    return true;
  }

  hold(post = this.holdPost) {
    this.stop();
    this.moveGoal = null;
    if (post?.watch) {
      const p = this.p, watch = post.watch;
      [this.wantYaw, this.wantPitch] = anglesFromDir(watch.x - p.x, (watch.y || 0) + 1.3 - p.y - P.standEye, watch.z - p.z);
    } else { this.wantYaw = this.holdYaw ?? this.p.yaw; this.wantPitch = 0; }
    if (this.room.curWeapon(this.p).type === 'sniper' && !this.p.reloadEnd) this.p.scoped = true;
    if (this.alertPos && this.room.time - this.alertT < 1.5) this.wantYaw = anglesFromDir(this.alertPos.x - this.p.x, 0, this.alertPos.z - this.p.z)[0];
  }

  lookAround() {
    this.stop();
    this.wantYaw += Math.sin(this.room.time * 0.8 + this.p.id) * 0.01;
  }

  defend(siteName, incomingTeam) {
    if (!this.holdPost) this.holdPost = choosePost(this, siteName, incomingTeam);
    if (this.holdPost && this.goTo('hold', this.holdPost.cell)) this.hold();
    else if (!this.holdPost && this.siteCell != null && this.goTo('site', this.siteCell)) this.hold();
  }

  guard(b, incomingTeam = 'CT') {
    this.defend(b.site || this.siteName, incomingTeam);
    // 看见拆包信息时优先检查炸弹，不能继续背对正在拆包的人。
    if (this.p.team === 'T' && b.defuser != null) {
      if (!this.visible) this.goToPos('stop-defuse', b.x, b.z);
      this.wantYaw = anglesFromDir(b.x - this.p.x, 0, b.z - this.p.z)[0];
    }
  }

  roam() {
    const r = this.room;
    if (this.roamCell < 0 || this.goTo('roam', this.roamCell)) {
      this.roamCell = r.nav.randomCell(r.rng);
      this.goalKey = null;
    }
  }

  // ---------------- 移动 ----------------
  goTo(key, cell) {
    const c = this.room.nav.center(cell, this.tmpC);
    return this.goToPos(key + cell, c.x, c.z);
  }

  goToPos(key, x, z) {
    const r = this.room, p = this.p, nav = r.nav, t = r.time;
    const dx = x - p.x, dz = z - p.z;
    this.moveGoal = { x, z };
    if (dx * dx + dz * dz < 1.0) { this.path = null; this.moveGoal = null; return true; }
    p.scoped = false;
    // 人在楼板下面那一层（比如掉进了地下通道）：周围没有和脚下一样高的可走格子，先照着那一层的路走出去
    const s0 = nav.nearestWalkable(p.x, p.z, p.y, true);
    const lower = s0 < 0 && nav.lower ? nav.lower : null;
    const gk = lower ? 'wayout' : key + '|' + Math.round(x) + ',' + Math.round(z);
    if (this.goalKey !== gk || !this.path || t > this.repathAt) {
      if (this.goalKey !== gk) {
        this.lastPos = { x: p.x, z: p.z }; this.stuckCheckT = t + 0.6; this.stuckCount = 0;
        this.centerUntil = 0; this.evadeUntil = 0;
      }
      this.goalKey = gk;
      this.repathAt = t + 4 + r.rng() * 2;
      let cells = null, on = nav;
      if (lower) { cells = lower.wayOut(p.x, p.z, p.y); on = lower; }
      if (!cells) { on = nav; cells = nav.findPath(s0 >= 0 ? s0 : nav.nearestWalkable(p.x, p.z), nav.nearestWalkable(x, z)); }
      this.path = cells ? on.smooth(cells, p.x, p.z) : null;
      this.pathIdx = 0;
      if (!this.path || !this.path.length) {
        this.path = null;
        this.stop();
        return false;
      }
    }
    this.follow();
    return false;
  }

  follow() {
    const r = this.room, p = this.p, t = r.time, path = this.path;
    while (this.pathIdx < path.length - 1) {
      const w = path[this.pathIdx];
      const dx = w.x - p.x, dz = w.z - p.z;
      // 靠近路点再转向，给窄门和拐角留出完整身位。
      if (dx * dx + dz * dz < 0.1225) this.pathIdx++;
      else break;
    }
    const w = path[Math.min(this.pathIdx, path.length - 1)];
    this.moveToward(w.x, w.z);
    // 被墙角蹭住了：先挪回自己脚下那一格的正中间（人比格子只窄一点点，偏一点就会蹭到墙角），再接着走
    if (t < this.centerUntil) this.moveToward(this.centerX, this.centerZ);
    // 还是卡着：往旁边让一步、退一点（绕开挡路的角），还不行再重新找路
    if (t < this.evadeUntil) { this.cmd.side = this.evadeDir; this.cmd.fwd = -0.4; }
    if (!this.visible) {
      if (this.lastSeen && t - this.lastSeenT < 3) this.wantYaw = anglesFromDir(this.lastSeen.x - p.x, 0, this.lastSeen.z - p.z)[0];
      else if (t - this.alertT > 1.5) this.wantYaw = anglesFromDir(w.x - p.x, 0, w.z - p.z)[0];
      this.wantPitch = 0;
    }
    if (t > this.stuckCheckT) {
      const moved = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z);
      if (moved < 0.3) {
        this.stuckCount++;
        this.cmd.jump = this.stuckCount > 1;
        if (this.stuckCount === 1) {
          const nav = r.nav, ci = nav.nearestWalkable(p.x, p.z, p.y);
          if (ci >= 0) { const c = nav.center(ci, this.tmpC); this.centerX = c.x; this.centerZ = c.z; this.centerUntil = t + 0.35; }
        }
        if (this.stuckCount >= 2) {
          this.evadeDir = this.stuckCount % 2 ? 1 : -1;
          this.evadeUntil = t + 0.45;
        }
        if (this.stuckCount > 3) { this.path = null; this.goalKey = null; this.stuckCount = 0; }
      } else this.stuckCount = 0;
      this.lastPos.x = p.x; this.lastPos.z = p.z;
      this.stuckCheckT = t + 0.6;
    }
  }

  moveToward(x, z) {
    const p = this.p;
    const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz) || 1;
    const nx = dx / d, nz = dz / d, sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    this.cmd.fwd = -nx * sy - nz * cy;
    this.cmd.side = nx * cy - nz * sy;
  }

  stop() { this.cmd.fwd = 0; this.cmd.side = 0; }

  turn(dt) {
    const p = this.p;
    const maxR = this.d.turn * dt;
    p.yaw += clamp(angleDiff(p.yaw, this.wantYaw) * Math.min(1, dt * 14), -maxR, maxR);
    if (p.yaw > Math.PI) p.yaw -= Math.PI * 2;
    else if (p.yaw < -Math.PI) p.yaw += Math.PI * 2;
    p.pitch += clamp((this.wantPitch - p.pitch) * Math.min(1, dt * 14), -maxR, maxR);
    p.pitch = clamp(p.pitch, -1.5, 1.5);
  }
}

// 靶场假人：不开枪，站着 / 蹲着 / 左右来回走，永远面向射击区
export class DummyBrain {
  constructor(room, p, spot) {
    this.room = room;
    this.p = p;
    this.spot = spot;
    this.cmd = { fwd: 0, side: 0, jump: false, crouch: false, walk: false, yaw: 0, speed: 6, frozen: false };
    this.dir = 1;
    this.nextFlip = 0;
  }
  onSpawn() { this.dir = this.room.rng() < 0.5 ? 1 : -1; this.nextFlip = this.room.time + 0.8 + this.room.rng() * 1.5; }
  onDeath() {}
  onRoundStart() {}
  onHurt() {}
  onBombPlanted() {}
  update() {
    const p = this.p, s = this.spot, c = this.cmd, t = this.room.time;
    c.fwd = 0; c.side = 0; c.jump = false; c.walk = !!s.walk; c.crouch = !!s.crouch;
    p.yaw = s.yaw;
    p.pitch = 0;
    if (s.kind !== 'strafe') return;
    // 左右来回走：走到头就掉头，中途偶尔随机换向（像真人左右晃）
    const off = (p.x - s.x) * Math.cos(s.yaw) - (p.z - s.z) * Math.sin(s.yaw);
    if (off > s.w) this.dir = -1;
    else if (off < -s.w) this.dir = 1;
    else if (t > this.nextFlip) { this.dir = -this.dir; this.nextFlip = t + 0.6 + this.room.rng() * 1.6; }
    c.side = this.dir;
  }
}
