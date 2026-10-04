// 第一人称武器（独立场景渲染，不会穿墙），含晃动、后坐、切枪 / 拉栓 / 换弹、挥刀、检视动画
import * as THREE from 'three';
import { makeWeapon, armColors } from './models.js';
import { HD, hdHands, hdOffHand, handPose, HAND_SHAPES } from './hdmodels.js';
import { viewEnv } from './hdkit.js';
import { flare } from './textures.js';
import { WEAPONS } from '../shared/weapons.js';
import { clamp } from '../shared/util.js';
import { clipFor, sample, KNIFE_FX, KNIFE_POSES, KNIFE_HIT, seg, eOut, sstep, easeOf } from './vmanims.js';

// 摆位的朝向：dir = 枪口 / 刀尖朝哪，face = 模型右侧面（+X）朝哪（都是相机坐标；face 会自动修正成和 dir 垂直）
// 刀也可以不写 face，改写 elbow（手肘大概在哪）：由握法算出刀该绕自己转到什么角度（见 elbowQuat）
function aim(dir, face) {
  const z = new THREE.Vector3(...dir).normalize().negate();
  const x = new THREE.Vector3(...face);
  x.addScaledVector(z, -x.dot(z)).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, new THREE.Vector3().crossVectors(z, x), z));
}
const layQ = (l) => l.q || (l.q = l.dir ? aim(l.dir, l.face) : new THREE.Quaternion().setFromEuler(new THREE.Euler(...l.rot)));

// 各类武器在画面里的位置（相机坐标：右、上、后）。rot 是转角，或者用 dir / face 直接写朝向；bob：走路晃动的幅度
const LAYOUT = {
  rifle: { pos: [0.19, -0.19, -0.36], rot: [0.02, 0.06, 0] },
  sniper: { pos: [0.19, -0.195, -0.34], rot: [0.02, 0.05, 0] },
  smg: { pos: [0.17, -0.17, -0.36], rot: [0.02, 0.07, 0] },
  shotgun: { pos: [0.19, -0.19, -0.35], rot: [0.02, 0.06, 0] },
  pistol: { pos: [0.15, -0.16, -0.4], rot: [0.02, 0.1, 0] },
  grenade: { pos: [0.16, -0.16, -0.36], rot: [0.2, 0.2, 0] },
  c4: { pos: [0.03, -0.24, -0.42], rot: [0.6, 0, 0] },
  // 刀照 CS:GO 的拿法：拳头在画面右下、手背对着自己，刀身朝左前方斜着指出去（刀面朝上对着镜头，刀背靠近自己）
  knife: { pos: [0.127, -0.097, -0.26], dir: [-0.86, 0.3, -0.41], face: [-0.1, 0.8, 0.59], scale: 1.15, bob: 0.7 },
  // 剥皮小刀照瓦罗兰特的拿法：刀立得更直，在画面右侧。朝向用「刀尖朝哪 + 手肘在哪」来写（和 KNIFE_POSES 一样）：
  // 刀要立起来、小臂又要从右下方伸上来，看到的就是握刀的手指这一面（要是让手背对着自己，小臂只能从左下方来，像左手）
  knife_xeno: { pos: [0.21, -0.215, -0.38], dir: [-0.58, 0.66, -0.48], elbow: [0.667, -0.281, -0.52], scale: 1.15, bob: 0.7 },
  // 爪子刀照 CS2 的拿法：刀面对着屏幕，刀环在拳头左边，弯刀从右边伸出来往上弯
  knife_karambit: { pos: [0.1, -0.112, -0.33], rot: [0.06, -0.08, 0.06], scale: 1.08, bob: 0.8 },
};
// 开枪时枪身的后坐（每类枪），照 CS:GO 的样子逐帧量出来调的：
//   back  顶到头（rk = 1）时整把枪挪多少 [右, 上, 后]（米）：枪是从右下角伸出来的，所以往后顶看起来是往右下滑、变大
//   pitch 顶到头时枪口上抬多少（弧度）
//   hit   每一枪瞬间顶多少；kick 再带着往后冲的速度；max 连射时最多顶到多少
//   w     回位的快慢：步枪一枪顶到头、停火后约 0.3 秒回位；狙击枪是 0.1 秒冲到最高、半秒才落回来
//   yaw / roll / x 每一枪随机的左右晃、侧倾、横移（每枪都不一样，才有「抖」的感觉）
export const RECOIL = {
  rifle: { back: [0.045, 0.012, 0.2], pitch: 0.02, hit: 0.65, kick: 8, max: 1, w: 17, yaw: 0.02, roll: 0.035, x: 0.004 },
  smg: { back: [0.032, 0.008, 0.14], pitch: 0.02, hit: 0.65, kick: 7, max: 1, w: 19, yaw: 0.016, roll: 0.03, x: 0.003 },
  pistol: { back: [0.01, 0.012, 0.09], pitch: 0.2, hit: 0.55, kick: 10, max: 1.15, w: 15, yaw: 0.02, roll: 0.04, x: 0.003 },
  sniper: { back: [0.02, 0.03, 0.17], pitch: 0.14, hit: 0.12, kick: 22, max: 1.3, w: 9, yaw: 0.02, roll: 0.05, x: 0.004 },
  shotgun: { back: [0.03, 0.025, 0.17], pitch: 0.16, hit: 0.3, kick: 20, max: 1.3, w: 11, yaw: 0.03, roll: 0.06, x: 0.005 },
};
// 刀在手里的摆法（相对手的位置）：爪子刀横着握，刀柄穿过拳头
const GRIP = { karambit: { rot: [0, -Math.PI / 2, 0], pos: [0.02, -0.03, 0.03] } };

