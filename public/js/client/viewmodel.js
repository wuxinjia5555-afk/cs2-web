// 第一人称武器（独立场景渲染，不会穿墙），含晃动、后坐、换弹、切枪、挥刀、检视动画
import * as THREE from 'three';
import { makeWeapon, armColors, mbox } from './models.js';
import { HD, hdHands } from './hdmodels.js';
import { viewEnv } from './hdkit.js';
import { flare } from './textures.js';
import { WEAPONS } from '../shared/weapons.js';
import { clamp } from '../shared/util.js';

const LAYOUT = {
  rifle: { pos: [0.19, -0.19, -0.36], rot: [0.02, 0.06, 0] },
  sniper: { pos: [0.19, -0.195, -0.34], rot: [0.02, 0.05, 0] },
  smg: { pos: [0.17, -0.17, -0.36], rot: [0.02, 0.07, 0] },
  shotgun: { pos: [0.19, -0.19, -0.35], rot: [0.02, 0.06, 0] },
  pistol: { pos: [0.15, -0.16, -0.4], rot: [0.02, 0.1, 0] },
  knife: { pos: [0.17, -0.18, -0.38], rot: [0.25, 0.45, -0.25] },
  grenade: { pos: [0.16, -0.16, -0.36], rot: [0.2, 0.2, 0] },
  c4: { pos: [0.03, -0.24, -0.42], rot: [0.6, 0, 0] },
  // 爪子刀照 CS2 的拿法：刀面对着屏幕，刀环在拳头左边，弯刀从右边伸出来往上弯
  knife_karambit: { pos: [0.09, -0.11, -0.34], rot: [0.06, -0.08, 0.06] },
};
// 刀在手里的摆法（相对手的位置）：爪子刀横着握，刀柄穿过拳头
// glove：这种握法的拳头 [宽, 高, 厚, x, y, z, 绕 x 转]（横着握，拳头要包住刀柄，刀环贴在拳头左边）
const GRIP = { karambit: { rot: [0, -Math.PI / 2, 0], pos: [0.02, -0.03, 0.03], glove: [0.07, 0.06, 0.062, 0.004, -0.032, 0.035, 0],
  sleeve: [0.078, 0.078, 0.34, 0.0615, -0.1874, 0.1359, 1.012, 0.3078] } };

// ---------- 特殊刀（背包皮肤）的切刀 / 检视花式动画 ----------
const TAU = Math.PI * 2;
const seg = (e, a, b) => clamp((e - a) / (b - a), 0, 1);
const sstep = (x) => x * x * (3 - 2 * x);
const eOut = (x, p = 3) => 1 - Math.pow(1 - x, p);
const backOut = (x, c = 1.6) => 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);

// 蝴蝶刀的一次翻刀。open：刀身连着咬柄（hB）一起甩出去 180°（刀身到位“嗒”），咬柄再自己转 180° 拍回手心（“咔”）；close 反过来。
// k > 1：越转越快，最后拍合那一下最快最脆
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
const bfEv = (segs) => segs.flatMap((s) => [{ t: s.t0, k: 'kn_swish' }, { t: s.mid, k: 'kn_tick' }, { t: s.t1, k: 'kn_clack' }]);
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
const BF_DRAW = [bfSeg(true, 0.05, 0.3, 1.6)];
// 蝴蝶刀检视（照 CS:GO / CS2 的检视拆帧做的）：抬手把刀亮到画面中间、刀面对着镜头 →
// 整把刀在指间甩一圈（咬柄被甩开、最后“咔”地合上）→ 合刀、再开刀 → 捏着销轴把咬柄张开成 Y 字展示一会儿 → “咔”合上放下
const BF_INSP_FLIP = [bfSeg(false, 1.35, 1.8, 1.4), bfSeg(true, 1.9, 2.4, 1.5)];
// 返回 [整把刀绕销轴的转角, 刀身, 咬柄]
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
// 爪子刀（参考 CS2）：拔刀时绕食指往里转一圈（屏幕上逆时针：刀刃在前，先往上、往里翻），先快后慢地停住；
// 检视：往里转大半圈，刀身朝下挂在手指上晃一晃，再甩回来、最后再转一圈接住。角度增大 = 屏幕上逆时针
const HANG = Math.PI * 1.5;
const KA_DRAW = [{ t0: 0.05, t1: 0.5, a0: -TAU, a1: 0, ease: (x) => eOut(x, 2) }];
const KA_INSP = [{ t0: 0.35, t1: 0.95, a0: 0, a1: HANG, ease: sstep }, { t0: 1.5, t1: 1.85, a0: HANG, a1: TAU, ease: sstep },
  { t0: 1.95, t1: 2.4, a0: TAU, a1: 2 * TAU, ease: (x) => eOut(x, 2) }];
