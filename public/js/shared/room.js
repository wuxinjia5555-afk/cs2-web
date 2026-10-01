// 房间：权威游戏逻辑（回合、经济、伤害、炸弹、投掷物、掉落、机器人）
// 服务端与"离线练习"共用同一份代码。io = { send(pid, msg), broadcast(msg, exceptPid) }
import { P, TICK_RATE, F, ECON, TIMES, HG, HG_MULT, otherTeam } from './constants.js';
import { WEAPONS, EQUIP, NADE_TYPES, MAX_NADES, defaultPistol, dmgAt, moveSpeed, inaccuracy, spreadDir, isGun, recoverRecoil, patternKick, nextSpray } from './weapons.js';
import { getMap, inRect } from './maps.js';
import { stepPlayer, traceShot, segSphere, hullBlocked } from './physics.js';
import { NADE, NADE_STEP, makeProjectile, stepProjectile } from './grenades.js';
import { BotBrain, BOT_NAMES, DummyBrain } from './bot.js';
import { mulberry32, r2, r3, shuffle, pick, clamp, isNum, isVec3, cleanText, dirFromAngles, DEG } from './util.js';

const DT = 1 / TICK_RATE;
const eyeOf = (p) => p.y + (p.crouched ? P.crouchEye : P.standEye);

export class Room {
  constructor(opts = {}, io = {}) {
    const o = (this.opts = {
      code: opts.code || 'LOCAL',
      name: cleanText(opts.name, 24) || '房间',
      map: typeof opts.map === 'string' ? opts.map : 'sandstorm',
      mode: ['dm', 'range'].includes(opts.mode) ? opts.mode : 'bomb',
      bots: opts.bots !== false,
      botDiff: isNum(opts.botDiff) ? clamp(opts.botDiff | 0, 0, 2) : 1,
      teamSize: isNum(opts.teamSize) ? clamp(opts.teamSize | 0, 1, 5) : 5,
      maxRounds: [8, 16, 24].includes(opts.maxRounds) ? opts.maxRounds : 16,
      ff: !!opts.ff,
      warmup: opts.warmup !== false,
      freeze: isNum(opts.freeze) ? clamp(opts.freeze, 2, 15) : TIMES.freeze,
      roundTime: TIMES.round,
      dmKills: 40,
    });
    this.io = io;
    this.map = getMap(o.map);
    o.map = this.map.id;
    this.world = this.map.world;
    this.nav = this.map.nav;
    this.rng = mulberry32((Math.random() * 4294967296) >>> 0);
    this.players = new Map();
    this.nextId = 1;
    this.eid = 1;
    this.time = 0;
    this.tickN = 0;
    this.phase = 'idle';
    this.phaseEnd = Infinity;
    this.buyEnd = 0;
    this.round = 0;
    this.scores = { T: 0, CT: 0 };
    this.loss = { T: 0, CT: 0 };
    this.bomb = null;
    this.nades = [];
    this.smokes = [];
    this.fires = [];
    this.drops = [];
    this.hostId = -1;
    this.halfPending = false;
    this.matchPending = null;
    this.roundPlanted = false;
    this.plan = { T: 'A', ct: 0 };
    this.intel = { T: new Map(), CT: new Map() };
    // 靶场设置：假人数量 / 移动 / 护甲、子弹、假人回血
    this.rangeOpts = { count: 18, move: 'default', armor: 'mixed', ammo: 'mag', regen: true };
    if (o.mode === 'dm' || o.mode === 'range') this.startMatch();
    else if (o.warmup) this.startWarmup();
  }

  // ---------------- 通讯 ----------------
  send(p, msg) { if (p && !p.isBot && this.io.send) this.io.send(p.id, msg); }
  bcast(msg, exceptId) { if (this.io.broadcast) this.io.broadcast(msg, exceptId); }
  sendTeam(team, msg) { for (const p of this.players.values()) if (!p.isBot && p.team === team) this.send(p, msg); }
  err(p, text) { this.send(p, { t: 'err', text }); }

  // ---------------- 玩家 ----------------
  newPlayer(name, isBot) {
    return {
      id: this.nextId++, name, isBot, bot: null, team: 'SPEC', alive: false,
      hp: 100, armor: 0, helmet: false, kit: false, money: ECON.start,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: true, crouched: false, jumpHeld: false, walk: false,
      yaw: 0, pitch: 0, scoped: false,
      inv: { 1: null, 2: null, 4: [], 5: false }, slot: 3, nade: null,
      drawEnd: 0, reloadEnd: 0, reloadSlot: 0,
      fireTokens: 3, lastFireCheck: 0, lastShotT: -10, nextKnife: 0, nextFire: 0,
      punchP: 0, punchY: 0, spray: 0, fireAcc: 0,
      kills: 0, deaths: 0, assists: 0, score: 0, mvps: 0, roundKills: 0, dmgBy: {},
      hist: [], lastSt: 0, ping: 0, spot: 0,
      planting: false, plantEnd: 0, plantPos: null, defusing: false, defuseEnd: 0, defusePos: null,
      respawnAt: 0, protectUntil: 0, blindUntil: 0, fireDmgAcc: 0,
      dirty: true, chatT: -9, dmLoadout: { 1: null, 2: null }, lastHurtBy: null,
    };
  }

  item(wid) {
    const w = WEAPONS[wid];
    return { w: wid, clip: w.mag, res: w.res };
  }
  defaultInv(team) {
    return { 1: null, 2: this.item(defaultPistol(team)), 4: [], 5: false };
  }
  dmInv(p) {
    let prim = p.dmLoadout[1];
    if (!prim) prim = p.isBot ? pick(['ak47', 'm4a4', 'm4a1s', 'galil', 'famas', 'ak47', 'mp9', 'ump45', 'awp'], this.rng) : p.team === 'CT' ? 'm4a4' : 'ak47';
    return { 1: this.item(prim), 2: this.item(p.dmLoadout[2] || defaultPistol(p.team)), 4: [], 5: false };
  }

  pubInfo(q) {
    return { id: q.id, n: q.name, tm: q.team, b: q.isBot ? 1 : 0, k: q.kills, d: q.deaths, a: q.assists, sc: q.score, mv: q.mvps };
  }

  countTeam(team, humansOnly = false) {
    let n = 0;
    for (const p of this.players.values()) if (p.team === team && (!humansOnly || !p.isBot)) n++;
    return n;
  }
  humans() {
    let n = 0;
    for (const p of this.players.values()) if (!p.isBot) n++;
    return n;
  }
  isEnemy(a, b) {
    if (!a || !b || a === b) return false;
    if (this.opts.mode === 'dm') return true;
    return a.team !== b.team;
  }

  addHuman(name, onCreated) {
    const p = this.newPlayer(cleanText(name, 16) || '玩家', false);
    this.players.set(p.id, p);
    if (onCreated) onCreated(p);
    const host = this.players.get(this.hostId);
    if (!host || host.isBot) this.hostId = p.id;
    this.bcast({ t: 'pjoin', p: this.pubInfo(p) }, p.id);
    this.sendInit(p);
    if (this.opts.mode === 'dm') this.setTeam(p, 'AUTO');
    else if (this.opts.mode === 'range') this.setTeam(p, 'CT');
    return p;
  }

