// 键鼠输入（指针锁定 + 原始鼠标输入）
import { BIND_ACTIONS } from './settings.js';
export class Input {
  constructor(canvas, touch = false) {
    this.canvas = canvas;
    this.touch = !!touch;
    this.moveX = 0;
    this.moveY = 0;
    this.tdx = 0;
    this.tdy = 0;
    this.gyroYaw = 0;
    this.gyroPitch = 0;
    this.keys = new Set();
    this.phys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouse = [false, false, false];
    this.mDown = [false, false, false];
    this.mUp = [false, false, false];
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.locked = false;
    this.typing = false;
    this.active = false;
    this.onLockChange = null;
    this.onKey = null;
    this._h = {
      kd: (e) => this._kd(e), ku: (e) => this._ku(e), md: (e) => this._md(e), mu: (e) => this._mu(e),
      mm: (e) => this._mm(e), wh: (e) => this._wh(e), plc: () => this._plc(), blur: () => this._blur(),
      ctx: (e) => { if (this.active) e.preventDefault(); },
    };
  }

  attach() {
    const h = this._h;
    window.addEventListener('keydown', h.kd, true);
    window.addEventListener('keyup', h.ku, true);
    window.addEventListener('mousedown', h.md);
    window.addEventListener('mouseup', h.mu);
    window.addEventListener('mousemove', h.mm);
    window.addEventListener('wheel', h.wh, { passive: false });
    window.addEventListener('blur', h.blur);
    window.addEventListener('contextmenu', h.ctx);
    document.addEventListener('pointerlockchange', h.plc);
    this.active = true;
  }

  detach() {
    const h = this._h;
    window.removeEventListener('keydown', h.kd, true);
    window.removeEventListener('keyup', h.ku, true);
    window.removeEventListener('mousedown', h.md);
    window.removeEventListener('mouseup', h.mu);
    window.removeEventListener('mousemove', h.mm);
    window.removeEventListener('wheel', h.wh);
    window.removeEventListener('blur', h.blur);
    window.removeEventListener('contextmenu', h.ctx);
    document.removeEventListener('pointerlockchange', h.plc);
    this.active = false;
    this.unlock();
  }

  // 键位映射：玩家按的键 -> 游戏逻辑认的键（每个动作的第一个默认键）。被改走的默认键失效
  setBinds(binds) {
    const map = new Map(), reserved = new Set();
    for (const [act, , def] of BIND_ACTIONS) {
      for (const k of def) if (!k.startsWith('Digit')) reserved.add(k);
      for (const k of (binds && binds[act]) || def) if (k) map.set(k, def[0]);
    }
    this.keymap = map;
    this.reservedKeys = reserved;
  }

  mapKey(c) {
    if (!this.keymap) return c;
    const m = this.keymap.get(c);
    if (m) return m;
    return this.reservedKeys.has(c) ? null : c;
  }

  _kd(e) {
    if (!this.active || this.typing) return;
    const raw = e.code;
    const c = this.mapKey(raw);
    if (raw === 'Tab' || c === 'Tab' || ((this.locked || document.fullscreenElement) && (c === 'Space' || raw.startsWith('Arrow') || e.ctrlKey || raw === 'F2' || raw === 'Quote' || raw === 'Slash' || (c && c !== raw)))) e.preventDefault();
    if (!c) return;
    this.phys.add(raw);
    if (!this.keys.has(c)) this.pressed.add(c);
    this.keys.add(c);
    if (this.onKey) this.onKey(c, true, e);
  }

  _ku(e) {
    const raw = e.code;
    this.phys.delete(raw);
    const c = this.mapKey(raw);
    if (!c) return;
    // 同一个动作绑了两个键：另一个还按着就不算松开
    for (const k of this.phys) if (this.mapKey(k) === c) return;
    this.keys.delete(c);
    this.released.add(c);
    if (this.active && this.onKey && !this.typing) this.onKey(c, false, e);
  }

  _md(e) {
    if (this.touch || !this.active || !this.locked) return;
    if (e.button > 2) return;
    this.mouse[e.button] = true;
    this.mDown[e.button] = true;
    e.preventDefault();
  }

  _mu(e) {
    if (this.touch || e.button > 2) return;
    if (this.mouse[e.button]) this.mUp[e.button] = true;
    this.mouse[e.button] = false;
  }

  _mm(e) {
    if (this.touch || !this.locked) return;
    if (Math.abs(e.movementX) > 800 || Math.abs(e.movementY) > 800) return;
    this.dx += e.movementX;
    this.dy += e.movementY;
  }

  _wh(e) {
    if (this.touch || !this.locked) return;
    this.wheel += Math.sign(e.deltaY);
    e.preventDefault();
  }

  _plc() {
    this.locked = document.pointerLockElement === this.canvas;
    if (!this.locked) {
      for (let i = 0; i < 3; i++) { if (this.mouse[i]) this.mUp[i] = true; this.mouse[i] = false; }
    }
    if (this.onLockChange) this.onLockChange(this.locked);
  }

  _blur() {
    for (const k of this.keys) this.released.add(k);
    this.keys.clear();
    for (let i = 0; i < 3; i++) { if (this.mouse[i]) this.mUp[i] = true; this.mouse[i] = false; }
  }

  lock() {
    if (this.touch) {
      if (!this.locked) { this.locked = true; if (this.onLockChange) this.onLockChange(true); }
      return;
    }
    if (this.locked) return;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { const q = this.canvas.requestPointerLock(); if (q && q.catch) q.catch(() => {}); } catch {} });
    } catch {
      try { this.canvas.requestPointerLock(); } catch {}
    }
  }

  unlock() {
    if (this.touch) {
      if (this.locked) { this.locked = false; this.releaseAll(); if (this.onLockChange) this.onLockChange(false); }
      return;
    }
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // 触屏虚拟按键 / 鼠标键
  vKey(code, down) {
    if (down) {
      if (!this.keys.has(code)) this.pressed.add(code);
      this.keys.add(code);
    } else {
      if (this.keys.has(code)) this.released.add(code);
      this.keys.delete(code);
    }
  }
  vMouse(b, down) {
    if (down) {
      if (!this.mouse[b]) this.mDown[b] = true;
      this.mouse[b] = true;
    } else {
      if (this.mouse[b]) this.mUp[b] = true;
      this.mouse[b] = false;
    }
  }
  releaseAll() {
    for (const k of this.keys) this.released.add(k);
    this.keys.clear();
    this.phys.clear();
    for (let i = 0; i < 3; i++) { if (this.mouse[i]) this.mUp[i] = true; this.mouse[i] = false; }
    this.moveX = 0;
    this.moveY = 0;
  }

  down(c) { return this.keys.has(c); }
  hit(c) { return this.pressed.has(c); }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mDown.fill(false);
    this.mUp.fill(false);
    this.dx = 0;
    this.dy = 0;
    this.tdx = 0;
    this.tdy = 0;
    this.gyroYaw = 0;
    this.gyroPitch = 0;
    this.wheel = 0;
  }
}
