// 第一人称的动作数据：各种枪切出来 / 拉栓 / 换弹的关键帧，以及各种刀的切刀、检视、挥刀动作。
// 动作都是照 CS:GO / CS2（刀还参考了瓦罗兰特）的样子自己摆的关键帧，没有用游戏里的动画文件。
import { clamp } from '../shared/util.js';

export const TAU = Math.PI * 2;
export const seg = (e, a, b) => clamp((e - a) / (b - a), 0, 1);
export const sstep = (x) => x * x * (3 - 2 * x);
export const eOut = (x, p = 3) => 1 - Math.pow(1 - x, p);
export const backOut = (x, c = 1.6) => 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);

// ---------- 关键帧 ----------
// 一条轨道 = [[时刻, 值…, 缓动?]…]。时刻是 0~1（整段动作的进度）；两帧之间默认平滑过渡，
// 最后一项可以写缓动：'out' 先快后慢（拉开），'in' 先慢后快（松手弹回去），'lin' 匀速
const EASE = { lin: (x) => x, in: (x) => x * x, out: (x) => 1 - (1 - x) * (1 - x), io: sstep };
export function sample(keys, u, out) {
  const n = keys.length;
  let a = keys[0], b = a, x = 0;
  if (u >= keys[n - 1][0]) a = b = keys[n - 1];
  else if (u > a[0]) {
    for (let i = 1; i < n; i++) if (u < keys[i][0]) { a = keys[i - 1]; b = keys[i]; break; }
    const e = b[b.length - 1];
    x = (typeof e === 'string' ? EASE[e] : sstep)((u - a[0]) / (b[0] - a[0]));
  }
  if (!out) return a[1] + (b[1] - a[1]) * x;
  for (let i = 0; i < out.length; i++) out[i] = a[i + 1] + (b[i + 1] - a[i + 1]) * x;
  return out;
}

// ---------- 枪的动作 ----------
// 每段动作里可以有这些轨道（没写的就不动）：
//   g      整把枪在画面里的偏移 [右, 上, 后, 抬头, 左转, 逆时针侧倾]
//   mag    弹匣 [往上（负数是往下抽）, 往后, 绕卡榫转]；magOff = [t0, t1]：这段时间弹匣不在画面里（手拿出去换新的）
//   bolt   枪机 / 套筒 / 拉机柄拉开多少（0~1）；boltUp：栓动步枪的拉机柄抬起多少；pump：霰弹枪护木往后拉多少
//   lhMag / lhBolt   左手挪到弹匣 / 拉机柄上的程度（0~1）；lh：左手额外的偏移 [右, 上, 后]
//   rhBolt 右手挪到拉机柄上的程度（栓动步枪）
//   ev     [[时刻, 声音]…]
const Z6 = [0, 0, 0, 0, 0, 0];
const OUT = [-0.05, -0.12, 0.08]; // 左手拿着弹匣出画面：往左下方

// 霰弹枪换弹：左手在画面外的弹袋和枪下面的装弹口之间来回 n 次，一次塞一发
function shells(n, t0, t1) {
  const lhMag = [[t0 - 0.06, 0]], lh = [[0.02, 0, 0, 0], [t0 - 0.02, -0.05, -0.18, 0.1]], ev = [];
  const d = (t1 - t0) / n;
  for (let i = 0; i < n; i++) {
    const t = t0 + i * d;
    lhMag.push([t, 0], [t + d * 0.45, 1, 'out'], [t + d * 0.6, 1], [t + d * 0.98, 0]);
    ev.push([t + d * 0.47, 'shell']);
  }
  lh.push([t1, -0.05, -0.18, 0.1], [t1 + 0.07, 0, 0, 0]);
  return { lhMag, lh, ev };
}
const SH = shells(4, 0.12, 0.8);

