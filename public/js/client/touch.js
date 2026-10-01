// 触屏操作：左侧浮动摇杆移动、右侧滑动转视角、开火键可拖动瞄准、功能按钮、切枪栏、陀螺仪瞄准
import { WEAPONS, isGun } from '../shared/weapons.js';
import { DEG } from '../shared/util.js';
import { settings, saveSettings } from './settings.js';
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
<button class="t-btn t-knife" data-act="knife"><span>刀</span></button>
<button class="t-btn t-nade" data-act="nade"><span>道具</span></button>
<button class="t-btn t-inspect" data-act="inspect"><span>检视</span></button>
<div class="t-radar-proxy"><span>小地图</span></div>
<div class="t-wheel"></div>
<div class="t-weapons"></div>
<button class="t-sm t-buy" data-act="buy">🛒 购买</button>
<div class="t-top">
  <button class="t-sm t-rangebtn off" data-act="rangepanel">🎯 靶场</button>
  <button class="t-sm" data-act="score">📋</button>
  <button class="t-sm" data-act="chat">💬</button>
  <button class="t-sm t-fs" data-act="fs" title="全屏">⛶</button>
  <button class="t-sm" data-act="menu">☰</button>
</div>
<div class="t-spec"><button class="t-sm" data-act="specPrev">◀ 上一个</button><button class="t-sm" data-act="specNext">下一个 ▶</button></div>
`;

// 可以自定义位置和大小的按钮
const CUSTOM = [['fire', '.t-fire', '开火'], ['firel', '.t-fire-l', '左开火'], ['jump', '.t-jump', '跳'], ['crouch', '.t-crouch', '蹲'],
  ['reload', '.t-reload', '换弹'], ['alt', '.t-alt', '开镜'], ['use', '.t-use', '拆弹/拾取'], ['buy', '.t-buy', '购买'], ['weapons', '.t-weapons', '武器栏'],
  ['knife', '.t-knife', '切刀'], ['nade', '.t-nade', '投掷物'], ['inspect', '.t-inspect', '检视'], ['radar', '.t-radar-proxy', '小地图']];
const NADE_SHORT = { he: '手雷', flash: '闪光', smoke: '烟雾', molotov: '燃烧', incgrenade: '燃烧' };

// 小地图的位置（不在游戏里时 HUD 是隐藏的，用默认尺寸估算）
function radarRect(rw) {
  const r = rw ? rw.getBoundingClientRect() : null;
  if (r && r.width) return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, size: rw.offsetWidth };
  return { cx: 6 + 56, cy: 6 + 56, size: 112 };
}

let gyroTipShown = '';
function gyroTip(text) {
  if (gyroTipShown === text) return;
  gyroTipShown = text;
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(gyroTip.t);
  gyroTip.t = setTimeout(() => el.classList.remove('show'), 5000);
}

export class TouchControls {
  constructor(game, opts = {}) {
    this.g = game;
    this.inp = game.input;
    this.preview = !!opts.preview;
    const el = (this.el = document.createElement('div'));
    el.id = 'touch-ui';
    el.innerHTML = HTML;
    document.body.appendChild(el);
    this.hadTouchClass = document.body.classList.contains('touch');
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
    if (settings.gyro && !this.preview) this.enableGyro();
  }

  applyLayout() {
    const b = Math.max(44, Math.min(86, Math.min(innerHeight, innerWidth) * 0.15)) * settings.btnScale;
    document.documentElement.style.setProperty('--tb', b.toFixed(1) + 'px');
    this.el.style.setProperty('--to', String(settings.btnOpacity));
    this.q('.t-fire-l').classList.toggle('off', !settings.leftFire);
    this.joyR = b * 0.95;
    this.applyCustom(this.editing ? this.draft : settings.touchLayout);
  }

  applyCustom(layout) {
    for (const [key, sel] of CUSTOM) {
      const els = [this.q(sel)];
      if (key === 'radar') els.push(document.getElementById('radar-wrap'));
      const c = layout && layout[key];
      for (const e of els) {
        if (!e) continue;
        if (c) {
          e.classList.add('cl');
          e.style.left = (c.x * 100).toFixed(2) + '%';
          e.style.top = (c.y * 100).toFixed(2) + '%';
          e.style.setProperty('--ts', String(c.s || 1));
        } else {
          e.classList.remove('cl');
          e.style.left = '';
          e.style.top = '';
          e.style.removeProperty('--ts');
        }
      }
    }
    this.syncRadarProxy();
  }

  // 编辑布局时，小地图上盖一个可以拖动的框
  syncRadarProxy() {
    const px = this.q('.t-radar-proxy'), rw = document.getElementById('radar-wrap');
    if (!px || !rw || !this.editing) return;
    const r = radarRect(rw);
    px.style.width = r.size + 'px';
    px.style.height = r.size + 'px';
    if (!px.classList.contains('cl')) { px.style.left = r.cx + 'px'; px.style.top = r.cy + 'px'; }
  }

  // ---------------- 自定义按钮布局 ----------------
  startEdit(onDone) {
    this.reset();
    this.editing = true;
    this.onEditDone = onDone;
    this.draft = JSON.parse(JSON.stringify(settings.touchLayout || {}));
    this.origOpacity = settings.btnOpacity;
    this.sel = null;
    this.el.classList.remove('hidden');
    this.el.classList.add('editing');
    this.syncRadarProxy();
    const bar = this.q('.t-weapons');
    this.savedBar = bar.innerHTML;
    if (!bar.children.length) bar.innerHTML = '<button class="t-slot cur">主武器</button><button class="t-slot">手枪</button><button class="t-slot">刀</button>';
    const p = (this.panel = document.createElement('div'));
    p.className = 'tl-panel';
    p.innerHTML = `<div class="tl-tip">拖动按钮换位置 · 点选按钮后可调大小</div>
      <label class="tl-row"><span id="tl-name">先点选一个按钮</span><input type="range" id="tl-size" min="0.6" max="1.8" step="0.05" value="1" disabled></label>
      <label class="tl-row"><span>按钮透明度</span><input type="range" id="tl-op" min="0.25" max="1" step="0.05" value="${settings.btnOpacity}"></label>
      <div class="tl-btns"><button data-tl="reset">恢复默认</button><button data-tl="cancel">取消</button><button data-tl="save" class="acc">保存</button></div>`;
    this.el.appendChild(p);
    p.querySelector('#tl-size').addEventListener('input', (e) => {
      if (!this.sel) return;
      const d = this.draft[this.sel] || (this.draft[this.sel] = this.centerOf(this.sel));
      d.s = +e.target.value;
      this.applyCustom(this.draft);
    });
    p.querySelector('#tl-op').addEventListener('input', (e) => {
      settings.btnOpacity = +e.target.value;
      this.el.style.setProperty('--to', String(settings.btnOpacity));
    });
    p.addEventListener('click', (e) => {
      const a = e.target.closest('[data-tl]');
      if (!a) return;
      const act = a.dataset.tl;
      if (act === 'reset') { this.draft = {}; this.applyCustom(this.draft); this.select(null); return; }
      if (act === 'save') { settings.touchLayout = this.draft; saveSettings(); }
      else settings.btnOpacity = this.origOpacity;
      this.stopEdit();
    });
  }

  stopEdit() {
    this.editing = false;
    this.el.classList.remove('editing');
    if (this.panel) { this.panel.remove(); this.panel = null; }
    this.select(null);
    this.q('.t-weapons').innerHTML = this.savedBar || '';
    this.cache = {};
    this.applyLayout();
    const f = this.onEditDone;
    this.onEditDone = null;
    if (f) f();
  }

  centerOf(key) {
    const sel = CUSTOM.find((c) => c[0] === key)[1];
    if (key === 'radar') { const rr = radarRect(document.getElementById('radar-wrap')); return { x: rr.cx / innerWidth, y: rr.cy / innerHeight, s: 1 }; }
    const r = this.q(sel).getBoundingClientRect();
    return { x: (r.left + r.width / 2) / innerWidth, y: (r.top + r.height / 2) / innerHeight, s: 1 };
  }

  select(key) {
    for (const [k, sel] of CUSTOM) this.q(sel).classList.toggle('tl-sel', k === key);
    this.sel = key;
    if (!this.panel) return;
    const size = this.panel.querySelector('#tl-size');
    size.disabled = !key;
    size.value = key && this.draft[key] ? this.draft[key].s || 1 : 1;
    this.panel.querySelector('#tl-name').textContent = key ? `大小：${CUSTOM.find((c) => c[0] === key)[2]}` : '先点选一个按钮';
  }

  editDown(e) {
    if (e.target.closest('.tl-panel')) return;
    e.preventDefault();
    const hit = CUSTOM.find(([, sel]) => e.target.closest(sel));
    if (!hit) { this.select(null); return; }
    this.select(hit[0]);
    const c = this.draft[hit[0]] || this.centerOf(hit[0]);
    this.drag = { id: e.pointerId, key: hit[0], sx: e.clientX, sy: e.clientY, x: c.x, y: c.y, s: c.s || 1 };
    try { this.el.setPointerCapture(e.pointerId); } catch {}
  }

  editMove(e) {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    e.preventDefault();
    const x = Math.max(0.03, Math.min(0.97, d.x + (e.clientX - d.sx) / innerWidth));
    const y = Math.max(0.05, Math.min(0.95, d.y + (e.clientY - d.sy) / innerHeight));
    this.draft[d.key] = { x, y, s: d.s };
    this.applyCustom(this.draft);
  }

  editUp(e) {
    if (this.drag && this.drag.id === e.pointerId) this.drag = null;
  }

  onDown(e) {
    if (this.editing) return this.editDown(e);
    e.preventDefault();
    audio.init();
    const btn = e.target.closest('[data-act]');
    if (this.wheelOpen && !(btn && (btn.dataset.act.startsWith('pick:') || btn.dataset.act === 'nade'))) this.closeWheel();
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
    if (this.editing) return this.editMove(e);
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
    } else if (p.kind === 'btn' && p.act === 'nade' && this.wheelOpen) {
      this.wheelMove(e.clientX, e.clientY);
    } else if (p.kind === 'look' || (p.kind === 'btn' && p.act === 'fire')) {
      this.inp.tdx += dx;
      this.inp.tdy += dy;
    }
  }

  onUp(e) {
    if (this.editing) return this.editUp(e);
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
      case 'fire': {
        // 拿着投掷物、选了“近抛”时，开火键用右键的轻抛
        if (down) { const w = g.curWeapon(); this.fireBtn = w.type === 'grenade' && this.throwShort ? 2 : 0; }
        inp.vMouse(this.fireBtn || 0, down);
        break;
      }
      case 'alt': {
        const w = g.curWeapon();
        if (w.type === 'grenade') { if (down) this.throwShort = !this.throwShort; break; }
        this.scopePress(down, w);
        break;
      }
      case 'inspect': inp.vKey('KeyF', down); break;
      case 'knife': if (down) this.knifeToggle(); break;
      case 'nade':
        // 短按：依次切换；长按：中间弹出轮盘，往哪边滑就选哪个
        if (down) { clearTimeout(this.wheelTimer); this.wheelTimer = setTimeout(() => this.openWheel(), 330); }
        else {
          clearTimeout(this.wheelTimer);
          if (this.wheelOpen) { if (this.wheelSel) { this.pickNade(this.wheelSel); this.closeWheel(); } }
          else this.nadeCycle();
        }
        break;
      case 'rangepanel': if (down) g.openRangePanel(); break;
      case 'jump': inp.vKey('Space', down); break;
      case 'reload': inp.vKey('KeyR', down); break;
      case 'use': inp.vKey('KeyE', down); break;
      case 'drop': inp.vKey('KeyG', down); break;
      case 'crouch': this.crouchPress(down); break;
      case 'buy': if (down) g.openBuy(); break;
      case 'score': if (down) { if (g.hud.sbOpen) g.hud.closeScoreboard(); else g.hud.openScoreboard(); } break;
      case 'chat': if (down) g.openChat(false); break;
      case 'menu': if (down) g.openPauseMenu(); break;
      case 'fs': if (down) g.toggleFullscreen(); break;
      case 'specPrev': if (down) g.cycleSpec(-1); break;
      case 'specNext': if (down) g.cycleSpec(1); break;
      default:
        if (down && act.startsWith('pick:')) { this.pickNade(act.slice(5)); this.closeWheel(); }
        else if (down && act.startsWith('slot')) g.switchSlot(+act.slice(4));
    }
  }

  // 蹲：点按切换 / 按住蹲 / 混合（点一下切换，按住超过 0.35 秒就是按住蹲）
  crouchPress(down) {
    const mode = settings.crouchMode || 'toggle';
    const set = (on) => { this.crouchOn = on; this.inp.vKey('ControlLeft', on); };
    if (mode === 'hold') { set(down); return; }
    if (mode === 'toggle') { if (down) set(!this.crouchOn); return; }
    if (down) {
      this.crouchT = performance.now();
      this.standOnUp = this.crouchOn;
      if (!this.crouchOn) set(true);
    } else if (this.standOnUp || performance.now() - this.crouchT > 350) set(false);
  }

  // 开镜：点按切换 / 按住开镜 / 混合
  scopePress(down, w) {
    const mode = settings.scopeMode || 'toggle', g = this.g, inp = this.inp;
    if (mode === 'toggle' || !w.scope) { inp.vMouse(2, down); return; }
    if (down) {
      this.altT = performance.now();
      this.unscopeOnUp = mode === 'mixed' && g.w.scope > 0;
      if (!g.w.scope) { inp.vMouse(2, true); inp.vMouse(2, false); }
    } else if (mode === 'hold' || this.unscopeOnUp || performance.now() - this.altT > 350) g.unscope();
  }

  // 切刀：按一下拿刀，再按一下切回原来的武器
  knifeToggle() {
    const g = this.g, me = g.me;
    if (!me.alive) return;
    if (me.slot === 3) g.switchSlot(g.slotValid(this.knifeBack) && this.knifeBack !== 3 ? this.knifeBack : g.bestSlot());
    else { this.knifeBack = me.slot; g.switchSlot(3); }
  }

  openWheel() {
    const me = this.g.me;
    const types = [...new Set(me.inv[4] || [])];
    if (!me.alive || !types.length) return;
    const ICON = { he: '💥', flash: '⚡', smoke: '☁', molotov: '🔥', incgrenade: '🔥' };
    const R = Math.min(110, Math.min(innerWidth, innerHeight) * 0.24);
    const wheel = this.q('.t-wheel');
    wheel.innerHTML = '<div class="t-wheel-bg"></div>' + types.map((t, i) => {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / types.length;
      const n = me.inv[4].filter((x) => x === t).length;
      return `<button class="t-wheel-item${me.slot === 4 && me.nade === t ? ' cur' : ''}" data-act="pick:${t}" data-a="${a}" style="left:${(Math.cos(a) * R).toFixed(1)}px;top:${(Math.sin(a) * R).toFixed(1)}px">${ICON[t] || '●'}<span>${NADE_SHORT[t] || t}${n > 1 ? ' ×' + n : ''}</span></button>`;
    }).join('');
    wheel.classList.add('on');
    this.wheelOpen = true;
    this.wheelSel = null;
    const p = [...this.ptrs.values()].find((q) => q.act === 'nade');
    this.wheelOrigin = p ? { x: p.x, y: p.y } : null;
  }

  wheelMove(x, y) {
    if (!this.wheelOpen || !this.wheelOrigin) return;
    const dx = x - this.wheelOrigin.x, dy = y - this.wheelOrigin.y;
    let best = null;
    if (Math.hypot(dx, dy) > 24) {
      const ang = Math.atan2(dy, dx);
      let bd = Infinity;
      for (const el of this.q('.t-wheel').querySelectorAll('.t-wheel-item')) {
        const d = Math.abs(Math.atan2(Math.sin(ang - +el.dataset.a), Math.cos(ang - +el.dataset.a)));
        if (d < bd) { bd = d; best = el; }
      }
    }
    for (const el of this.q('.t-wheel').querySelectorAll('.t-wheel-item')) el.classList.toggle('sel', el === best);
    this.wheelSel = best ? best.dataset.act.slice(5) : null;
  }

  closeWheel() {
    this.wheelOpen = false;
    this.wheelSel = null;
    this.q('.t-wheel').classList.remove('on');
  }

  pickNade(type) {
    const g = this.g;
    if (!g.me.alive || !(g.me.inv[4] || []).includes(type)) return;
    g.me.nade = type;
    g.switchSlot(4, true);
  }

  // 投掷物：按一下切到投掷物，已经拿着时再按切换下一种
  nadeCycle() {
    const g = this.g;
    if (!g.me.alive) return;
    if (!g.me.inv[4].length) { g.hud.center('没有投掷物', 1.2); return; }
    g.switchSlot(4);
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
    if (this.editing) return;
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
    const alt = w.type === 'sniper' ? (W.scope ? '关镜' : '开镜') : w.type === 'knife' ? '重击' : w.type === 'grenade' ? (this.throwShort ? '近抛' : '远抛') : '';
    this.set('.t-alt', 'alt', alt, (el, v) => { el.classList.toggle('off', !v); el.querySelector('span').textContent = v; });
    this.set('.t-reload', 'reload', isGun(w), (el, v) => el.classList.toggle('off', !v));
    this.set('.t-alt', 'altLit', w.type === 'grenade' && !!this.throwShort, (el, v) => el.classList.toggle('lit', v));
    this.set('.t-knife span', 'knife', me.slot === 3 ? '切回' : '刀', (el, v) => { el.textContent = v; });
    const nades = me.inv[4] || [];
    const nadeLabel = me.slot === 4 && me.nade ? NADE_SHORT[me.nade] || '道具' : '道具';
    this.set('.t-nade', 'nadeOff', !nades.length, (el, v) => el.classList.toggle('off', v));
    this.set('.t-nade span', 'nade', nadeLabel, (el, v) => { el.textContent = v; });
    this.set('.t-rangebtn', 'range', g.mode === 'range', (el, v) => el.classList.toggle('off', !v));
    if (this.wheelOpen && !alive) this.closeWheel();
    this.set('.t-nade', 'nadeLit', me.slot === 4, (el, v) => el.classList.toggle('lit', v));
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
    const DME = window.DeviceMotionEvent;
    if (!window.isSecureContext) {
      gyroTip('陀螺仪需要用 https 地址打开：在电脑上点主菜单「手机扫码」重新扫码进入');
      return;
    }
    if (!DME) { gyroTip('这个浏览器不支持陀螺仪'); return; }
    const start = () => {
      if (this.gyroOn) return;
      this.gyroOn = true;
      this.motionSeen = false;
      window.addEventListener('devicemotion', this.h.motion);
      setTimeout(() => { if (this.gyroOn && !this.motionSeen) gyroTip('没有收到陀螺仪数据：这台手机或浏览器可能不支持'); }, 2500);
    };
    if (typeof DME.requestPermission === 'function') {
      // iPhone：必须在点击屏幕时申请权限
      const ask = () => {
        DME.requestPermission().then((r) => {
          if (r === 'granted') start();
          else gyroTip('没有获得陀螺仪权限：可在 Safari 设置里允许“运动与方向访问”');
        }).catch(() => {
          if (!this.gyroAskBound) {
            this.gyroAskBound = true;
            const once = () => { this.gyroAskBound = false; this.el.removeEventListener('touchend', once); if (settings.gyro && !this.gyroOn) ask(); };
            this.el.addEventListener('touchend', once);
          }
        });
      };
      ask();
    } else start();
  }
  disableGyro() {
    this.gyroOn = false;
    window.removeEventListener('devicemotion', this.h.motion);
  }
  onMotion(e) {
    this.motionSeen = true;
    const rr = e.rotationRate;
    const now = performance.now();
    const dt = this.lastMotion ? Math.min(0.1, (now - this.lastMotion) / 1000) : 0;
    this.lastMotion = now;
    if (!rr || !dt || !this.g.me.alive || !this.inp.locked) return;
    if (settings.gyroScope && !(this.g.w && this.g.w.scope > 0)) return;
    const ang = (screen.orientation && screen.orientation.angle) ?? (typeof window.orientation === 'number' ? window.orientation : 0);
    const b = rr.beta || 0, gm = rr.gamma || 0;
    let yawRate, pitchRate;
    if (ang === 90) { yawRate = b; pitchRate = -gm; }
    else if (ang === 270 || ang === -90) { yawRate = -b; pitchRate = gm; }
    else { yawRate = gm; pitchRate = b; }
    if (settings.gyroInvX) yawRate = -yawRate;
    if (settings.gyroInvY) pitchRate = -pitchRate;
    const k = DEG * dt * settings.gyroSens;
    if (Math.abs(yawRate) > 0.6) this.inp.gyroYaw += yawRate * k;
    if (Math.abs(pitchRate) > 0.6) this.inp.gyroPitch += pitchRate * k;
  }

  destroy() {
    this.disableGyro();
    this.reset();
    window.removeEventListener('resize', this.h.resize);
    this.el.remove();
    if (this.preview && !this.hadTouchClass) document.body.classList.remove('touch');
  }
}