const M9_ROLL = [{ t0: 0.42, t1: 0.86, a0: 0, a1: Math.PI, ease: sstep }, { t0: 1.02, t1: 1.42, a0: Math.PI, a1: TAU, ease: sstep }];
const M9_TOSS = { draw: [0.06, 0.36], inspect: [1.56, 1.96] };
// 剥皮小刀：拔刀时在手里往后翻一圈握住；检视：亮刀 → 慢慢翻面看两面 → 指间快速转两圈 → 放下
// 切刀（照游戏视频拆帧做的）：刀尖朝上、刀面对着镜头从下面抬上来 → 在手里飞快顺时针转一整圈（约 0.2 秒）
// → 竖着握住，手腕一拧绕刀身转一圈、露出刀背锯齿 → 放下到平时的拿法
const XE_DRAW = [{ t0: 0.06, t1: 0.28, a0: 0, a1: -TAU, ease: sstep }];
const XE_DRAW_ROLL = [{ t0: 0.3, t1: 0.56, a0: 0, a1: TAU, ease: (x) => eOut(x, 2) }];
const XE_ROLL = [{ t0: 0.5, t1: 1.05, a0: 0, a1: Math.PI, ease: sstep }, { t0: 1.35, t1: 1.9, a0: Math.PI, a1: TAU, ease: sstep }];
const XE_TWIRL = [{ t0: 2.0, t1: 2.55, a0: 0, a1: -2 * TAU, ease: (x) => eOut(x, 1.8) }];
// 翻刀时手腕转过来，让刀面对着屏幕（不然转刀是侧着看的，看不清）
const WRIST = { ry: 0.85, rz: 0.25, rx: -0.12, px: -0.075, py: 0.055, pz: 0.05 };
export const KNIFE_FX = {
  butterfly: {
    draw: { dur: 0.5, back: [0.3, 0.5], ev: bfEv(BF_DRAW) },
    inspect: { dur: 4.0, back: [3.5, 4.0], ev: [{ t: 0.05, k: 'kn_swish' }, { t: 0.45, k: 'kn_swish' }, { t: 1.25, k: 'kn_clack' }, ...bfEv(BF_INSP_FLIP),
      { t: 2.55, k: 'kn_tick' }, { t: 3.45, k: 'kn_clack' }] },
    parts(P, mode, e) {
      const [a, b, h] = mode === 'draw' ? [0, ...bfAngles(BF_DRAW, true, e)] : mode === 'inspect' ? bfInspect(e) : [0, 0, 0];
      P.pivot.rotation.x = a;
      P.blade.rotation.x = b;
      P.hB.rotation.x = h;
    },
    wrist: { inspect: { ry: 0, rz: 0, rx: 0, px: 0, py: 0, pz: 0 } },
    pose(mode, e, o) {
      if (mode !== 'inspect') return;
      // 把刀亮到画面中间偏右、刀面对着镜头
      const w = sstep(seg(e, 0, 0.45)) * (1 - sstep(seg(e, 3.5, 4.0)));
      o.rx += w * 1.2; o.ry += w * (-0.35 + Math.sin(e * 1.7) * 0.05); o.rz += w * 1.75;
      o.px += w * -0.04; o.py += w * 0.1; o.pz += w * 0.08;
    },
  },
  karambit: {
    draw: { dur: 0.66, back: [0.48, 0.66], ev: [{ t: 0.05, k: 'kn_swish' }, { t: 0.5, k: 'kn_catch' }] },
    inspect: { dur: 2.7, back: [2.38, 2.7], ev: [{ t: 0.35, k: 'kn_swish' }, { t: 0.95, k: 'kn_tick' }, { t: 1.5, k: 'kn_swish' }, { t: 1.85, k: 'kn_tick' },
      { t: 1.95, k: 'kn_swish' }, { t: 2.4, k: 'kn_catch' }] },
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
    parts(P, mode, e) {
      let a = mode === 'draw' ? track(KA_DRAW, e) : mode === 'inspect' ? track(KA_INSP, e) : 0;
      if (mode === 'inspect' && e > 0.95 && e < 1.5) a += Math.sin((e - 0.95) * 11) * 0.16 * (1 - (e - 0.95) / 0.55); // 挂着晃
      P.spin.rotation.x = a;
    },
    // 刀面本来就对着屏幕，手腕只要稍微抬一下
    wrist: { draw: { ry: 0, rz: 0.12, rx: 0.05, px: -0.03, py: 0.035, pz: 0.03 }, inspect: { ry: 0, rz: 0.15, rx: -0.05, px: -0.05, py: 0.07, pz: 0 } },
  },
  xeno: {
    draw: { dur: 0.6, back: [0.42, 0.6], ev: [{ t: 0.06, k: 'kn_swish' }, { t: 0.28, k: 'kn_tick' }, { t: 0.3, k: 'kn_swish' }, { t: 0.54, k: 'kn_catch' }] },
    inspect: { dur: 3.1, back: [2.65, 3.1], ev: [{ t: 0.5, k: 'kn_swish' }, { t: 1.35, k: 'kn_swish' }, { t: 2.0, k: 'kn_swish' }, { t: 2.55, k: 'kn_catch' }] },
    wrist: { draw: { ry: 0, rz: 0, rx: 0, px: 0, py: 0, pz: 0 } },
    pose(mode, e, o) {
      if (mode !== 'draw') return;
      // 切刀时刀尖朝上、刀面对着镜头举在画面右下，最后放下到平时的拿法
      const w = 1 - sstep(seg(e, 0.42, 0.6));
      o.rx += w * 1.2; o.ry += w * -0.35; o.rz += w * 1.75;
      o.px += w * -0.05; o.py += w * 0.08; o.pz += w * 0.05;
    },
    parts(P, mode, e) {
      const a = mode === 'draw' ? track(XE_DRAW, e) : mode === 'inspect' ? track(XE_TWIRL, e) : 0;
      P.spin.rotation.set(a, 0, mode === 'draw' ? track(XE_DRAW_ROLL, e) : mode === 'inspect' ? track(XE_ROLL, e) : 0);
      // 挂绳跟着转动甩一甩
      const sw = Math.abs(a) > 0.01 ? Math.sin(e * 23) * 0.5 : Math.sin(e * 9) * 0.12 * Math.exp(-e * 0.6);
      P.cord.rotation.set(sw, 0, sw * 0.4);
    },
  },
  m9: {
    draw: { dur: 0.52, back: [0.36, 0.52], ev: [{ t: 0.06, k: 'kn_swish' }, { t: 0.36, k: 'kn_catch' }] },
    inspect: { dur: 2.6, back: [2.15, 2.6], ev: [{ t: 0.42, k: 'kn_swish' }, { t: 1.02, k: 'kn_swish' }, { t: 1.56, k: 'kn_swish' }, { t: 1.96, k: 'kn_catch' }] },
    parts(P, mode, e) {
      // 抛起来翻一圈（在空中匀速转），再接住
      const T = M9_TOSS[mode];
      const q = T && e > T[0] && e < T[1] ? (e - T[0]) / (T[1] - T[0]) : 0;
      P.spin.rotation.set(q ? -TAU * (1 - q) : 0, 0, mode === 'inspect' ? track(M9_ROLL, e) : 0);
      P.spin.position.copy(P.base);
      if (q) P.spin.position.y += 0.07 * 4 * q * (1 - q);
    },
  },
};

