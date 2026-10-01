// 触屏操作：左侧浮动摇杆移动、右侧滑动转视角、开火键可拖动瞄准、功能按钮、切枪栏、陀螺仪瞄准
import { WEAPONS, isGun } from '../shared/weapons.js';
import { DEG } from '../shared/util.js';
import { settings } from './settings.js';
import { audio } from './audio.js';

const SLOT_SHORT = { 3: '刀', 5: 'C4' };

export const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches;

const HTML = `
<div class="t-joy"><div class="t-knob"></div></div>
<button class="t-btn t-fire" data-act="fire"><span>开火</span></button>
<button class="t-btn t-fire-l" data-act="fire"><span>开火</span></button>
<button class="t-btn t-jump" data-act="jump"><span>跳</span></button>
<button class="t-btn t-crouch" data-act="crouch"><span>蹲</span></button>
<button class="t-btn t-reload" data-act="reload"><span>换弹</span></button>
<button class="t-btn t-alt" data-act="alt"><span>开镜</span></button>
<button class="t-btn t-use" data-act="use"><span>拆弹</span></button>
<div class="t-weapons"></div>
<button class="t-sm t-buy" data-act="buy">🛒 购买</button>
<div class="t-top">
  <button class="t-sm" data-act="score">📋</button>
  <button class="t-sm" data-act="chat">💬</button>
  <button class="t-sm t-fs" data-act="fs" title="全屏">⛶</button>
  <button class="t-sm" data-act="menu">☰</button>
</div>
<div class="t-spec"><button class="t-sm" data-act="specPrev">◀ 上一个</button><button class="t-sm" data-act="specNext">下一个 ▶</button></div>
`;

export class TouchControls {
  constructor(game) {
    this.g = game;
    this.inp = game.input;
    const el = (this.el = document.createElement('div'));
    el.id = 'touch-ui';
    el.innerHTML = HTML;
    document.body.appendChild(el);
    document.body.classList.add('touch');
    this.joy = el.querySelector('.t-joy');
    this.knob = el.querySelector('.t-knob');
    this.q = (s) => el.querySelector(s);
    this.ptrs = new Map();
    this.crouchOn = false;
    this.cache = {};
    this.h = {
      down: (e) => this.onDown(e), move: (e) => this.onMove(e), up: (e) => this.onUp(e),
      ctx: (e) => e.preventDefault(), resize: () => this.applyLayout(), motion: (e) => this.onMotion(e),
    };
    el.addEventListener('pointerdown', this.h.down);
    el.addEventListener('pointermove', this.h.move);
    el.addEventListener('pointerup', this.h.up);
    el.addEventListener('pointercancel', this.h.up);
    el.addEventListener('lostpointercapture', this.h.up);
    el.addEventListener('contextmenu', this.h.ctx);
    window.addEventListener('resize', this.h.resize);
    this.applyLayout();
    for (const b of document.querySelectorAll('[data-close="buymenu"]')) b.textContent = '关闭';
    this.lastMotion = 0;
    if (settings.gyro) this.enableGyro();
  }

  applyLayout() {
    const b = Math.max(44, Math.min(86, Math.min(innerHeight, innerWidth) * 0.15)) * settings.btnScale;
    document.documentElement.style.setProperty('--tb', b.toFixed(1) + 'px');
    this.el.style.setProperty('--to', String(settings.btnOpacity));
    this.q('.t-fire-l').classList.toggle('off', !settings.leftFire);
    this.joyR = b * 0.95;
  }

  onDown(e) {
    e.preventDefault();
    audio.init();
    const btn = e.target.closest('[data-act]');
    try { this.el.setPointerCapture(e.pointerId); } catch {}
    const p = { kind: 'look', x: e.clientX, y: e.clientY, act: null, btn: null };
    if (btn) {
      p.kind = 'btn';
      p.act = btn.dataset.act;
      p.btn = btn;
      btn.classList.add('on');
      this.press(p.act, true);
    } else if (e.clientX < innerWidth * 0.42 && e.clientY > innerHeight * 0.22 && ![...this.ptrs.values()].some((q) => q.kind === 'joy')) {
      p.kind = 'joy';
      p.bx = e.clientX;
      p.by = e.clientY;
      this.joy.style.left = p.bx + 'px';
      this.joy.style.top = p.by + 'px';
      this.joy.classList.add('on');
      this.setKnob(0, 0);
    }
    this.ptrs.set(e.pointerId, p);
  }