const CLIPS = {
  // AK / 加利尔：拉机柄在右边，左手从枪下面绕过去往后拉
  ak: {
    draw: {
      g: [[0, 0.02, -0.2, 0.02, -0.6, 0.08, 0.4], [0.3, 0.008, 0.004, 0, 0.03, 0.03, 0.26, 'out'], [0.45, 0.006, 0.006, 0.014, 0.05, 0.03, 0.26], [0.56, 0.007, 0, -0.006, -0.01, 0.02, 0.2], [0.85, 0, 0, 0, -0.01, 0, 0.02], [1, ...Z6]],
      lhBolt: [[0, 1], [0.6, 1], [0.86, 0]],
      bolt: [[0.3, 0], [0.45, 1, 'out'], [0.5, 1], [0.555, 0, 'in']],
      ev: [[0.3, 'boltback'], [0.54, 'boltfwd']],
    },
    // 卸弹匣（往前一掰再抽出来）→ 换上新的（先挂住前面再往后一扣）→ 左手绕到枪下面拉一下拉机柄
    reload: {
      g: [[0, ...Z6], [0.1, -0.01, 0.0, 0.01, 0.14, 0.05, -0.45], [0.63, -0.01, -0.002, 0.01, 0.12, 0.05, -0.43], [0.74, 0.006, -0.008, 0.006, 0.03, 0.02, 0.26], [0.9, 0.004, 0, 0, 0.01, 0, 0.2], [1, ...Z6]],
      lhMag: [[0.02, 0], [0.13, 1], [0.64, 1], [0.74, 0]],
      mag: [[0.15, 0, 0, 0], [0.2, -0.012, -0.012, 0.3, 'out'], [0.3, -0.25, -0.05, 0.48, 'in'], [0.46, -0.25, -0.05, 0.48], [0.56, -0.016, -0.014, 0.32, 'out'], [0.63, 0, 0, 0, 'in']],
      magOff: [0.3, 0.46],
      lh: [[0.2, 0, 0, 0], [0.31, ...OUT], [0.45, ...OUT], [0.56, 0, 0, 0]],
      lhBolt: [[0.66, 0], [0.75, 1], [0.9, 1], [1, 0]],
      bolt: [[0.77, 0], [0.85, 1, 'out'], [0.87, 1], [0.895, 0, 'in']],
      ev: [[0.15, 'magout'], [0.6, 'magin'], [0.77, 'boltback'], [0.885, 'boltfwd']],
    },
  },
  // M4、法玛斯、冲锋枪：弹匣直上直下，左手从上面扣住拉机柄往后拉
  m4: {
    draw: {
      g: [[0, 0.015, -0.2, 0.02, -0.6, 0.06, 0.25], [0.28, 0.004, 0.004, 0, 0.03, 0.02, 0.12, 'out'], [0.43, 0.003, 0.004, 0.016, 0.06, 0.02, 0.12], [0.54, 0.004, 0, -0.005, -0.01, 0.01, 0.08], [0.85, 0, 0, 0, -0.01, 0, 0.01], [1, ...Z6]],
      lhBolt: [[0, 1], [0.6, 1], [0.86, 0]],
      bolt: [[0.28, 0], [0.43, 1, 'out'], [0.48, 1], [0.535, 0, 'in']],
      ev: [[0.28, 'boltback'], [0.52, 'boltfwd']],
    },
    reload: {
      g: [[0, ...Z6], [0.09, -0.01, 0.0, 0.01, 0.14, 0.05, -0.42], [0.6, -0.01, -0.002, 0.01, 0.12, 0.05, -0.4], [0.7, 0.004, -0.004, 0.004, 0.04, 0.02, 0.12], [0.88, 0.003, 0, 0, 0.01, 0, 0.08], [1, ...Z6]],
      lhMag: [[0.02, 0], [0.11, 1], [0.6, 1], [0.69, 0]],
      mag: [[0.13, 0, 0, 0], [0.25, -0.26, 0, 0, 'in'], [0.43, -0.26, 0, 0], [0.53, -0.03, 0, 0, 'out'], [0.585, 0, 0, 0, 'in']],
      magOff: [0.26, 0.42],
      lh: [[0.16, 0, 0, 0], [0.27, ...OUT], [0.41, ...OUT], [0.52, 0, 0, 0]],
      lhBolt: [[0.62, 0], [0.7, 1], [0.86, 1], [0.98, 0]],
      bolt: [[0.72, 0], [0.8, 1, 'out'], [0.83, 1], [0.86, 0, 'in']],
      ev: [[0.13, 'magout'], [0.57, 'magin'], [0.72, 'boltback'], [0.85, 'boltfwd']],
    },
  },
  // 手枪：掏出来左手拉一下套筒；换弹时枪口抬起来，旧弹匣自己掉出去，左手从下面把新弹匣推进握把，再拉套筒
  pistol: {
    draw: {
      g: [[0, 0.01, -0.2, 0.03, -0.75, 0.1, 0.2], [0.34, 0.004, 0.006, 0.004, 0.06, 0.04, 0.12, 'out'], [0.5, 0.004, 0.006, 0.02, 0.1, 0.04, 0.12], [0.62, 0.004, 0, -0.006, -0.02, 0.02, 0.06], [0.9, 0, 0, 0, -0.01, 0, 0], [1, ...Z6]],
      lhBolt: [[0, 1], [0.66, 1], [0.92, 0]],
      bolt: [[0.34, 0], [0.5, 1, 'out'], [0.55, 1], [0.61, 0, 'in']],
      ev: [[0.34, 'slideback'], [0.6, 'slidefwd']],
    },
    reload: {
      g: [[0, ...Z6], [0.1, -0.012, 0.015, 0.01, 0.3, 0.12, -0.4], [0.56, -0.012, 0.012, 0.01, 0.27, 0.12, -0.38], [0.68, 0.006, 0.004, 0.012, 0.1, 0.06, 0.14], [0.86, 0.004, 0, 0, 0, 0.02, 0.05], [1, ...Z6]],
      lh: [[0.03, 0, 0, 0], [0.16, -0.05, -0.2, 0.1], [0.34, -0.05, -0.2, 0.1], [0.38, 0, 0, 0]],
      lhMag: [[0.3, 0], [0.36, 1], [0.6, 1], [0.68, 0]],
      mag: [[0.1, 0, 0, 0], [0.24, -0.3, 0.02, 0, 'in'], [0.36, -0.22, 0, 0], [0.5, -0.03, 0, 0, 'out'], [0.55, 0, 0, 0, 'in']],
      magOff: [0.24, 0.36],
      lhBolt: [[0.6, 0], [0.68, 1], [0.84, 1], [0.96, 0]],
      bolt: [[0.7, 0], [0.78, 1, 'out'], [0.8, 1], [0.83, 0, 'in']],
      ev: [[0.1, 'magout'], [0.54, 'magin'], [0.7, 'slideback'], [0.82, 'slidefwd']],
    },
  },
  // 栓动狙击枪：每开一枪右手抬起拉机柄、往后拉、推回去、压下；切出来和换完弹匣也要拉一次。
  // 照 CS:GO 的节奏：开枪后枪先往后上方顶、约 0.4 秒落回来，然后才开始拉栓（delay），拉完离下一枪还有一点空
  bolt: {
    cycle: {
      frac: 0.6, delay: 0.4,
      g: [[0, ...Z6], [0.16, -0.035, 0.018, 0.004, 0.05, 0.04, 0.24], [0.42, -0.05, 0.024, 0.016, 0.07, 0.05, 0.32], [0.64, -0.045, 0.02, -0.002, 0.03, 0.04, 0.28], [0.86, -0.01, 0.004, 0, 0.005, 0.01, 0.06], [1, ...Z6]],
      rhBolt: [[0, 0], [0.14, 1], [0.8, 1], [1, 0]],
      boltUp: [[0.16, 0], [0.27, 1, 'out'], [0.62, 1], [0.72, 0, 'in']],
      bolt: [[0.27, 0], [0.41, 1, 'out'], [0.47, 1], [0.6, 0, 'in']],
      ev: [[0.16, 'boltup'], [0.28, 'boltback'], [0.5, 'boltfwd'], [0.7, 'boltdown']],
    },
    draw: {
      g: [[0, 0.0, -0.22, 0.02, -0.6, 0.06, 0.3], [0.3, -0.04, 0.02, 0, 0.04, 0.04, 0.28, 'out'], [0.55, -0.05, 0.024, 0.014, 0.07, 0.05, 0.32], [0.75, -0.045, 0.02, -0.003, 0.03, 0.04, 0.28], [0.92, -0.008, 0.003, 0, 0, 0, 0.04], [1, ...Z6]],
      rhBolt: [[0, 1], [0.84, 1], [1, 0]],
      boltUp: [[0.32, 0], [0.42, 1, 'out'], [0.72, 1], [0.82, 0, 'in']],
      bolt: [[0.42, 0], [0.54, 1, 'out'], [0.6, 1], [0.71, 0, 'in']],
      ev: [[0.32, 'boltup'], [0.43, 'boltback'], [0.62, 'boltfwd'], [0.8, 'boltdown']],
    },
    reload: {
      g: [[0, ...Z6], [0.08, -0.01, 0.0, 0.01, 0.12, 0.04, -0.38], [0.5, -0.01, -0.002, 0.01, 0.1, 0.04, -0.36], [0.62, -0.045, 0.022, 0.006, 0.05, 0.04, 0.3], [0.88, -0.045, 0.02, 0, 0.03, 0.04, 0.28], [1, ...Z6]],
      lhMag: [[0.02, 0], [0.1, 1], [0.5, 1], [0.58, 0]],
      mag: [[0.12, 0, 0, 0], [0.22, -0.24, 0, 0, 'in'], [0.36, -0.24, 0, 0], [0.45, -0.03, 0, 0, 'out'], [0.49, 0, 0, 0, 'in']],
      magOff: [0.23, 0.35],
      lh: [[0.14, 0, 0, 0], [0.24, ...OUT], [0.34, ...OUT], [0.44, 0, 0, 0]],
      rhBolt: [[0.56, 0], [0.63, 1], [0.92, 1], [1, 0]],
      boltUp: [[0.64, 0], [0.7, 1, 'out'], [0.86, 1], [0.92, 0, 'in']],
      bolt: [[0.7, 0], [0.77, 1, 'out'], [0.8, 1], [0.86, 0, 'in']],
      ev: [[0.12, 'magout'], [0.48, 'magin'], [0.64, 'boltup'], [0.71, 'boltback'], [0.81, 'boltfwd'], [0.9, 'boltdown']],
    },
  },
  // 泵动霰弹枪：每开一枪左手把护木往后一拉再推回去；换弹是一发一发从下面塞
  pump: {
    cycle: {
      frac: 0.62, delay: 0.14,
      g: [[0, ...Z6], [0.3, 0, -0.004, 0.012, 0.04, 0, 0.03], [0.62, 0, 0, -0.006, -0.01, 0, 0.02], [1, ...Z6]],
      pump: [[0.08, 0], [0.36, 1, 'out'], [0.46, 1], [0.7, 0, 'in']],
      ev: [[0.1, 'pumpback'], [0.5, 'pumpfwd']],
    },
    draw: {
      g: [[0, 0.015, -0.2, 0.02, -0.6, 0.06, 0.2], [0.36, 0, 0, 0, 0.03, 0, 0.05, 'out'], [0.56, 0, -0.004, 0.012, 0.05, 0, 0.05], [0.76, 0, 0, -0.005, -0.01, 0, 0.02], [1, ...Z6]],
      pump: [[0.38, 0], [0.56, 1, 'out'], [0.62, 1], [0.76, 0, 'in']],
      ev: [[0.4, 'pumpback'], [0.66, 'pumpfwd']],
    },
    reload: {
      g: [[0, ...Z6], [0.08, 0.01, 0.01, 0.02, 0.3, 0.1, -0.5], [0.8, 0.01, 0.008, 0.02, 0.28, 0.1, -0.48], [0.88, 0, 0, 0.01, 0.04, 0, 0.03], [1, ...Z6]],
      lhMag: SH.lhMag, lh: SH.lh,
      pump: [[0.88, 0], [0.93, 1, 'out'], [0.95, 1], [0.985, 0, 'in']],
      ev: [...SH.ev, [0.885, 'pumpback'], [0.96, 'pumpfwd']],
    },
  },
  // 手雷：按下开火时左手过来把拉环拔掉
  nade: {
    pin: {
      dur: 0.45,
      g: [[0, ...Z6], [0.45, -0.01, 0.004, 0, 0.04, 0.06, -0.08], [0.7, 0.012, 0, 0, 0, -0.04, 0.1, 'out'], [1, ...Z6]],
      lhBolt: [[0, 1]],
      lh: [[0, -0.14, -0.16, 0.06], [0.42, 0, 0, 0, 'out'], [0.58, 0, 0, 0], [1, -0.2, -0.05, 0.04, 'in']],
      pin: [[0.58, 0], [1, 1, 'in']],
      ev: [[0.56, 'pinpull']],
    },
  },
};
// 没有专门动作的武器：从下面抬上来
const RISE = { g: [[0, 0, -0.22, 0, -0.7, 0, 0], [1, 0, 0, 0, 0, 0, 0, 'out']], simple: true };

