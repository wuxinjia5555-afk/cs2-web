// 枪声合成：离线算好一段波形（瞬态爆音 + 扫频的枪口爆风 + 低频冲击 + 机械声 + 回声 + 环境尾音），
// 游戏里直接播放缓冲区，既好听又省 CPU。浏览器和 Node 都能跑（tools 里用来出试听文件）。

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// RBJ 双二阶滤波器
class Biquad {
  constructor(sr) { this.sr = sr; this.x1 = this.x2 = this.y1 = this.y2 = 0; }
  set(type, f, q) {
    const w = (2 * Math.PI * Math.min(f, this.sr * 0.45)) / this.sr;
    const cs = Math.cos(w), al = Math.sin(w) / (2 * q);
    let b0, b1, b2;
    if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; }
    else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
    else { b0 = al; b1 = 0; b2 = -al; } // bp，峰值 0dB
    const a0 = 1 + al;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = (-2 * cs) / a0; this.a2 = (1 - al) / a0;
    return this;
  }
  p(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

const env = (t, att, dec) => (t < att ? t / att : Math.exp(-(t - att) / dec));

// 各类枪的音色（时间单位秒，频率 Hz）
// pulse：枪口冲击波（类似 Friedlander 波形）  crack：极短的高频脆响  body：扫频的爆风噪声  punch：低中频的“砰”
// boom：低频冲击  mech：机械动作声  echo：回声  tail：环境尾音  drive：软削波强度
export const GUN_PROFILES = {
  rifle: {
    len: 0.65, punch: [0.8, 260, 0.035], pulse: [0.9, 0.0005], crack: [0.35, 2600, 0.004],
    body: { amp: 1.0, f0: 2200, f1: 600, sweep: 0.016, q: 0.85, dec: 0.04 },
    boom: { amp: 0.4, f0: 150, f1: 52, ft: 0.028, dec: 0.07 },
    mech: [[0.032, 0.1, 3400, 6, 0.006]], echo: [[0.042, 0.22, 1600], [0.1, 0.13, 900]],
    tail: { amp: 0.17, lp: 950, dec: 0.2 }, drive: 2.0, gain: 0.42, ref: 22,
  },
  ak47: {
    len: 0.72, punch: [0.95, 230, 0.04], pulse: [1.0, 0.0006], crack: [0.35, 2300, 0.0045],
    body: { amp: 1.0, f0: 2100, f1: 480, sweep: 0.02, q: 0.8, dec: 0.048 },
    boom: { amp: 0.47, f0: 135, f1: 46, ft: 0.032, dec: 0.085 },
    mech: [[0.036, 0.1, 3000, 6, 0.006]], echo: [[0.045, 0.24, 1400], [0.11, 0.15, 850]],
    tail: { amp: 0.2, lp: 850, dec: 0.24 }, drive: 2.2, gain: 0.44, ref: 22,
  },
  m4a4: {
    len: 0.62, punch: [0.75, 280, 0.03], pulse: [0.85, 0.00045], crack: [0.35, 2900, 0.0035],
    body: { amp: 1.0, f0: 2400, f1: 680, sweep: 0.014, q: 0.9, dec: 0.036 },
    boom: { amp: 0.36, f0: 160, f1: 58, ft: 0.025, dec: 0.062 },
    mech: [[0.03, 0.1, 3700, 6, 0.006]], echo: [[0.04, 0.22, 1700], [0.095, 0.12, 1000]],
    tail: { amp: 0.16, lp: 1050, dec: 0.18 }, drive: 2.0, gain: 0.42, ref: 22,
  },
  pistol: {
    len: 0.45, punch: [0.6, 320, 0.022], pulse: [0.8, 0.00035], crack: [0.3, 3200, 0.003],
    body: { amp: 0.9, f0: 2500, f1: 800, sweep: 0.01, q: 0.95, dec: 0.022 },
    boom: { amp: 0.25, f0: 210, f1: 85, ft: 0.018, dec: 0.045 },
    mech: [[0.02, 0.14, 4000, 7, 0.005]], echo: [[0.035, 0.18, 1800], [0.08, 0.1, 1100]],
    tail: { amp: 0.12, lp: 1300, dec: 0.12 }, drive: 1.8, gain: 0.34, ref: 18,
  },
  deagle: {
    len: 0.8, punch: [1.0, 220, 0.05], pulse: [1.0, 0.0007], crack: [0.4, 2200, 0.005],
    body: { amp: 1.0, f0: 1900, f1: 380, sweep: 0.024, q: 0.72, dec: 0.06 },
    boom: { amp: 0.5, f0: 120, f1: 40, ft: 0.04, dec: 0.12 },
    mech: [[0.042, 0.1, 2800, 6, 0.007]], echo: [[0.05, 0.28, 1300], [0.13, 0.17, 800]],
    tail: { amp: 0.26, lp: 800, dec: 0.3 }, drive: 2.4, gain: 0.46, ref: 24,
  },
  smg: {
    len: 0.4, punch: [0.55, 320, 0.02], pulse: [0.75, 0.00035], crack: [0.28, 3300, 0.003],
    body: { amp: 0.9, f0: 2600, f1: 850, sweep: 0.01, q: 1.0, dec: 0.02 },
    boom: { amp: 0.23, f0: 190, f1: 78, ft: 0.018, dec: 0.04 },
    mech: [[0.018, 0.14, 4300, 7, 0.004]], echo: [[0.03, 0.15, 1800]],
    tail: { amp: 0.1, lp: 1400, dec: 0.1 }, drive: 1.6, gain: 0.33, ref: 18,
  },
  ump45: {
    len: 0.45, punch: [0.7, 280, 0.025], pulse: [0.85, 0.00045], crack: [0.28, 2800, 0.0035],
    body: { amp: 0.95, f0: 2200, f1: 650, sweep: 0.013, q: 0.9, dec: 0.026 },
    boom: { amp: 0.3, f0: 170, f1: 62, ft: 0.022, dec: 0.05 },
    mech: [[0.022, 0.12, 3600, 7, 0.005]], echo: [[0.035, 0.17, 1600]],
    tail: { amp: 0.12, lp: 1200, dec: 0.12 }, drive: 1.8, gain: 0.36, ref: 18,
  },
  shotgun: {
    len: 0.95, punch: [1.0, 200, 0.07], pulse: [1.0, 0.0008], crack: [0.3, 2000, 0.004],
    body: { amp: 1.0, f0: 1500, f1: 300, sweep: 0.03, q: 0.65, dec: 0.08 },
    boom: { amp: 0.55, f0: 110, f1: 38, ft: 0.05, dec: 0.15 },
    mech: [], echo: [[0.06, 0.28, 1100], [0.15, 0.18, 700]],
    tail: { amp: 0.28, lp: 700, dec: 0.34 }, drive: 2.5, gain: 0.48, ref: 24,
  },
  awp: {
    len: 1.35, punch: [1.0, 200, 0.06], pulse: [1.0, 0.0008], crack: [0.5, 2500, 0.006],
    body: { amp: 1.0, f0: 2000, f1: 340, sweep: 0.03, q: 0.7, dec: 0.07 },
    boom: { amp: 0.55, f0: 100, f1: 35, ft: 0.05, dec: 0.18 },
    mech: [], echo: [[0.07, 0.32, 1200], [0.19, 0.2, 700], [0.33, 0.11, 500]],
    tail: { amp: 0.32, lp: 700, dec: 0.55 }, drive: 2.6, gain: 0.52, ref: 30,
  },
  ssg08: {
    len: 1.0, punch: [0.85, 240, 0.045], pulse: [0.95, 0.0006], crack: [0.45, 3000, 0.005],
    body: { amp: 1.0, f0: 2600, f1: 500, sweep: 0.02, q: 0.8, dec: 0.05 },
    boom: { amp: 0.4, f0: 130, f1: 45, ft: 0.035, dec: 0.12 },
    mech: [], echo: [[0.06, 0.28, 1400], [0.16, 0.16, 800]],
    tail: { amp: 0.26, lp: 900, dec: 0.4 }, drive: 2.3, gain: 0.46, ref: 28,
  },
  // 消音：没有爆风和回声，主要是“噗”的一声加上枪机撞击的金属声
  silenced: {
    len: 0.3, punch: [0.35, 380, 0.015], pulse: [0.25, 0.0003], crack: [0.08, 4000, 0.0015],
    body: { amp: 0.75, f0: 1900, f1: 950, sweep: 0.012, q: 1.2, dec: 0.017 },
    boom: { amp: 0.17, f0: 210, f1: 90, ft: 0.015, dec: 0.03 },
    mech: [[0.003, 0.45, 3000, 5, 0.009], [0.048, 0.28, 2300, 5, 0.008]], echo: [],
    tail: { amp: 0.05, lp: 1500, dec: 0.06 }, drive: 1.5, gain: 0.3, ref: 8,
  },
  silenced_rifle: {
    len: 0.32, punch: [0.45, 340, 0.018], pulse: [0.3, 0.0004], crack: [0.08, 3600, 0.0018],
    body: { amp: 0.8, f0: 1700, f1: 800, sweep: 0.014, q: 1.1, dec: 0.02 },
    boom: { amp: 0.21, f0: 180, f1: 75, ft: 0.018, dec: 0.035 },
    mech: [[0.004, 0.42, 2700, 5, 0.01], [0.04, 0.24, 2000, 5, 0.008]], echo: [],
    tail: { amp: 0.06, lp: 1300, dec: 0.07 }, drive: 1.5, gain: 0.32, ref: 9,
  },
};

export function gunProfileKey(w) {
  if (!w) return 'rifle';
  if (w.silenced) return w.type === 'rifle' ? 'silenced_rifle' : 'silenced';
  if (GUN_PROFILES[w.id]) return w.id;
  if (w.type === 'sniper') return 'ssg08';
  return GUN_PROFILES[w.type] ? w.type : 'rifle';
}

// 合成一段单声道波形
export function synthGun(P, sr, seed = 1) {
  const R = rng(seed);
  const n = Math.ceil(P.len * sr);
  const dry = new Float32Array(n);
  const out = new Float32Array(n);
  const nz = () => R() * 2 - 1;
  const crackF = new Biquad(sr).set('hp', P.crack[1], 0.7);
  const bodyF = new Biquad(sr), bodyF2 = new Biquad(sr);
  const tailF = new Biquad(sr).set('lp', P.tail.lp, 0.6), tailF2 = new Biquad(sr).set('lp', P.tail.lp * 1.3, 0.6);
  const mechF = P.mech.map((m) => new Biquad(sr).set('bp', m[2], m[3]));
  const punchF = new Biquad(sr).set('bp', P.punch[1], 0.8), punchF2 = new Biquad(sr).set('lp', P.punch[1] * 2, 0.7);
  const B = P.body, M = P.boom;
  // 每份变体的细微差别
  const fj = 0.94 + R() * 0.12, dj = 0.92 + R() * 0.16;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const w = nz();
    let s = 0;
    // 1) 枪口冲击波：正压尖峰后跟一个负压
    const [pa, pT] = P.pulse;
    if (t < pT * 8) s += pa * (1 - t / pT) * Math.exp((-2.2 * t) / pT);
    // 2) 高频脆响
    s += crackF.p(w) * P.crack[0] * 3.2 * Math.exp(-t / P.crack[2]);
    // 3) 爆风：带通噪声，中心频率从高往低扫
    if ((i & 15) === 0) {
      const fc = (B.f1 + (B.f0 - B.f1) * Math.exp(-t / B.sweep)) * fj;
      bodyF.set('bp', fc, B.q);
      bodyF2.set('lp', fc * 1.8, 0.7);
    }
    s += bodyF2.p(bodyF.p(w)) * B.amp * 6 * env(t, 0.0004, B.dec * dj);
    // 3b) 低中频的“砰”：低通噪声，决定胸腔感（手机喇叭也能放出来）
    s += punchF2.p(punchF.p(w)) * P.punch[0] * 15 * env(t, 0.0008, P.punch[2] * dj);
    // 4) 低频冲击：音高快速下降的正弦
    const f = (M.f1 + (M.f0 - M.f1) * Math.exp(-t / M.ft)) * fj;
    ph += (2 * Math.PI * f) / sr;
    s += Math.sin(ph) * M.amp * env(t, 0.0012, M.dec * dj);
    // 5) 机械声（枪机 / 套筒）
    for (let k = 0; k < P.mech.length; k++) {
      const m = P.mech[k];
      const y = mechF[k].p(w);
      if (t >= m[0]) s += y * m[1] * 3 * Math.exp(-(t - m[0]) / m[4]);
    }
    dry[i] = s;
    // 6) 环境尾音：低通噪声，慢慢淡出
    out[i] = tailF2.p(tailF.p(w)) * P.tail.amp * 4 * env(t, 0.012, P.tail.dec * dj);
  }
  // 7) 回声：把干声延迟、衰减、变闷后叠加
  for (const [dt, amp, lp] of P.echo) {
    const d = Math.round(dt * dj * sr);
    const f = new Biquad(sr).set('lp', lp, 0.7);
    for (let i = d; i < n; i++) out[i] += f.p(dry[i - d]) * amp;
  }
  for (let i = 0; i < n; i++) out[i] += dry[i];
  // 去掉 55Hz 以下的闷响（喇叭放不出来，只会占音量），再柔和地削掉 9kHz 以上
  const hp = new Biquad(sr).set('hp', 55, 0.7), lp = new Biquad(sr).set('lp', 9000, 0.7);
  let peak = 0;
  for (let i = 0; i < n; i++) { out[i] = lp.p(hp.p(out[i])); peak = Math.max(peak, Math.abs(out[i])); }
  // 软削波让声音更“实”，最后统一峰值
  const dr = P.drive, nd = Math.tanh(dr);
  let peak2 = 0;
  for (let i = 0; i < n; i++) { out[i] = Math.tanh((out[i] / (peak || 1)) * dr) / nd; peak2 = Math.max(peak2, Math.abs(out[i])); }
  const g = 0.9 / (peak2 || 1), fade = Math.min(n, Math.round(0.03 * sr));
  for (let i = 0; i < n; i++) out[i] *= g * (i > n - fade ? (n - i) / fade : 1);
  return out;
}

