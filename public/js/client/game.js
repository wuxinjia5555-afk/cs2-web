// 客户端游戏主循环：本地预测移动、武器、命中判定、插值、观战、特效与界面联动
import * as THREE from 'three';
import { P, PHYS_DT, F, INTERP_DELAY, HG } from '../shared/constants.js';
import { WEAPONS, NADE_TYPES, inaccuracy, spreadDir, moveSpeed, isGun, recoverRecoil, patternKick, nextSpray } from '../shared/weapons.js';
import { getMap, inRect } from '../shared/maps.js';
import { stepPlayer, traceShot, newMoveState, rayPlayer, hullBlocked } from '../shared/physics.js';
import { makeProjectile, stepProjectile, NADE_STEP, throwVelocity, NADE } from '../shared/grenades.js';
import { dirFromAngles, anglesFromDir, angleDiff, clamp, lerp, lerpAngle, DEG, r2, r3 } from '../shared/util.js';
import { buildMapMeshes, setupEnvironment } from './world.js';
import { PlayerModel, makeWeapon } from './models.js';
import { ViewModel } from './viewmodel.js';
import { Effects } from './effects.js';
import { Hud, weaponName } from './hud.js';
import { Input } from './input.js';
import { audio } from './audio.js';
import { settings, saveSettings, useTouch } from './settings.js';
import { TouchControls } from './touch.js';

const BASE_FOV = 73.74;
const $ = (id) => document.getElementById(id);
const tmp3 = [0, 0, 0];

export class Game {
  constructor({ renderer, net, init, pending = [], onExit, onNetLost }) {
    this.renderer = renderer;
    this.net = net;
    this.onExit = onExit;
    this.onNetLost = onNetLost;
    this.myId = init.you;
    this.code = init.code;
    this.roomName = init.name;
    this.mode = init.mode;
    this.opts = init.opts || {};
    this.map = getMap(init.map);
    this.world = this.map.world;
    this.hostId = init.round && init.round.host != null ? init.round.host : -1;
    this.round = init.round || { ph: 'idle', pe: -1, n: 0, sc: { T: 0, CT: 0 }, max: 16, be: 0 };
    this.bomb = init.bomb;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, innerWidth / innerHeight, 0.03, 700);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.env = setupEnvironment(this.scene, this.map, settings.shadows);
    this.mapMesh = buildMapMeshes(this.map);
    this.scene.add(this.mapMesh);
    this.isTouch = useTouch();
    this.fx = new Effects(this.scene, { low: this.isTouch });
    this.vm = new ViewModel();
    this.vm.knifeSkin = (settings.skins && settings.skins.knife) || 'default';
    this.vm.sfx = (k) => audio.play(k);
    this.input = new Input(renderer.domElement, this.isTouch);
    this.input.setBinds(settings.binds);
    // 告诉服务器我的刀皮肤（别人看到的第三人称模型）
    if (settings.skins && settings.skins.knife && settings.skins.knife !== 'default') this.net.send({ t: 'skin', k: settings.skins.knife });
    // 靶场：统计开枪 / 命中 / 爆头 / 击杀
    this.rangeStats = this.mode === 'range' ? { shots: 0, hits: 0, hs: 0, kills: 0 } : null;
    this.rangeOpts = init.ro || null;
    this.assist = null;
    this.aimEnemy = false;

    this.me = { id: this.myId, team: 'SPEC', alive: false, hp: 100, armor: 0, helmet: false, money: 0, kit: false, inv: { 1: null, 2: null, 4: [], 5: false }, slot: 3, nade: null };
    this.sim = newMoveState();
    this.prev = { x: 0, y: 0, z: 0 };
    this.acc = 0;
    this.cmd = { fwd: 0, side: 0, jump: false, crouch: false, walk: false, yaw: 0, speed: 6, frozen: false };
    this.yaw = 0;
    this.pitch = 0;
    this.eyeOff = P.standEye;
    this.w = {
      nextFire: 0, drawEnd: 0, reloadEnd: 0, reloadSlot: 0, punchP: 0, punchY: 0, spray: 0, fireAcc: 0, lastShot: -10,
      scope: 0, rescopeAt: 0, resume: 0, nadeHold: null, prevSlot: 2, planting: false, plantStart: 0, defusing: false,
      defuseStart: 0, defuseDur: 10, pendingClick: -1, switchBackAt: 0,
    };
    this.players = new Map();
    for (const p of init.players || []) this.addPlayerInfo(p);
    this.nades = new Map();
    this.localNadeN = 0;
    this.drops = new Map();
    this.bombMesh = null;
    this.bombLed = null;
    this.nextBeep = 0;
    this.specId = null;
    this.deathT = -1;
    this.deathPos = null;
    this.corpses = [];
    this.fc = null;
    this.flashUntil = 0; this.flashDur = 1; this.flashAlpha = 0;
    this.smokeAlpha = 0;
    this.hurtT = 0;
    this.shake = 0;
    this.tagUntil = 0;
    this.stepAcc = 0;
    this.targetName = '';
    this.chatOpen = false;
    this.paused = false;
    this.ping = 0;
    this.fps = 60; this.fpsAcc = 0; this.fpsN = 0;
    this.frameN = 0;
    this.lastSend = 0;
    this.lastPing = 0;
    this.mdx = 0; this.mdy = 0;
    this.svOffset = (init.st || 0) - performance.now();
    this.inbox = pending.slice();
    this.now = performance.now() / 1000;
    this.lastT = this.now;

    for (const s of init.smokes || []) this.fx.addSmoke(s.id, s.p[0], s.p[1], s.p[2], NADE.smoke.dur, NADE.smoke.dur - s.left);
    for (const f of init.fires || []) this.fx.addFire(f.id, f.p[0], f.p[1], f.p[2], NADE.molotov.dur, NADE.molotov.dur - f.left);
    for (const d of init.drops || []) this.addDrop(d, true);
    if (this.bomb && this.bomb.st === 'planted') this.placeBombMesh();

    this.hud = new Hud(this);
    if (this.rangeStats) {
      this.hud.rangeStats(this.rangeStats);
      setTimeout(() => this.hud.center('训练场：弹药无限，随时随地免费买枪（B）', 4), 600);
    }
    this.touch = this.isTouch ? new TouchControls(this) : null;
    this.hud.show();
    this.hud.clearTransient();
    this.initUI();
    this.fc = { x: this.map.bounds.x1 / 2, y: 30, z: this.map.bounds.z1 * 0.85 };
    this.pitch = -0.6;
    const meInit = init.me;
    if (meInit && (meInit.tm === 'T' || meInit.tm === 'CT')) {
      this.me.team = meInit.tm;
      this.vm.setTeam(meInit.tm);
      if (meInit.al) {
        this.sim.x = this.prev.x = meInit.p[0];
        this.sim.y = this.prev.y = meInit.p[1];
        this.sim.z = this.prev.z = meInit.p[2];
        this.sim.onGround = true;
        this.yaw = meInit.yaw;
        this.pitch = 0;
        this.me.alive = true;
        this.adoptSlot = true;
      }
    }