const T1 = new THREE.Vector3(), T2 = new THREE.Vector3(), EU = new THREE.Euler(), QD = new THREE.Quaternion(), QP = new THREE.Quaternion();
const PV = new THREE.Vector3(), QT = new THREE.Quaternion();
const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

// 刀的一个姿势（vmanims.js 里的 KNIFE_POSES）算成位置 + 朝向。'idle' 是平时的拿法。
// 朝向 = 刀尖朝 dir，再绕刀身转到「小臂正好朝着 elbow 那边伸过去」（U.elbowAng：手肘在这把刀自己坐标里的方位）
function elbowQuat(ang, sp) {
  const z = v3(sp.dir).normalize().negate(), f = v3(sp.elbow).sub(v3(sp.pos));
  f.addScaledVector(z, -f.dot(z)).normalize();
  const x = f.clone().multiplyScalar(Math.cos(ang)).addScaledVector(new THREE.Vector3().crossVectors(z, f), -Math.sin(ang));
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, new THREE.Vector3().crossVectors(z, x), z));
}
function knifePose(U, name) {
  let c = U.kpose[name];
  if (c) return c;
  if (name === 'idle') c = { p: v3(U.lay.pos), q: U.lay.q };
  else c = { p: v3(KNIFE_POSES[name].pos), q: elbowQuat(U.elbowAng, KNIFE_POSES[name]) };
  return (U.kpose[name] = c);
}
// 姿势轨道 [[时刻, 姿势名, 缓动?]…] 在 t 时刻的位置（写进 P）和朝向（写进 Q）
function poseAt(U, track, t, P, Q) {
  let i = 1;
  while (i < track.length - 1 && t >= track[i][0]) i++;
  const a = track[i - 1], b = track[i], pa = knifePose(U, a[1]), pb = knifePose(U, b[1]);
  const x = easeOf(b)(clamp((t - a[0]) / (b[0] - a[0]), 0, 1));
  P.lerpVectors(pa.p, pb.p, x);
  Q.copy(pa.q).slerp(pb.q, x);
}