const FAMILY = {
  ak47: 'ak', galil: 'ak', m4a4: 'm4', m4a1s: 'm4', famas: 'm4', mac10: 'm4', mp9: 'm4', ump45: 'm4',
  glock: 'pistol', usp: 'pistol', p250: 'pistol', deagle: 'pistol', ssg08: 'bolt', awp: 'bolt', nova: 'pump',
  he: 'nade', flash: 'nade', smoke: 'nade', molotov: 'nade', incgrenade: 'nade',
};
// 这把武器的某一段动作（draw 切出来 / reload 换弹 / cycle 开一枪后拉栓 / pin 拔拉环）。没有就返回 null
export function clipFor(wid, kind) {
  const f = CLIPS[FAMILY[wid]];
  return (f && f[kind]) || (kind === 'draw' ? RISE : null);
}

// ---------- 刀 ----------
// 「亮刀」的姿势：拳头举在画面中间偏右，刀尖朝上，握刀的手心对着镜头（检视、花式切刀时用）
export const KNIFE_SHOW = { pos: [0.075, -0.1, -0.27], dir: [-0.1, 0.96, -0.26], face: [0.12, 0.26, -0.96] };
// 挥刀（照 CS：左键是横着一划，一左一右轮着来；右键是往前一捅）
export const KNIFE_HIT = {
  slash: [[0, ...Z6], [0.14, 0.045, 0.01, 0.02, 0, -1.0, -0.15], [0.42, -0.22, 0.025, -0.07, -0.08, 0.5, 0.3, 'out'], [0.56, -0.23, 0.02, -0.06, -0.08, 0.55, 0.32], [1, ...Z6]],
  back: [[0, ...Z6], [0.14, -0.1, 0.012, -0.02, 0, 0.5, 0.2], [0.42, 0.09, 0.01, -0.07, -0.05, -1.25, -0.3, 'out'], [0.56, 0.1, 0.008, -0.06, -0.05, -1.3, -0.32], [1, ...Z6]],
  stab: [[0, ...Z6], [0.2, 0.035, -0.012, 0.06, 0.1, -0.45, -0.1], [0.42, -0.07, 0.03, -0.2, -0.05, -0.75, 0.15, 'out'], [0.62, -0.07, 0.03, -0.19, -0.05, -0.75, 0.15], [1, ...Z6]],
};

