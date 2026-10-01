// 程序合成音效（WebAudio），带距离衰减与左右声道定位；语音播报用浏览器 TTS
import { WEAPONS } from '../shared/weapons.js';
import { settings } from './settings.js';

const GUN = {
  pistol: { lp: 3600, dec: 0.13, thump: 170, tv: 0.55, vol: 0.75, crack: 0.35 },
  deagle: { lp: 2300, dec: 0.32, thump: 110, tv: 0.9, vol: 1.0, crack: 0.45 },
  smg: { lp: 3300, dec: 0.1, thump: 150, tv: 0.45, vol: 0.62, crack: 0.3 },
  rifle: { lp: 2500, dec: 0.19, thump: 120, tv: 0.8, vol: 0.9, crack: 0.45 },
  ak47: { lp: 2100, dec: 0.22, thump: 105, tv: 0.95, vol: 0.95, crack: 0.5 },
  shotgun: { lp: 1700, dec: 0.36, thump: 90, tv: 1.0, vol: 1.0, crack: 0.3 },
  sniper: { lp: 1900, dec: 0.62, thump: 80, tv: 1.1, vol: 1.15, crack: 0.6 },
  silenced: { lp: 1500, dec: 0.07, thump: 0, tv: 0, vol: 0.32, crack: 0.1, bp: true },
};

class AudioSys {
  constructor() {
    this.ctx = null;
    this.lx = 0; this.ly = 0; this.lz = 0; this.lyaw = 0;
    this.lastVoice = 0;
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
    // 简易混响
    this.reverb = ctx.createConvolver();
    const rl = Math.floor(ctx.sampleRate * 1.4);
    const ir = ctx.createBuffer(2, rl, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const c = ir.getChannelData(ch);
      for (let i = 0; i < rl; i++) c[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rl, 3.2);
    }
    this.reverb.buffer = ir;
    this.revGain = ctx.createGain();
    this.revGain.gain.value = 0.22;
    this.reverb.connect(this.revGain);
    this.revGain.connect(this.master);
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
    let prof = GUN[w.silenced ? 'silenced' : wid === 'ak47' ? 'ak47' : wid === 'deagle' ? 'deagle' : w.type] || GUN.rifle;
    const o = this._out(pos, w.silenced ? 7 : 22, prof.vol, w.type === 'sniper' ? 0.6 : 0.35);
    if (!o) return;
    const t = this.ctx.currentTime;
    const lp = prof.lp * (1 - o.far * 0.6) * (0.92 + Math.random() * 0.16);
    if (prof.bp) {
      this._noise(o.input, t, { type: 'bandpass', f: 1400, q: 1.1, dec: prof.dec, vol: 1 });
      this._tone(o.input, t, { f: 900, f2: 300, dec: 0.04, vol: 0.2, type: 'square' });
      return;
    }
    this._noise(o.input, t, { f: lp, f2: lp * 0.35, dec: prof.dec, vol: 1 });
    if (prof.crack) this._noise(o.input, t, { type: 'highpass', f: 2500, dec: 0.035, vol: prof.crack * (1 - o.far) });
    if (prof.thump) this._tone(o.input, t, { f: prof.thump, f2: prof.thump * 0.4, dec: 0.12, vol: prof.tv });
  }

  step(pos, vol = 0.5, surface = 'hard') {
    if (!this.ctx) return;
    const o = this._out(pos, 5, vol, 0.05);
    if (!o) return;
    const t = this.ctx.currentTime;
    const f = surface === 'sand' ? 650 : surface === 'metal' ? 2100 : 1100;
    this._noise(o.input, t, { type: 'bandpass', f: f * (0.85 + Math.random() * 0.3), q: 1.3, dec: 0.08, vol: 0.9 });
    this._tone(o.input, t, { f: 95, f2: 55, dec: 0.06, vol: 0.35 });
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