  addBot(team) {
    const used = new Set([...this.players.values()].map((p) => p.name));
    const base = BOT_NAMES.find((n) => !used.has('BOT ' + n));
    const p = this.newPlayer('BOT ' + (base || this.nextId), true);
    p.team = team;
    p.inv = this.defaultInv(team);
    p.bot = new BotBrain(this, p);
    this.players.set(p.id, p);
    this.bcast({ t: 'pjoin', p: this.pubInfo(p) });
    if (this.phase === 'freeze') { this.spawnPlayer(p, this.pickSpawn(team)); p.bot.onRoundStart(); }
    else if (this.phase === 'warmup' || this.phase === 'dm') p.respawnAt = this.time + 0.5;
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.alive) this.dropOnDeath(p, true);
    if (p.planting) p.planting = false;
    if (p.defusing) this.cancelDefuse(p);
    this.players.delete(id);
    this.bcast({ t: 'pleave', id });
    if (id === this.hostId) {
      const h = [...this.players.values()].find((q) => !q.isBot);
      this.hostId = h ? h.id : -1;
      this.bcast({ t: 'host', id: this.hostId });
    }
    if (!p.isBot) this.rebalanceBots();
    this.checkRoundEnd();
  }

  rebalanceBots() {
    if (this.opts.mode === 'range') return;
    for (const team of ['T', 'CT']) {
      const humans = this.countTeam(team, true);
      const bots = [...this.players.values()].filter((p) => p.isBot && p.team === team);
      const want = this.opts.bots ? Math.max(0, this.opts.teamSize - humans) : 0;
      while (bots.length > want) {
        const b = bots.find((x) => !x.alive) || bots[bots.length - 1];
        bots.splice(bots.indexOf(b), 1);
        this.removePlayer(b.id);
      }
      for (let k = bots.length; k < want; k++) this.addBot(team);
    }
  }

  setTeam(p, team) {
    if (!['T', 'CT', 'SPEC', 'AUTO'].includes(team)) return;
    if (this.opts.mode === 'range' && !p.isBot && team !== 'SPEC') team = 'CT'; // 靶场：玩家都在 CT，假人在 T
    if (team === 'AUTO') {
      const hT = this.countTeam('T', true), hC = this.countTeam('CT', true);
      if (p.team === 'T') team = hT - 1 <= hC ? 'T' : 'CT';
      else if (p.team === 'CT') team = hC - 1 <= hT ? 'CT' : 'T';
      else team = hT < hC ? 'T' : hC < hT ? 'CT' : this.countTeam('T') <= this.countTeam('CT') ? 'T' : 'CT';
    }
    if (team !== 'SPEC' && p.team !== team && this.opts.mode !== 'dm' && this.countTeam(team, true) >= 5) {
      this.err(p, '该阵营已满');
      return;
    }
    if (p.team === team) { this.send(p, { t: 'teamok', team }); return; }
    if (p.alive) {
      this.dropOnDeath(p, true);
      p.alive = false;
      p.dirty = true;
    }
    p.team = team;
    p.inv = this.defaultInv(team);
    p.armor = 0; p.helmet = false; p.kit = false; p.slot = 2;
    this.bcast({ t: 'pteam', id: p.id, team });
    this.send(p, { t: 'teamok', team });
    if (!p.isBot) this.rebalanceBots();
    p.dirty = true;
    if (team === 'SPEC') { this.checkRoundEnd(); return; }
    if (this.phase === 'idle' && !p.isBot) { this.startMatch(); return; }
    if (this.phase === 'warmup' || this.phase === 'dm' || this.phase === 'range') {
      p.respawnAt = this.time + 0.3;
      if (this.phase === 'warmup' && this.phaseEnd === Infinity) { this.phaseEnd = this.time + TIMES.warmupMax; this.bcastRound(); }
    } else if (this.phase === 'freeze') {
      this.spawnPlayer(p, this.pickSpawn(team));
    }
    this.checkRoundEnd();
  }

  pickSpawn(team) {
    if (this.phase === 'dm') {
      const list = this.map.dmSpawns;
      let best = list[0], bestD = -1;
      for (let k = 0; k < 14; k++) {
        const s = pick(list, this.rng);
        let md = Infinity;
        for (const q of this.players.values()) if (q.alive) md = Math.min(md, Math.hypot(q.x - s.x, q.z - s.z));
        if (md > bestD) { bestD = md; best = s; }
        if (md > 16) break;
      }
      return { ...best, yaw: this.rng() * Math.PI * 2 };
    }
    const list = this.map.spawns[team] || this.map.spawns.T;
    const alive = [...this.players.values()].filter((q) => q.alive);
    const free = list.filter((s) => !alive.some((q) => Math.abs(q.x - s.x) < 0.9 && Math.abs(q.z - s.z) < 0.9));
    return pick(free.length ? free : list, this.rng);
  }

  spawnPlayer(p, sp) {
    p.alive = true;
    p.hp = 100;
    p.x = sp.x; p.y = sp.y; p.z = sp.z;
    p.vx = p.vy = p.vz = 0;
    p.onGround = true; p.crouched = false; p.jumpHeld = false;
    p.yaw = sp.yaw || 0; p.pitch = 0; p.scoped = false;
    p.slot = p.inv[1] ? 1 : p.inv[2] ? 2 : 3;
    p.drawEnd = this.time + 0.3; p.reloadEnd = 0;
    p.planting = false; p.defusing = false;
    p.dmgBy = {}; p.roundKills = 0; p.hist.length = 0; p.lastSt = this.time;
    p.punchP = p.punchY = p.spray = p.fireAcc = 0;
    p.blindUntil = 0; p.fireDmgAcc = 0; p.respawnAt = 0;
    p.protectUntil = this.phase === 'dm' || this.phase === 'warmup' ? this.time + TIMES.protect : 0;
    p.dirty = true;
    this.send(p, { t: 'spawn', p: [r2(p.x), r2(p.y), r2(p.z)], yaw: r3(p.yaw) });
    if (p.bot) p.bot.onSpawn();
  }

  // ---------------- 阶段 ----------------
  startWarmup() {
    this.phase = 'warmup';
    this.phaseEnd = Infinity;
    this.bcastRound();
  }

  startMatch() {
    this.round = 0;
    this.scores = { T: 0, CT: 0 };
    this.loss = { T: 0, CT: 0 };
    this.halfPending = false;
    this.matchPending = null;
    this.clearRound();
    for (const p of this.players.values()) {
      if (p.planting) p.planting = false;
      if (p.defusing) p.defusing = false;
      p.kills = p.deaths = p.assists = p.score = p.mvps = 0;
      p.money = ECON.start;
      p.inv = this.defaultInv(p.team);
      p.armor = 0; p.helmet = false; p.kit = false;
      p.alive = false;
      p.dirty = true;
    }
    if (this.opts.mode === 'range') {
      this.phase = 'range';
      this.phaseEnd = Infinity;
      this.spawnDummies();
      for (const p of this.players.values()) if (!p.dummy && (p.team === 'T' || p.team === 'CT')) p.respawnAt = this.time + 0.2;
      this.bcastRound();
    } else if (this.opts.mode === 'dm') {
      this.phase = 'dm';
      this.phaseEnd = this.time + TIMES.dmLength;
      for (const p of this.players.values()) if (p.team === 'T' || p.team === 'CT') p.respawnAt = this.time + 0.2;
      this.bcastRound();
    } else {
      this.startRound();
    }
    this.bcast({ t: 'msg', k: 'match_start' });
    this.bcastScores();
  }

  // 靶场：按地图上的位置放假人
  spawnDummies() {
    for (const p of [...this.players.values()]) if (p.dummy) this.removePlayer(p.id);
    const r = this.rangeOpts;
    (this.map.dummies || []).slice(0, r.count).forEach((d0, i) => {
      const d = { ...d0 };
      if (r.move === 'static') d.kind = d0.kind === 'crouch' ? 'crouch' : 'static';
      else if (r.move === 'moving') { d.kind = 'strafe'; d.crouch = false; d.w = Math.max(d0.w, 4); }
      const p = this.newPlayer('假人 ' + (i + 1), true);
      p.team = 'T';
      p.inv = { 1: this.item(i % 4 === 3 ? 'awp' : 'ak47'), 2: this.item('glock'), 4: [], 5: false };
      p.slot = 1;
      p.dummy = d;
      p.bot = new DummyBrain(this, p, d);
      p.armor = r.armor === 'none' ? 0 : 100;
      p.helmet = r.armor === 'helmet' || (r.armor === 'mixed' && i % 2 === 0);
      this.players.set(p.id, p);
      this.bcast({ t: 'pjoin', p: this.pubInfo(p) });
      this.spawnPlayer(p, d);
    });
  }

  // 靶场：假人 3 秒没挨打就回满血；玩家子弹和钱一直是满的
  rangeTick() {
    const sec = this.tickN % TICK_RATE === 0;
    for (const p of this.players.values()) {
      const r = this.rangeOpts;
      if (p.dummy) {
        const ar = r.armor === 'none' ? 0 : 100;
        if (r.regen && p.alive && (p.hp < 100 || p.armor < ar) && this.time - (p.lastHurtT || 0) > 3) { p.hp = 100; p.armor = ar; p.dirty = true; }
      } else if (p.alive) {
        for (const s of [1, 2]) {
          const it = p.inv[s];
          if (!it) continue;
          const w = WEAPONS[it.w];
          if (r.ammo === 'mag' && it.clip < w.mag) { it.clip = w.mag; p.dirty = true; }
          if (sec && r.ammo !== 'off' && it.res < w.res) { it.res = w.res; p.dirty = true; }
        }
        if (sec && p.money < ECON.max) { p.money = ECON.max; p.dirty = true; }
      }
    }
  }

  clearRound() {
    this.bomb = null;
    this.nades = [];
    this.smokes = [];
    this.fires = [];
    this.drops = [];
    this.intel.T.clear();
    this.intel.CT.clear();
    this.bcast({ t: 'reset' });
  }

  startRound() {
    if (this.halfPending) { this.swapTeams(); this.halfPending = false; }
    this.round++;
    this.clearRound();
    const spT = shuffle(this.map.spawns.T.slice(), this.rng), spCT = shuffle(this.map.spawns.CT.slice(), this.rng);
    let iT = 0, iC = 0;
    for (const p of this.players.values()) {
      if (p.team !== 'T' && p.team !== 'CT') continue;
      if (!p.alive) { p.inv = this.defaultInv(p.team); p.armor = 0; p.helmet = false; p.kit = false; }
      // 活下来的人：枪留着，但弹匣和备弹补满（不继承上回合打掉的子弹）
      for (const s of [1, 2]) if (p.inv[s]) { const w = WEAPONS[p.inv[s].w]; p.inv[s].clip = w.mag; p.inv[s].res = w.res; }
      p.inv[5] = false;
      p.alive = false;
      const sp = p.team === 'T' ? spT[iT++ % spT.length] : spCT[iC++ % spCT.length];
      this.spawnPlayer(p, sp);
    }
    const ts = [...this.players.values()].filter((p) => p.team === 'T' && p.alive);
    if (ts.length) {
      const c = pick(ts, this.rng);
      c.inv[5] = true;
      c.dirty = true;
      this.bomb = { st: 'carried', carrier: c.id, x: c.x, y: c.y, z: c.z };
    }
    this.phase = 'freeze';
    this.phaseEnd = this.time + this.opts.freeze;
    this.buyEnd = this.phaseEnd + TIMES.buy;
    this.roundPlanted = false;
    this.plan.T = this.rng() < 0.5 ? 'A' : 'B';
    this.plan.ct = 0;
    for (const p of this.players.values()) if (p.bot && p.alive) p.bot.onRoundStart();
    this.bcastRound();
    this.bcastBomb();
  }

  swapTeams() {
    for (const p of this.players.values()) {
      if (p.team !== 'T' && p.team !== 'CT') continue;
      p.team = otherTeam(p.team);
      p.money = ECON.start;
      p.inv = this.defaultInv(p.team);
      p.armor = 0; p.helmet = false; p.kit = false;
      p.alive = false;
      p.dirty = true;
      this.bcast({ t: 'pteam', id: p.id, team: p.team });
    }
    this.scores = { T: this.scores.CT, CT: this.scores.T };
    this.loss = { T: 0, CT: 0 };
    this.bcast({ t: 'msg', k: 'halftime' });
  }

  endRound(winner, reason, mvpId = null) {
    if (this.phase !== 'live' && this.phase !== 'freeze') return;
    this.phase = 'over';
    this.phaseEnd = this.time + TIMES.roundEnd;
    for (const p of this.players.values()) {
      if (p.planting) this.cancelPlant(p);
      if (p.defusing) this.cancelDefuse(p);
    }
    this.scores[winner]++;
    const loser = otherTeam(winner);
    const reward = reason === 'bomb' ? ECON.winBomb : reason === 'defuse' ? ECON.winDefuse : reason === 'time' ? ECON.winTime : ECON.winElim;
    const lossB = ECON.lossBase + ECON.lossStep * Math.min(this.loss[loser], ECON.lossMaxSteps);
    for (const p of this.players.values()) {
      if (p.team === winner) this.addMoney(p, reward);
      else if (p.team === loser) this.addMoney(p, lossB + (loser === 'T' && this.roundPlanted ? ECON.plantTeamBonus : 0));
    }
    this.loss[winner] = Math.max(0, this.loss[winner] - 1);
    this.loss[loser] = Math.min(ECON.lossMaxSteps, this.loss[loser] + 1);
    let mvp = mvpId != null ? this.players.get(mvpId) : null;
    if (!mvp || mvp.team !== winner) {
      mvp = null;
      for (const p of this.players.values()) if (p.team === winner && p.roundKills > 0 && (!mvp || p.roundKills > mvp.roundKills)) mvp = p;
    }
    if (mvp) mvp.mvps++;
    const winScore = this.opts.maxRounds / 2 + 1;
    if (this.scores[winner] >= winScore) this.matchPending = winner;
    else if (this.round >= this.opts.maxRounds) this.matchPending = 'draw';
    else if (this.round === this.opts.maxRounds / 2) this.halfPending = true;
    this.bcast({ t: 'rend', w: winner, r: reason, sc: this.scores, mvp: mvp ? mvp.id : -1, half: this.halfPending ? 1 : 0, last: this.matchPending ? 1 : 0 });
    this.bcastRound();
    this.bcastScores();
  }

  endMatch(winnerId) {
    let w = this.matchPending;
    if (this.opts.mode === 'dm') {
      let best = null;
      for (const p of this.players.values()) if (p.team !== 'SPEC' && (!best || p.kills > best.kills)) best = p;
      w = winnerId ?? (best ? best.id : null);
    }
    this.phase = 'matchover';
    this.phaseEnd = this.time + TIMES.matchEnd;
    this.matchPending = null;
    this.bcast({ t: 'mend', w, sc: this.scores, mode: this.opts.mode });
    this.bcastScores();
    this.bcastRound();
  }

  checkRoundEnd() {
    if (this.opts.mode !== 'bomb' || this.phase !== 'live') return;
    let tAll = 0, tAlive = 0, cAll = 0, cAlive = 0;
    for (const p of this.players.values()) {
      if (p.team === 'T') { tAll++; if (p.alive) tAlive++; }
      else if (p.team === 'CT') { cAll++; if (p.alive) cAlive++; }
    }
    const planted = this.bomb && this.bomb.st === 'planted';
    if (cAll > 0 && cAlive === 0) { this.endRound('T', 'elim'); return; }
    if (!planted && tAll > 0 && tAlive === 0) this.endRound('CT', 'elim');
  }

  // ---------------- 主循环 ----------------
  tick() {
    const t = (this.time += DT);
    this.tickN++;
    switch (this.phase) {
      case 'warmup':
        this.respawnDead();
        if (t >= this.phaseEnd) this.startMatch();
        break;
      case 'dm':
        this.respawnDead();
        if (t >= this.phaseEnd) this.endMatch();
        break;
      case 'range':
        this.respawnDead();
        this.rangeTick();
        break;
      case 'freeze':
        if (t >= this.phaseEnd) {
          this.phase = 'live';
          this.phaseEnd = t + this.opts.roundTime;
          this.bcastRound();
          this.bcast({ t: 'msg', k: 'go' });
        }
        break;
      case 'live':
        if (!(this.bomb && this.bomb.st === 'planted') && t >= this.phaseEnd) this.endRound('CT', 'time');
        break;
      case 'over':
        if (t >= this.phaseEnd) { if (this.matchPending) this.endMatch(); else this.startRound(); }
        break;
      case 'matchover':
        if (t >= this.phaseEnd) this.startMatch();
        break;
    }

    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (p.bot) {
        p.bot.update(DT);
        const cmd = p.bot.cmd;
        cmd.yaw = p.yaw;
        cmd.speed = moveSpeed(this.curWeapon(p), p.scoped);
        cmd.frozen = this.phase === 'freeze' || p.planting || p.defusing;
        stepPlayer(p, cmd, DT, this.world);
        if (p.y < -30) { this.damage(p, null, 'world', 500, HG.CHEST, { noHg: true, noArmor: true }); continue; }
        this.separate(p);
        p.walk = cmd.walk;
        this.recordHist(p);
        this.botWeaponTick(p);
      }
      this.weaponTick(p);
    }
    this.updateBomb();
    this.updateNades();
    this.updateFires();
    this.updateDrops();
    if (this.tickN % 6 === 0) this.updateSpotted();
    if (this.bomb && this.bomb.st === 'carried') {
      const c = this.players.get(this.bomb.carrier);
      if (c) { this.bomb.x = c.x; this.bomb.y = c.y; this.bomb.z = c.z; }
    }
    this.bcast(this.snapshot());
    for (const p of this.players.values()) {
      if (p.dirty) { p.dirty = false; this.sendSelf(p); }
    }
    if (this.tickN % TICK_RATE === 0) this.bcastScores();
  }

  respawnDead() {
    for (const p of this.players.values()) {
      if (p.alive || (p.team !== 'T' && p.team !== 'CT') || !p.respawnAt || this.time < p.respawnAt) continue;
      if (p.dummy) { p.armor = this.rangeOpts.armor === 'none' ? 0 : 100; this.spawnPlayer(p, p.dummy); continue; }
      if (this.phase === 'dm') p.inv = this.dmInv(p);
      else {
        if (!p.inv[1] && !p.inv[2]) p.inv = this.defaultInv(p.team);
        for (const s of [1, 2]) if (p.inv[s]) { const w = WEAPONS[p.inv[s].w]; p.inv[s].clip = w.mag; p.inv[s].res = w.res; }
        p.money = ECON.max;
      }
      p.armor = 100; p.helmet = true;
      this.spawnPlayer(p, this.pickSpawn(p.team));
    }
  }

  recordHist(p) {
    p.hist.push([this.time, p.x, p.y, p.z]);
    if (p.hist.length > 48) p.hist.shift();
  }

  separate(p) {
    for (const q of this.players.values()) {
      if (q === p || !q.alive) continue;
      const dx = p.x - q.x, dz = p.z - q.z, d2 = dx * dx + dz * dz;
      if (d2 >= 0.64 || Math.abs(p.y - q.y) > 1.5) continue;
      const d = Math.sqrt(d2);
      const nx = d > 1e-3 ? dx / d : this.rng() - 0.5, nz = d > 1e-3 ? dz / d : this.rng() - 0.5;
      const push = (0.8 - d) * 0.5;
      const ox = p.x, oz = p.z;
      p.x += nx * push; p.z += nz * push;
      if (hullBlocked(this.world, p.x, p.y + 0.02, p.z, p.crouched ? P.crouchH : P.standH)) { p.x = ox; p.z = oz; }
    }
  }

  // ---------------- 武器 ----------------
  curWeapon(p) {
    if (p.slot === 1 || p.slot === 2) { const it = p.inv[p.slot]; if (it) return WEAPONS[it.w]; }
    if (p.slot === 4 && p.inv[4].length) return WEAPONS[p.nade && p.inv[4].includes(p.nade) ? p.nade : p.inv[4][0]];
    if (p.slot === 5 && p.inv[5]) return WEAPONS.c4;
    return WEAPONS.knife;
  }

  canShoot() {
    return this.phase !== 'freeze' && this.phase !== 'matchover' && this.phase !== 'idle';
  }

  weaponTick(p) {
    if (p.reloadEnd && this.time >= p.reloadEnd) {
      p.reloadEnd = 0;
      const it = p.inv[p.reloadSlot];
      if (it && p.slot === p.reloadSlot) {
        const w = WEAPONS[it.w];
        const take = Math.min(w.mag - it.clip, it.res);
        it.clip += take; it.res -= take;
        p.dirty = true;
      }
    }
  }

  botWeaponTick(p) {
    recoverRecoil(p, this.curWeapon(p), DT, this.time - p.lastShotT);
  }

  targetList(except) {
    const out = [];
    for (const q of this.players.values()) if (q.alive && q !== except) out.push({ id: q.id, x: q.x, y: q.y, z: q.z, crouched: q.crouched });
    return out;
  }

  // 机器人开枪（服务器端射线判定）
  botShoot(p) {
    const w = this.curWeapon(p);
    if (!p.alive || !this.canShoot()) return false;
    if (w.type === 'knife') return this.botKnife(p);
    if (!isGun(w)) return false;
    const it = p.inv[p.slot];
    if (!it || it.clip <= 0 || this.time < p.nextFire || this.time < p.drawEnd || p.reloadEnd) return false;
    it.clip--;
    p.nextFire = this.time + 60 / w.rpm;
    p.lastShotT = this.time;
    p.protectUntil = 0;
    const speed = Math.hypot(p.vx, p.vz);
    const inacc = inaccuracy(w, { speed, onGround: p.onGround, crouched: p.crouched, scoped: p.scoped, fireAcc: p.fireAcc, maxSpeed: moveSpeed(w, p.scoped) });
    p.fireAcc = Math.min(w.spread.cap, p.fireAcc + w.spread.fire);
    const comp = p.bot ? p.bot.d.comp : 0;
    const yaw = p.yaw + p.punchY * (1 - comp), pitch = p.pitch + p.punchP * (1 - comp);
    const pat = patternKick(w, p.spray);
    p.punchY += pat[0] * DEG;
    p.punchP += pat[1] * DEG;
    p.spray = nextSpray(w, p.spray);
    const ox = p.x, oy = eyeOf(p), oz = p.z;
    const targets = this.targetList(p);
    const ends = [];
    const tmp = [0, 0, 0];
    for (let k = 0; k < (w.pellets || 1); k++) {
      const dir = spreadDir(yaw, pitch, inacc + (w.spread.pellet || 0), this.rng, tmp);
      const res = traceShot(this.world, ox, oy, oz, dir[0], dir[1], dir[2], 200, targets, p.id);
      if (res.kind === 2) {
        const tg = this.players.get(res.id);
        if (tg) this.damage(tg, p, w.id, dmgAt(w, res.t), res.g, { from: [ox, oy, oz] });
      }
      ends.push([r2(res.x), r2(res.y), r2(res.z), res.kind]);
    }
    this.bcast({ t: 'shot', id: p.id, w: w.id, o: [r2(ox), r2(oy), r2(oz)], e: ends });
    if (w.type === 'sniper') p.scoped = false;
    return true;
  }

  botKnife(p) {
    if (this.time < p.nextKnife || this.time < p.drawEnd) return false;
    p.nextKnife = this.time + 0.5;
    this.bcast({ t: 'shot', id: p.id, w: 'knife', o: [r2(p.x), r2(eyeOf(p)), r2(p.z)], e: [] });
    const f = dirFromAngles(p.yaw, 0);
    for (const q of this.players.values()) {
      if (!q.alive || !this.isEnemy(p, q)) continue;
      const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
      if (d < 1.7 && Math.abs(q.y - p.y) < 1.2 && (dx * f[0] + dz * f[2]) / (d || 1) > 0.6) {
        this.damage(q, p, 'knife', 40, HG.CHEST, { noHg: true, from: [p.x, eyeOf(p), p.z] });
        break;
      }
    }
    return true;
  }

  // ---------------- 伤害 ----------------
  damage(v, a, wid, dmg, g, opts = {}) {
    if (!v.alive || this.phase === 'matchover') return;
    if (v.protectUntil > this.time) return;
    if (a && a !== v && !this.isEnemy(a, v) && !this.opts.ff) return;
    v.lastHurtT = this.time;
    const w = WEAPONS[wid];
    const pen = w && w.pen != null ? w.pen : 1;
    let d = dmg * (opts.noHg ? 1 : HG_MULT[g]);
    let armorLoss = 0;
    const helmetHit = !opts.noHg && g === HG.HEAD && v.helmet && v.armor > 0;
    if (!opts.noArmor && v.armor > 0 && (g === HG.HEAD ? v.helmet || opts.noHg : g !== HG.LEGS)) {
      let hpD = d * pen;
      armorLoss = (d - hpD) * 0.5;
      if (armorLoss > v.armor) { armorLoss = v.armor; hpD = d - v.armor * 2; }
      d = hpD;
    }
    const loss = Math.max(1, Math.floor(d));
    v.armor = Math.max(0, Math.round(v.armor - armorLoss));
    const real = Math.min(loss, v.hp);
    v.hp -= loss;
    if (a && a !== v) { v.dmgBy[a.id] = (v.dmgBy[a.id] || 0) + real; v.lastHurtBy = a.id; }
    v.dirty = true;
    const from = opts.from || (a ? [a.x, eyeOf(a), a.z] : null);
    this.send(v, { t: 'hurt', a: a ? a.id : -1, d: real, hp: Math.max(0, v.hp), ar: v.armor, o: from ? [r2(from[0]), r2(from[1]), r2(from[2])] : null, g, w: wid });
    if (a && a !== v) this.send(a, { t: 'hit', v: v.id, d: real, g: opts.noHg ? 1 : g, hm: helmetHit ? 1 : 0, k: v.hp <= 0 ? 1 : 0 });
    if (v.bot) v.bot.onHurt(a);
    if (v.hp <= 0) this.kill(v, a, wid, g === HG.HEAD && !opts.noHg);
  }

  dropOnDeath(v, keepPrimary = false) {
    if (v.dummy) return;
    const dm = this.opts.mode === 'dm' || this.opts.mode === 'range' || this.phase === 'warmup';
    if (!dm && !keepPrimary) {
      if (v.inv[1]) this.dropItem(v, 1, false);
      else if (v.inv[2]) this.dropItem(v, 2, false);
    }
    if (v.inv[5]) this.dropItem(v, 5, false);
  }

  kill(v, a, wid, hs) {
    v.alive = false;
    v.hp = 0;
    v.deaths++;
    if (v.planting) this.cancelPlant(v);
    if (v.defusing) this.cancelDefuse(v);
    v.reloadEnd = 0;
    v.scoped = false;
    const dm = this.opts.mode === 'dm' || this.opts.mode === 'range' || this.phase === 'warmup';
    this.dropOnDeath(v);
    if (!dm) { v.inv[4] = []; v.kit = false; }
    let assister = null;
    if (a && a !== v) {
      if (this.isEnemy(a, v)) {
        a.kills++; a.roundKills++; a.score += 2;
        if (!dm) this.addMoney(a, (WEAPONS[wid] && WEAPONS[wid].killReward) ?? 300);
      } else {
        a.kills--; a.score -= 2;
        if (!dm) this.addMoney(a, -ECON.teamKillPenalty);
      }
      a.dirty = true;
    }
    let bestDmg = 40;
    for (const id in v.dmgBy) {
      const q = this.players.get(+id);
      if (q && q !== a && v.dmgBy[id] > bestDmg && this.isEnemy(q, v)) { bestDmg = v.dmgBy[id]; assister = q; }
    }
    if (assister) { assister.assists++; assister.score += 1; }
    v.dmgBy = {};
    this.bcast({ t: 'kill', k: a ? a.id : -1, v: v.id, w: wid, hs: hs ? 1 : 0, as: assister ? assister.id : -1 });
    if (v.bot) v.bot.onDeath();
    if (this.phase === 'dm' || this.phase === 'warmup') v.respawnAt = this.time + (this.phase === 'dm' ? TIMES.dmRespawn : TIMES.warmupRespawn);
    else if (this.phase === 'range') v.respawnAt = this.time + (v.dummy ? 1.5 : 1);
    v.dirty = true;
    if (this.phase === 'dm' && a && a !== v && a.kills >= this.opts.dmKills) this.endMatch(a.id);
    this.checkRoundEnd();
  }

  addMoney(p, n) {
    p.money = clamp(p.money + n, 0, ECON.max);
    p.dirty = true;
  }

  // ---------------- 消息处理 ----------------
  handle(pid, m) {
    const p = this.players.get(pid);
    if (!p || !m || typeof m.t !== 'string') return;
    switch (m.t) {
      case 'st': this.onState(p, m); break;
      case 'fire': this.onFire(p, m); break;
      case 'reload': this.onReload(p); break;
      case 'slot': this.onSlot(p, m); break;
      case 'buy': this.onBuy(p, String(m.item)); break;
      case 'drop': this.onDrop(p); break;
      case 'use': this.onUse(p); break;
      case 'plant': this.onPlant(p, !!m.on); break;
      case 'defuse': this.onDefuse(p, !!m.on); break;
      case 'throw': this.onThrow(p, m); break;
      case 'chat': this.onChat(p, m); break;
      case 'team': this.setTeam(p, String(m.team)); break;
      case 'start': if (p.id === this.hostId && this.phase === 'warmup') this.startMatch(); break;
      case 'range': if (this.opts.mode === 'range') this.setRangeOpts(m.o); break;
    }
  }

  setRangeOpts(o) {
    if (!o || typeof o !== 'object') return;
    const r = this.rangeOpts, before = [r.count, r.move, r.armor].join();
    if (isNum(o.count)) r.count = clamp(o.count | 0, 0, (this.map.dummies || []).length);
    if (['default', 'static', 'moving'].includes(o.move)) r.move = o.move;
    if (['mixed', 'helmet', 'vest', 'none'].includes(o.armor)) r.armor = o.armor;
    if (['reserve', 'mag', 'off'].includes(o.ammo)) r.ammo = o.ammo;
    if (typeof o.regen === 'boolean') r.regen = o.regen;
    if ([r.count, r.move, r.armor].join() !== before) this.spawnDummies();
    this.bcast({ t: 'rangeopts', o: r });
  }

  onState(p, m) {
    if (Array.isArray(m.a) && isNum(m.a[0]) && isNum(m.a[1])) {
      p.yaw = m.a[0];
      p.pitch = clamp(m.a[1], -1.56, 1.56);
    }
    if (isNum(m.pg)) p.ping = clamp(m.pg | 0, 0, 999);
    if (!p.alive) return;
    const f = m.f | 0;
    p.crouched = !!(f & F.CROUCH);
    p.walk = !!(f & F.WALK);
    p.onGround = !!(f & F.GROUND);
    p.scoped = !!(f & F.SCOPED);
    if (!isVec3(m.p) || this.phase === 'freeze') return;
    const [x, y, z] = m.p;
    const dt = Math.max(0.03, this.time - p.lastSt);
    const dx = x - p.x, dz = z - p.z;
    const maxD = 9 * dt + 1.5;
    if (dx * dx + dz * dz > maxD * maxD || Math.abs(y - p.y) > 25 * dt + 3 || x < 0 || z < 0 || x > this.map.bounds.x1 || z > this.map.bounds.z1) {
      this.send(p, { t: 'spawn', p: [r2(p.x), r2(p.y), r2(p.z)], yaw: r3(p.yaw), fix: 1 });
      p.lastSt = this.time;
      return;
    }
    p.x = x; p.y = y; p.z = z;
    if (isVec3(m.v)) { p.vx = m.v[0]; p.vy = m.v[1]; p.vz = m.v[2]; }
    p.lastSt = this.time;
    this.recordHist(p);
  }

  onFire(p, m) {
    if (!p.alive || !this.canShoot()) return;
    const w = this.curWeapon(p);
    if (w.id !== m.w) return;
    if (w.type === 'knife') { this.onKnife(p, m); return; }
    if (!isGun(w)) return;
    const it = p.inv[p.slot];
    if (!it || it.clip <= 0) return;
    if (this.time < p.drawEnd - 0.35) return;
    if (p.reloadEnd) {
      if (this.time >= p.reloadEnd - 0.6) { p.reloadEnd = this.time; this.weaponTick(p); }
      else return;
    }
    const iv = 60 / w.rpm;
    p.fireTokens = Math.min(3, p.fireTokens + (this.time - p.lastFireCheck) / iv);
    p.lastFireCheck = this.time;
    if (p.fireTokens < 0.6) return;
    p.fireTokens -= 1;
    it.clip--;
    p.protectUntil = 0;
    p.lastShotT = this.time;
    if (!isVec3(m.o)) return;
    const o = m.o;
    if (Math.abs(o[0] - p.x) > 2.5 || Math.abs(o[2] - p.z) > 2.5 || Math.abs(o[1] - eyeOf(p)) > 2.5) return;
    const hits = Array.isArray(m.h) ? m.h.slice(0, w.pellets || 1) : [];
    for (const h of hits) this.applyClientHit(p, w, o, h);
    const e = Array.isArray(m.e) ? m.e.slice(0, 12).filter((v) => Array.isArray(v) && v.length >= 3 && isNum(v[0]) && isNum(v[1]) && isNum(v[2])) : [];
    this.bcast({ t: 'shot', id: p.id, w: w.id, o: [r2(o[0]), r2(o[1]), r2(o[2])], e }, p.id);
  }

  applyClientHit(p, w, o, h) {
    if (!Array.isArray(h) || h.length < 8) return;
    const tg = this.players.get(h[0]);
    if (!tg || !tg.alive || tg === p) return;
    const g = h[1] | 0;
    if (g < 0 || g > 3) return;
    for (let k = 2; k < 8; k++) if (!isNum(h[k])) return;
    const hx = h[2], hy = h[3], hz = h[4], tx = h[5], ty = h[6], tz = h[7];
    if (!this.nearHistory(tg, tx, ty, tz, 1.6)) return;
    if (Math.abs(hx - tx) > 0.7 || Math.abs(hz - tz) > 0.7 || hy < ty - 0.3 || hy > ty + 2.1) return;
    const dx = hx - o[0], dy = hy - o[1], dz = hz - o[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > 250 || d < 0.01) return;
    const r = this.world.raycast(o[0], o[1], o[2], dx / d, dy / d, dz / d, d);
    if (r && r.t < d - 0.25) return;
    this.damage(tg, p, w.id, dmgAt(w, d), g, { from: o });
  }

  nearHistory(tg, x, y, z, tol) {
    const t2 = tol * tol;
    const chk = (px, py, pz) => {
      const dx = px - x, dz = pz - z;
      return dx * dx + dz * dz < t2 && Math.abs(py - y) < 1.6;
    };
    if (chk(tg.x, tg.y, tg.z)) return true;
    for (let k = tg.hist.length - 1; k >= 0; k--) {
      const e = tg.hist[k];
      if (this.time - e[0] > 1.2) break;
      if (chk(e[1], e[2], e[3])) return true;
    }
    return false;
  }

  onKnife(p, m) {
    if (this.time < p.drawEnd - 0.3 || this.time < p.nextKnife - 0.2) return;
    const stab = !!m.stab;
    p.nextKnife = this.time + (stab ? 1.0 : 0.45);
    p.protectUntil = 0;
    this.bcast({ t: 'shot', id: p.id, w: 'knife', o: [r2(p.x), r2(eyeOf(p)), r2(p.z)], e: [], stab: stab ? 1 : 0 }, p.id);
    const h = Array.isArray(m.h) ? m.h[0] : null;
    if (!Array.isArray(h)) return;
    const tg = this.players.get(h[0]);
    if (!tg || !tg.alive || tg === p) return;
    if (!this.nearHistory(tg, p.x, tg.y, p.z, 2.6)) return;
    const fx = -Math.sin(tg.yaw), fz = -Math.cos(tg.yaw);
    let ax = tg.x - p.x, az = tg.z - p.z;
    const al = Math.hypot(ax, az) || 1;
    ax /= al; az /= al;
    const back = fx * ax + fz * az > 0.5;
    const dmg = stab ? (back ? 180 : 65) : back ? 90 : 40;
    this.damage(tg, p, 'knife', dmg, HG.CHEST, { noHg: true, from: [p.x, eyeOf(p), p.z] });
  }

  onReload(p) {
    if (!p.alive || p.reloadEnd || (p.slot !== 1 && p.slot !== 2)) return;
    const it = p.inv[p.slot];
    if (!it) return;
    const w = WEAPONS[it.w];
    if (it.clip >= w.mag || it.res <= 0) return;
    p.reloadEnd = this.time + w.reload;
    p.reloadSlot = p.slot;
    p.scoped = false;
    this.bcast({ t: 'rl', id: p.id, w: w.id }, p.id);
  }

  onSlot(p, m) {
    const s = m.s | 0;
    if (s < 1 || s > 5) return;
    if ((s === 1 || s === 2) && !p.inv[s]) return;
    if (s === 4) {
      if (!p.inv[4].length) return;
      p.nade = NADE_TYPES.includes(m.g) && p.inv[4].includes(m.g) ? m.g : p.inv[4][0];
    }
    if (s === 5 && !p.inv[5]) return;
    if (p.slot !== s) {
      p.slot = s;
      p.drawEnd = this.time + (this.curWeapon(p).deploy || 0.5);
    }
    p.reloadEnd = 0;
    p.scoped = false;
    if (p.planting && s !== 5) this.cancelPlant(p);
  }

  inBuyZone(p) {
    return (this.map.buy[p.team] || []).some((z) => inRect(z, p.x, p.z));
  }

  onBuy(p, item) {
    if (!p.alive || (p.team !== 'T' && p.team !== 'CT')) return;
    const free = this.phase === 'warmup' || this.phase === 'dm' || this.phase === 'range';
    if (!free) {
      if (!(this.phase === 'freeze' || (this.phase === 'live' && this.time < this.buyEnd))) return this.err(p, '购买时间已过');
      if (!this.inBuyZone(p)) return this.err(p, '不在购买区内');
    }
    const w = WEAPONS[item], eq = EQUIP[item];
    const def = (w && w.price) ? w : eq;
    if (!def) return;
    if (def.team && def.team !== p.team && this.opts.mode !== 'dm' && this.opts.mode !== 'range') return this.err(p, '本阵营无法购买');
    let price = free ? 0 : def.price;
    if (item === 'vesthelm' && p.armor >= 100 && !free) price = 350;
    if (p.money < price) return this.err(p, '金钱不足');
    if (w) {
      if (w.slot === 1 || w.slot === 2) {
        const cur = p.inv[w.slot];
        if (cur && cur.w === item) {
          if (!free) return this.err(p, '已拥有该武器');
          cur.clip = w.mag; cur.res = w.res;
        } else {
          if (cur && !free) this.dropItem(p, w.slot, false);
          p.inv[w.slot] = this.item(item);
        }
        if (this.opts.mode === 'dm') p.dmLoadout[w.slot] = item;
        p.slot = w.slot;
        p.drawEnd = this.time + w.deploy;
        p.reloadEnd = 0;
        p.scoped = false;
      } else if (w.slot === 4) {
        if (this.opts.mode === 'dm') return this.err(p, '死斗模式不能购买投掷物');
        if (p.inv[4].filter((x) => x === item).length >= w.max) return this.err(p, '该投掷物已达上限');
        if (p.inv[4].length >= MAX_NADES) return this.err(p, '投掷物已满');
        p.inv[4].push(item);
      } else return;
    } else if (item === 'vest') {
      if (p.armor >= 100) return this.err(p, '已有防弹衣');
      p.armor = 100;
    } else if (item === 'vesthelm') {
      if (p.armor >= 100 && p.helmet) return this.err(p, '已有防弹衣和头盔');
      p.armor = 100; p.helmet = true;
    } else if (item === 'kit') {
      if (p.team !== 'CT') return;
      if (p.kit) return this.err(p, '已有拆弹器');
      p.kit = true;
    } else return;
    p.money -= price;
    p.dirty = true;
    this.send(p, { t: 'bought', item });
  }

  dropItem(p, slot, throwIt) {
    let wid, clip = 0, res = 0;
    if (slot === 5) {
      if (!p.inv[5]) return null;
      p.inv[5] = false;
      wid = 'c4';
      if (p.planting) this.cancelPlant(p);
    } else if (slot === 1 || slot === 2) {
      const it = p.inv[slot];
      if (!it) return null;
      p.inv[slot] = null;
      wid = it.w; clip = it.clip; res = it.res;
    } else return null;
    const dir = dirFromAngles(p.yaw, clamp(p.pitch, -0.3, 0.6));
    const sp = throwIt ? 4 : 1.2;
    const o = [r2(p.x), r2(eyeOf(p) - 0.25), r2(p.z)];
    const v = [r2(dir[0] * sp + p.vx * 0.5), r2(dir[1] * sp + 1.5), r2(dir[2] * sp + p.vz * 0.5)];
    const d = { id: this.eid++, w: wid, clip, res, by: p.id, t: this.time, pr: makeProjectile(o, v, 0.25) };
    this.drops.push(d);
    if (this.drops.length > 40) {
      const old = this.drops.find((x) => x.w !== 'c4');
      if (old) { this.drops.splice(this.drops.indexOf(old), 1); this.bcast({ t: 'pick', id: old.id, by: -1 }); }
    }
    if (wid === 'c4') { this.bomb = { st: 'dropped', drop: d.id, x: o[0], y: o[1], z: o[2] }; this.bcastBomb(); }
    this.bcast({ t: 'drop', d: [d.id, wid, o[0], o[1], o[2], v[0], v[1], v[2]] });
    if (p.slot === slot) {
      p.slot = p.inv[1] ? 1 : p.inv[2] ? 2 : 3;
      p.drawEnd = this.time + 0.4;
      p.reloadEnd = 0;
    }
    p.dirty = true;
    return d;
  }

  onDrop(p) {
    if (!p.alive || this.opts.mode === 'dm') return;
    if (p.slot === 1 || p.slot === 2 || p.slot === 5) this.dropItem(p, p.slot, true);
  }

  onUse(p) {
    if (!p.alive) return;
    let best = null, bd = 2.2 * 2.2;
    for (const d of this.drops) {
      if (d.w === 'c4') continue;
      const dx = d.pr.x - p.x, dz = d.pr.z - p.z, dy = d.pr.y - p.y;
      const dd = dx * dx + dz * dz;
      if (dd < bd && Math.abs(dy) < 2) { bd = dd; best = d; }
    }
    if (!best) return;
    const w = WEAPONS[best.w];
    if (p.inv[w.slot]) this.dropItem(p, w.slot, false);
    this.pickup(p, best);
  }

  pickup(p, d) {
    const idx = this.drops.indexOf(d);
    if (idx < 0) return;
    this.drops.splice(idx, 1);
    if (d.w === 'c4') {
      p.inv[5] = true;
      this.bomb = { st: 'carried', carrier: p.id, x: p.x, y: p.y, z: p.z };
      this.bcastBomb();
    } else {
      const w = WEAPONS[d.w];
      p.inv[w.slot] = { w: d.w, clip: d.clip, res: d.res };
      if (p.bot && (p.slot === 3 || (p.slot === 2 && w.slot === 1))) { p.slot = w.slot; p.drawEnd = this.time + w.deploy; }
    }
    p.dirty = true;
    this.bcast({ t: 'pick', id: d.id, by: p.id, w: d.w });
  }

  updateDrops() {
    for (let k = this.drops.length - 1; k >= 0; k--) {
      const d = this.drops[k];
      if (!d.pr.rest) {
        const target = this.time - d.t;
        while (d.pr.age + NADE_STEP <= target + 1e-9) stepProjectile(d.pr, NADE_STEP, this.world, 20);
        if (d.pr.rest) this.bcast({ t: 'dropr', id: d.id, p: [r2(d.pr.x), r2(d.pr.y), r2(d.pr.z)] });
        if (d.pr.y < -20) { this.drops.splice(k, 1); this.bcast({ t: 'pick', id: d.id, by: -1 }); continue; }
      }
      if (d.w === 'c4' && this.bomb && this.bomb.st === 'dropped') { this.bomb.x = d.pr.x; this.bomb.y = d.pr.y; this.bomb.z = d.pr.z; }
    }
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      for (let k = this.drops.length - 1; k >= 0; k--) {
        const d = this.drops[k];
        if (d.by === p.id && this.time - d.t < 1.0) continue;
        const dx = d.pr.x - p.x, dz = d.pr.z - p.z, dy = d.pr.y - p.y;
        if (dx * dx + dz * dz > 1.0 || dy < -0.6 || dy > 1.5) continue;
        if (d.w === 'c4') { if (p.team === 'T' && this.opts.mode === 'bomb') this.pickup(p, d); continue; }
        if (!p.inv[WEAPONS[d.w].slot]) this.pickup(p, d);
      }
    }
  }

  // ---------------- 炸弹 ----------------
  inSite(p) {
    for (const s of Object.values(this.map.sites)) if (inRect(s, p.x, p.z) && Math.abs(p.y - s.y) < 2.5) return s.name;
    return null;
  }

  onPlant(p, on) {
    if (!on) { if (p.planting) this.cancelPlant(p); return; }
    if (!p.alive || p.team !== 'T' || !p.inv[5] || this.phase !== 'live' || p.planting) return;
    if (!this.inSite(p)) return this.err(p, '必须在包点内安放炸弹');
    if (!p.onGround) return;
    p.planting = true;
    p.plantEnd = this.time + TIMES.plant;
    p.plantPos = [p.x, p.z];
    p.slot = 5;
    this.bcast({ t: 'planting', id: p.id, on: 1 });
  }
  cancelPlant(p) {
    p.planting = false;
    this.bcast({ t: 'planting', id: p.id, on: 0 });
  }

  onDefuse(p, on) {
    if (!on) { if (p.defusing) this.cancelDefuse(p); return; }
    const b = this.bomb;
    if (!p.alive || p.team !== 'CT' || !b || b.st !== 'planted' || p.defusing) return;
    if (Math.hypot(p.x - b.x, p.z - b.z) > 2.0 || Math.abs(p.y - b.y) > 1.8) return;
    if (b.defuser != null && b.defuser !== p.id) return;
    p.defusing = true;
    p.defuseEnd = this.time + (p.kit ? TIMES.defuseKit : TIMES.defuse);
    p.defusePos = [p.x, p.z];
    b.defuser = p.id;
    b.defuseEnd = p.defuseEnd;
    this.bcast({ t: 'defusing', id: p.id, on: 1, kit: p.kit ? 1 : 0 });
    this.bcastBomb();
  }
  cancelDefuse(p) {
    p.defusing = false;
    if (this.bomb && this.bomb.defuser === p.id) { this.bomb.defuser = null; this.bomb.defuseEnd = 0; this.bcastBomb(); }
    this.bcast({ t: 'defusing', id: p.id, on: 0 });
  }

  updateBomb() {
    for (const p of this.players.values()) {
      if (!p.planting) continue;
      const moved = Math.hypot(p.x - p.plantPos[0], p.z - p.plantPos[1]);
      if (!p.alive || !p.inv[5] || this.phase !== 'live' || moved > 0.5) this.cancelPlant(p);
      else if (this.time >= p.plantEnd) this.plantBomb(p);
    }
    const b = this.bomb;
    if (!b || b.st !== 'planted' || this.phase !== 'live') return;
    if (this.time >= b.explodeAt) { this.explodeBomb(); return; }
    if (b.defuser != null) {
      const p = this.players.get(b.defuser);
      if (!p || !p.alive || !p.defusing || Math.hypot(p.x - p.defusePos[0], p.z - p.defusePos[1]) > 0.5) {
        if (p) this.cancelDefuse(p);
        else { b.defuser = null; this.bcastBomb(); }
      } else if (this.time >= p.defuseEnd) this.defuseBomb(p);
    }
  }

  plantBomb(p) {
    p.planting = false;
    p.inv[5] = false;
    p.dirty = true;
    const site = this.inSite(p) || 'A';
    this.bomb = { st: 'planted', x: p.x, y: p.y, z: p.z, site, plantedAt: this.time, explodeAt: this.time + TIMES.bomb, planter: p.id, defuser: null, defuseEnd: 0 };
    this.roundPlanted = true;
    this.addMoney(p, ECON.plantReward);
    p.score += 2;
    this.phaseEnd = this.bomb.explodeAt;
    if (p.slot === 5) { p.slot = p.inv[1] ? 1 : p.inv[2] ? 2 : 3; p.drawEnd = this.time + 0.5; }
    this.bcastBomb();
    this.bcastRound();
    this.bcast({ t: 'msg', k: 'planted', site });
    for (const q of this.players.values()) if (q.bot) q.bot.onBombPlanted();
  }

  defuseBomb(p) {
    const b = this.bomb;
    b.st = 'defused';
    b.defuser = null;
    p.defusing = false;
    this.addMoney(p, ECON.defuseReward);
    p.score += 2;
    this.bcastBomb();
    this.bcast({ t: 'msg', k: 'defused' });
    this.endRound('CT', 'defuse', p.id);
  }

  explodeBomb() {
    const b = this.bomb;
    b.st = 'exploded';
    this.bcastBomb();
    this.endRound('T', 'bomb', b.planter);
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const d = Math.hypot(p.x - b.x, p.y + 1 - b.y, p.z - b.z);
      const dmg = 500 * Math.exp(-(d * d) / (2 * 11 * 11));
      if (dmg >= 1) this.damage(p, null, 'c4', dmg, HG.CHEST, { noHg: true, from: [b.x, b.y + 0.5, b.z] });
    }
  }

  bombInfo() {
    const b = this.bomb;
    if (!b) return null;
    return {
      st: b.st, x: r2(b.x), y: r2(b.y), z: r2(b.z), c: b.carrier ?? -1, site: b.site || null,
      ea: b.explodeAt ? Math.round(b.explodeAt * 1000) : 0, pa: b.plantedAt ? Math.round(b.plantedAt * 1000) : 0,
      df: b.defuser ?? -1, de: b.defuseEnd ? Math.round(b.defuseEnd * 1000) : 0,
    };
  }
  bcastBomb() { this.bcast({ t: 'bomb', b: this.bombInfo() }); }

  // ---------------- 投掷物 ----------------
  onThrow(p, m) {
    if (!p.alive || !this.canShoot()) return;
    const type = String(m.g);
    const idx = p.inv[4].indexOf(type);
    if (idx < 0 || !isVec3(m.o) || !isVec3(m.v)) return;
    if (Math.abs(m.o[0] - p.x) > 2 || Math.abs(m.o[2] - p.z) > 2 || Math.abs(m.o[1] - eyeOf(p)) > 2) return;
    if (Math.hypot(m.v[0], m.v[1], m.v[2]) > 30) return;
    p.inv[4].splice(idx, 1);
    p.dirty = true;
    if (p.slot === 4 && !p.inv[4].length) { p.slot = p.inv[1] ? 1 : p.inv[2] ? 2 : 3; p.drawEnd = this.time + 0.4; }
    p.protectUntil = 0;
    const o = [r2(m.o[0]), r2(m.o[1]), r2(m.o[2])], v = [r2(m.v[0]), r2(m.v[1]), r2(m.v[2])];
    const n = { id: this.eid++, type, owner: p.id, t0: this.time, pr: makeProjectile(o, v, 0.45) };
    this.nades.push(n);
    this.bcast({ t: 'gthrow', id: n.id, g: type, o, v, by: p.id });
  }

  updateNades() {
    for (let k = this.nades.length - 1; k >= 0; k--) {
      const n = this.nades[k];
      const target = this.time - n.t0;
      const fire = n.type === 'molotov' || n.type === 'incgrenade';
      let det = false;
      while (n.pr.age + NADE_STEP <= target + 1e-9) {
        stepProjectile(n.pr, NADE_STEP, this.world);
        if (fire && n.pr.hitGround) { det = true; break; }
      }
      const age = n.pr.age;
      if (n.type === 'he' || n.type === 'flash') det = age >= NADE.he.fuse;
      else if (n.type === 'smoke') det = (n.pr.rest && age >= NADE.smoke.minAge) || age > 8;
      else det = det || age >= NADE.molotov.maxAir;
      if (n.pr.y < -20) { this.nades.splice(k, 1); continue; }
      if (det) { this.nades.splice(k, 1); this.detonate(n); }
    }
  }

  detonate(n) {
    const { x, y, z } = n.pr;
    const owner = this.players.get(n.owner) || null;
    const msg = { t: 'gdet', id: n.id, g: n.type, p: [r2(x), r2(y), r2(z)] };
    if (n.type === 'he') {
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        const cy = p.y + 1.0;
        const d = Math.hypot(p.x - x, cy - y, p.z - z);
        if (d > NADE.he.radius) continue;
        if (!this.world.clear(x, y + 0.1, z, p.x, cy, p.z) && !this.world.clear(x, y + 0.1, z, p.x, p.y + 1.6, p.z)) continue;
        const dmg = NADE.he.dmg * Math.pow(1 - d / NADE.he.radius, 1.2);
        if (dmg >= 1) this.damage(p, owner, 'he', dmg, HG.CHEST, { noHg: true, from: [x, y, z] });
      }
    } else if (n.type === 'flash') {
      for (const p of this.players.values()) {
        if (!p.alive || !p.bot) continue;
        const ey = eyeOf(p);
        const dx = x - p.x, dy = y - ey, dz = z - p.z;
        const d = Math.hypot(dx, dy, dz);
        if (d > NADE.flash.range || !this.world.clear(p.x, ey, p.z, x, y, z) || this.smokeBlocks(p.x, ey, p.z, x, y, z)) continue;
        const f = dirFromAngles(p.yaw, p.pitch);
        const dot = (f[0] * dx + f[1] * dy + f[2] * dz) / (d || 1);
        const base = dot > 0.5 ? 4.0 : dot > 0 ? 2.0 : 0.5;
        p.blindUntil = Math.max(p.blindUntil, this.time + base * Math.max(0.25, 1 - d / NADE.flash.range));
      }
    } else if (n.type === 'smoke') {
      this.smokes.push({ id: n.id, x, y, z, t0: this.time, until: this.time + NADE.smoke.dur });
      for (let k = this.fires.length - 1; k >= 0; k--) {
        const f = this.fires[k];
        if (Math.hypot(f.x - x, f.z - z) < NADE.smoke.radius + f.r) { this.fires.splice(k, 1); this.bcast({ t: 'fireout', id: f.id }); }
      }
      msg.d = NADE.smoke.dur;
    } else {
      let gy = y;
      if (!n.pr.hitGround) {
        const h = this.world.raycast(x, y, z, 0, -1, 0, 4);
        if (!h) { msg.fz = 1; this.bcast(msg); return; }
        gy = y - h.t;
      }
      if (this.smokes.some((s) => Math.hypot(s.x - x, s.z - z) < NADE.smoke.radius + 1)) { msg.fz = 1; this.bcast(msg); return; }
      this.fires.push({ id: n.id, x, y: gy, z, r: NADE.molotov.radius, until: this.time + NADE.molotov.dur, owner: n.owner });
      msg.p[1] = r2(gy);
      msg.d = NADE.molotov.dur;
    }
    this.bcast(msg);
  }

  smokeBlocks(ax, ay, az, bx, by, bz) {
    for (const s of this.smokes) {
      const age = this.time - s.t0;
      const r = NADE.smoke.radius * Math.min(1, 0.3 + age / 1.2) * (this.time > s.until - 1.5 ? 0.6 : 1);
      if (segSphere(ax, ay, az, bx, by, bz, s.x, s.y + 1.0, s.z, r)) return true;
    }
    return false;
  }

  updateFires() {
    for (let k = this.smokes.length - 1; k >= 0; k--) if (this.time >= this.smokes[k].until) this.smokes.splice(k, 1);
    for (let k = this.fires.length - 1; k >= 0; k--) {
      const f = this.fires[k];
      if (this.time >= f.until) { this.fires.splice(k, 1); continue; }
      const owner = this.players.get(f.owner) || null;
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        if (Math.hypot(p.x - f.x, p.z - f.z) > f.r || p.y - f.y > 1.2 || p.y - f.y < -1) continue;
        p.fireDmgAcc += NADE.molotov.dps * DT;
        if (p.fireDmgAcc >= 4) {
          const d = Math.floor(p.fireDmgAcc);
          p.fireDmgAcc -= d;
          this.damage(p, owner, 'molotov', d, HG.CHEST, { noHg: true, noArmor: true, from: [f.x, f.y, f.z] });
        }
      }
    }
  }

  // ---------------- 视野 ----------------
  canSee(a, b, fovCos = -2) {
    const ax = a.x, ay = eyeOf(a), az = a.z;
    const dx = b.x - ax, dz = b.z - az;
    if (fovCos > -1) {
      const dl = Math.hypot(dx, dz) || 1;
      if ((-Math.sin(a.yaw) * dx - Math.cos(a.yaw) * dz) / dl < fovCos) return false;
    }
    const hs = b.crouched ? [1.2, 0.8] : [1.62, 1.1];
    for (const h of hs) {
      const by = b.y + h;
      if (this.world.clear(ax, ay, az, b.x, by, b.z) && !this.smokeBlocks(ax, ay, az, b.x, by, b.z)) return true;
    }
    return false;
  }

  updateSpotted() {
    for (const v of this.players.values()) v.spot = 0;
    if (this.opts.mode === 'dm') return;
    for (const v of this.players.values()) {
      if (!v.alive) continue;
      for (const a of this.players.values()) {
        if (!a.alive || a.team === v.team || (a.team !== 'T' && a.team !== 'CT')) continue;
        const bit = a.team === 'T' ? F.SPOT_T : F.SPOT_CT;
        if (v.spot & bit) continue;
        const dx = v.x - a.x, dz = v.z - a.z;
        if (dx * dx + dz * dz > 8100) continue;
        if (this.canSee(a, v, 0.34)) {
          v.spot |= bit;
          this.intel[a.team].set(v.id, { x: v.x, y: v.y, z: v.z, t: this.time });
        }
      }
    }
  }

  // ---------------- 同步 ----------------
  snapshot() {
    const ps = [];
    for (const p of this.players.values()) {
      if (p.team !== 'T' && p.team !== 'CT') continue;
      let f = p.spot || 0;
      if (p.crouched) f |= F.CROUCH;
      if (p.walk) f |= F.WALK;
      if (p.onGround) f |= F.GROUND;
      if (p.alive) f |= F.ALIVE;
      if (p.scoped) f |= F.SCOPED;
      if (p.defusing) f |= F.DEFUSING;
      if (p.planting) f |= F.PLANTING;
      if (p.reloadEnd) f |= F.RELOADING;
      if (p.inv[5]) f |= F.BOMB;
      if (p.kit) f |= F.KIT;
      if (p.isBot) f |= F.BOT;
      if (p.protectUntil > this.time) f |= F.PROTECT;
      ps.push([p.id, r2(p.x), r2(p.y), r2(p.z), r3(p.yaw), r3(p.pitch), f, this.curWeapon(p).id, Math.max(0, p.hp)]);
    }
    return { t: 's', st: Math.round(this.time * 1000), ps };
  }

  roundInfo() {
    return {
      ph: this.phase, pe: this.phaseEnd === Infinity ? -1 : Math.round(this.phaseEnd * 1000),
      n: this.round, sc: this.scores, max: this.opts.maxRounds, be: Math.round(this.buyEnd * 1000), host: this.hostId,
    };
  }
  bcastRound() { this.bcast({ t: 'round', ...this.roundInfo() }); }

  sendSelf(p) {
    if (p.isBot) return;
    const it = (s) => (p.inv[s] ? [p.inv[s].w, p.inv[s].clip, p.inv[s].res] : null);
    this.send(p, {
      t: 'self', al: p.alive ? 1 : 0, hp: Math.max(0, p.hp), ar: p.armor, hm: p.helmet ? 1 : 0, m: p.money,
      kit: p.kit ? 1 : 0, i1: it(1), i2: it(2), i4: p.inv[4].slice(), i5: p.inv[5] ? 1 : 0, sl: p.slot, tm: p.team,
    });
  }

  sendInit(p) {
    this.send(p, {
      t: 'init', you: p.id, code: this.opts.code, name: this.opts.name, map: this.map.id, mode: this.opts.mode,
      opts: { bots: this.opts.bots, botDiff: this.opts.botDiff, teamSize: this.opts.teamSize, maxRounds: this.opts.maxRounds, ff: this.opts.ff },
      st: Math.round(this.time * 1000),
      players: [...this.players.values()].map((q) => this.pubInfo(q)),
      round: this.roundInfo(),
      bomb: this.bombInfo(),
      smokes: this.smokes.map((s) => ({ id: s.id, p: [r2(s.x), r2(s.y), r2(s.z)], left: s.until - this.time })),
      fires: this.fires.map((f) => ({ id: f.id, p: [r2(f.x), r2(f.y), r2(f.z)], left: f.until - this.time })),
      drops: this.drops.map((d) => [d.id, d.w, r2(d.pr.x), r2(d.pr.y), r2(d.pr.z), 0, 0, 0]),
      me: { p: [r2(p.x), r2(p.y), r2(p.z)], yaw: r3(p.yaw), al: p.alive ? 1 : 0, tm: p.team },
      ro: this.opts.mode === 'range' ? this.rangeOpts : undefined,
    });
    p.dirty = true;
  }

  bcastScores() {
    this.bcast({ t: 'sb', l: [...this.players.values()].map((q) => [q.id, q.kills, q.deaths, q.assists, q.score, q.mvps, q.money, q.isBot ? -1 : q.ping, q.team]) });
  }

  onChat(p, m) {
    const text = cleanText(m.text, 120);
    if (!text || this.time - p.chatT < 0.4) return;
    p.chatT = this.time;
    const msg = { t: 'chat', id: p.id, n: p.name, tm: p.team, tx: text, team: m.team ? 1 : 0, dead: p.alive ? 0 : 1 };
    if (m.team && p.team !== 'SPEC') this.sendTeam(p.team, msg);
    else this.bcast(msg);
    if (text === '!start' && p.id === this.hostId && this.phase === 'warmup') this.startMatch();
  }

  info() {
    let humans = 0, bots = 0;
    for (const p of this.players.values()) p.isBot ? bots++ : humans++;
    return {
      code: this.opts.code, name: this.opts.name, map: this.map.id, mapName: this.map.name, mode: this.opts.mode,
      humans, bots, phase: this.phase, round: this.round, sc: this.scores, maxRounds: this.opts.maxRounds,
    };
  }
}