    this.net.onmessage = (m) => {
      this.inbox.push(m);
      if (this.inbox.length > 400) {
        const n = this.inbox.length;
        this.inbox = this.inbox.filter((x, i) => x.t !== 's' || i > n - 20);
      }
    };
    this.net.onclose = () => this.onDisconnect();
    this.input.attach();
    this.input.onLockChange = (locked) => this.onLockChange(locked);
    this.onResizeBound = () => this.resize();
    window.addEventListener('resize', this.onResizeBound);
    this.beforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', this.beforeUnload);
    this.resize();
    this.running = true;
    this.frameBound = (t) => this.frame(t);
    this.raf = requestAnimationFrame(this.frameBound);
    if (this.mode === 'bomb' && this.me.team === 'SPEC') this.showTeamSelect();
    else this.input.lock();
  }

  // ---------------- 界面绑定 ----------------
  initUI() {
    this.ui = [];
    const on = (el, ev, fn) => { el.addEventListener(ev, fn); this.ui.push([el, ev, fn]); };
    for (const b of document.querySelectorAll('#teamselect [data-team]')) {
      on(b, 'click', () => {
        this.net.send({ t: 'team', team: b.dataset.team });
        $('teamselect').classList.add('hidden');
        audio.play('click');
        this.input.lock();
      });
    }
    on($('btn-resume'), 'click', () => { this.hidePause(); this.input.lock(); });
    on($('btn-startmatch'), 'click', () => { this.net.send({ t: 'start' }); this.hidePause(); this.input.lock(); });
    on($('btn-team'), 'click', () => { this.hidePause(); this.showTeamSelect(); });
    on($('btn-copylink'), 'click', () => {
      const url = `${location.origin}${location.pathname}?room=${this.code}`;
      navigator.clipboard?.writeText(url).then(() => this.toast('邀请链接已复制：' + url), () => this.toast(url));
    });
    on($('btn-settings-ig'), 'click', () => {
      $('pause').classList.add('hidden');
      this.settingsOpen = true;
      window.__openSettings && window.__openSettings(() => { this.settingsOpen = false; this.hud.refreshCrosshair(); audio.setVolume(settings.volume); this.resize(); this.showPause(); });
    });
    on($('btn-quit'), 'click', () => this.exit());
    on($('btn-qr-room'), 'click', () => { $('pause').classList.add('hidden'); if (window.__showQR) window.__showQR(this.code); });
    for (const id of ['rp-count', 'rp-move', 'rp-armor', 'rp-ammo', 'rp-regen']) on($(id), id === 'rp-count' ? 'input' : 'change', () => this.sendRangeOpts());
    on($('rp-dmg'), 'change', () => { settings.rangeDmg = $('rp-dmg').checked; saveSettings(); });
    on($('rp-reset'), 'click', () => { if (this.rangeStats) { Object.assign(this.rangeStats, { shots: 0, hits: 0, hs: 0, kills: 0 }); this.hud.rangeStats(this.rangeStats); } });
    on($('rp-close'), 'click', () => this.closeRangePanel());
    on($('scoreboard'), 'pointerdown', () => { if (this.isTouch) this.hud.closeScoreboard(); });
    on($('buymenu'), 'pointerdown', (e) => { if (e.target.id === 'buymenu') this.closeBuy(); });
    for (const b of document.querySelectorAll('[data-close="buymenu"]')) on(b, 'click', () => this.closeBuy());
    const ci = $('chat-input');
    on(ci, 'keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = ci.value.trim();
        if (text) this.net.send({ t: 'chat', text, team: this.chatTeam });
        this.closeChat();
      } else if (e.key === 'Escape') this.closeChat();
    });
    on($('chat-send'), 'click', () => {
      const text = ci.value.trim();
      if (text) this.net.send({ t: 'chat', text, team: this.chatTeam });
      this.closeChat();
    });
    on($('chat-cancel'), 'click', () => this.closeChat());
    // 手机上收起键盘：没写内容就当取消
    on(ci, 'blur', () => setTimeout(() => { if (this.chatOpen && !ci.value.trim()) this.closeChat(); }, 200));
    on(this.renderer.domElement, 'mousedown', () => {
      if (!this.isTouch && !this.input.locked && !this.anyOverlay()) this.input.lock();
    });
  }

  anyOverlay() {
    return ['buymenu', 'teamselect', 'pause', 'menu-settings', 'qrbox', 'fshelp', 'reconnect', 'rangepanel'].some((id) => !$(id).classList.contains('hidden')) || this.chatOpen;
  }

  toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => el.classList.remove('show'), 2600);
  }

  onLockChange(locked) {
    if (locked) { this.paused = false; return; }
    if (this.chatOpen) { this.closeChat(); return; }
    if (this.hud.buyOpen || this.suppressPause || this.settingsOpen) { this.suppressPause = false; return; }
    if (!$('teamselect').classList.contains('hidden') || !$('matchend').classList.contains('hidden')) return;
    this.showPause();
  }

  showPause() {
    this.paused = true;
    const host = this.isHost() && this.round.ph === 'warmup';
    $('btn-startmatch').classList.toggle('hidden', !host);
    $('btn-copylink').classList.toggle('hidden', this.net.isLocal);
    $('btn-qr-room').classList.toggle('hidden', this.net.isLocal);
    $('pause-room').innerHTML = this.net.isLocal
      ? `单机练习 · ${this.map.name}`
      : `房间码 <b>${this.code}</b> · ${this.map.name}<br>把房间码或邀请链接发给朋友即可加入`;
    $('pause').classList.remove('hidden');
  }
  hidePause() { this.paused = false; $('pause').classList.add('hidden'); }

  showTeamSelect() {
    let t = 0, c = 0;
    for (const p of this.players.values()) { if (p.team === 'T') t++; else if (p.team === 'CT') c++; }
    $('ts-t').textContent = `${t} 人`;
    $('ts-ct').textContent = `${c} 人`;
    this.suppressPause = true;
    this.input.unlock();
    $('teamselect').classList.remove('hidden');
  }

  // ---------------- 靶场设置面板 ----------------
  openRangePanel() {
    if (this.mode !== 'range') return;
    this.suppressPause = true;
    this.input.unlock();
    this.syncRangePanel();
    $('rangepanel').classList.remove('hidden');
    if (this.touch) this.touch.reset();
  }

  closeRangePanel() {
    $('rangepanel').classList.add('hidden');
    if (!this.anyOverlay()) this.input.lock();
  }

  syncRangePanel() {
    const o = this.rangeOpts;
    if (!o) return;
    $('rp-count').max = String(this.map.dummies.length);
    $('rp-count').value = String(o.count);
    $('rp-count-v').textContent = String(o.count);
    $('rp-move').value = o.move;
    $('rp-armor').value = o.armor;
    $('rp-ammo').value = o.ammo;
    $('rp-regen').checked = !!o.regen;
    $('rp-dmg').checked = settings.rangeDmg !== false;
  }

  sendRangeOpts() {
    const o = { count: +$('rp-count').value, move: $('rp-move').value, armor: $('rp-armor').value, ammo: $('rp-ammo').value, regen: $('rp-regen').checked };
    $('rp-count-v').textContent = String(o.count);
    this.net.send({ t: 'range', o });
  }

  openBuy() {
    if (!this.me.alive) return;
    if (!this.canBuy()) {
      const free = this.round.ph === 'warmup' || this.round.ph === 'dm';
      if (!free && !this.inBuyZone()) this.hud.center('你不在购买区内', 1.5);
      else this.hud.center('购买时间已过', 1.5);
      return;
    }
    this.suppressPause = true;
    this.input.unlock();
    this.hud.openBuy();
  }
  closeBuy() {
    if (!this.hud.buyOpen) return;
    this.hud.closeBuy();
    this.input.lock();
  }

  buy(id) {
    audio.init();
    if (!this.canBuy()) { this.hud.center(this.inBuyZone() ? '购买时间已过' : '你不在购买区内', 1.5); return; }
    this.net.send({ t: 'buy', item: id });
  }

  // 退款：这回合买的、还没用过的东西，在购买时间内、购买区里可以原价退回
  refund(id) {
    audio.init();
    if (!this.canBuy()) { this.hud.center(this.inBuyZone() ? '购买时间已过，不能退款' : '你不在购买区内', 1.5); return; }
    this.net.send({ t: 'refund', item: id });
  }

  openChat(team) {
    this.chatOpen = true;
    this.chatTeam = team;
    this.input.typing = true;
    for (const k of [...this.input.keys]) this.input.keys.delete(k);
    $('chat-mode').textContent = team ? '队伍：' : '全部：';
    $('chat-input-wrap').classList.remove('hidden');
    const ci = $('chat-input');
    ci.value = '';
    setTimeout(() => ci.focus(), 0);
  }
  closeChat() {
    this.chatOpen = false;
    this.input.typing = false;
    $('chat-input-wrap').classList.add('hidden');
    $('chat-input').blur();
  }

  // ---------------- 查询 ----------------
  isHost() { return this.hostId === this.myId; }
  serverNow() { return performance.now() + this.svOffset; }

  curWeapon() {
    const me = this.me;
    if (me.slot === 1 || me.slot === 2) { const it = me.inv[me.slot]; if (it) return WEAPONS[it.w]; }
    if (me.slot === 4 && me.inv[4].length) return WEAPONS[me.nade && me.inv[4].includes(me.nade) ? me.nade : me.inv[4][0]];
    if (me.slot === 5 && me.inv[5]) return WEAPONS.c4;
    return WEAPONS.knife;
  }

  inBuyZone() {
    return (this.map.buy[this.me.team] || []).some((z) => inRect(z, this.sim.x, this.sim.z));
  }
  canBuy() {
    const ph = this.round.ph;
    if (!this.me.alive || (this.me.team !== 'T' && this.me.team !== 'CT')) return false;
    if (ph === 'warmup' || ph === 'dm' || ph === 'range') return true;
    if (!(ph === 'freeze' || (ph === 'live' && this.serverNow() < this.round.be))) return false;
    return this.inBuyZone();
  }
  inSite() {
    for (const s of Object.values(this.map.sites)) if (inRect(s, this.sim.x, this.sim.z) && Math.abs(this.sim.y - s.y) < 2.5) return s.name;
    return null;
  }
  isEnemyId(id) {
    const p = this.players.get(id);
    if (!p) return false;
    return this.mode === 'dm' || p.team !== this.me.team;
  }
  eyePos() { return { x: this.sim.x, y: this.sim.y + this.eyeOff, z: this.sim.z }; }

  frozen() {
    const ph = this.round.ph;
    return !this.me.alive || ph === 'freeze' || ph === 'matchover' || this.w.planting || this.w.defusing || this.paused || this.chatOpen;
  }

  targets() {
    const out = [];
    for (const p of this.players.values()) {
      if (p.id === this.myId || !p.rp || !(p.rp.f & F.ALIVE)) continue;
      out.push({ id: p.id, x: p.rp.x, y: p.rp.y, z: p.rp.z, crouched: !!(p.rp.f & F.CROUCH) });
    }
    return out;
  }

  currentInacc(w) {
    return inaccuracy(w, {
      speed: Math.hypot(this.sim.vx, this.sim.vz), onGround: this.sim.onGround, crouched: this.sim.crouched,
      scoped: this.w.scope > 0, fireAcc: this.w.fireAcc, maxSpeed: moveSpeed(w, this.w.scope > 0),
    });
  }

  crosshairSpread() {
    const w = this.curWeapon();
    if (!isGun(w)) return 0;
    const h = this.renderer.domElement.clientHeight || innerHeight;
    const px = (Math.tan(this.currentInacc(w)) / Math.tan((this.camera.fov * DEG) / 2)) * (h / 2);
    return Math.min(70, px * 0.55);
  }

  radarCenter() {
    if (!this.me.alive) {
      const sp = this.specId != null ? this.players.get(this.specId) : null;
      if (sp && sp.rp) return { x: sp.rp.x, z: sp.rp.z, yaw: sp.rp.yaw };
      return { x: this.camera.position.x, z: this.camera.position.z, yaw: this.yaw };
    }
    return { x: this.sim.x, z: this.sim.z, yaw: this.yaw };
  }

  hintText() {
    const me = this.me;
    const T = this.isTouch;
    if (!T && !this.input.locked && !this.anyOverlay() && !this.hud.buyOpen) return '点击画面开始操作（锁定鼠标）';
    if (!me.alive || this.paused) return '';
    const b = this.bomb;
    if (me.team === 'CT' && b && b.st === 'planted' && !this.w.defusing && Math.hypot(this.sim.x - b.x, this.sim.z - b.z) < 2.0) return T ? '按住「拆弹」按钮拆除炸弹' : '按住 E 拆除炸弹';
    if (this.round.ph === 'live' && me.inv[5] && !this.w.planting) {
      if (this.inSite()) {
        if (me.slot === 5) return T ? '按住「安放」按钮安放炸弹' : '按住左键安放炸弹';
        return T ? '在包点内：点下方「C4」拿出炸弹，再按住「安放」' : '在包点内：按 5 拿出 C4，按住左键安放';
      }
    }
    const d = this.nearDrop();
    if (d) return T ? `点「捡起」拿 ${weaponName(d.w)}` : `按 E 捡起 ${weaponName(d.w)}`;
    return '';
  }

  nearDrop() {
    for (const d of this.drops.values()) {
      if (d.w === 'c4') continue;
      if (Math.hypot(d.pr.x - this.sim.x, d.pr.z - this.sim.z) < 1.9 && Math.abs(d.pr.y - this.sim.y) < 2) return d;
    }
    return null;
  }

  // 触屏「拆弹/捡起」按钮是否显示
  useContext() {
    const me = this.me, b = this.bomb;
    if (!me.alive) return '';
    if (me.team === 'CT' && b && b.st === 'planted' && Math.hypot(this.sim.x - b.x, this.sim.z - b.z) < 2.0) return '拆弹';
    return this.nearDrop() ? '捡起' : '';
  }

  openPauseMenu() {
    this.suppressPause = true;
    this.input.unlock();
    this.showPause();
  }

  // ---------------- 玩家信息 ----------------
  addPlayerInfo(pi) {
    let p = this.players.get(pi.id);
    if (!p) {
      p = { id: pi.id, name: pi.n, team: pi.tm, bot: !!pi.b, alive: false, hp: 100, wid: 'knife', buf: [], rp: null, model: null, speed: 0, stepAcc: 0, deathT: 0, lastShotT: -9, k: 0, d: 0, a: 0, sc: 0, mv: 0, money: 0, ping: 0 };
      this.players.set(pi.id, p);
    }
    p.name = pi.n;
    p.team = pi.tm;
    p.bot = !!pi.b;
    p.skin = pi.sk || null;
    if (pi.k != null) { p.k = pi.k; p.d = pi.d; p.a = pi.a; p.sc = pi.sc; p.mv = pi.mv; }
    if (pi.id === this.myId) this.me.team = pi.tm;
    return p;
  }

  removePlayerModel(p) {
    if (!p.model) return;
    this.scene.remove(p.model.root);
    if (p.model.tag) { p.model.tag.material.map.dispose(); p.model.tag.material.dispose(); }
    p.model = null;
  }

  // ---------------- 消息 ----------------
  onMsg(m) {
    switch (m.t) {
      case 's': this.onSnapshot(m); break;
      case 'self': this.onSelf(m); break;
      case 'spawn': this.onSpawn(m); break;
      case 'round': this.onRound(m); break;
      case 'rend': this.onRoundEnd(m); break;
      case 'mend': this.hud.matchEnd(m); this.input.unlock(); this.suppressPause = true; break;
      case 'kill': this.onKill(m); break;
      case 'hurt': this.onHurt(m); break;
      case 'hit': this.onHit(m); break;
      case 'shot': this.onShot(m); break;
      case 'rangeopts': this.rangeOpts = m.o; if (!$('rangepanel').classList.contains('hidden')) this.syncRangePanel(); break;
      case 'rl': { const p = this.players.get(m.id); if (p && p.rp) audio.reloadAt([p.rp.x, p.rp.y + 1.2, p.rp.z]); break; }
      case 'gthrow': this.onNadeThrow(m); break;
      case 'gdet': this.onNadeDet(m); break;
      case 'fireout': this.fx.removeFire(m.id); break;
      case 'bomb': this.onBomb(m.b); break;
      case 'planting': this.onPlanting(m); break;
      case 'defusing': this.onDefusing(m); break;
      case 'drop': this.addDrop(m.d, false); break;
      case 'dropr': { const d = this.drops.get(m.id); if (d) { d.pr.x = m.p[0]; d.pr.y = m.p[1]; d.pr.z = m.p[2]; d.pr.rest = true; d.pr.vx = d.pr.vy = d.pr.vz = 0; } break; }
      case 'pick': this.onPick(m); break;
      case 'pjoin': { const p = this.addPlayerInfo(m.p); if (!p.bot) this.hud.chat({ sys: true, text: `${p.name} 加入了游戏` }); break; }
      case 'pleave': {
        const p = this.players.get(m.id);
        if (p) { this.removePlayerModel(p); this.players.delete(m.id); if (!p.bot) this.hud.chat({ sys: true, text: `${p.name} 离开了游戏` }); }
        if (this.specId === m.id) this.specId = null;
        break;
      }
      case 'pskin': { const p = this.players.get(m.id); if (p) p.skin = m.k || null; break; }
      case 'pteam': {
        const p = this.players.get(m.id);
        if (p) {
          p.team = m.team;
          if (p.model && p.model.team !== m.team) this.removePlayerModel(p);
          if (m.id === this.myId) { this.me.team = m.team; this.vm.setTeam(m.team); }
        }
        break;
      }
      case 'teamok': this.me.team = m.team; this.vm.setTeam(m.team); if (m.team === 'SPEC') { this.me.alive = false; } break;
      case 'host': this.hostId = m.id; break;
      case 'sb': this.onScores(m); break;
      case 'chat': this.hud.chat(m); if (m.id !== this.myId) audio.play('click', null, 0.6); break;
      case 'err': this.hud.center(m.text, 2); break;
      case 'bought': this.onBought(m.item); break;
      case 'refunded': audio.play('pickup'); this.hud.center(`已退款 +$${m.m}`, 1.2); break;
      case 'msg': this.onServerMsg(m); break;
      case 'reset': this.onReset(); break;
      case 'pong': this.ping = Math.round(performance.now() - m.c); break;
      case 'left': break;
    }
  }

  onSnapshot(m) {
    const sample = m.st - performance.now();
    if (sample > this.svOffset) this.svOffset += (sample - this.svOffset) * 0.25;
    else this.svOffset += (sample - this.svOffset) * 0.03;
    if (Math.abs(sample - this.svOffset) > 1500) this.svOffset = sample;
    for (const e of m.ps) {
      const id = e[0];
      const p = this.players.get(id) || this.addPlayerInfo({ id, n: '?', tm: 'T', b: 0 });
      const f = e[6];
      const alive = !!(f & F.ALIVE);
      if (p.alive && !alive && !p.deathT) p.deathT = this.now;
      if (alive) p.deathT = 0;
      p.alive = alive;
      p.hp = e[8];
      p.wid = e[7];
      if (id === this.myId) {
        p.rp = { x: this.sim.x, y: this.sim.y, z: this.sim.z, yaw: this.yaw, pitch: this.pitch, f, w: e[7] };
        continue;
      }
      const last = p.buf[p.buf.length - 1];
      if (last && m.st <= last.t) continue;
      p.buf.push({ t: m.st, x: e[1], y: e[2], z: e[3], yaw: e[4], pitch: e[5], f, w: e[7] });
      if (p.buf.length > 40) p.buf.shift();
    }
  }

  onSelf(m) {
    const me = this.me;
    if (me.money !== m.m && this.selfInit) this.hud.moneyPop(m.m - me.money);
    this.selfInit = true;
    me.hp = m.hp;
    me.armor = m.ar;
    me.helmet = !!m.hm;
    me.money = m.m;
    me.kit = !!m.kit;
    me.rf = m.rf || [];
    if (m.tm !== me.team) { me.team = m.tm; this.vm.setTeam(m.tm); }
    const recent = this.now - this.w.lastShot < 0.8 || this.w.reloadEnd > 0;
    for (const s of [1, 2]) {
      const srv = m['i' + s];
      if (!srv) { me.inv[s] = null; continue; }
      const cur = me.inv[s];
      if (cur && cur.w === srv[0] && s === me.slot && recent) continue;
      me.inv[s] = { w: srv[0], clip: srv[1], res: srv[2] };
    }
    me.inv[4] = (m.i4 || []).slice();
    if (this.w.pendingThrow && this.now - this.w.pendingThrowT < 1.5) {
      const i = me.inv[4].indexOf(this.w.pendingThrow);
      if (i >= 0) me.inv[4].splice(i, 1);
    }
    me.inv[5] = !!m.i5;
    const wasAlive = me.alive;
    me.alive = !!m.al && (me.team === 'T' || me.team === 'CT');
    if (wasAlive && !me.alive && this.deathT < 0) this.deathT = this.now;
    if (me.alive && this.adoptSlot) {
      this.adoptSlot = false;
      me.slot = this.slotValid(m.sl) ? m.sl : this.bestSlot();
      if (me.slot === 4) me.nade = me.inv[4][0] || null;
      this.vm.wid = null;
      this.vm.setWeapon(this.curWeapon().id, 0.5, this.now);
      this.hud.showWeaponList();
    } else if (me.alive) {
      if (!this.slotValid(me.slot)) this.switchSlot(this.bestSlot(), true);
      else if (m.sl !== me.slot && this.now - (this.lastSlotSend || 0) > 0.3) { this.lastSlotSend = this.now; this.net.send({ t: 'slot', s: me.slot, g: me.nade }); }
      if (me.slot === 4 && (!me.nade || !me.inv[4].includes(me.nade))) me.nade = me.inv[4][0] || null;
      this.vm.setWeapon(this.curWeapon().id, 0.3, this.now);
    }
  }

  slotValid(s) {
    const me = this.me;
    if (s === 1 || s === 2) return !!me.inv[s];
    if (s === 4) return me.inv[4].length > 0;
    if (s === 5) return !!me.inv[5];
    return s === 3;
  }
  bestSlot() { return this.me.inv[1] ? 1 : this.me.inv[2] ? 2 : 3; }

  unscope() {
    const W = this.w;
    if (!W.scope) return;
    W.scope = 0;
    W.rescopeAt = 0;
    W.resume = 0;
    audio.play('scope');
  }

  onSpawn(m) {
    const s = this.sim;
    s.x = m.p[0]; s.y = m.p[1]; s.z = m.p[2];
    s.vx = s.vy = s.vz = 0;
    s.onGround = true;
    this.prev.x = s.x; this.prev.y = s.y; this.prev.z = s.z;
    this.acc = 0;
    if (m.fix) return;
    s.crouched = false;
    this.eyeOff = P.standEye;
    this.yaw = m.yaw;
    this.pitch = 0;
    this.me.alive = true;
    this.me.hp = 100;
    this.deathT = -1;
    this.killerId = null;
    this.specId = null;
    if (this.mode !== 'dm' && this.round.ph !== 'warmup') this.roundKills = 0;
    this.hud.clearKillIcons();
    const W = this.w;
    W.punchP = W.punchY = W.spray = W.fireAcc = 0;
    W.reloadEnd = 0; W.scope = 0; W.rescopeAt = 0; W.nadeHold = null; W.planting = false; W.defusing = false;
    W.lastShot = -10; // 让随后到达的服务器弹药数（新回合补满）一定生效
    W.drawEnd = this.now + 0.3;
    this.flashUntil = 0;
    this.hud.hideDeath();
    this.vm.setTeam(this.me.team);
    this.me.slot = this.bestSlot();
    this.adoptSlot = true;
    this.vm.wid = null;
    this.vm.setWeapon(this.curWeapon().id, 0.5, this.now);
  }

  onRound(m) {
    const prev = this.round.ph;
    this.round = m;
    if (m.host != null) this.hostId = m.host;
    if (m.ph === 'freeze' && prev !== 'freeze') {
      this.roundKills = 0;
      this.hud.clearKillIcons();
      this.hud.hideRoundEnd();
      this.hud.hideMatchEnd();
      if (!$('matchend').classList.contains('hidden')) $('matchend').classList.add('hidden');
    }
    if (m.ph === 'dm' && prev !== 'dm') this.hud.hideMatchEnd();
    if (prev === 'matchover' && m.ph !== 'matchover') {
      this.hud.hideMatchEnd();
      if (!this.anyOverlay()) this.input.lock();
    }
  }

  onRoundEnd(m) {
    this.hud.roundEnd(m);
    const won = m.w === this.me.team;
    if (this.me.team === 'T' || this.me.team === 'CT') audio.play(won ? 'win' : 'lose');
    audio.speak(m.w === 'CT' ? '警察胜利' : '匪徒胜利');
  }

  onServerMsg(m) {
    switch (m.k) {
      case 'planted':
        this.hud.center(`炸弹已安放在 ${m.site} 点！`, 3);
        audio.speak('炸弹已安放');
        break;
      case 'defused': this.hud.center('炸弹已被拆除', 3); audio.speak('炸弹已被拆除'); break;
      case 'go': audio.play('roundstart'); if (this.me.alive) this.hud.center('开始行动！', 1.5); break;
      case 'halftime': this.hud.center('半场结束 · 交换阵营', 4); break;
      case 'match_start': this.hud.center(this.mode === 'dm' ? '死斗开始！' : this.mode === 'range' ? '训练场：随便打，弹药无限、随时免费买枪' : '比赛开始！', 3); this.hud.hideMatchEnd(); break;
    }
  }

  onHit(m) {
    const kill = !!m.k, head = m.g === HG.HEAD;
    if (this.mode === 'range') {
      if (settings.rangeDmg !== false) this.hud.damagePop(m.d, head, kill);
      const st = this.rangeStats;
      st.hits++;
      if (head) st.hs++;
      this.hud.rangeStats(st);
    }
    this.hud.hitmarker(head, kill);
    if (!kill) audio.play(head ? (m.hm ? 'headshot' : 'headshot_nohelm') : 'hit');
    const v = this.players.get(m.v);
    if (v && v.model) v.model.hitT = this.now;
    if (head && v) {
      // 爆头闪光：在敌人头的位置闪一下（一直开着）
      const hp = v.model && v.model.head ? v.model.head.localToWorld(new THREE.Vector3(0, 0.17, 0)) : v.rp ? new THREE.Vector3(v.rp.x, v.rp.y + 1.62, v.rp.z) : null;
      if (hp) this.fx.headPop(hp.x, hp.y, hp.z, !!m.hm);
    }
    if (!kill) this.vibrate(12);
  }

  onKill(m) {
    this.hud.killFeed(m);
    const v = this.players.get(m.v);
    const k = this.players.get(m.k);
    if (v) {
      v.alive = false;
      v.deathT = this.now;
      if (v.rp) {
        audio.play('bodyfall', [v.rp.x, v.rp.y, v.rp.z]);
        // 尸体朝“被打过来的方向”倒下
        let dx, dz;
        if (m.k === this.myId) { dx = v.rp.x - this.sim.x; dz = v.rp.z - this.sim.z; }
        else if (k && k.rp && k !== v) { dx = v.rp.x - k.rp.x; dz = v.rp.z - k.rp.z; }
        else { const a = v.rp.yaw; dx = Math.sin(a); dz = Math.cos(a); }
        const dl = Math.hypot(dx, dz) || 1;
        dx /= dl; dz /= dl;
        v.deathPush = [dx, dz];
        const crouch = v.rp.f & F.CROUCH;
        const by = v.rp.y + (m.hs ? (crouch ? 1.2 : 1.62) : crouch ? 0.85 : 1.2);
        this.fx.blood(v.rp.x, by, v.rp.z, dx, 0.35, dz, true);
        this.fx.blood(v.rp.x, by - 0.15, v.rp.z, dx * 1.4, 0.15, dz * 1.4, !!m.hs);
      }
    }
    if (m.v === this.myId) {
      this.me.alive = false;
      this.deathT = this.now;
      this.killerId = m.k;
      this.deathPos = { x: this.sim.x, y: this.sim.y + this.eyeOff, z: this.sim.z };
      this.w.scope = 0;
      this.w.planting = false;
      this.w.defusing = false;
      this.w.nadeHold = null;
      this.hud.deathInfo(this.players.get(m.k), m.w, m.hs);
      if (this.hud.buyOpen) this.closeBuy();
      if (this.mode === 'dm' || this.round.ph === 'warmup') this.roundKills = 0;
      this.vibrate([70, 40, 90]);
    } else if (m.k === this.myId && this.isEnemyId(m.v)) {
      // 靶场没有回合：4 秒内连续击杀才算连杀
      if (this.mode === 'range' && this.now - (this.lastKillT || -99) > 4) this.roundKills = 0;
      this.lastKillT = this.now;
      if (this.rangeStats) { this.rangeStats.kills++; this.hud.rangeStats(this.rangeStats); }
      const n = (this.roundKills = (this.roundKills || 0) + 1);
      if (this.mode === 'dm') this.refillAmmo(); // 死斗：杀一个人就把子弹补满（服务器那边也补了）
      const w = WEAPONS[m.w];
      const paid = this.mode === 'bomb' && this.round.ph !== 'warmup';
      const reward = paid ? ((w && w.killReward) ?? 300) : 0;
      this.hud.killConfirm({ name: v ? v.name : '', team: v ? v.team : 'T', weapon: m.w, hs: !!m.hs, streak: n, reward });
      audio.play('killconfirm', null, 1, { streak: n, hs: !!m.hs });
      this.vibrate(n >= 2 ? [30, 30, 30, 30, 60] : [30, 30, 50]);
    } else if (m.as === this.myId) {
      this.hud.assistNote(v ? v.name : '');
    }
  }

  refillAmmo() {
    for (const s of [1, 2]) {
      const it = this.me.inv[s];
      if (!it) continue;
      const w = WEAPONS[it.w];
      it.clip = w.mag;
      it.res = w.res;
    }
    if (this.w.reloadEnd) { this.w.reloadEnd = 0; this.vm.cancelReload(); }
    this.hud.ammoRefill();
  }

  // 手机震动（iPhone 的 Safari 不支持，会自动忽略）
  vibrate(pattern) {
    if (!this.isTouch || !settings.vibrate || !navigator.vibrate) return;
    try { navigator.vibrate(pattern); } catch {}
  }

  onHurt(m) {
    this.me.hp = m.hp;
    this.me.armor = m.ar;
    this.hurtT = this.now + Math.min(0.6, 0.15 + m.d / 60);
    this.tagUntil = this.now + 0.3;
    audio.play('hurt', null, Math.min(1, 0.3 + m.d / 60));
    this.vibrate(Math.round(Math.min(70, 20 + m.d)));
    if (m.o) {
      const ang = Math.atan2(-(m.o[0] - this.sim.x), -(m.o[2] - this.sim.z));
      this.hud.damageFrom(ang);
    }
    if (m.g === HG.HEAD && !this.me.helmet) this.w.punchP += 0.03;
  }

  onScores(m) {
    for (const e of m.l) {
      const p = this.players.get(e[0]);
      if (!p) continue;
      p.k = e[1]; p.d = e[2]; p.a = e[3]; p.sc = e[4]; p.mv = e[5]; p.money = e[6]; p.ping = e[7];
      if (e[8] && e[8] !== p.team) {
        p.team = e[8];
        if (p.model && p.model.team !== p.team) this.removePlayerModel(p);
      }
    }
  }

  onBought(item) {
    audio.play('buy');
    const w = WEAPONS[item];
    if (w && (w.slot === 1 || w.slot === 2)) {
      this.me.inv[w.slot] = { w: item, clip: w.mag, res: w.res };
      this.switchSlot(w.slot, true);
    }
  }

  stopAllSeq() {
    this.stopMySeq();
    for (const p of this.players.values()) if (p.bombSeq) { p.bombSeq.stop(); p.bombSeq = null; }
  }

  onReset() {
    this.stopAllSeq();
    for (const n of this.nades.values()) this.scene.remove(n.mesh);
    this.nades.clear();
    for (const d of this.drops.values()) this.scene.remove(d.mesh);
    this.drops.clear();
    this.fx.clearRound();
    for (const c of this.corpses) this.scene.remove(c.obj);
    this.corpses = [];
    if (this.bombMesh) { this.scene.remove(this.bombMesh); this.bombMesh = null; }
    this.bomb = null;
    this.flashUntil = 0;
  }

  onDisconnect() {
    if (!this.running) return;
    this.input.releaseAll();
    if (this.onNetLost) this.onNetLost();
    else this.hud.center('与服务器断开连接，请返回主菜单重新加入', 60);
  }

  // 全屏：安卓等支持的浏览器直接全屏；iPhone Safari 不支持，弹出说明
  toggleFullscreen() {
    const d = document, el = d.documentElement;
    if (d.fullscreenElement || d.webkitFullscreenElement) {
      const ex = d.exitFullscreen || d.webkitExitFullscreen;
      if (ex) ex.call(d);
      return;
    }
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req && (d.fullscreenEnabled || d.webkitFullscreenEnabled)) {
      try {
        const p = req.call(el, { navigationUI: 'hide' });
        const lock = () => { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); };
        if (p && p.then) p.then(lock).catch(() => window.__showFsHelp && window.__showFsHelp());
        else lock();
      } catch {
        if (window.__showFsHelp) window.__showFsHelp();
      }
    } else if (window.__showFsHelp) window.__showFsHelp();
  }

  // ---------------- 射击相关消息 ----------------
  onShot(m) {
    const p = this.players.get(m.id);
    if (p) p.lastShotT = this.now;
    if (m.w === 'knife') { audio.play('knife', m.o); return; }
    audio.shot(m.w, m.o);
    if (p && this.isEnemyId(p.id)) {
      const d = Math.hypot(m.o[0] - this.camera.position.x, m.o[2] - this.camera.position.z);
      if (d < 70) this.soundPing(m.o[0], m.o[2], d / 70, 'shot');
    }
    let mx = m.o[0], my = m.o[1] - 0.12, mz = m.o[2];
    if (p && p.model && p.model.gunHolder.children[0]) {
      const g = p.model.gunHolder.children[0];
      const v = new THREE.Vector3().copy(g.userData.muzzle || new THREE.Vector3());
      g.localToWorld(v);
      mx = v.x; my = v.y; mz = v.z;
    }
    const w = WEAPONS[m.w];
    if (w && !w.silenced) this.fx.muzzle(mx, my, mz);
    for (const e of m.e || []) {
      if (Math.random() < 0.6 || (w && w.type === 'sniper')) this.fx.tracer(mx, my, mz, e[0], e[1], e[2]);
      if (e[3] === 1) {
        const dx = e[0] - m.o[0], dy = e[1] - m.o[1], dz = e[2] - m.o[2];
        const d = Math.hypot(dx, dy, dz) || 1;
        const h = this.world.raycast(m.o[0], m.o[1], m.o[2], dx / d, dy / d, dz / d, d + 0.2);
        if (h) this.fx.impact(e[0], e[1], e[2], h.nx, h.ny, h.nz);
      } else if (e[3] === 2) {
        const dx = e[0] - m.o[0], dy = e[1] - m.o[1], dz = e[2] - m.o[2];
        const d = Math.hypot(dx, dy, dz) || 1;
        this.fx.blood(e[0], e[1], e[2], dx / d, dy / d, dz / d, false);
      }
    }
  }

  onNadeThrow(m) {
    if (m.by === this.myId) {
      for (const [id, n] of this.nades) {
        if (n.local && n.type === m.g) {
          this.nades.delete(id);
          n.local = false;
          this.nades.set(m.id, n);
          return;
        }
      }
    }
    this.addNade(m.id, m.g, m.o, m.v, false);
    const p = this.players.get(m.by);
    if (p && p.rp && m.by !== this.myId) audio.play('throw', m.o);
  }

  addNade(id, type, o, v, local) {
    const mesh = makeWeapon(type, true);
    mesh.scale.setScalar(1.4);
    mesh.position.set(o[0], o[1], o[2]);
    this.scene.add(mesh);
    this.nades.set(id, { type, pr: makeProjectile(o, v, 0.45), mesh, t0: this.now, local });
  }

  onNadeDet(m) {
    const n = this.nades.get(m.id);
    if (n) { this.scene.remove(n.mesh); this.nades.delete(m.id); }
    for (const [id, q] of this.nades) {
      if (q.local && q.type === m.g && this.now - q.t0 > 0.5) { this.scene.remove(q.mesh); this.nades.delete(id); break; }
    }
    const [x, y, z] = m.p;
    const eye = this.camera.position;
    const dist = Math.hypot(eye.x - x, eye.y - y, eye.z - z);
    switch (m.g) {
      case 'he':
        this.fx.explosion(x, y, z, 1);
        audio.play('explode', m.p, 0.9);
        this.shake = Math.max(this.shake, Math.max(0, 1 - dist / 16) * 0.8);
        break;
      case 'flash': {
        this.fx.flashPop(x, y + 0.2, z);
        audio.play('flashbang', m.p);
        if (!this.me.alive && this.me.team !== 'SPEC') break;
        if (dist > NADE.flash.range) break;
        if (!this.world.clear(eye.x, eye.y, eye.z, x, y + 0.1, z) || this.fx.smokeDensityAt({ x: (x + eye.x) / 2, y: (y + eye.y) / 2, z: (z + eye.z) / 2 }) > 0.5) break;
        const f = dirFromAngles(this.yaw, this.pitch);
        const dot = (f[0] * (x - eye.x) + f[1] * (y - eye.y) + f[2] * (z - eye.z)) / (dist || 1);
        const base = dot > 0.55 ? 4.2 : dot > 0.1 ? 2.2 : 0.8;
        const dur = base * Math.max(0.25, 1 - dist / NADE.flash.range);
        if (this.now + dur > this.flashUntil) { this.flashUntil = this.now + dur; this.flashDur = dur; }
        audio.play('ring', null, Math.min(1, dur / 4));
        break;
      }
      case 'smoke':
        this.fx.addSmoke(m.id, x, y, z, m.d || NADE.smoke.dur);
        audio.play('smoke', m.p);
        break;
      default:
        if (m.fz) { audio.play('smoke', m.p, 0.4); break; }
        this.fx.addFire(m.id, x, y, z, m.d || NADE.molotov.dur);
        audio.play('fire', m.p);
    }
  }

  onBomb(b) {
    const prev = this.bomb;
    this.bomb = b;
    if (b && b.st === 'planted' && !this.bombMesh) {
      this.placeBombMesh();
      audio.play('plant', [b.x, b.y, b.z]);
      this.nextBeep = 0;
    }
    if (b && b.st === 'exploded' && (!prev || prev.st !== 'exploded')) {
      this.fx.explosion(b.x, b.y, b.z, 3);
      audio.play('explode', [b.x, b.y + 1, b.z], 1.4);
      const d = Math.hypot(this.camera.position.x - b.x, this.camera.position.z - b.z);
      this.shake = Math.max(this.shake, Math.max(0.3, 1 - d / 40));
      if (this.bombMesh) { this.scene.remove(this.bombMesh); this.bombMesh = null; }
    }
    if (b && b.st === 'defused' && this.bombLed) this.bombLed.material.color.set(0x33ff66);
    if (b && b.df === this.myId && !this.w.defusing) { /* 服务器确认开始拆弹 */ }
  }

  placeBombMesh() {
    const b = this.bomb;
    const m = makeWeapon('c4', true);
    m.scale.setScalar(1.6);
    m.position.set(b.x, b.y + 0.06, b.z);
    m.rotation.y = Math.random() * Math.PI;
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    led.position.set(-0.07, 0.045, -0.04);
    m.add(led);
    this.bombLed = led;
    this.scene.add(m);
    this.bombMesh = m;
  }

  onPlanting(m) {
    if (m.id === this.myId) {
      if (!m.on) { this.w.planting = false; this.stopMySeq(); }
      return;
    }
    const p = this.players.get(m.id);
    if (!p) return;
    if (p.bombSeq) { p.bombSeq.stop(); p.bombSeq = null; }
    if (m.on && p.rp) {
      p.bombSeq = audio.seq('plant', [p.rp.x, p.rp.y + 0.5, p.rp.z]);
      if (this.isEnemyId(p.id)) this.bombPing(p);
    }
  }

  stopMySeq() {
    if (this.mySeq) { this.mySeq.stop(); this.mySeq = null; }
  }

  // 声纹：敌人开始下包 / 拆包
  bombPing(p) {
    const d = Math.hypot(p.rp.x - this.camera.position.x, p.rp.z - this.camera.position.z);
    if (d < 45) this.soundPing(p.rp.x, p.rp.z, d / 45, 'bomb');
  }

  onDefusing(m) {
    if (m.id === this.myId) {
      this.stopMySeq();
      if (m.on) {
        this.w.defusing = true; this.w.defuseStart = this.now; this.w.defuseDur = m.kit ? 5 : 10;
        this.mySeq = audio.seq('defuse', null, { vol: 0.6, dur: this.w.defuseDur });
      } else this.w.defusing = false;
      return;
    }
    const p = this.players.get(m.id);
    if (!p) return;
    if (p.bombSeq) { p.bombSeq.stop(); p.bombSeq = null; }
    if (m.on && p.rp) {
      p.bombSeq = audio.seq('defuse', [p.rp.x, p.rp.y + 0.5, p.rp.z], { dur: m.kit ? 5 : 10 });
      if (this.isEnemyId(p.id)) this.bombPing(p);
    }
  }

  addDrop(d, rest) {
    const [id, w, x, y, z, vx, vy, vz] = d;
    if (this.drops.has(id)) return;
    const mesh = makeWeapon(w, true);
    if (w !== 'c4') mesh.rotation.set(0, Math.random() * Math.PI * 2, Math.PI / 2);
    const pr = makeProjectile([x, y, z], [vx, vy, vz], 0.25);
    if (rest) pr.rest = true;
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.drops.set(id, { w, pr, mesh, t0: this.now });
  }

  onPick(m) {
    const d = this.drops.get(m.id);
    if (d) { this.scene.remove(d.mesh); this.drops.delete(m.id); }
    if (m.by === this.myId) { audio.play('pickup'); this.hud.showWeaponList(); }
  }

  // ---------------- 输入 ----------------
  handleKeys() {
    const inp = this.input;
    if (this.chatOpen || this.settingsOpen) return;
    if (inp.hit('Tab')) this.hud.openScoreboard();
    if (inp.released.has('Tab')) this.hud.closeScoreboard();
    if (this.hud.buyOpen) {
      for (let n = 1; n <= 7; n++) if (inp.hit('Digit' + n)) this.hud.buyKey(n);
      if (inp.hit('KeyB') || inp.hit('Escape')) this.closeBuy();
      return;
    }
    if (!$('rangepanel').classList.contains('hidden')) {
      if (inp.hit('Digit0') || inp.hit('Escape')) this.closeRangePanel();
      return;
    }
    if (inp.hit('Escape') && inp.locked) { inp.unlock(); return; }
    if (this.paused) return;
    if (inp.hit('KeyB')) { this.openBuy(); return; }
    if (inp.hit('Digit0') && this.mode === 'range') { this.openRangePanel(); return; }
    if (inp.hit('KeyY')) { this.openChat(false); return; }
    if (inp.hit('KeyU')) { this.openChat(true); return; }
    if (inp.hit('KeyM') && this.mode === 'bomb') { this.showTeamSelect(); return; }
    if (inp.hit('F2') && this.isHost() && this.round.ph === 'warmup') this.net.send({ t: 'start' });
    if (!this.me.alive) {
      if (inp.locked && (inp.mDown[0] || inp.hit('Space') && !this.freeCamActive)) this.cycleSpec(1);
      if (inp.locked && inp.mDown[2]) this.cycleSpec(-1);
      return;
    }
    for (let s = 1; s <= 5; s++) if (inp.hit('Digit' + s)) this.switchSlot(s);
    if (inp.hit('KeyQ')) { if (this.slotValid(this.w.prevSlot)) this.switchSlot(this.w.prevSlot); }
    if (inp.wheel) {
      const order = [1, 2, 3, 4, 5].filter((s) => this.slotValid(s));
      const i = order.indexOf(this.me.slot);
      const n = order[(i + (inp.wheel > 0 ? 1 : -1) + order.length) % order.length];
      if (n != null) this.switchSlot(n);
    }
    if (inp.hit('KeyR')) this.startReload();
    if (inp.hit('KeyG')) this.net.send({ t: 'drop' });
    if (inp.hit('KeyF')) this.vm.onInspect(this.now);
    if (inp.hit('KeyE')) this.net.send({ t: 'use' });
  }

  handleLook(dt) {
    const inp = this.input;
    this.mdx = inp.dx + inp.tdx * 3;
    this.mdy = inp.dy + inp.tdy * 3;
    if (!inp.locked || this.paused) return;
    let zoom = 1;
    const w = this.curWeapon();
    if (this.me.alive && this.w.scope > 0 && w.scope) {
      zoom = (Math.tan((w.scope[this.w.scope - 1] * DEG) / 2) / Math.tan((BASE_FOV * DEG) / 2)) * settings.zoomSens;
    }
    const sens = settings.sens * 0.022 * DEG * zoom;
    this.yaw -= inp.dx * sens;
    this.pitch = clamp(this.pitch - inp.dy * sens, -89 * DEG, 89 * DEG);
    if (inp.touch) {
      let dx = inp.tdx, dy = inp.tdy;
      const a = this.assist;
      if (a) {
        const slow = a.off < a.size * 1.8 ? 0.45 : 0.72;
        dx *= slow;
        dy *= slow;
      }
      const tz = zoom === 1 ? 1 : (zoom / settings.zoomSens) * settings.touchZoomSens;
      const k = 0.2 * settings.touchSens * DEG * tz;
      this.yaw += -dx * k * settings.touchSensX + inp.gyroYaw * tz;
      this.pitch = clamp(this.pitch - dy * k * settings.touchSensY + inp.gyroPitch * tz, -89 * DEG, 89 * DEG);
      // 辅助瞄准：转动视角或移动时，轻微吸附到敌人身上
      const active = dx !== 0 || dy !== 0 || inp.moveX !== 0 || inp.moveY !== 0 || inp.gyroYaw !== 0;
      if (a && active && this.me.alive) {
        const pull = Math.min(1, dt * 6) * 0.35;
        this.yaw += angleDiff(this.yaw, a.ay) * pull;
        this.pitch += (a.ap - this.pitch) * pull;
      }
    }
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    else if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }

  // 能不能观战这个人：只能看活着的队友（纯观众可以看所有活着的人）；死人、敌人都不行
  canSpec(p) {
    if (!p || p.id === this.myId || !p.alive || !p.rp || !(p.rp.f & F.ALIVE)) return false;
    if (p.team !== 'T' && p.team !== 'CT') return false;
    if (this.me.team === 'SPEC') return true;
    return this.mode === 'bomb' && p.team === this.me.team;
  }

  cycleSpec(dir) {
    const list = [...this.players.values()].filter((p) => this.canSpec(p));
    if (!list.length) { this.specId = null; return; }
    let i = list.findIndex((p) => p.id === this.specId);
    i = i < 0 ? 0 : (i + dir + list.length) % list.length;
    this.specId = list[i].id;
  }

  switchSlot(s, force = false) {
    const me = this.me, W = this.w;
    if (!this.slotValid(s)) return;
    if (s === 4) {
      const list = me.inv[4];
      if (me.slot === 4 && !force) {
        const types = [...new Set(list)];
        me.nade = types[(types.indexOf(me.nade) + 1) % types.length];
      } else if (!me.nade || !list.includes(me.nade)) me.nade = list[0];
    } else if (me.slot === s && !force) return;
    if (me.slot !== s) W.prevSlot = me.slot;
    if (W.planting) { W.planting = false; this.net.send({ t: 'plant', on: false }); }
    me.slot = s;
    const w = this.curWeapon();
    W.drawEnd = this.now + (w.deploy || 0.5);
    W.reloadEnd = 0;
    W.scope = 0;
    W.rescopeAt = 0;
    W.nadeHold = null;
    W.switchBackAt = 0;
    this.vm.cancelReload();
    this.vm.setWeapon(w.id, w.deploy || 0.5, this.now);
    this.vm.drawStart = this.now;
    if (!this.vm.knifeFx()) audio.play('deploy'); // 特殊刀的切刀声跟着动作走（viewmodel 里触发）
    this.lastSlotSend = this.now;
    this.net.send({ t: 'slot', s, g: me.nade });
    this.hud.showWeaponList();
  }

  startReload() {
    const me = this.me, W = this.w;
    if (me.slot !== 1 && me.slot !== 2) return;
    const it = me.inv[me.slot];
    if (!it || W.reloadEnd) return;
    const w = WEAPONS[it.w];
    if (it.clip >= w.mag || it.res <= 0) return;
    W.reloadEnd = this.now + w.reload;
    W.reloadSlot = me.slot;
    if (W.scope) { W.scope = 0; W.resume = 0; }
    this.vm.onReload(this.now, w.reload);
    audio.reload(w.id);
    this.net.send({ t: 'reload' });
  }

  // ---------------- 本地移动 ----------------
  updateLocal(dt) {
    const me = this.me, s = this.sim, inp = this.input;
    if (!me.alive) { this.updateFreeCam(dt); return; }
    const w = this.curWeapon();
    const cmd = this.cmd;
    const typing = this.chatOpen;
    const k = (c) => !typing && inp.down(c);
    cmd.fwd = (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0);
    cmd.side = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0);
    cmd.jump = k('Space');
    cmd.crouch = k('ControlLeft') || this.w.defusing;
    cmd.walk = k('ShiftLeft');
    if (inp.touch && !cmd.fwd && !cmd.side && (inp.moveX || inp.moveY)) {
      cmd.fwd = inp.moveY;
      cmd.side = inp.moveX;
      if (Math.hypot(inp.moveX, inp.moveY) < 0.6) cmd.walk = true;
    }
    // 手机“松手急停”：摇杆一松开就刹住（相当于电脑上按反方向键急停），开枪马上就准
    const touchMove = !!(inp.touch && (inp.moveX || inp.moveY));
    if (this.touchMoveWas && !touchMove && inp.touch && settings.quickStop !== false) this.quickStopT = this.now + 0.12;
    this.touchMoveWas = touchMove;
    cmd.yaw = this.yaw;
    cmd.speed = moveSpeed(w, this.w.scope > 0) * (this.now < this.tagUntil ? 0.55 : 1);
    cmd.frozen = this.frozen();
    this.acc += dt;
    let n = 0;
    while (this.acc >= PHYS_DT && n < 10) {
      this.prev.x = s.x; this.prev.y = s.y; this.prev.z = s.z;
      const wasGround = s.onGround, vy0 = s.vy, cr0 = s.crouched, y0 = s.y;
      if (this.now < (this.quickStopT || 0) && s.onGround && !cmd.fwd && !cmd.side) { s.vx *= 0.3; s.vz *= 0.3; }
      stepPlayer(s, cmd, PHYS_DT, this.world);
      this.pushFromPlayers();
      if (s.crouched !== cr0) { this.eyeOff += y0 - s.y; this.prev.y += s.y - y0; }
      if (!wasGround && s.onGround && vy0 < -4) {
        audio.play('land', null, Math.min(1, -vy0 / 12));
        this.vm.onLand(-vy0);
      }
      if (wasGround && !s.onGround && s.vy > 0) this.jumpT = this.now;
      this.acc -= PHYS_DT;
      n++;
    }
    if (n >= 10) this.acc = 0;
    const eyeT = s.crouched ? P.crouchEye : P.standEye;
    this.eyeOff += (eyeT - this.eyeOff) * Math.min(1, dt * 14);
    const sp = Math.hypot(s.vx, s.vz);
    if (s.onGround && sp > 2.9 && !cmd.walk && !s.crouched) {
      this.stepAcc += sp * dt;
      if (this.stepAcc > 2.3) { this.stepAcc = 0; audio.step(null, 0.14, this.surfaceUnder(s.x, s.y, s.z)); }
    }
  }

  // 声纹：把敌人声音的方向画在准星周围（k：0 很近 ~ 1 刚好听得到）
  soundPing(x, z, k, kind) {
    if (!settings.soundViz || !this.me.alive) return;
    const cam = this.camera.position, yaw = this.camera.rotation.y;
    const dx = x - cam.x, dz = z - cam.z;
    if (dx * dx + dz * dz < 1) return;
    const rx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const fz = -dx * Math.sin(yaw) - dz * Math.cos(yaw);
    this.hud.soundPing(Math.atan2(rx, fz), Math.max(0.3, 1 - k), kind);
  }

  surfaceUnder(x, y, z) {
    const h = this.world.raycast(x, y + 0.2, z, 0, -1, 0, 0.6);
    if (!h) return 'hard';
    const mat = this.map.boxes[h.i].mat || '';
    if (mat === 'sand') return 'sand';
    if (mat.startsWith('metal') || mat.startsWith('container')) return 'metal';
    return 'hard';
  }

  pushFromPlayers() {
    const s = this.sim;
    for (const p of this.players.values()) {
      if (p.id === this.myId || !p.rp || !(p.rp.f & F.ALIVE)) continue;
      const dx = s.x - p.rp.x, dz = s.z - p.rp.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= 0.62 || Math.abs(s.y - p.rp.y) > 1.6) continue;
      const d = Math.sqrt(d2) || 0.01;
      const push = 0.79 - d;
      const nx = s.x + (dx / d) * push, nz = s.z + (dz / d) * push;
      if (!hullBlocked(this.world, nx, s.y + 0.02, nz, s.crouched ? P.crouchH : P.standH)) { s.x = nx; s.z = nz; }
    }
  }

  updateFreeCam(dt) {
    // 在队伍里的人死了不能自由飞（不然能看到敌人）：有队友就看队友，没有就停在自己倒下的地方
    if (this.me.team !== 'SPEC') { this.freeCamActive = false; return; }
    const inp = this.input, fc = this.fc;
    this.freeCamActive = true;
    if (this.chatOpen || this.paused) return;
    const sp = (inp.down('ShiftLeft') ? 25 : 12) * dt;
    const f = dirFromAngles(this.yaw, this.pitch);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const fw = (inp.down('KeyW') ? 1 : 0) - (inp.down('KeyS') ? 1 : 0) + inp.moveY;
    const sd = (inp.down('KeyD') ? 1 : 0) - (inp.down('KeyA') ? 1 : 0) + inp.moveX;
    const up = (inp.down('Space') ? 1 : 0) - (inp.down('ControlLeft') ? 1 : 0);
    fc.x += (f[0] * fw + rx * sd) * sp;
    fc.y += (f[1] * fw + up) * sp;
    fc.z += (f[2] * fw + rz * sd) * sp;
    fc.x = clamp(fc.x, -20, this.map.bounds.x1 + 20);
    fc.z = clamp(fc.z, -20, this.map.bounds.z1 + 20);
    fc.y = clamp(fc.y, 0.5, 80);
  }

  specTarget() {
    if (this.specId != null) {
      const p = this.players.get(this.specId);
      if (this.canSpec(p)) return p;
    }
    this.cycleSpec(1);
    return this.specId != null ? this.players.get(this.specId) : null;
  }

  // ---------------- 武器 ----------------
  updateWeapon(dt) {
    const me = this.me, W = this.w, now = this.now, inp = this.input;
    const w = this.curWeapon();
    // 后坐力恢复
    recoverRecoil(W, w, dt, now - W.lastShot);
    if (!me.alive) return;
    // 换弹完成
    if (W.reloadEnd && now >= W.reloadEnd) {
      const it = me.inv[W.reloadSlot];
      if (it && me.slot === W.reloadSlot) {
        const ww = WEAPONS[it.w];
        const take = Math.min(ww.mag - it.clip, it.res);
        it.clip += take;
        it.res -= take;
      }
      W.reloadEnd = 0;
    }
    if (W.rescopeAt && now >= W.rescopeAt) {
      W.rescopeAt = 0;
      if (W.resume && w.scope && inp.locked) W.scope = W.resume;
    }
    if (W.switchBackAt && now >= W.switchBackAt) {
      W.switchBackAt = 0;
      if (me.inv[4].length && me.slot === 4) this.switchSlot(4, true);
      else this.switchSlot(this.slotValid(W.prevSlot) && W.prevSlot !== 4 ? W.prevSlot : this.bestSlot(), true);
    }
    const ph = this.round.ph;
    const canAct = inp.locked && !this.paused && !this.chatOpen && ph !== 'freeze' && ph !== 'matchover' && ph !== 'idle';
    const ready = now >= W.drawEnd;
    // 拆弹（按住 E）
    const b = this.bomb;
    const nearBomb = me.team === 'CT' && b && b.st === 'planted' && Math.hypot(this.sim.x - b.x, this.sim.z - b.z) < 2.0 && Math.abs(this.sim.y - b.y) < 1.8;
    if (inp.down('KeyE') && nearBomb && canAct && this.sim.onGround) {
      if (!W.defusing && !W.defuseReq) { W.defuseReq = true; this.net.send({ t: 'defuse', on: true }); }
    } else if (W.defusing || W.defuseReq) {
      if (W.defusing || W.defuseReq) this.net.send({ t: 'defuse', on: false });
      W.defusing = false;
      W.defuseReq = false;
    }
    if (!inp.down('KeyE')) W.defuseReq = false;
    if (W.defusing) return;

    if (isGun(w)) {
      const it = me.inv[me.slot];
      if (inp.mDown[0]) W.pendingClick = now;
      const auto = this.isTouch && settings.autoFire && this.aimEnemy && (w.type !== 'sniper' || W.scope > 0);
      // 刚按过开火（0.12 秒内）就开枪：甩狙时点得很快，按下松开都在两帧之间，也不能吞掉这一枪
      const clicked = now - W.pendingClick < 0.12;
      const wantFire = (w.auto ? inp.mouse[0] || clicked : clicked) || auto;
      if (wantFire && canAct && ready && !W.reloadEnd && now >= W.nextFire) {
        if (it.clip > 0) {
          W.pendingClick = -1;
          this.fireOnce(w, it);
        } else if (inp.mDown[0] || w.auto) {
          audio.play('empty');
          W.nextFire = now + 0.25;
          W.pendingClick = -1;
          if (it.res > 0) this.startReload();
        }
      }
      if (inp.mDown[2] && w.scope && canAct && !W.reloadEnd) {
        W.scope = (W.scope + 1) % (w.scope.length + 1);
        W.rescopeAt = 0;
        audio.play('scope');
      }
      if (it && it.clip === 0 && it.res > 0 && !W.reloadEnd && now - W.lastShot > 0.25 && !inp.mouse[0]) this.startReload();
    } else if (w.type === 'knife') {
      if (canAct && ready && now >= W.nextFire) {
        if (inp.mouse[0]) this.knifeAttack(false);
        else if (inp.mouse[2]) this.knifeAttack(true);
      }
    } else if (w.type === 'grenade') {
      if (canAct && ready && !W.nadeHold && (inp.mDown[0] || inp.mDown[2])) {
        W.nadeHold = { t0: now, l: false, r: false };
        audio.play('pin');
      }
      if (W.nadeHold) {
        W.nadeHold.l = W.nadeHold.l || inp.mouse[0];
        W.nadeHold.r = W.nadeHold.r || inp.mouse[2];
        if (!inp.mouse[0] && !inp.mouse[2] && now - W.nadeHold.t0 > 0.2 && canAct) {
          const s = W.nadeHold.l && W.nadeHold.r ? 0.62 : W.nadeHold.l ? 1 : 0.32;
          W.nadeHold = null;
          this.throwNade(s);
        }
      }
    } else if (w.type === 'c4') {
      const can = canAct && ph === 'live' && this.sim.onGround && this.inSite();
      if (inp.mouse[0] && can && ready) {
        if (!W.planting) {
          W.planting = true;
          W.plantStart = now;
          this.net.send({ t: 'plant', on: true });
          this.stopMySeq();
          this.mySeq = audio.seq('plant', null, { vol: 0.55 });
        }
      } else if (W.planting) {
        W.planting = false;
        this.net.send({ t: 'plant', on: false });
        this.stopMySeq();
      }
      if (inp.mDown[0] && !can && canAct) this.hud.center(ph !== 'live' ? '现在不能安放炸弹' : '必须在包点内安放炸弹', 1.5);
    }
  }

  fireOnce(w, it) {
    const W = this.w, now = this.now;
    if (!(this.rangeOpts && this.rangeOpts.ammo === 'mag')) it.clip--;
    W.nextFire = now + 60 / w.rpm;
    W.lastShot = now;
    const inacc = this.currentInacc(w);
    W.fireAcc = Math.min(w.spread.cap, W.fireAcc + w.spread.fire);
    if (this.rangeStats) { this.rangeStats.shots++; this.hud.rangeStats(this.rangeStats); }
    const eye = this.eyePos();
    const yaw = this.yaw + W.punchY, pitch = this.pitch + W.punchP;
    const targets = this.targets();
    const hits = [], ends = [];
    this.scene.updateMatrixWorld();
    this.vm.scene.updateMatrixWorld();
    const muz = this.vm.muzzleWorld(this.camera, new THREE.Vector3());
    for (let k = 0; k < (w.pellets || 1); k++) {
      const dir = spreadDir(yaw, pitch, inacc + (w.spread.pellet || 0), Math.random, tmp3);
      const res = traceShot(this.world, eye.x, eye.y, eye.z, dir[0], dir[1], dir[2], 250, targets, this.myId);
      ends.push([r2(res.x), r2(res.y), r2(res.z), res.kind]);
      if (res.kind === 2) {
        if (this.isEnemyId(res.id)) hits.push([res.id, res.g, r2(res.x), r2(res.y), r2(res.z), r2(res.tg.x), r2(res.tg.y), r2(res.tg.z)]);
        this.fx.blood(res.x, res.y, res.z, dir[0], dir[1], dir[2], res.g === HG.HEAD);
      } else if (res.kind === 1) {
        const bm = (this.map.boxes[res.i] && this.map.boxes[res.i].mat) || '';
        this.fx.impact(res.x, res.y, res.z, res.nx, res.ny, res.nz, bm.startsWith('metal') || bm.startsWith('container') ? 'metal' : 'wall');
      }
      if (k < 3 && (w.type !== 'pistol' || Math.random() < 0.5)) this.fx.tracer(muz.x, muz.y, muz.z, res.x, res.y, res.z);
    }
    const pat = patternKick(w, W.spray);
    W.punchY += pat[0] * DEG * (0.9 + Math.random() * 0.2);
    W.punchP += pat[1] * DEG;
    W.spray = nextSpray(w, W.spray);
    this.vm.onFire(now, w.type === 'sniper' ? 1.4 : 1);
    audio.shot(w.id, null);
    this.net.send({ t: 'fire', w: w.id, o: [r2(eye.x), r2(eye.y), r2(eye.z)], h: hits, e: ends.slice(0, 12) });
    if (w.type === 'sniper' && W.scope > 0) {
      W.resume = W.scope;
      W.scope = 0;
      W.rescopeAt = now + (60 / w.rpm) * 0.8;
    }
    if (w.type === 'sniper' || w.type === 'shotgun' || w.id === 'deagle') this.shake = Math.max(this.shake, 0.08);
  }

  knifeAttack(stab) {
    const W = this.w, now = this.now;
    W.nextFire = now + (stab ? 1.0 : 0.45);
    this.vm.onKnife(now, stab);
    audio.play('knife');
    const eye = this.eyePos();
    const targets = this.targets();
    let best = null;
    for (const [oy, op] of [[0, 0], [0.16, 0], [-0.16, 0], [0, 0.12], [0, -0.12]]) {
      const d = dirFromAngles(this.yaw + oy, this.pitch + op);
      const res = traceShot(this.world, eye.x, eye.y, eye.z, d[0], d[1], d[2], stab ? 1.35 : 1.75, targets, this.myId);
      res.dir = d.slice();
      if (res.kind === 2 && (!best || best.kind !== 2 || res.t < best.t)) best = res;
      else if (!best && res.kind === 1) best = res;
    }
    const hits = [];
    if (best && best.kind === 2 && this.isEnemyId(best.id)) {
      hits.push([best.id, best.g, r2(best.x), r2(best.y), r2(best.z), r2(best.tg.x), r2(best.tg.y), r2(best.tg.z)]);
      this.fx.blood(best.x, best.y, best.z, best.dir[0], best.dir[1], best.dir[2], false);
      audio.play('knifehit');
    } else if (best && best.kind === 1) {
      this.fx.impact(best.x, best.y, best.z, best.nx, best.ny, best.nz);
      audio.play('knifehit', null, 0.5);
    }
    this.net.send({ t: 'fire', w: 'knife', stab, o: [r2(eye.x), r2(eye.y), r2(eye.z)], h: hits, e: [] });
  }

  throwNade(strength) {
    const me = this.me, W = this.w;
    const type = me.nade && me.inv[4].includes(me.nade) ? me.nade : me.inv[4][0];
    if (!type) return;
    const p = this.pitch + (Math.PI / 2 - Math.abs(this.pitch)) * (10 / 90);
    const dir = dirFromAngles(this.yaw, p);
    const v = throwVelocity(dir, strength, [this.sim.vx, this.sim.vy, this.sim.vz]);
    const eye = this.eyePos();
    let o = [eye.x + dir[0] * 0.25, eye.y + dir[1] * 0.25 - 0.05, eye.z + dir[2] * 0.25];
    if (!this.world.clear(eye.x, eye.y, eye.z, o[0], o[1], o[2])) o = [eye.x, eye.y - 0.05, eye.z];
    o = o.map(r2);
    const vv = v.map(r2);
    this.net.send({ t: 'throw', g: type, o, v: vv });
    this.addNade('L' + this.localNadeN++, type, o, vv, true);
    const i = me.inv[4].indexOf(type);
    if (i >= 0) me.inv[4].splice(i, 1);
    W.pendingThrow = type;
    W.pendingThrowT = this.now;
    this.vm.onThrow(this.now);
    audio.play('throw');
    if (me.inv[4].length) me.nade = me.inv[4][0];
    W.switchBackAt = this.now + 0.45;
  }

  sendState() {
    if (this.now - this.lastSend < 1 / 30) return;
    this.lastSend = this.now;
    const s = this.sim;
    let f = 0;
    if (s.crouched) f |= F.CROUCH;
    if (this.cmd.walk) f |= F.WALK;
    if (s.onGround) f |= F.GROUND;
    if (this.me.alive) f |= F.ALIVE;
    if (this.w.scope) f |= F.SCOPED;
    const msg = { t: 'st', a: [r3(this.yaw), r3(this.pitch)], f, pg: this.ping };
    if (this.me.alive) { msg.p = [r2(s.x), r2(s.y), r2(s.z)]; msg.v = [r2(s.vx), r2(s.vy), r2(s.vz)]; }
    this.net.send(msg);
    if (this.now - this.lastPing > 2 && !this.net.isLocal) {
      this.lastPing = this.now;
      this.net.send({ t: 'ping', c: performance.now() });
    }
  }

  // ---------------- 其他玩家 ----------------
  updateRemotes(dt) {
    const rt = this.serverNow() - INTERP_DELAY * 1000;
    const myTeam = this.me.team;
    for (const p of this.players.values()) {
      if (p.id === this.myId || !p.buf.length) continue;
      const buf = p.buf;
      let a = null, b = null;
      for (let i = buf.length - 1; i >= 0; i--) {
        if (buf[i].t <= rt) { a = buf[i]; b = buf[i + 1] || null; break; }
      }
      if (!a) { a = buf[0]; b = null; }
      let x = a.x, y = a.y, z = a.z, yaw = a.yaw, pitch = a.pitch;
      if (b) {
        const k = clamp((rt - a.t) / Math.max(1, b.t - a.t), 0, 1);
        if (Math.hypot(b.x - a.x, b.z - a.z) > 5) { if (k > 0.5) { x = b.x; y = b.y; z = b.z; } }
        else { x = lerp(a.x, b.x, k); y = lerp(a.y, b.y, k); z = lerp(a.z, b.z, k); }
        yaw = lerpAngle(a.yaw, b.yaw, k);
        pitch = lerp(a.pitch, b.pitch, k);
      }
      const f = (b && rt - a.t > (b.t - a.t) * 0.5 ? b : a).f;
      const lx = p.rp ? p.rp.x : x, lz = p.rp ? p.rp.z : z;
      p.rp = { x, y, z, yaw, pitch, f, w: a.w };
      const alive = !!(f & F.ALIVE);
      const inst = Math.hypot(x - lx, z - lz) / Math.max(dt, 1e-3);
      p.speed += (Math.min(inst, 9) - p.speed) * Math.min(1, dt * 10);
      if (!p.model || p.model.team !== p.team) {
        this.removePlayerModel(p);
        if (p.team !== 'T' && p.team !== 'CT') continue;
        p.model = new PlayerModel(p.team, p.name);
        this.scene.add(p.model.root);
      }
      const m = p.model;
      if (alive) {
        // 死斗里复活前，把尸体留在原地
        if (p.seenAlive && p.deadYaw != null && m.deadT >= 0 && (this.mode !== 'bomb' || this.round.ph === 'warmup')) this.leaveCorpse(m);
        p.deadYaw = null;
        p.seenAlive = true;
      }
      m.root.position.set(x, y, z);
      if (!alive && p.deadYaw == null) {
        p.deadYaw = yaw;
        const [dx, dz] = p.deathPush || [Math.sin(yaw), Math.cos(yaw)];
        p.deathPush = null;
        m.setDeathPush(dx, dz, yaw);
        if (p.seenAlive) this.bloodPoolAt(x, y, z, dx, dz);
      }
      m.root.rotation.y = alive ? yaw : p.deadYaw;
      m.setWeapon(alive ? a.w : null, p.skin);
      m.update(dt, { speed: p.speed, crouch: !!(f & F.CROUCH), pitch, alive, bomb: !!(f & F.BOMB), now: this.now });
      // 还没出生过的玩家不显示（否则会在地图原点躺着）
      m.root.visible = alive || !!p.seenAlive;
      if (m.tag) m.tag.visible = alive && this.mode !== 'dm' && (p.team === myTeam || myTeam === 'SPEC') && this.specId !== p.id;
      if (this.specId === p.id && !this.me.alive) m.root.visible = false;
      if (alive && f & F.GROUND && !(f & F.WALK) && !(f & F.CROUCH) && p.speed > 2.9) {
        p.stepAcc += p.speed * dt;
        if (p.stepAcc > 2.3) {
          p.stepAcc = 0;
          const heard = audio.step([x, y, z], 0.6, this.surfaceUnder(x, y, z));
          if (heard && this.isEnemyId(p.id)) this.soundPing(x, z, heard.d / 32, 'step');
        }
      }
    }
    while (this.corpses.length && this.now - this.corpses[0].t > (this.isTouch ? 12 : 20)) this.scene.remove(this.corpses.shift().obj);
    if (this.frameN % 3 === 0) this.updateTargetName();
  }

  leaveCorpse(m) {
    const c = m.root.clone();
    c.traverse((o) => { if (o.isSprite) o.visible = false; });
    this.scene.add(c);
    this.corpses.push({ obj: c, t: this.now });
    while (this.corpses.length > (this.isTouch ? 4 : 8)) this.scene.remove(this.corpses.shift().obj);
  }

  // 血泊放在尸体胸口下面；找不到地面就不放
  bloodPoolAt(x, y, z, dx, dz) {
    for (const d of [1.0, 0.5]) {
      const px = x + dx * d, pz = z + dz * d;
      const h = this.world.raycast(px, y + 0.5, pz, 0, -1, 0, 3);
      if (h && h.t > 0.05) { this.fx.bloodPool(px, y + 0.5 - h.t, pz); return; }
    }
  }

  // 触屏辅助瞄准：找准星附近、看得见的敌人
  updateAssist() {
    this.assist = null;
    if (!settings.aimAssist || !this.me.alive) return;
    const w = this.curWeapon();
    if (!isGun(w) && w.type !== 'knife') return;
    const e = this.eyePos();
    let best = null, bestScore = Infinity;
    for (const p of this.players.values()) {
      if (p.id === this.myId || !p.rp || !(p.rp.f & F.ALIVE) || !this.isEnemyId(p.id)) continue;
      const crouch = p.rp.f & F.CROUCH;
      const tx = p.rp.x, ty = p.rp.y + (crouch ? 0.95 : 1.3), tz = p.rp.z;
      const dx = tx - e.x, dy = ty - e.y, dz = tz - e.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > 70 || d < 0.5) continue;
      const [ay, ap] = anglesFromDir(dx, dy, dz);
      const off = Math.hypot(angleDiff(this.yaw, ay), ap - this.pitch);
      const size = Math.atan2(0.45, d);
      const cone = size * 3 + 0.035;
      if (off > cone) continue;
      const score = off / cone;
      if (score < bestScore) { bestScore = score; best = { ay, ap, off, size, x: tx, y: ty, z: tz }; }
    }
    if (best && (!this.world.clear(e.x, e.y, e.z, best.x, best.y, best.z) || this.fx.smokeDensityAt({ x: (e.x + best.x) / 2, y: (e.y + best.y) / 2, z: (e.z + best.z) / 2 }) > 0.4)) best = null;
    this.assist = best;
  }

  updateTargetName() {
    this.targetName = '';
    this.aimEnemy = false;
    if (!this.me.alive) return;
    const c = this.camera.position;
    const d = dirFromAngles(this.yaw, this.pitch);
    const res = traceShot(this.world, c.x, c.y, c.z, d[0], d[1], d[2], 60, this.targets(), this.myId);
    if (res.kind === 2) {
      const p = this.players.get(res.id);
      if (p) {
        const enemy = this.isEnemyId(p.id);
        // 瞄到敌人不显示名字（和 CS2 一样只显示队友的名字）；训练场显示距离
        this.targetName = enemy ? (this.mode === 'range' ? `${Math.round(res.t)} 米` : '') : p.name + ' (队友)';
        this.aimEnemy = enemy && !(p.rp && p.rp.f & F.PROTECT);
      }
    }
  }

  // ---------------- 实体 ----------------
  updateEntities(dt) {
    const now = this.now;
    for (const [id, n] of this.nades) {
      const target = now - n.t0;
      let guard = 0;
      while (n.pr.age + NADE_STEP <= target && guard++ < 200) {
        if (stepProjectile(n.pr, NADE_STEP, this.world)) audio.play('bounce', [n.pr.x, n.pr.y, n.pr.z]);
      }
      n.mesh.position.set(n.pr.x, n.pr.y, n.pr.z);
      if (!n.pr.rest) { n.mesh.rotation.x += dt * 9; n.mesh.rotation.z += dt * 5; }
      if (n.local && target > 8) { this.scene.remove(n.mesh); this.nades.delete(id); }
    }
    for (const d of this.drops.values()) {
      if (!d.pr.rest) {
        const target = now - d.t0;
        let guard = 0;
        while (d.pr.age + NADE_STEP <= target && guard++ < 200) stepProjectile(d.pr, NADE_STEP, this.world, 20);
      }
      d.mesh.position.set(d.pr.x, d.pr.y + (d.pr.rest ? 0.03 : 0), d.pr.z);
    }
    const b = this.bomb;
    if (b && b.st === 'planted' && this.bombMesh) {
      const left = (b.ea - this.serverNow()) / 1000;
      const k = clamp(left / 40, 0, 1);
      const iv = 0.1 + 0.9 * Math.pow(k, 1.4);
      if (now >= this.nextBeep && left > 0) {
        this.nextBeep = now + iv;
        audio.play('beep', [b.x, b.y + 0.2, b.z]);
        this.bombLedOn = now + 0.08;
      }
      if (this.bombLed) this.bombLed.visible = now < this.bombLedOn || left < 1.2;
    }
  }

  // ---------------- 镜头 ----------------
  updateCamera(dt) {
    const cam = this.camera, now = this.now, W = this.w;
    this.shake *= Math.exp(-dt * 6);
    const sh = this.shake > 0.01 ? this.shake : 0;
    const sx = sh ? (Math.random() - 0.5) * sh * 0.05 : 0, sy = sh ? (Math.random() - 0.5) * sh * 0.05 : 0;
    let roll = 0;
    if (this.me.alive) {
      const a = clamp(this.acc / PHYS_DT, 0, 1);
      cam.position.set(lerp(this.prev.x, this.sim.x, a), lerp(this.prev.y, this.sim.y, a) + this.eyeOff, lerp(this.prev.z, this.sim.z, a));
      cam.rotation.set(this.pitch + W.punchP * 0.5 + sy, this.yaw + W.punchY * 0.5 + sx, 0);
      this.freeCamActive = false;
    } else if (this.deathT >= 0 && now - this.deathT < 3 && this.deathPos) {
      const t = now - this.deathT;
      const k = Math.min(1, t / 0.6);
      cam.position.set(this.deathPos.x, this.deathPos.y - k * 1.25, this.deathPos.z);
      const killer = this.killerId != null && this.killerId !== this.myId ? this.players.get(this.killerId) : null;
      if (killer && killer.rp && t > 0.45) {
        // 看向凶手
        const [ty, tp] = anglesFromDir(killer.rp.x - cam.position.x, killer.rp.y + 1.2 - cam.position.y, killer.rp.z - cam.position.z);
        const q = Math.min(1, dt * 5);
        this.yaw = lerpAngle(this.yaw, ty, q);
        this.pitch = lerp(this.pitch, tp, q);
        this.deathRoll = lerp(this.deathRoll ?? 0.45, 0.12, q);
        cam.rotation.set(this.pitch, this.yaw, this.deathRoll);
      } else {
        roll = k * 0.45;
        this.deathRoll = roll;
        cam.rotation.set(this.pitch * (1 - k) + 0.1 * k, this.yaw, roll);
        if (k >= 1) this.pitch = 0.1;
      }
    } else {
      const sp = this.me.team !== 'SPEC' || this.specId != null ? this.specTarget() : null;
      this.noSpecMate = !sp && this.me.team !== 'SPEC';
      if (sp && sp.rp) {
        const f = sp.rp.f;
        cam.position.set(sp.rp.x, sp.rp.y + (f & F.CROUCH ? P.crouchEye : P.standEye), sp.rp.z);
        cam.rotation.set(sp.rp.pitch, sp.rp.yaw, 0);
        this.freeCamActive = false;
      } else if (this.me.team === 'T' || this.me.team === 'CT') {
        // 没有活着的队友可看：镜头留在自己倒下的地方（可以转视角，不能乱飞）；还没出生过就在自家出生点
        const sp0 = (this.map.spawns[this.me.team] || [])[0];
        const d = this.deathPos ? { x: this.deathPos.x, y: this.deathPos.y - 1.25, z: this.deathPos.z } : sp0 ? { x: sp0.x, y: sp0.y + P.standEye, z: sp0.z } : this.fc;
        cam.position.set(d.x, d.y, d.z);
        cam.rotation.set(this.pitch, this.yaw, this.deathPos ? this.deathRoll ?? 0.12 : 0);
        this.freeCamActive = false;
      } else {
        cam.position.set(this.fc.x, this.fc.y, this.fc.z);
        cam.rotation.set(this.pitch, this.yaw, 0);
      }
    }
    const w = this.curWeapon();
    let fov = BASE_FOV;
    if (this.me.alive && W.scope > 0 && w.scope) fov = w.scope[W.scope - 1];
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 30);
      if (Math.abs(cam.fov - fov) < 0.05) cam.fov = fov;
      cam.updateProjectionMatrix();
      this.fx.setPointScale(this.renderer.domElement.height, cam.fov);
    }
    this.env.follow(cam.position);
    audio.setListener(cam.position.x, cam.position.y, cam.position.z, this.me.alive ? this.yaw : cam.rotation.y);
  }

  updateOverlays() {
    const now = this.now;
    if (now < this.flashUntil) {
      const left = this.flashUntil - now;
      this.flashAlpha = left > this.flashDur * 0.45 ? 1 : clamp(left / (this.flashDur * 0.45), 0, 1);
    } else this.flashAlpha = 0;
    this.smokeAlpha = this.fx.smokeDensityAt(this.camera.position) * 0.97;
  }

  render() {
    const r = this.renderer;
    r.autoClear = false;
    r.clear();
    r.render(this.scene, this.camera);
    if (this.me.alive && this.w.scope === 0) {
      r.clearDepth();
      r.render(this.vm.scene, this.vm.camera);
    }
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2) * settings.res);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vm.resize(w / h);
    this.fx.setPointScale(this.renderer.domElement.height, this.camera.fov);
  }

  // ---------------- 主循环 ----------------
  frame(tMs) {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frameBound);
    this.tick(tMs);
  }

  tick(tMs) {
    const now = Math.max(tMs / 1000, this.lastT + 0.0005);
    const dt = clamp(now - this.lastT, 0.0005, 0.1);
    this.lastT = now;
    this.now = now;
    this.frameN++;
    this.fpsAcc += dt;
    this.fpsN++;
    if (this.fpsAcc >= 0.5) { this.fps = Math.round(this.fpsN / this.fpsAcc); this.fpsAcc = 0; this.fpsN = 0; }
    try {
      this.net.update(dt);
      const box = this.inbox;
      this.inbox = [];
      for (let i = 0; i < box.length; i++) {
        const m = box[i];
        if (m.t === 'init') {
          this.exit({ silent: true, init: m, rest: box.slice(i + 1) });
          return;
        }
        try { this.onMsg(m); } catch (e) { console.error('处理消息出错', m.t, e); }
      }
      this.handleKeys();
      if (this.isTouch && this.frameN % 2 === 0) this.updateAssist();
      this.handleLook(dt);
      this.updateLocal(dt);
      this.updateWeapon(dt);
      this.sendState();
      this.updateRemotes(dt);
      this.updateEntities(dt);
      this.updateCamera(dt);
      this.updateOverlays(dt);
      this.fx.update(dt, this.camera.position, audio);
      if (this.me.alive) {
        this.vm.update(dt, {
          now, speed: Math.hypot(this.sim.vx, this.sim.vz), onGround: this.sim.onGround, crouch: this.sim.crouched,
          mdx: this.mdx, mdy: this.mdy, scoped: this.w.scope > 0, silenced: !!this.curWeapon().silenced,
        });
      }
      this.hud.update(dt);
      if (this.touch) this.touch.update();
      this.render();
    } catch (e) {
      console.error('帧更新出错', e);
    }
    this.input.endFrame();
  }

  exit(opts = {}) {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.stopAllSeq();
    if (this.touch) { this.touch.destroy(); this.touch = null; }
    this.input.detach();
    window.removeEventListener('resize', this.onResizeBound);
    window.removeEventListener('beforeunload', this.beforeUnload);
    for (const [el, ev, fn] of this.ui) el.removeEventListener(ev, fn);
    this.hud.hide();
    this.closeChat();
    this.net.onmessage = null;
    this.net.onclose = null;
    for (const p of this.players.values()) this.removePlayerModel(p);
    this.fx.clearRound();
    this.scene.traverse((o) => {
      if (o.isMesh && o.parent === this.mapMesh) { o.geometry.dispose(); }
    });
    if (!opts.init) {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      if (navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock();
    }
    if (this.onExit) this.onExit(opts);
  }
}