  onMove(e) {
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (p.kind === 'joy') {
      let vx = e.clientX - p.bx, vy = e.clientY - p.by;
      const r = this.joyR, l = Math.hypot(vx, vy);
      if (l > r * 1.6) {
        // 手指拖远了：底座跟过去（浮动摇杆）
        p.bx = e.clientX - (vx / l) * r;
        p.by = e.clientY - (vy / l) * r;
        this.joy.style.left = p.bx + 'px';
        this.joy.style.top = p.by + 'px';
        vx = e.clientX - p.bx;
        vy = e.clientY - p.by;
      }
      const ll = Math.hypot(vx, vy);
      if (ll > r) { vx *= r / ll; vy *= r / ll; }
      this.setKnob(vx, vy);
      let mx = vx / r, my = -vy / r;
      if (Math.hypot(mx, my) < 0.14) { mx = 0; my = 0; }
      this.inp.moveX = mx;
      this.inp.moveY = my;
    } else if (p.kind === 'look' || (p.kind === 'btn' && p.act === 'fire')) {
      this.inp.tdx += dx;
      this.inp.tdy += dy;
    }
  }

  onUp(e) {
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    this.ptrs.delete(e.pointerId);
    if (p.kind === 'joy') {
      this.joy.classList.remove('on');
      this.inp.moveX = 0;
      this.inp.moveY = 0;
    } else if (p.kind === 'btn') {
      p.btn.classList.remove('on');
      this.press(p.act, false);
    }
  }

  setKnob(x, y) {
    this.knob.style.transform = `translate(calc(-50% + ${x.toFixed(1)}px), calc(-50% + ${y.toFixed(1)}px))`;
  }

  press(act, down) {
    const inp = this.inp, g = this.g;
    switch (act) {
      case 'fire': inp.vMouse(0, down); break;
      case 'alt': inp.vMouse(2, down); break;
      case 'jump': inp.vKey('Space', down); break;
      case 'reload': inp.vKey('KeyR', down); break;
      case 'use': inp.vKey('KeyE', down); break;
      case 'drop': inp.vKey('KeyG', down); break;
      case 'crouch':
        if (down) { this.crouchOn = !this.crouchOn; inp.vKey('ControlLeft', this.crouchOn); }
        break;
      case 'buy': if (down) g.openBuy(); break;
      case 'score': if (down) { if (g.hud.sbOpen) g.hud.closeScoreboard(); else g.hud.openScoreboard(); } break;
      case 'chat': if (down) g.openChat(false); break;
      case 'menu': if (down) g.openPauseMenu(); break;
      case 'fs': if (down) g.toggleFullscreen(); break;
      case 'specPrev': if (down) g.cycleSpec(-1); break;
      case 'specNext': if (down) g.cycleSpec(1); break;
      default:
        if (down && act.startsWith('slot')) g.switchSlot(+act.slice(4));
    }
  }

  // 所有触点松开（打开菜单时）
  reset() {
    for (const p of this.ptrs.values()) if (p.btn) p.btn.classList.remove('on');
    this.ptrs.clear();
    this.joy.classList.remove('on');
    if (this.crouchOn) { this.crouchOn = false; this.inp.vKey('ControlLeft', false); }
    this.inp.releaseAll();
  }

  set(sel, key, val, fn) {
    if (this.cache[key] === val) return;
    this.cache[key] = val;
    fn(this.q(sel), val);
  }