// 分段转角：[{t0, t1, a0, a1, ease}]
function track(tr, e) {
  let a = tr[0].a0;
  for (const s of tr) {
    if (e < s.t0) return a;
    if (e < s.t1) return s.a0 + (s.a1 - s.a0) * s.ease((e - s.t0) / (s.t1 - s.t0));
    a = s.a1;
  }
  return a;
}
// 蝴蝶刀的一次翻刀。open：刀身连着咬柄一起甩出去 180°（刀身到位“嗒”），咬柄再自己转 180° 拍回手心（“咔”）；close 反过来。
// k > 1：越转越快，最后拍合那一下最快最脆。返回 [刀身转角, 咬柄转角]（都是相对握在手里的那片刀柄）
const bfSeg = (open, t0, t1, k) => ({ open, t0, t1, k, mid: t0 + (t1 - t0) * Math.pow(0.5, 1 / k) });
function bfAngles(segs, closed, e) {
  for (const s of segs) {
    if (e < s.t0) break;
    if (e < s.t1) {
      const f = Math.pow((e - s.t0) / (s.t1 - s.t0), s.k) * TAU;
      return s.open ? [Math.PI - Math.min(Math.PI, f), -f] : [Math.max(0, f - Math.PI), f];
    }
    closed = !s.open;
  }
  return closed ? [Math.PI, 0] : [0, 0];
}
const bfEv = (segs) => segs.flatMap((s) => [[s.t0, 'kn_swish'], [s.mid, 'kn_tick'], [s.t1, 'kn_clack']]);
const BF_DRAW = [bfSeg(true, 0.05, 0.3, 1.6)];
// 蝴蝶刀检视：抬手把刀亮到画面中间 → 整把刀在指间甩一圈（咬柄被甩开、最后“咔”地合上）→ 合刀、再开刀
// → 捏着销轴把咬柄张开成 Y 字展示一会儿 → “咔”合上放下
const BF_INSP_FLIP = [bfSeg(false, 1.35, 1.8, 1.4), bfSeg(true, 1.9, 2.4, 1.5)];
function bfInspect(e) {
  let P = 0, b = 0, h = 0;
  const q = seg(e, 0.45, 1.25);
  if (q > 0 && q < 1) { P = -TAU * sstep(q); h = Math.sin(q * Math.PI) * 1.9; }
  if (e >= 1.35 && e < 2.4) [b, h] = bfAngles(BF_INSP_FLIP, false, e);
  if (e >= 2.5 && e < 3.6) {
    const yIn = sstep(seg(e, 2.5, 2.8)), shut = seg(e, 3.3, 3.45);
    h = 1.75 * yIn * (1 - shut * shut); // 张开，最后越合越快“咔”一声
    P = (-0.5 + Math.sin((e - 2.5) * 3) * 0.06) * yIn * (1 - sstep(seg(e, 3.3, 3.6)));
  }
  return [P, b, h];
}
// 爪子刀（参考 CS2）：拔刀时绕食指往里转一圈，先快后慢地停住；
// 检视：往里转大半圈，刀身朝下挂在手指上晃一晃，再甩回来、最后再转一圈接住
const HANG = Math.PI * 1.5;
const KA_DRAW = [{ t0: 0.05, t1: 0.5, a0: -TAU, a1: 0, ease: (x) => eOut(x, 2) }];
const KA_INSP = [{ t0: 0.35, t1: 0.95, a0: 0, a1: HANG, ease: sstep }, { t0: 1.5, t1: 1.85, a0: HANG, a1: TAU, ease: sstep },
  { t0: 1.95, t1: 2.4, a0: TAU, a1: 2 * TAU, ease: (x) => eOut(x, 2) }];