// 脚步声：脚跟落地的“咚” + 稍后脚尖的轻响；沙地多一层沙粒摩擦声，金属地面带一点共鸣
export function synthStep(surface, sr, seed = 1) {
  const R = rng(seed);
  const metal = surface === 'metal', sand = surface === 'sand';
  const n = Math.ceil((metal ? 0.3 : 0.2) * sr);
  const out = new Float32Array(n);
  const v = 0.85 + R() * 0.3; // 每一步轻重不同
  const toeAt = 0.04 + R() * 0.03; // 脚尖落地的时间
  const lpF = sand ? 400 : 620;
  const thudF = new Biquad(sr).set('lp', lpF, 0.8), thudF2 = new Biquad(sr).set('lp', lpF, 0.8);
  const toeF = new Biquad(sr).set('lp', sand ? 900 : 1500, 0.8);
  const scuffF = new Biquad(sr).set('bp', sand ? 2300 : metal ? 1800 : 1400, sand ? 0.8 : 1.3);
  const modes = metal ? [[420 * (0.96 + R() * 0.08), 0.08], [1150 * (0.96 + R() * 0.08), 0.05], [2300, 0.03]] : [];
  const modeF = modes.map(([f]) => new Biquad(sr).set('bp', f, 18));
  let grain = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, w = R() * 2 - 1;
    let s = thudF2.p(thudF.p(w)) * 5 * v * env(t, 0.003, 0.02);
    const toe = toeF.p(w);
    if (t >= toeAt) s += toe * 2.2 * v * env(t - toeAt, 0.002, 0.014);
    const sc = scuffF.p(w);
    if (sand) {
      if ((i & 63) === 0) grain = R() < 0.4 ? 1.4 : 0.35; // 沙粒：一颗一颗的细碎声
      s += sc * 0.8 * grain * env(t, 0.004, 0.05);
    } else s += sc * 0.55 * env(t, 0.001, 0.01);
    for (let k = 0; k < modes.length; k++) s += modeF[k].p(w) * 9 * Math.exp(-t / modes[k][1]);
    out[i] = s;
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const fade = Math.round(0.02 * sr);
  for (let i = 0; i < n; i++) out[i] = Math.tanh((out[i] / (peak || 1)) * 1.3) / Math.tanh(1.3) * 0.8 * (i > n - fade ? (n - i) / fade : 1);
  return out;
}