export { KNIFE_FX };

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
    this.sfx = null; // 动作的音效回调（刀的花式动作、拉栓、换弹匣这些）
    this.kfxKey = ''; this.kfxLast = -1; this.joltT = -9;
    // 动作被打断（检视到一半挥刀、挥到一半又检视）时，从当时的姿势平滑接过去
    this.kbT = -9; this.kbP = new THREE.Vector3(); this.kbQ = new THREE.Quaternion();
    this.cache = new Map();
    this.cur = null;
    this.wid = null;
    this.t = 0;
    this.bobT = 0;
    this.rk = 0; this.rv = 0;             // 后坐：往后顶了多少（0~1 左右）、还在往后冲的速度
    this.jit = [0, 0, 0]; this.jitK = 0;  // 每一枪随机的左右晃 / 侧倾
    this.swayX = 0;
    this.swayY = 0;
    this.drawStart = 0; this.drawDur = 0;
    this.reloadStart = 0; this.reloadDur = 0;
    this.knifeT = -1; this.knifeStab = false; this.knifeAlt = false;
    this.inspectT = -1;
    this.throwT = -1;
    this.landKick = 0;
    this.flashT = 0;
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flare(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: 0xffe0a0 }));
    this.flash.visible = false;
    this.flash.scale.set(0.16, 0.16, 1);
    this.boltK = 0;      // 枪机后坐（开一枪弹回去）
    this.envFor = null;  // 环境反光是给哪个渲染器做的
    this.clip = null;    // 正在放的一段动作：{ def, kind, t0, dur, last }
    this.off = null;     // 拿刀时空着的左手
    // 这一帧各条轨道的值
    this.A = { g: [0, 0, 0, 0, 0, 0], mag: [0, 0, 0], lh: [0, 0, 0], magHide: false, lhHide: false, bolt: 0, boltUp: 0, pump: 0, pin: 0, lhMag: 0, lhBolt: 0, rhBolt: 0 };
    this.O = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, hand0: null, hand: null, handW: 0 };
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
    if (this.off) { this.root.remove(this.off); this.off = null; }
    const w = this.wid;
    this.wid = null;
    this.cur = null;
    if (w) this.setWeapon(w, 0);
  }

  build(wid) {
    const w = WEAPONS[wid];
    const type = w ? (w.type === 'grenade' ? 'grenade' : w.type) : 'knife';
    const lay = (HD[wid] && HD[wid].lay) || (wid === 'knife' && LAYOUT['knife_' + this.knifeSkin]) || LAYOUT[type] || LAYOUT.rifle;
    if (!lay.elbow) layQ(lay); // 写了 elbow 的摆法（刀）要等知道握法之后再算朝向
    const g = new THREE.Group(), U = g.userData;
    if (lay.scale) g.scale.setScalar(lay.scale);
    const gun = makeWeapon(wid, false, wid === 'knife' ? this.knifeSkin : null);
    const grip = wid === 'knife' && GRIP[this.knifeSkin];
    if (grip) { gun.rotation.set(...grip.rot); gun.position.set(...grip.pos); }
    g.add(gun);
    // 带手指的手（按这把武器的握法摆好姿势）
    const pose = handPose(wid, type, this.knifeSkin);
    const hands = hdHands(pose, armColors(this.team));
    if (hands) g.add(hands);
    const H = hands ? hands.userData : {}, P = gun.userData;
    Object.assign(U, { gun, lay, type, wid, hands, rh: H.rh || null, lh: H.lh || null, lhM: H.lhM || null, lhB: H.lhB || null, rhB: H.rhB || null,
      mag: P.mag || null, bolt: P.bolt || null, pump: P.pump || null, pin: P.pin || null });
    // 会动的零件：记下原来的位置
    for (const k of ['mag', 'bolt', 'pump', 'pin']) if (U[k]) { U[k].userData.base = U[k].position.clone(); U[k].userData.rx0 = U[k].rotation.x; }
    for (const k of ['lhM', 'lhB', 'rhB']) if (U[k]) U[k].visible = false;
    // 拿刀的右手手指会动；刀的姿势按「手肘在哪」来摆（见 knifePose）
    U.rig = (U.rh && U.rh.userData.rig) || null;
    U.kpose = {};
    if (pose && pose.right) { U.shape0 = pose.right.pose; U.elbowAng = Math.atan2(pose.right.elbow[1], pose.right.elbow[0]); }
    if (lay.elbow && !lay.q) lay.q = elbowQuat(U.elbowAng, lay);
    U.travel = P.boltTravel ?? 0.05;     // 枪机 / 套筒能拉开多远
    U.kickBolt = P.boltKick ?? (P.manual ? 0 : U.travel * 0.8); // 开枪时自己往后弹多少（栓动的不弹）
    U.lift = P.boltLift ?? 0;            // 栓动步枪：拉机柄抬起的角度
    U.pumpTravel = P.pumpTravel ?? 0.07;
    // 手要去的地方（枪的坐标）。左手：平时握的地方 lhG、弹匣 magAt、拉机柄 boltAt；右手：握把 rhG、拉机柄 knobAt
    if (pose) {
      U.lhG = pose.left ? v3(pose.left.grip) : pose.leftAct ? v3(pose.leftAct.grip) : null;
      U.boltAt = pose.leftAct ? v3(pose.leftAct.grip) : null;
      U.rhG = v3(pose.right.grip);
      U.knobAt = pose.rightAct ? v3(pose.rightAct.grip) : null;
      if (pose.leftMag) U.magAt = v3(pose.leftMag.grip);
      else if (U.mag && pose.left) {
        // 没有专门的拿弹匣姿势：就用托枪的手挪到弹匣下半截
        const b = new THREE.Box3().setFromObject(U.mag), c = b.getCenter(new THREE.Vector3());
        U.magAt = new THREE.Vector3(c.x, Math.max(b.min.y + 0.03, c.y - 0.05), c.z);
        if (U.magAt.distanceTo(U.lhG) > 0.3) U.magAt.sub(U.lhG).setLength(0.3).add(U.lhG);
      } else if (P.port && pose.left) U.magAt = v3(P.port); // 霰弹枪：装弹口
      if (U.knobAt && U.bolt) U.knobR = U.knobAt.clone().sub(U.bolt.userData.base).setZ(0); // 拉机柄头到枪机轴线
    }
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
    this.boltK = 0;
    this.rk = this.rv = this.jitK = 0;
    g.userData.pinGone = false;
    // 切出来的动作：时间太短（刚出生、切换观战对象）就只是抬上来
    this.clip = null;
    if (deploy > 0 && !g.userData.gun.userData.kfx) this.play(deploy < 0.45 ? clipFor('', 'draw') : clipFor(wid, 'draw'), 'draw', now, deploy);
  }

  play(def, kind, t0, dur) { this.clip = def ? { def, kind, t0, dur, last: -1 } : null; }

  // 提前把一把武器的模型搭好（搭一把要几十毫秒，放在不打紧的时候做，免得第一次切出来时卡一下）。返回是不是真的搭了
  warm(wid) {
    const key = wid === 'knife' ? 'knife:' + this.knifeSkin : wid;
    if (this.cache.has(key)) return false;
    this.cache.set(key, this.build(wid));
    return true;
  }

  // 当前拿的是有花式动作的刀
  knifeFx() { return !!(this.cur && this.cur.userData.gun.userData.kfx); }

  onFire(now, strength = 1) {
    this.boltK = 1;
    // 后坐：瞬间往后一顿，再带着往后冲一小段（之后弹簧把它拉回来）；每一枪随机晃一个方向
    const R = this.cur && RECOIL[this.cur.userData.type];
    if (R) { this.rk = Math.min(R.max, this.rk + R.hit * strength); this.rv += R.kick * strength; }
    this.jit[0] = Math.random() * 2 - 1; this.jit[1] = Math.random(); this.jit[2] = Math.random() * 2 - 1;
    this.jitK = 1;
    this.flashT = now + 0.045;
    this.flash.material.rotation = Math.random() * Math.PI * 2;
    const s = 0.12 + Math.random() * 0.1;
    this.flash.scale.set(s, s, 1);
    this.inspectT = -1;
    // 栓动步枪、泵动霰弹枪：开完一枪要拉一下
    const c = clipFor(this.wid, 'cycle'), w = WEAPONS[this.wid];
    if (c && w && w.rpm) this.play(c, 'cycle', now + c.delay, (60 / w.rpm) * c.frac);
    else if (this.clip && this.clip.kind === 'draw') this.clip = null;
  }
  onReload(now, dur) {
    this.reloadStart = now; this.reloadDur = dur; this.inspectT = -1;
    this.play(clipFor(this.wid, 'reload'), 'reload', now, dur);
  }
  cancelReload() {
    this.reloadDur = 0;
    if (this.clip && this.clip.kind === 'reload') this.clip = null;
  }
  onKnife(now, stab) { this.blendFrom(now); this.knifeT = now; this.knifeStab = stab; if (!stab) this.knifeAlt = !this.knifeAlt; this.inspectT = -1; }
  onInspect(now) { if (this.reloadDur === 0 && !this.clip) { this.blendFrom(now); this.inspectT = now; } }
  // 刀：记下现在的姿势，新动作从这里平滑接过去
  blendFrom(now) {
    const g = this.cur;
    if (!g || !g.userData.gun.userData.kfx) return;
    this.kbT = now; this.kbP.copy(g.position); this.kbQ.copy(g.quaternion);
  }
  onThrow(now) { this.throwT = now; }
  onLand(v) { this.landKick = Math.min(1, v / 10); }
  // 手雷：拔拉环
  onPin(now) {
    const c = clipFor(this.wid, 'pin');
    if (c && this.cur && !this.cur.userData.pinGone) this.play(c, 'pin', now, c.dur);
  }

  // st: {now, speed, onGround, crouch, mdx, mdy, scoped, hidden, silenced, punchP, punchY（后坐力让准星偏了多少，可以不给）}
  update(dt, st) {
    const g = this.cur;
    if (!g) return;
    const U = g.userData, now = st.now, lay = U.lay, type = U.type, gun = U.gun;
    this.t += dt;
    g.visible = !st.scoped && !st.hidden;
    const bob = lay.bob ?? 1;
    const sp = clamp(st.speed / 6, 0, 1.2);
    if (st.onGround && sp > 0.05) this.bobT += dt * (5 + sp * 6);
    const bx = Math.sin(this.bobT) * 0.011 * sp * bob;
    const by = -Math.abs(Math.cos(this.bobT)) * 0.012 * sp * bob;
    this.swayX += (clamp(-st.mdx * 0.00045, -0.05, 0.05) - this.swayX) * Math.min(1, dt * 9);
    this.swayY += (clamp(-st.mdy * 0.00045, -0.05, 0.05) - this.swayY) * Math.min(1, dt * 9);
    // 后坐的弹簧（不来回弹）：顶上去之后平滑地落回原位
    const R = RECOIL[type], rw = R ? R.w : 17;
    for (let n = Math.max(1, Math.ceil(dt / 0.006)), h = dt / n; n > 0; n--) {
      this.rv += (-rw * rw * this.rk - 2 * rw * this.rv) * h;
      this.rk += this.rv * h;
    }
    this.jitK *= Math.exp(-dt * 15);
    this.landKick *= Math.exp(-dt * 9);
    const idle = Math.sin(this.t * 1.4) * 0.0025 * bob;

    // 位置是相机坐标里的绝对位置；转角是叠在平时拿法上面的偏转（抬头、左转、逆时针侧倾）
    let px = lay.pos[0] + bx - this.swayX * 0.6 * bob, py = lay.pos[1] + by + idle - this.landKick * 0.03 - (st.crouch ? 0.008 : 0), pz = lay.pos[2];
    let rx = this.swayY * 0.8, ry = this.swayX, rz = bx * 2;

    if (R) {
      const j = this.jitK;
      px += this.rk * R.back[0]; py += this.rk * R.back[1]; pz += this.rk * R.back[2]; rx += this.rk * R.pitch;
      px += this.jit[0] * j * R.x; ry += this.jit[0] * j * R.yaw; rz += this.jit[2] * j * R.roll;
      // 连射时枪口跟着后坐力往上抬、往两边偏（和准星实际偏的方向一致）
      rx += clamp((st.punchP || 0) * 0.4, -0.03, 0.12);
      ry += clamp((st.punchY || 0) * 0.4, -0.07, 0.07);
    }

    // ---- 正在放的动作（切枪 / 换弹 / 拉栓 / 拔拉环）：算出这一帧各条轨道的值 ----
    const A = this.A;
    A.g.fill(0); A.mag.fill(0); A.lh.fill(0);
    A.magHide = A.lhHide = false; A.bolt = A.boltUp = A.pump = A.pin = A.lhMag = A.lhBolt = A.rhBolt = 0;
    const C = this.clip;
    if (C) {
      const u = (now - C.t0) / C.dur, d = C.def;
      if (u >= 1) {
        this.clip = null;
        if (C.kind === 'reload') this.reloadDur = 0;
        if (C.kind === 'pin') U.pinGone = true;
      } else if (u >= 0) {
        if (d.g) sample(d.g, u, A.g);
        if (d.mag) sample(d.mag, u, A.mag);
        if (d.lh) sample(d.lh, u, A.lh);
        if (d.magOff) A.magHide = u > d.magOff[0] && u < d.magOff[1];
        if (d.lhOff) for (const w of d.lhOff) if (u > w[0] && u < w[1]) A.lhHide = true;
        if (d.bolt) A.bolt = sample(d.bolt, u);
        if (d.boltUp) A.boltUp = sample(d.boltUp, u);
        if (d.pump) A.pump = sample(d.pump, u);
        if (d.pin) A.pin = sample(d.pin, u);
        if (d.lhMag) A.lhMag = sample(d.lhMag, u);
        if (d.lhBolt) A.lhBolt = sample(d.lhBolt, u);
        if (d.rhBolt) A.rhBolt = sample(d.rhBolt, u);
        if (d.ev) for (const [t, k] of d.ev) if (t > C.last && t <= u && this.sfx && g.visible) this.sfx(k);
        C.last = u;
        px += A.g[0]; py += A.g[1]; pz += A.g[2]; rx += A.g[3]; ry += A.g[4]; rz += A.g[5];
      }
    }

    if (this.reloadDur > 0 && now - this.reloadStart >= this.reloadDur) this.reloadDur = 0; // 换弹动作被别的动作顶掉了也要算换完

    // ---- 会动的零件 ----
    const mag = U.mag, bolt = U.bolt;
    if (mag) {
      const b = mag.userData.base;
      mag.position.set(b.x, b.y + A.mag[0], b.z + A.mag[1]);
      mag.rotation.x = mag.userData.rx0 + A.mag[2];
      mag.visible = !A.magHide;
    }
    this.boltK *= Math.exp(-dt * 26);
    const boltZ = A.bolt * U.travel + this.boltK * U.kickBolt, lift = A.boltUp * U.lift;
    if (bolt) { bolt.position.z = bolt.userData.base.z + boltZ; bolt.rotation.z = lift; }
    const pumpZ = A.pump * U.pumpTravel;
    if (U.pump) U.pump.position.z = U.pump.userData.base.z + pumpZ;
    if (U.pin) {
      const b = U.pin.userData.base;
      U.pin.visible = !U.pinGone;
      U.pin.position.set(b.x + (A.pin > 0 ? A.lh[0] : 0), b.y + (A.pin > 0 ? A.lh[1] : 0), b.z + (A.pin > 0 ? A.lh[2] : 0));
    }

    // ---- 两只手：算出手现在握着的那个点，把对应姿势的那只手挪过去 ----
    const put = (grp, on, home) => { if (grp) { grp.visible = on; if (on) grp.position.subVectors(T1, home); } };
    if (U.lhG) {
      const wM = U.magAt ? A.lhMag : 0, wB = U.lhB ? A.lhBolt : 0;
      T1.copy(U.lhG);
      if (wM > 0) T1.addScaledVector(T2.subVectors(U.magAt, U.lhG).add(v0(0, A.mag[0], A.mag[1])), wM);
      if (wB > 0) T1.addScaledVector(T2.subVectors(U.boltAt, U.lhG).add(v0(0, 0, boltZ)), wB);
      T1.x += A.lh[0]; T1.y += A.lh[1]; T1.z += A.lh[2] + (U.pump ? pumpZ * (1 - wM) : 0); // 霰弹枪：左手一直握着护木
      const useB = wB > 0.5, useM = !useB && wM > 0.5 && !!U.lhM;
      put(U.lh, !useB && !useM && !A.lhHide, U.lhG);
      put(U.lhM, useM && !A.lhHide, U.magAt);
      put(U.lhB, useB && !A.lhHide, U.boltAt);
    }
    if (U.rhB) {
      const wB = A.rhBolt;
      T1.copy(U.rhG);
      if (wB > 0) {
        // 拉机柄头：绕枪机轴线抬起来，再跟着枪机往后
        const r = U.knobR, c = Math.cos(lift), s = Math.sin(lift);
        T2.subVectors(U.knobAt, U.rhG);
        if (r) { T2.x += r.x * c - r.y * s - r.x; T2.y += r.x * s + r.y * c - r.y; }
        T2.z += boltZ;
        T1.addScaledVector(T2, wB);
      }
      put(U.rh, wB <= 0.5, U.rhG);
      put(U.rhB, wB > 0.5, U.knobAt);
    }

    // 投掷
    if (this.throwT >= 0) {
      const p = (now - this.throwT) / 0.4;
      if (p >= 1) { this.throwT = -1; U.pinGone = false; } // 扔出去了：手里换成下一颗（拉环还在）
      else { const s = Math.sin(p * Math.PI); pz -= s * 0.1; py += s * 0.08; rx -= s * 0.9; }
    }

    // ---- 刀：切刀 / 检视的花式动作、挥刀 ----
    const kfx = gun.userData.kfx, o = this.O;
    let rise = 1;
    QP.copy(lay.q);
    if (kfx) {
      const F = KNIFE_FX[kfx.kind];
      o.px = o.py = o.pz = o.rx = o.ry = o.rz = o.handW = 0;
      o.hand0 = o.hand = null;
      let mode = null, e = 0;
      const de = now - this.drawStart;
      if (this.drawDur > 0 && de < F.draw.dur) {
        // 从下面抬上来（挥刀打断时也照样抬）
        rise = eOut(seg(de, 0, 0.18));
        py -= (1 - rise) * 0.22;
        rx -= (1 - rise) * 0.4;
        if (this.knifeT < 0) { mode = 'draw'; e = de; }
      }
      if (!mode && this.inspectT >= 0) {
        e = now - this.inspectT;
        if (e >= F.inspect.dur) this.inspectT = -1; else mode = 'inspect';
      }
      F.anim(kfx, mode, e, o);
      let track = mode ? F[mode].pose : null, tt = e; // 这一帧整只手的姿势照哪条轨道摆
      if (mode) {
        const key = mode + (mode === 'draw' ? this.drawStart : this.inspectT);
        if (key !== this.kfxKey) { this.kfxKey = key; this.kfxLast = -1; }
        for (const [t, k] of F[mode].ev) {
          if (t <= this.kfxLast || t > e) continue;
          if (this.sfx && g.visible) this.sfx(k);
          if (k === 'kn_clack' || k === 'kn_catch') this.joltT = now;
        }
        this.kfxLast = e;
      } else this.kfxKey = '';
      if (this.knifeT >= 0) {
        const p = (now - this.knifeT) / (this.knifeStab ? 0.55 : 0.4);
        if (p >= 1) this.knifeT = -1;
        else {
          o.hand = null; // 挥刀时一定是握紧的
          if (F.attack) F.attack(this.knifeStab, p, o);
          else { track = KNIFE_HIT[this.knifeStab ? 'stab' : this.knifeAlt ? 'back' : 'slash']; tt = p; }
        }
      }
      if (track) {
        poseAt(U, track, tt, PV, QP);
        px += PV.x - lay.pos[0]; py += PV.y - lay.pos[1]; pz += PV.z - lay.pos[2];
      }
      px += o.px; py += o.py; pz += o.pz; rx += o.rx; ry += o.ry; rz += o.rz;
      if (U.rig) U.rig.userData.setShape(HAND_SHAPES[o.hand0] || U.shape0, (o.hand && HAND_SHAPES[o.hand]) || U.shape0, o.hand ? o.handW : 0);
      // 刀柄拍合 / 接住刀的那一下，手上轻轻一震
      const j = now >= this.joltT ? Math.exp(-(now - this.joltT) / 0.05) : 0;
      if (j > 0.01) { py -= j * 0.006; rx += j * 0.05; }
    } else if (this.inspectT >= 0) {
      // 枪的检视：转过来看一眼侧面
      const p = (now - this.inspectT) / 2.6;
      if (p >= 1) this.inspectT = -1;
      else {
        const s = Math.sin(Math.min(1, p * 2.2) * Math.PI / 2) * (p > 0.8 ? (1 - p) / 0.2 : 1);
        ry -= s * 1.1; rz += s * 0.5; px -= s * 0.05; py += s * 0.03;
      }
    }

    // ---- 摆到位：这一帧的姿势（枪是平时的拿法，刀可能正照着姿势轨道在动）上面再叠这一帧的偏转 ----
    g.position.set(px, py, pz);
    g.quaternion.copy(QD.setFromEuler(EU.set(rx, ry, rz))).multiply(QP);
    if (kfx && now >= this.kbT && now - this.kbT < 0.1) {
      const x = sstep((now - this.kbT) / 0.1);
      g.position.lerpVectors(this.kbP, PV.copy(g.position), x);
      g.quaternion.copy(QT.copy(this.kbQ).slerp(g.quaternion, x));
    }
    this.flash.visible = now < this.flashT && !st.silenced;

    // ---- 拿刀时空着的左手：张开放在画面左下 ----
    const offOn = type === 'knife' && g.visible && !this.noOff;
    if (offOn && !this.off) {
      this.off = hdOffHand(armColors(this.team));
      this.off.traverse((m) => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; } });
      this.root.add(this.off);
    }
    if (this.off) {
      this.off.visible = offOn;
      if (offOn) {
        const hit = this.knifeT >= 0 ? Math.sin(clamp((now - this.knifeT) / 0.4, 0, 1) * Math.PI) : 0;
        this.off.position.set(bx * 0.6 - this.swayX * 0.4, by * 0.6 - idle - (1 - rise) * 0.16 - hit * 0.025 - this.landKick * 0.03, hit * 0.02);
        this.off.rotation.set(this.swayY * 0.5 - (1 - rise) * 0.3, this.swayX * 0.6, -bx * 1.5 - hit * 0.12);
      }
    }
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
    return out.applyMatrix4(mainCam.matrixWorld);
  }
}
const V0 = new THREE.Vector3();
function v0(x, y, z) { return V0.set(x, y, z); }