  update() {
    const g = this.g, me = g.me, W = g.w;
    const blocked = g.anyOverlay() || g.hud.buyOpen || !g.input.locked || !document.getElementById('matchend').classList.contains('hidden');
    if (blocked !== this.cache.blocked) {
      this.cache.blocked = blocked;
      this.el.classList.toggle('hidden', blocked);
      if (blocked) this.reset();
    }
    if (blocked) return;
    const alive = me.alive;
    this.set('.t-joy', 'dead', !alive, () => this.el.classList.toggle('dead', !alive));
    if (!alive && this.crouchOn) { this.crouchOn = false; this.inp.vKey('ControlLeft', false); }
    const w = g.curWeapon();
    const fire = w.type === 'grenade' ? '投掷' : w.type === 'c4' ? '安放' : w.type === 'knife' ? '挥刀' : '开火';
    this.set('.t-fire span', 'fire', fire, (el, v) => { el.textContent = v; this.q('.t-fire-l span').textContent = v; });
    const alt = w.type === 'sniper' ? (W.scope ? '关镜' : '开镜') : w.type === 'knife' ? '重击' : w.type === 'grenade' ? '轻抛' : '';
    this.set('.t-alt', 'alt', alt, (el, v) => { el.classList.toggle('off', !v); el.querySelector('span').textContent = v; });
    this.set('.t-reload', 'reload', isGun(w), (el, v) => el.classList.toggle('off', !v));
    const use = g.useContext();
    this.set('.t-use', 'use', use, (el, v) => { el.classList.toggle('off', !v); el.querySelector('span').textContent = v; });
    this.set('.t-buy', 'buy', g.canBuy(), (el, v) => el.classList.toggle('off', !v));
    const full = !!(document.fullscreenElement || document.webkitFullscreenElement) || isStandalone();
    this.set('.t-fs', 'fs', full, (el, v) => el.classList.toggle('off', v));
    this.set('.t-crouch', 'crouch', this.crouchOn, (el, v) => el.classList.toggle('lit', v));
    this.set('.t-spec', 'spec', !alive, (el, v) => el.classList.toggle('off', !v));
    const key = [me.slot, me.nade, me.inv[1] && me.inv[1].w, me.inv[2] && me.inv[2].w, me.inv[4].join(), me.inv[5], alive].join('|');
    if (key !== this.cache.weapons) {
      this.cache.weapons = key;
      this.buildWeaponBar();
    }
  }

  buildWeaponBar() {
    const me = this.g.me;
    const bar = this.q('.t-weapons');
    if (!me.alive) { bar.innerHTML = ''; return; }
    const items = [];
    const nm = (id) => (WEAPONS[id] ? WEAPONS[id].name.replace(/ .*$/, '') : id);
    if (me.inv[1]) items.push([1, nm(me.inv[1].w)]);
    if (me.inv[2]) items.push([2, nm(me.inv[2].w)]);
    items.push([3, SLOT_SHORT[3]]);
    if (me.inv[4].length) {
      const cur = me.slot === 4 && me.nade ? me.nade : me.inv[4][0];
      items.push([4, nm(cur) + (me.inv[4].length > 1 ? ` +${me.inv[4].length - 1}` : '')]);
    }
    if (me.inv[5]) items.push([5, SLOT_SHORT[5]]);
    let html = items.map(([s, n]) => `<button class="t-slot${me.slot === s ? ' cur' : ''}" data-act="slot${s}">${n}</button>`).join('');
    if (me.slot === 1 || me.slot === 2 || me.slot === 5) html += '<button class="t-slot t-drop" data-act="drop">丢弃</button>';
    bar.innerHTML = html;
  }

  // ---------------- 陀螺仪 ----------------
  enableGyro() {
    if (this.gyroOn) return;
    const start = () => { this.gyroOn = true; window.addEventListener('devicemotion', this.h.motion); };
    const DME = window.DeviceMotionEvent;
    if (DME && typeof DME.requestPermission === 'function') {
      DME.requestPermission().then((r) => { if (r === 'granted') start(); }).catch(() => {});
    } else if (DME) start();
  }
  disableGyro() {
    this.gyroOn = false;
    window.removeEventListener('devicemotion', this.h.motion);
  }
  onMotion(e) {
    const rr = e.rotationRate;
    const now = performance.now();
    const dt = this.lastMotion ? Math.min(0.1, (now - this.lastMotion) / 1000) : 0;
    this.lastMotion = now;
    if (!rr || !dt || !this.g.me.alive || !this.inp.locked) return;
    const ang = (screen.orientation && screen.orientation.angle) ?? (typeof window.orientation === 'number' ? window.orientation : 0);
    const b = rr.beta || 0, gm = rr.gamma || 0;
    let yawRate, pitchRate;
    if (ang === 90) { yawRate = b; pitchRate = -gm; }
    else if (ang === 270 || ang === -90) { yawRate = -b; pitchRate = gm; }
    else { yawRate = gm; pitchRate = b; }
    const k = DEG * dt * settings.gyroSens;
    if (Math.abs(yawRate) > 0.6) this.inp.gyroYaw += yawRate * k;
    if (Math.abs(pitchRate) > 0.6) this.inp.gyroPitch += pitchRate * k;
  }

  destroy() {
    this.disableGyro();
    this.reset();
    window.removeEventListener('resize', this.h.resize);
    this.el.remove();
  }
}