// 命中 / 爆头 / 击杀的反馈音（opts.streak 连杀数会让击杀声的金属音逐级升高）
export function synthFx(kind, sr, opts = {}) {
  const R = rng(opts.seed || 5);
  const len = { hit: 0.12, hs_helmet: 0.35, hs_nohelm: 0.2, kill: 0.75, kill_hs: 0.9 }[kind] || 0.5;
  const n = Math.ceil(len * sr);
  const out = new Float32Array(n);
  const streak = Math.max(1, Math.min(5, opts.streak || 1));
  const up = Math.pow(1.122, streak - 1); // 每多一杀升高约一个全音
  const bp = (f, q) => new Biquad(sr).set('bp', f, q), lpf = (f) => new Biquad(sr).set('lp', f, 0.7);
  // 金属部件：一组非整数倍的泛音（像敲击金属片）
  const metal = (f0, ratios, amps, decs, glide = 0) => ratios.map((r, i) => ({ f: f0 * r, a: amps[i], d: decs[i], ph: R() * 6.28, g: glide }));
  let parts = [];
  if (kind === 'hs_helmet') parts = metal(2250, [1, 1.47, 2.09, 2.76], [1, 0.55, 0.35, 0.2], [0.18, 0.12, 0.08, 0.05]);
  if (kind === 'kill') parts = metal(1180 * up, [1, 1.52, 2.21, 2.93, 3.67], [1, 0.62, 0.45, 0.3, 0.2], [0.42, 0.3, 0.22, 0.16, 0.11], 0.04);
  if (kind === 'kill_hs') parts = [...metal(1180 * up, [1, 1.52, 2.21, 2.93], [0.9, 0.55, 0.4, 0.26], [0.45, 0.32, 0.22, 0.15], 0.04),
    ...metal(3300 * up, [1, 1.41, 2.03], [0.85, 0.5, 0.3], [0.5, 0.32, 0.2])];
  const nf1 = kind === 'hit' ? bp(1100, 0.9) : kind === 'hs_nohelm' ? bp(900, 0.8) : bp(2000, 0.8);
  const nf2 = kind === 'kill_hs' ? bp(4200, 1.2) : kind === 'hs_nohelm' ? bp(2600, 1.2) : bp(3500, 1.5);
  const sw = bp(6000, 4); // “锵”的扫频摩擦声
  let phSub = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, w = R() * 2 - 1;
    let s = 0;
    if (kind === 'hit') {
      s += nf1.p(w) * 2.6 * env(t, 0.0008, 0.02);
      phSub += (2 * Math.PI * (200 + 120 * Math.exp(-t / 0.01))) / sr;
      s += Math.sin(phSub) * 0.35 * env(t, 0.001, 0.025);
    } else if (kind === 'hs_nohelm') {
      s += nf1.p(w) * 2.8 * env(t, 0.0008, 0.035);
      s += nf2.p(w) * 1.0 * env(t, 0.0005, 0.012);
      phSub += (2 * Math.PI * (180 + 140 * Math.exp(-t / 0.012))) / sr;
      s += Math.sin(phSub) * 0.5 * env(t, 0.001, 0.04);
    } else if (kind === 'hs_helmet') {
      s += nf2.p(w) * 0.9 * env(t, 0.0003, 0.005); // 撞击的一下
    } else {
      // 击杀：低音冲击 + 碎裂声 + 一闪而过的扫频“锵”
      phSub += (2 * Math.PI * (62 + 150 * Math.exp(-t / 0.03))) / sr;
      s += Math.sin(phSub) * 0.7 * env(t, 0.0015, 0.1);
      s += nf1.p(w) * 1.6 * env(t, 0.0005, 0.022);
      if ((i & 15) === 0) sw.set('bp', 7000 - 4200 * Math.min(1, t / 0.09), 4);
      s += sw.p(w) * (kind === 'kill_hs' ? 1.5 : 1.1) * env(t, 0.004, 0.06);
      if (kind === 'kill_hs') s += nf2.p(w) * 1.2 * env(t, 0.0004, 0.012);
    }
    for (const p of parts) {
      const f = p.f * (1 + p.g * (1 - Math.exp(-t / 0.05)));
      p.ph += (2 * Math.PI * f) / sr;
      s += Math.sin(p.ph) * p.a * (kind === 'hs_helmet' ? 0.5 : 0.75) * env(t, 0.0015, p.d);
    }
    out[i] = s;
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const fade = Math.round(0.02 * sr), dr = kind === 'kill' || kind === 'kill_hs' ? 1.8 : 1.4;
  for (let i = 0; i < n; i++) out[i] = (Math.tanh((out[i] / (peak || 1)) * dr) / Math.tanh(dr)) * 0.92 * (i > n - fade ? (n - i) / fade : 1);
  return out;
}