export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.01, 10);
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight(0xe2ebff, 0x6b5c48, 2.4));
    const d = new THREE.DirectionalLight(0xfff2dc, 2.4);
    d.position.set(0.6, 1, 0.4);
    this.scene.add(d);
    this.root = new THREE.Group();
    this.camera.add(this.root);
    this.team = 'T';
    this.knifeSkin = 'default'; // 刀的皮肤（背包里选）
    this.sfx = null; // 花式动作的音效回调（kn_swish / kn_tick / kn_clack / kn_catch）
    this.kfxKey = ''; this.kfxLast = -1; this.joltT = -9;
    this.cache = new Map();
    this.cur = null;
    this.wid = null;
    this.t = 0;
    this.bobT = 0;
    this.kick = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.drawStart = 0; this.drawDur = 0;
    this.reloadStart = 0; this.reloadDur = 0;
    this.knifeT = -1; this.knifeStab = false;
    this.inspectT = -1;
    this.throwT = -1;
    this.landKick = 0;
    this.flashT = 0;
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flare(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: 0xffe0a0 }));
    this.flash.visible = false;
    this.flash.scale.set(0.16, 0.16, 1);
    this.boltK = 0;      // 枪机后坐（开一枪弹回去）
    this.envFor = null;  // 环境反光是给哪个渲染器做的
  }

  // 渲染前调用：高精度模型的金属要有环境可反射（每个渲染器只做一次）
  prepare(renderer) {
    if (this.envFor === renderer) return;
    this.envFor = renderer;
    this.scene.environment = viewEnv(renderer);
  }

  setTeam(team) {
    if (team === this.team) return;
    this.team = team;
    for (const g of this.cache.values()) this.root.remove(g);
    this.cache.clear();
    const w = this.wid;
    this.wid = null;
    this.cur = null;
    if (w) this.setWeapon(w, 0);
  }

  build(wid) {
    const w = WEAPONS[wid];
    const type = w ? (w.type === 'grenade' ? 'grenade' : w.type) : 'knife';
    const lay = (HD[wid] && HD[wid].lay) || (wid === 'knife' && LAYOUT['knife_' + this.knifeSkin]) || LAYOUT[type] || LAYOUT.rifle;
    const g = new THREE.Group();
    const gun = makeWeapon(wid, false, wid === 'knife' ? this.knifeSkin : null);
    const grip = wid === 'knife' && GRIP[this.knifeSkin];
    if (grip) { gun.rotation.set(...grip.rot); gun.position.set(...grip.pos); }
    g.add(gun);
    const col = armColors(this.team);
    // 有高精度模型的枪：配带手指的手（摆好了握枪的姿势）
    const hands = HD[wid] ? hdHands(wid, col) : null;
    if (hands) {
      g.add(hands);
      g.userData.hands = hands;
      g.userData.gun = gun;
      g.userData.lay = lay;
      g.userData.type = type;
      g.visible = false;
      g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
      this.root.add(g);
      return g;
    }
    // 右手握把 + 前臂
    if (grip && grip.glove) { const [gw, gh, gd, gx, gy, gz, grx] = grip.glove; g.add(mbox(gw, gh, gd, col.glove, gx, gy, gz, grx)); }
    else g.add(mbox(0.05, 0.09, 0.075, col.glove, 0.0, -0.045, 0.03, -0.3));
    if (grip && grip.sleeve) { const [sw, sh, sd, sx, sy, sz, srx, sry] = grip.sleeve; g.add(mbox(sw, sh, sd, col.sleeve, sx, sy, sz, srx, sry)); }
    else g.add(mbox(0.078, 0.078, 0.34, col.sleeve, 0.05, -0.16, 0.2, 0.7, -0.25));
    if (type === 'rifle' || type === 'sniper' || type === 'smg' || type === 'shotgun') {
      const hz = type === 'smg' ? -0.2 : type === 'sniper' ? -0.3 : -0.33;
      g.add(mbox(0.055, 0.07, 0.1, col.glove, -0.005, -0.015, hz));
      g.add(mbox(0.08, 0.08, 0.24, col.sleeve, -0.07, -0.12, hz + 0.1, 1.05, 0.55));
    } else if (type === 'pistol') {
      g.add(mbox(0.05, 0.08, 0.07, col.glove, -0.03, -0.06, 0.015, -0.3, 0.3));
      g.add(mbox(0.078, 0.078, 0.34, col.sleeve, -0.13, -0.14, 0.17, 0.4, 0.55));
    } else if (type === 'c4') {
      g.add(mbox(0.05, 0.08, 0.08, col.glove, -0.09, -0.03, 0.02));
      g.add(mbox(0.078, 0.078, 0.34, col.sleeve, -0.15, -0.12, 0.2, 0.45, 0.25));
    }
    g.userData.gun = gun;
    g.userData.lay = lay;
    g.userData.type = type;
    g.visible = false;
    g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    this.root.add(g);
    return g;
  }

  setWeapon(wid, deploy = 0.5, now = performance.now() / 1000) {
    if (this.wid === wid) return;
    this.wid = wid;
    if (this.cur) this.cur.visible = false;
    const key = wid === 'knife' ? 'knife:' + this.knifeSkin : wid;
    let g = this.cache.get(key);
    if (!g) { g = this.build(wid); this.cache.set(key, g); }
    this.cur = g;
    g.visible = true;
    if (this.flash.parent) this.flash.parent.remove(this.flash);
    g.userData.gun.add(this.flash);
    this.flash.position.copy(g.userData.gun.userData.muzzle || new THREE.Vector3());
    this.drawStart = now;
    this.drawDur = deploy;
    this.reloadDur = 0;
    this.knifeT = -1;
    this.inspectT = -1;
    this.throwT = -1;
  }

  // 当前拿的是有花式动作的刀
  knifeFx() { return !!(this.cur && this.cur.userData.gun.userData.kfx); }

  onFire(now, strength = 1) {
    this.boltK = 1;
    this.kick = Math.min(1.6, this.kick + strength);
    this.flashT = now + 0.045;
    this.flash.material.rotation = Math.random() * Math.PI * 2;
    const s = 0.12 + Math.random() * 0.1;
    this.flash.scale.set(s, s, 1);
    this.inspectT = -1;
  }
  onReload(now, dur) { this.reloadStart = now; this.reloadDur = dur; this.inspectT = -1; }
  cancelReload() { this.reloadDur = 0; }
  onKnife(now, stab) { this.knifeT = now; this.knifeStab = stab; this.inspectT = -1; }
  onInspect(now) { if (this.reloadDur === 0) this.inspectT = now; }
  onThrow(now) { this.throwT = now; }
  onLand(v) { this.landKick = Math.min(1, v / 10); }

  // st: {now, speed, onGround, crouch, mdx, mdy, scoped, suppressed, silenced}
  update(dt, st) {
    const g = this.cur;
    if (!g) return;
    const now = st.now;
    this.t += dt;
    g.visible = !st.scoped && !st.hidden;
    const lay = g.userData.lay;
    const sp = clamp(st.speed / 6, 0, 1.2);
    if (st.onGround && sp > 0.05) this.bobT += dt * (5 + sp * 6);
    const bx = Math.sin(this.bobT) * 0.011 * sp;
    const by = -Math.abs(Math.cos(this.bobT)) * 0.012 * sp;
    this.swayX += (clamp(-st.mdx * 0.00045, -0.05, 0.05) - this.swayX) * Math.min(1, dt * 9);
    this.swayY += (clamp(-st.mdy * 0.00045, -0.05, 0.05) - this.swayY) * Math.min(1, dt * 9);
    this.kick *= Math.exp(-dt * 13);
    this.landKick *= Math.exp(-dt * 9);
    const idle = Math.sin(this.t * 1.4) * 0.0025;

    let px = lay.pos[0] + bx - this.swayX * 0.6, py = lay.pos[1] + by + idle - this.landKick * 0.03 - (st.crouch ? 0.008 : 0), pz = lay.pos[2];
    let rx = lay.rot[0] + this.swayY * 0.8, ry = lay.rot[1] + this.swayX, rz = lay.rot[2] + bx * 2;

    const type = g.userData.type;
    const kfx = g.userData.gun.userData.kfx;
    const kickZ = type === 'sniper' ? 0.07 : type === 'pistol' ? 0.035 : type === 'shotgun' ? 0.07 : 0.028;
    const kickR = type === 'sniper' ? 0.18 : type === 'pistol' ? 0.16 : type === 'shotgun' ? 0.2 : 0.06;
    pz += this.kick * kickZ;
    rx += this.kick * kickR;

    // 拔枪（特殊刀有自己的切刀动作，在后面）
    if (this.drawDur > 0 && !kfx) {
      const p = clamp((now - this.drawStart) / this.drawDur, 0, 1);
      const e = 1 - Math.pow(1 - p, 3);
      py -= (1 - e) * 0.22;
      rx -= (1 - e) * 0.7;
    }
    // 换弹
    const gun = g.userData.gun;
    const mag = gun.userData.mag;
    if (mag && mag.userData.base === undefined) mag.userData.base = mag.position.clone();
    // 高精度模型：左手跟着弹匣走（从护木挪到弹匣上，抽出旧的、插上新的，再回到护木）
    const lh = g.userData.hands ? g.userData.hands.userData.lh : null;
    if (this.reloadDur > 0) {
      const p = clamp((now - this.reloadStart) / this.reloadDur, 0, 1);
      const s = Math.sin(p * Math.PI);
      rx -= s * 0.35;
      rz += s * 0.45;
      py -= s * 0.04;
      const out = p < 0.2 ? p / 0.2 : p < 0.55 ? 1 : p < 0.75 ? 1 - (p - 0.55) / 0.2 : 0;
      if (mag) {
        mag.position.copy(mag.userData.base);
        mag.position.y -= out * 0.18;
        mag.visible = !(p > 0.3 && p < 0.5);
      }
      if (lh) {
        const to = sstep(seg(p, 0.02, 0.16)) * (1 - sstep(seg(p, 0.78, 0.96))); // 手挪到弹匣上的程度
        lh.position.set(0.012 * to, -0.165 * to - out * 0.18, 0.105 * to);
      }
      if (p >= 1) this.reloadDur = 0;
    } else {
      if (mag) { mag.position.copy(mag.userData.base); mag.visible = true; }
      if (lh) lh.position.set(0, 0, 0);
    }
    // 枪机：开一枪往后一缩再弹回去
    const bolt = gun.userData.bolt;
    if (bolt) {
      this.boltK *= Math.exp(-dt * 26);
      bolt.position.z = this.boltK * 0.05;
    }
    // 挥刀
    if (this.knifeT >= 0) {
      const dur = this.knifeStab ? 0.55 : 0.32;
      const p = (now - this.knifeT) / dur;
      if (p >= 1) this.knifeT = -1;
      else if (kfx && KNIFE_FX[kfx.kind].attack) {
        const o = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 };
        KNIFE_FX[kfx.kind].attack(this.knifeStab, p, o);
        px += o.px; py += o.py; pz += o.pz; rx += o.rx; ry += o.ry; rz += o.rz;
      } else {
        const s = Math.sin(p * Math.PI);
        if (this.knifeStab) { pz -= s * 0.12; rx -= s * 0.5; }
        else { ry += s * 1.1 - 0.4 * s; rz -= s * 0.9; px -= s * 0.1; }
      }
    }
    // 投掷
    if (this.throwT >= 0) {
      const p = (now - this.throwT) / 0.4;
      if (p >= 1) this.throwT = -1;
      else { const s = Math.sin(p * Math.PI); pz -= s * 0.1; py += s * 0.08; rx -= s * 0.9; }
    }
    // 检视
    if (this.inspectT >= 0) {
      const p = (now - this.inspectT) / (kfx ? KNIFE_FX[kfx.kind].inspect.dur : 2.6);
      if (p >= 1) this.inspectT = -1;
      else if (!kfx) {
        const s = Math.sin(Math.min(1, p * 2.2) * Math.PI / 2) * (p > 0.8 ? (1 - p) / 0.2 : 1);
        ry -= s * 1.1;
        rz += s * 0.5;
        px -= s * 0.05;
        py += s * 0.03;
      }
    }
    // 特殊刀：切刀 / 检视的花式动作 + 音效
    if (kfx) {
      const F = KNIFE_FX[kfx.kind];
      let mode = null, e = 0;
      const de = now - this.drawStart;
      if (this.drawDur > 0 && de < F.draw.dur) {
        // 从下面抬上来（挥刀打断时也照样抬）
        const r = eOut(seg(de, 0, 0.16));
        py -= (1 - r) * 0.2;
        rx -= (1 - r) * 0.6;
        if (this.knifeT < 0) { mode = 'draw'; e = de; }
      }
      if (!mode && this.inspectT >= 0) { mode = 'inspect'; e = now - this.inspectT; }
      F.parts(kfx, mode, e);
      if (mode) {
        const M = F[mode];
        const w = mode === 'draw' ? 1 - backOut(seg(e, M.back[0], M.back[1])) : sstep(seg(e, 0, 0.3)) * (1 - sstep(seg(e, M.back[0], M.back[1])));
        const Wp = (F.wrist && F.wrist[mode]) || WRIST;
        ry += w * Wp.ry; rz += w * Wp.rz; rx += w * Wp.rx;
        px += w * Wp.px; py += w * Wp.py; pz += w * Wp.pz;
        if (F.pose) {
          const o = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 };
          F.pose(mode, e, o);
          px += o.px; py += o.py; pz += o.pz; rx += o.rx; ry += o.ry; rz += o.rz;
        }
        const key = mode + (mode === 'draw' ? this.drawStart : this.inspectT);
        if (key !== this.kfxKey) { this.kfxKey = key; this.kfxLast = -1; }
        for (const ev of M.ev) {
          if (ev.t <= this.kfxLast || ev.t > e) continue;
          if (this.sfx && g.visible) this.sfx(ev.k);
          if (ev.k === 'kn_clack' || ev.k === 'kn_catch') this.joltT = now;
        }
        this.kfxLast = e;
      } else this.kfxKey = '';
      // 刀柄拍合 / 接住刀的那一下，手上轻轻一震
      const j = Math.exp(-(now - this.joltT) / 0.05);
      if (j > 0.01) { py -= j * 0.006; rx += j * 0.05; }
    }
    g.position.set(px, py, pz);
    g.rotation.set(rx, ry, rz);
    this.flash.visible = now < this.flashT && !st.silenced;
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  // 枪口在主场景中的世界坐标（用于曳光弹起点）
  muzzleWorld(mainCam, out) {
    const g = this.cur;
    if (!g) return out.copy(mainCam.position);
    const m = g.userData.gun.userData.muzzle || new THREE.Vector3();
    out.copy(m);
    g.userData.gun.localToWorld(out);
    // 视图模型场景坐标 -> 相机空间 -> 主场景
    this.camera.worldToLocal(out);
    out.z *= 1.0;
    return out.applyMatrix4(mainCam.matrixWorld);
  }
}
