// 程序合成音效（WebAudio），带距离衰减与左右声道定位；语音播报用浏览器 TTS
import { WEAPONS } from '../shared/weapons.js';
import { settings } from './settings.js';
import { GUN_PROFILES, gunProfileKey, synthGun, synthStep } from './gunsynth.js';

const STEP_RANGE = 32; // 脚步声最远能听到的距离（米），和 CS 差不多

class AudioSys {
  constructor() {
    this.ctx = null;
    this.lx = 0; this.ly = 0; this.lz = 0; this.lyaw = 0;
    this.lastVoice = 0;
    this.gunBufs = {};
    this.stepBufs = {};
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = settings.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp);
    comp.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // 混响：越往后越闷的噪声尾巴（高频衰减得快，听起来不刺耳）
    this.reverb = ctx.createConvolver();
    const rl = Math.floor(ctx.sampleRate * 1.2);
    const ir = ctx.createBuffer(2, rl, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const c = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < rl; i++) {
        const t = i / ctx.sampleRate;
        const k = 0.3 + 0.65 * Math.min(1, t / 0.7);
        lp += (1 - k) * (Math.random() * 2 - 1 - lp);
        c[i] = lp * Math.exp(-t / 0.2) * (t < 0.006 ? t / 0.006 : 1);
      }
    }
    this.reverb.buffer = ir;
    this.revGain = ctx.createGain();
    this.revGain.gain.value = 0.22;
    this.reverb.connect(this.revGain);
    this.revGain.connect(this.master);
    this.warmGuns();
  }

  // 枪声缓冲区：每种枪 2 份略有不同的波形，用到时才合成（并在空闲时提前合成好）
  _gunBuf(key) {
    let arr = this.gunBufs[key];
    if (!arr) arr = this.gunBufs[key] = [];
    if (arr.length < 2 && (arr.length === 0 || Math.random() < 0.5)) arr.push(this._renderGun(key, arr.length));
    return arr[(Math.random() * arr.length) | 0];
  }

  _renderGun(key, v) {
    const sr = this.ctx.sampleRate;
    const data = synthGun(GUN_PROFILES[key], sr, 11 + v * 101 + key.length * 7);
    const buf = this.ctx.createBuffer(1, data.length, sr);
    buf.getChannelData(0).set(data);
    return buf;
  }

  _stepBuf(surface) {
    const arr = this.stepBufs[surface] || (this.stepBufs[surface] = []);
    if (arr.length < 6) {
      const sr = this.ctx.sampleRate;
      const data = synthStep(surface, sr, 3 + arr.length * 31 + surface.length);
      const buf = this.ctx.createBuffer(1, data.length, sr);
      buf.getChannelData(0).set(data);
      arr.push(buf);
      return buf;
    }
    return arr[(Math.random() * arr.length) | 0];
  }

  warmGuns() {
    for (const s of ['hard', 'sand', 'metal']) for (let i = 0; i < 6; i++) this._stepBuf(s);
    const keys = Object.keys(GUN_PROFILES);
    let k = 0;
    const step = () => {
      if (!this.ctx || k >= keys.length * 2) return;
      const key = keys[k % keys.length], arr = this.gunBufs[key] || (this.gunBufs[key] = []);
      if (arr.length < 2) arr.push(this._renderGun(key, arr.length));
      k++;
      setTimeout(step, 30);
    };
    setTimeout(step, 200);
  }

  setVolume(v) { if (this.master) this.master.gain.value = v; }

  setListener(x, y, z, yaw) { this.lx = x; this.ly = y; this.lz = z; this.lyaw = yaw; }

  // 创建输出节点（位置 pos 为 null 表示本人发出的声音）
  _out(pos, ref, vol, rev = 0.3) {
    const ctx = this.ctx;
    let gain = vol, pan = 0, far = 0;
    if (pos) {
      const dx = pos[0] - this.lx, dy = pos[1] - this.ly, dz = pos[2] - this.lz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      gain = vol / (1 + (d / ref) * (d / ref));
      far = Math.min(1, d / 60);
      const rx = dx * Math.cos(this.lyaw) - dz * Math.sin(this.lyaw);
      pan = Math.max(-1, Math.min(1, rx / (Math.abs(rx) + Math.abs(dx * Math.sin(this.lyaw) + dz * Math.cos(this.lyaw)) + 1e-3))) * 0.85;
    }
    if (pos && gain < 0.004) return null;
    const g = ctx.createGain();
    g.gain.value = gain;
    let node = g;
    if (ctx.createStereoPanner && pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      node = p;
    }
    node.connect(this.master);
    if (rev > 0) {
      const s = ctx.createGain();
      s.gain.value = rev * (0.5 + far);
      g.connect(s);
      s.connect(this.reverb);
    }
    return { input: g, far };
  }

  _noise(out, t, { type = 'lowpass', f = 2000, q = 0.7, dec = 0.15, vol = 1, rate = 1, att = 0.002, f2 = null }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = rate;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.setValueAtTime(f, t);
    if (f2) flt.frequency.exponentialRampToValueAtTime(f2, t + dec);
    flt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + att);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
    src.connect(flt);
    flt.connect(g);
    g.connect(out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dec + 0.05);
  }

  _tone(out, t, { f = 440, f2 = null, dec = 0.1, vol = 0.5, type = 'sine', att = 0.003 }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dec);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + att);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + dec + 0.05);
  }

  shot(wid, pos) {
    if (!this.ctx) return;
    const w = WEAPONS[wid];
    if (!w) return;
    const key = gunProfileKey(w);
    const P = GUN_PROFILES[key];
    const o = this._out(pos, P.ref, P.gain * settings.gunVol, pos ? 0.3 : 0.12);
    if (!o) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._gunBuf(key);
    src.playbackRate.value = 0.95 + Math.random() * 0.1;
    let node = src;
    if (o.far > 0.03) {
      // 越远越闷
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 700 + 9000 * (1 - o.far) * (1 - o.far);
      src.connect(lp);
      node = lp;
    }
    node.connect(o.input);
    src.start();
  }

  // 脚步声；返回 {d} 表示听得到（用于声纹），听不到返回 null
  step(pos, vol = 0.5, surface = 'hard') {
    if (!this.ctx) return null;
    let d = 0;
    if (pos) {
      d = Math.hypot(pos[0] - this.lx, pos[1] - this.ly, pos[2] - this.lz);
      if (d > STEP_RANGE) return null;
      if (d > STEP_RANGE - 8) vol *= (STEP_RANGE - d) / 8;
    }
    const o = this._out(pos, 8, vol * settings.stepVol, 0.03);
    if (!o) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = this._stepBuf(surface);
    src.playbackRate.value = 0.92 + Math.random() * 0.16;
    let node = src;
    if (o.far > 0.05) {
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900 + 7000 * (1 - o.far) * (1 - o.far);
      src.connect(lp);
      node = lp;
    }
    node.connect(o.input);
    src.start();
    return { d };
  }

  // 通用音效
  play(name, pos = null, vol = 1, opts = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    let o;
    switch (name) {
      case 'hit':
        o = this._out(null, 1, 0.35 * vol, 0);
        this._tone(o.input, t, { f: 1500, f2: 900, dec: 0.05, vol: 0.6, type: 'triangle' });
        break;
      case 'headshot':
        o = this._out(null, 1, 0.5 * vol, 0.1);
        this._tone(o.input, t, { f: 3100, dec: 0.35, vol: 0.5 });
        this._tone(o.input, t, { f: 4650, dec: 0.25, vol: 0.3 });
        this._noise(o.input, t, { type: 'highpass', f: 3000, dec: 0.05, vol: 0.5 });
        break;
      case 'headshot_nohelm':
        o = this._out(null, 1, 0.55 * vol, 0);
        this._noise(o.input, t, { f: 900, dec: 0.12, vol: 1 });
        this._tone(o.input, t, { f: 120, f2: 60, dec: 0.1, vol: 0.8 });
        break;
      case 'killconfirm': {
        // 击杀确认：一记闷响 + 上扬的提示音，连杀越多音越高；爆头多一声金属“叮”
        const n = Math.max(1, Math.min(6, opts.streak || 1));
        o = this._out(null, 1, 0.55 * vol, 0.15);
        const base = 620 * Math.pow(1.122, n - 1);
        this._tone(o.input, t, { f: 150, f2: 50, dec: 0.18, vol: 0.9 });
        this._noise(o.input, t, { type: 'bandpass', f: 1600, q: 1.2, dec: 0.06, vol: 0.45 });
        this._tone(o.input, t + 0.02, { f: base, dec: 0.2, vol: 0.45, type: 'triangle' });
        this._tone(o.input, t + 0.09, { f: base * 1.5, dec: 0.3, vol: 0.45, type: 'triangle' });
        if (n >= 2) this._tone(o.input, t + 0.16, { f: base * 2, dec: 0.38, vol: 0.4, type: 'triangle' });
        if (n >= 4) this._tone(o.input, t + 0.23, { f: base * 2.5, dec: 0.45, vol: 0.36, type: 'triangle' });
        if (opts.hs) {
          this._tone(o.input, t, { f: 3100, dec: 0.5, vol: 0.32 });
          this._tone(o.input, t, { f: 4650, dec: 0.32, vol: 0.2 });
          this._noise(o.input, t, { type: 'highpass', f: 3000, dec: 0.05, vol: 0.45 });
        }
        break;
      }
      case 'kill':
        o = this._out(null, 1, 0.25 * vol, 0);
        this._tone(o.input, t, { f: 880, dec: 0.09, vol: 0.5, type: 'triangle' });
        this._tone(o.input, t + 0.07, { f: 1320, dec: 0.12, vol: 0.5, type: 'triangle' });
        break;
      case 'hurt':
        o = this._out(null, 1, 0.6 * vol, 0);
        this._tone(o.input, t, { f: 180, f2: 70, dec: 0.15, vol: 0.9 });
        this._noise(o.input, t, { f: 700, dec: 0.1, vol: 0.5 });
        break;
      case 'empty':
        o = this._out(pos, 3, 0.4 * vol, 0);
        if (o) this._tone(o.input, t, { f: 2200, dec: 0.03, vol: 0.5, type: 'square' });
        break;
      case 'deploy':
        o = this._out(null, 1, 0.2 * vol, 0);
        this._noise(o.input, t, { type: 'bandpass', f: 2600, q: 2, dec: 0.05, vol: 0.8 });
        this._noise(o.input, t + 0.12, { type: 'bandpass', f: 1800, q: 2, dec: 0.05, vol: 0.6 });
        break;
      case 'knife':
        o = this._out(pos, 4, 0.5 * vol, 0.05);
        if (o) this._noise(o.input, t, { type: 'bandpass', f: 700, f2: 3200, q: 1.5, dec: 0.22, vol: 0.9, att: 0.05 });
        break;
      case 'knifehit':
        o = this._out(pos, 4, 0.6 * vol, 0.05);
        if (o) { this._tone(o.input, t, { f: 200, f2: 80, dec: 0.1, vol: 0.9 }); this._noise(o.input, t, { f: 1200, dec: 0.08, vol: 0.6 }); }
        break;
      case 'bounce':
        o = this._out(pos, 6, 0.35 * vol, 0.1);
        if (o) { this._tone(o.input, t, { f: 1900 + Math.random() * 600, dec: 0.08, vol: 0.4 }); this._noise(o.input, t, { type: 'highpass', f: 2000, dec: 0.03, vol: 0.4 }); }
        break;
      case 'pin':
        o = this._out(null, 1, 0.3 * vol, 0);
        this._tone(o.input, t, { f: 2600, dec: 0.05, vol: 0.5, type: 'square' });
        this._tone(o.input, t + 0.09, { f: 3100, dec: 0.08, vol: 0.4 });
        break;
      case 'throw':
        o = this._out(pos, 4, 0.35 * vol, 0);
        if (o) this._noise(o.input, t, { type: 'bandpass', f: 500, f2: 1500, q: 1, dec: 0.2, vol: 0.8, att: 0.04 });
        break;
      case 'explode': {
        o = this._out(pos, 26, 1.3 * vol, 0.7);
        if (!o) break;
        this._noise(o.input, t, { f: 2200 * (1 - o.far * 0.5), f2: 160, dec: 1.4, vol: 1 });
        this._tone(o.input, t, { f: 70, f2: 28, dec: 0.9, vol: 1.2 });
        this._noise(o.input, t, { type: 'highpass', f: 1500, dec: 0.08, vol: 0.6 });
        break;
      }
      case 'flashbang':
        o = this._out(pos, 20, 1.0 * vol, 0.5);
        if (o) { this._noise(o.input, t, { type: 'highpass', f: 1200, dec: 0.35, vol: 1 }); this._tone(o.input, t, { f: 90, f2: 40, dec: 0.3, vol: 0.7 }); }
        break;
      case 'ring':
        o = this._out(null, 1, 0.22 * vol, 0);
        this._tone(o.input, t, { f: 3400, dec: Math.max(0.5, vol * 3), vol: 0.35, att: 0.05 });
        break;
      case 'smoke':
        o = this._out(pos, 10, 0.5 * vol, 0.2);
        if (o) this._noise(o.input, t, { type: 'highpass', f: 1800, f2: 900, dec: 1.8, vol: 0.7, att: 0.05 });
        break;
      case 'fire':
        o = this._out(pos, 10, 0.7 * vol, 0.2);
        if (o) { this._noise(o.input, t, { f: 900, f2: 300, dec: 0.9, vol: 1, att: 0.02 }); this._noise(o.input, t + 0.05, { type: 'highpass', f: 2500, dec: 0.4, vol: 0.4 }); }
        break;
      case 'crackle':
        o = this._out(pos, 7, 0.35 * vol, 0.05);
        if (o) this._noise(o.input, t, { type: 'bandpass', f: 1200 + Math.random() * 2000, q: 2, dec: 0.05, vol: 0.8 });
        break;
      case 'beep':
        o = this._out(pos, 14, 0.55 * vol, 0.1);
        if (o) this._tone(o.input, t, { f: 1180, dec: 0.13, vol: 0.6, type: 'square' });
        break;
      case 'plant':
        o = this._out(pos, 8, 0.5 * vol, 0.05);
        if (o) for (let i = 0; i < 4; i++) this._tone(o.input, t + i * 0.1, { f: 1400 + i * 120, dec: 0.06, vol: 0.4, type: 'square' });
        break;
      case 'defuse':
        o = this._out(pos, 8, 0.45 * vol, 0.05);
        if (o) { this._noise(o.input, t, { type: 'bandpass', f: 3000, q: 3, dec: 0.06, vol: 0.8 }); this._noise(o.input, t + 0.15, { type: 'bandpass', f: 2400, q: 3, dec: 0.06, vol: 0.8 }); }
        break;
      case 'pickup':
        o = this._out(null, 1, 0.3 * vol, 0);
        this._noise(o.input, t, { type: 'bandpass', f: 1500, q: 2, dec: 0.08, vol: 0.9 });
        this._tone(o.input, t + 0.05, { f: 600, dec: 0.06, vol: 0.3, type: 'triangle' });
        break;
      case 'buy':
        o = this._out(null, 1, 0.3 * vol, 0);
        this._tone(o.input, t, { f: 1318, dec: 0.08, vol: 0.4, type: 'triangle' });
        this._tone(o.input, t + 0.06, { f: 1760, dec: 0.12, vol: 0.4, type: 'triangle' });
        break;
      case 'click':
        o = this._out(null, 1, 0.2 * vol, 0);
        this._tone(o.input, t, { f: 900, dec: 0.03, vol: 0.4, type: 'triangle' });
        break;
      case 'scope':
        o = this._out(null, 1, 0.25 * vol, 0);
        this._noise(o.input, t, { type: 'bandpass', f: 4000, q: 4, dec: 0.04, vol: 0.9 });
        break;
      case 'win':
      case 'lose': {
        o = this._out(null, 1, 0.22 * vol, 0.4);
        const notes = name === 'win' ? [523, 659, 784, 1047] : [440, 415, 370, 330];
        notes.forEach((f, i) => this._tone(o.input, t + i * 0.13, { f, dec: 0.5, vol: 0.45, type: 'triangle' }));
        break;
      }
      case 'roundstart':
        o = this._out(null, 1, 0.2 * vol, 0.3);
        this._tone(o.input, t, { f: 660, dec: 0.15, vol: 0.4, type: 'triangle' });
        this._tone(o.input, t + 0.15, { f: 990, dec: 0.3, vol: 0.4, type: 'triangle' });
        break;
      case 'land':
        o = this._out(pos, 5, 0.4 * vol, 0);
        if (o) { this._tone(o.input, t, { f: 110, f2: 50, dec: 0.1, vol: 0.9 }); this._noise(o.input, t, { f: 600, dec: 0.08, vol: 0.5 }); }
        break;
      case 'bodyfall':
        o = this._out(pos, 6, 0.5 * vol, 0.05);
        if (o) { this._tone(o.input, t, { f: 90, f2: 45, dec: 0.2, vol: 0.9 }); this._noise(o.input, t, { f: 500, dec: 0.15, vol: 0.5 }); }
        break;
    }
  }

  // 换弹声：几次咔哒声按时间排好
  reload(wid) {
    if (!this.ctx) return;
    const w = WEAPONS[wid];
    if (!w || !w.reload) return;
    const o = this._out(null, 1, 0.3, 0);
    const t = this.ctx.currentTime;
    const r = w.reload;
    const click = (at, f) => this._noise(o.input, t + at, { type: 'bandpass', f, q: 3, dec: 0.05, vol: 0.9 });
    click(r * 0.18, 1800);
    click(r * 0.55, 2400);
    click(r * 0.82, 1500);
    if (w.type === 'rifle' || w.type === 'smg') click(r * 0.9, 2800);
  }

  // 其他人换弹（定位）
  reloadAt(pos) {
    if (!this.ctx) return;
    const o = this._out(pos, 4, 0.3, 0);
    if (!o) return;
    const t = this.ctx.currentTime;
    this._noise(o.input, t + 0.3, { type: 'bandpass', f: 1900, q: 3, dec: 0.05, vol: 0.8 });
    this._noise(o.input, t + 1.2, { type: 'bandpass', f: 2400, q: 3, dec: 0.05, vol: 0.8 });
  }

  speak(text) {
    if (!settings.voice || !window.speechSynthesis) return;
    try {
      const now = performance.now();
      if (now - this.lastVoice < 600) window.speechSynthesis.cancel();
      this.lastVoice = now;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN';
      u.rate = 1.15;
      u.volume = Math.min(1, settings.volume * 1.2);
      window.speechSynthesis.speak(u);
    } catch {}
  }
}

export const audio = new AudioSys();