const KA_WRIST = { draw: { ry: 0, rz: 0.12, rx: 0.05, px: -0.03, py: 0.035, pz: 0.03, back: [0.48, 0.66] },
  inspect: { ry: 0, rz: 0.15, rx: -0.05, px: -0.05, py: 0.07, pz: 0, back: [2.38, 2.7] } };
// 剥皮小刀（瓦罗兰特的路子）：切刀时刀尖朝上亮出来，在手里飞快转一整圈，再绕刀身拧一圈露出刀背锯齿，然后放下
const XE_DRAW = [{ t0: 0.06, t1: 0.28, a0: 0, a1: TAU, ease: sstep }];
const XE_DRAW_ROLL = [{ t0: 0.3, t1: 0.56, a0: 0, a1: TAU, ease: (x) => eOut(x, 2) }];
const XE_ROLL = [{ t0: 0.5, t1: 1.05, a0: 0, a1: Math.PI, ease: sstep }, { t0: 1.35, t1: 1.9, a0: Math.PI, a1: TAU, ease: sstep }];
const XE_TWIRL = [{ t0: 2.0, t1: 2.55, a0: 0, a1: 2 * TAU, ease: (x) => eOut(x, 1.8) }];

// 每种刀：draw / inspect = { dur 秒, ev [[秒, 声音]…] }；
// anim(P, mode, e, o)：摆好刀上会动的零件（P），往 o 里加整只手的偏移，返回往「亮刀」姿势过渡多少（0~1）
export const KNIFE_FX = {
  // 默认匕首：从下面甩上来，手腕一拧落到位
  plain: {
    draw: { dur: 0.5, ev: [[0.04, 'kn_swish'], [0.36, 'kn_catch']] },
    inspect: { dur: 2.8, ev: [[0.1, 'kn_swish'], [1.0, 'kn_swish'], [2.35, 'kn_swish']] },
    anim(P, mode, e, o) {
      if (mode === 'draw') {
        const s = 1 - backOut(seg(e, 0.1, 0.5), 1.4);
        o.rz -= s * 0.9; o.rx -= s * 0.2; o.px += s * 0.03; o.py -= s * 0.04;
        return 0;
      }
      if (mode !== 'inspect') return 0;
      // 亮出一面 → 手腕转过去看另一面 → 放下
      const w = sstep(seg(e, 0, 0.4)) * (1 - sstep(seg(e, 2.35, 2.8)));
      o.ry += w * (0.35 - (sstep(seg(e, 0.9, 1.35)) - sstep(seg(e, 1.9, 2.3))) * 1.0);
      return w;
    },
  },
  // M9 刺刀（照 CS:GO 的切刀拆帧做的）：反握着从下面抬上来、手心对着镜头 → 刀在手里转半圈变成正握（刀尖从朝下转到朝上）
  // → 手腕一翻，落到平时的拿法。检视：亮刀看两面，往上抛着翻一圈接住
  m9: {
    draw: { dur: 0.66, ev: [[0.08, 'kn_swish'], [0.38, 'kn_catch'], [0.42, 'kn_swish']] },
    inspect: { dur: 2.9, ev: [[0.1, 'kn_swish'], [0.9, 'kn_swish'], [1.62, 'kn_swish'], [2.02, 'kn_catch'], [2.45, 'kn_swish']] },
    anim(P, mode, e, o) {
      let spin = 0, toss = 0, w = 0;
      if (mode === 'draw') {
        spin = -Math.PI * (1 - sstep(seg(e, 0.1, 0.38)));
        w = 1 - sstep(seg(e, 0.38, 0.66));
        const over = Math.sin(seg(e, 0.3, 0.6) * Math.PI); // 转到位后惯性往右多摆一点再回来
        o.rz -= over * 0.3 * w; o.py -= w * 0.03; o.px += w * 0.02;
      } else if (mode === 'inspect') {
        w = sstep(seg(e, 0, 0.4)) * (1 - sstep(seg(e, 2.45, 2.9)));
        o.ry += w * (0.3 - sstep(seg(e, 0.85, 1.3)) * 0.9);
        const q = seg(e, 1.62, 2.02);
        if (q > 0 && q < 1) { spin = TAU * q; toss = 0.09 * 4 * q * (1 - q); }
      }
      P.spin.rotation.x = spin;
      P.spin.position.copy(P.base);
      P.spin.position.z -= toss; // 亮刀时刀尖朝上：往刀尖方向抛就是往上抛
      return w;
    },
  },
  butterfly: {
    draw: { dur: 0.5, ev: bfEv(BF_DRAW) },
    inspect: { dur: 4.0, ev: [[0.05, 'kn_swish'], [0.45, 'kn_swish'], [1.25, 'kn_clack'], ...bfEv(BF_INSP_FLIP), [2.55, 'kn_tick'], [3.45, 'kn_clack']] },
    anim(P, mode, e, o) {
      const [a, b, h] = mode === 'draw' ? [0, ...bfAngles(BF_DRAW, true, e)] : mode === 'inspect' ? bfInspect(e) : [0, 0, 0];
      // 两片刀柄各有一根销轴：刀身绕握在手里那片的销轴转，咬柄装在刀根上、绕自己的销轴转。
      // 转的方向是从指关节那一侧翻过去（手腕那一侧有小臂挡着）
      P.pivot.rotation.x = -a;
      P.blade.rotation.x = -b;
      P.hB.rotation.x = -(h - b);
      if (mode !== 'inspect') return 0;
      const w = sstep(seg(e, 0, 0.45)) * (1 - sstep(seg(e, 3.5, 4.0)));
      o.ry += w * Math.sin(e * 1.7) * 0.05;
      return w;
    },
  },
  karambit: {
    draw: { dur: 0.66, ev: [[0.05, 'kn_swish'], [0.5, 'kn_catch']] },
    inspect: { dur: 2.7, ev: [[0.35, 'kn_swish'], [0.95, 'kn_tick'], [1.5, 'kn_swish'], [1.85, 'kn_tick'], [1.95, 'kn_swish'], [2.4, 'kn_catch']] },
    attack(stab, p, o) {
      // 先快后慢：0~0.3 出手，之后慢慢收回
      const s = p < 0.3 ? Math.sin((p / 0.3) * Math.PI / 2) : Math.cos(((p - 0.3) / 0.7) * Math.PI / 2);
      if (stab) {
        const lift = p < 0.25 ? Math.sin((p / 0.25) * Math.PI / 2) * (1 - p / 0.25) : 0;
        o.py += lift * 0.05 - s * 0.03; o.pz -= s * 0.1; o.rx += s * 0.75; o.rz -= s * 0.25; o.px -= s * 0.04;
      } else {
        o.px -= s * 0.17; o.py += s * 0.025; o.pz -= s * 0.05; o.rz += s * 0.55; o.ry += s * 0.35;
      }
    },
    anim(P, mode, e, o) {
      let a = mode === 'draw' ? track(KA_DRAW, e) : mode === 'inspect' ? track(KA_INSP, e) : 0;
      if (mode === 'inspect' && e > 0.95 && e < 1.5) a += Math.sin((e - 0.95) * 11) * 0.16 * (1 - (e - 0.95) / 0.55); // 挂着晃
      P.spin.rotation.x = a;
      const W = KA_WRIST[mode];
      if (W) {
        // 刀面本来就对着屏幕，手腕只要稍微抬一下
        const w = mode === 'draw' ? 1 - backOut(seg(e, W.back[0], W.back[1])) : sstep(seg(e, 0, 0.3)) * (1 - sstep(seg(e, W.back[0], W.back[1])));
        o.ry += w * W.ry; o.rz += w * W.rz; o.rx += w * W.rx; o.px += w * W.px; o.py += w * W.py; o.pz += w * W.pz;
      }
      return 0;
    },
  },
  xeno: {
    draw: { dur: 0.62, ev: [[0.06, 'kn_swish'], [0.28, 'kn_tick'], [0.3, 'kn_swish'], [0.54, 'kn_catch']] },
    inspect: { dur: 3.1, ev: [[0.5, 'kn_swish'], [1.35, 'kn_swish'], [2.0, 'kn_swish'], [2.55, 'kn_catch']] },
    anim(P, mode, e, o) {
      let w = 0, a = 0, roll = 0;
      if (mode === 'draw') {
        w = 1 - sstep(seg(e, 0.42, 0.62));
        a = track(XE_DRAW, e); roll = track(XE_DRAW_ROLL, e);
      } else if (mode === 'inspect') {
        w = sstep(seg(e, 0, 0.35)) * (1 - sstep(seg(e, 2.65, 3.1)));
        a = track(XE_TWIRL, e); roll = track(XE_ROLL, e);
      }
      P.spin.rotation.set(a, 0, roll);
      // 挂绳跟着转动甩一甩
      const sw = mode && a % TAU > 0.01 ? Math.sin(e * 23) * 0.5 : Math.sin(e * 9) * 0.12 * Math.exp(-e * 0.6);
      if (P.cord) P.cord.rotation.set(sw, 0, sw * 0.4);
      return w;
    },
  },
};