// 刀的花式动作声：kn_swish 甩刀的风声，kn_tick 金属轻碰，kn_clack 蝴蝶刀刀柄拍合（“咔-嗒”两下），kn_catch 一把握住刀柄
export function synthKnife(kind, sr, seed = 9) {
  const R = rng(seed);
  const len = { kn_swish: 0.24, kn_tick: 0.09, kn_clack: 0.22, kn_catch: 0.2 }[kind] || 0.2;
  const n = Math.ceil(len * sr);
  const out = new Float32Array(n);
  const bp = (f, q) => new Biquad(sr).set('bp', f, q);
  const ring = (f0, ratios, amps, decs) => ratios.map((r, i) => ({ f: f0 * r, a: amps[i], d: decs[i], ph: R() * 6.28 }));
  let parts = [], hits = [];
  // hits：[开始时间, 音量, 滤波器, 衰减]，一次撞击的瞬态
  if (kind === 'kn_tick') {
    parts = ring(4300, [1, 1.38, 2.05], [0.7, 0.45, 0.25], [0.022, 0.016, 0.01]);
    hits = [[0, 1, bp(5200, 1.2), 0.0025]];
  } else if (kind === 'kn_clack') {
    parts = ring(2650, [1, 1.53, 2.31, 3.1], [0.8, 0.55, 0.4, 0.22], [0.05, 0.04, 0.026, 0.018]);
    hits = [[0, 1, bp(1700, 0.9), 0.006], [0, 0.8, bp(4800, 1.1), 0.0025], [0.012, 0.6, bp(6200, 1.4), 0.002], [0.012, 0.3, bp(2400, 1.2), 0.004]];
  } else if (kind === 'kn_catch') {
    parts = ring(3100, [1, 1.47, 2.2], [0.35, 0.22, 0.12], [0.045, 0.03, 0.02]);
    hits = [[0, 1, bp(420, 0.8), 0.018], [0, 0.6, bp(1500, 0.9), 0.006], [0.004, 0.4, bp(5000, 1.2), 0.002]];
  }
  const sw = bp(1200, 1.6);
  for (let i = 0; i < n; i++) {
    const t = i / sr, w = R() * 2 - 1;
    let s = 0;
    if (kind === 'kn_swish') {
      const q = Math.min(1, t / 0.2);
      if ((i & 15) === 0) sw.set('bp', 800 + 1900 * Math.sin(q * Math.PI), 1.5);
      s += sw.p(w) * Math.pow(Math.sin(q * Math.PI), 2);
    }
    for (const [t0, g, f, d] of hits) if (t >= t0) s += f.p(w) * g * 3 * Math.exp(-(t - t0) / d);
    for (const p of parts) {
      p.ph += (2 * Math.PI * p.f) / sr;
      s += Math.sin(p.ph) * p.a * env(t, 0.0005, p.d);
    }
    out[i] = s;
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const fade = Math.round(0.015 * sr);
  for (let i = 0; i < n; i++) out[i] = (Math.tanh((out[i] / (peak || 1)) * 1.3) / Math.tanh(1.3)) * 0.9 * (i > n - fade ? (n - i) / fade : 1);
  return out;
}
