// 高精度模型：第一人称的枪和握枪的手。
// 零件都是照真枪的大致尺寸自己搭出来的（见 hdkit.js），没有用任何游戏的模型或贴图。
import * as THREE from 'three';
import { Kit, arcPts, rrect } from './hdkit.js';
import { GUNS } from './hdguns.js';

const U = 0.00116; // 真枪的 1 毫米 = 模型里的这么多米（比真枪略大一点，第一人称里更饱满）
const YB = 0.045;  // 枪管轴线的高度（和旧模型一致，枪口火光、曳光弹的位置不用改）

// ============================== AK-47 ==============================
// 尺寸写的都是真枪上的毫米数：第一个数是离枪口多远，第二个数是比枪管轴线高多少
function ak47(k) {
  const wood = 'wood', woodD = 'woodD';
  const Z = (mm) => -0.72 + mm * U;
  const Y = (mm) => YB + mm * U;
  const P = (...pts) => pts.map(([a, b]) => [Z(a), Y(b)]);
  const X = (pts) => pts.map(([a, b]) => [a * U, Y(b)]); // 截面：左右多少毫米、比枪管轴线高多少

  // ---- 枪管、枪口 ----
  k.tube('blued', 7.6 * U, Z(6), Z(432), { y: YB });
  k.tube('blued', 11.2 * U, Z(0), Z(27), { y: YB, cut: ['lo', 0.7] }); // 斜口制退器：下面长、上面短
  k.ball('bore', 4.8 * U, 4.8 * U, 2.2 * U, new THREE.Matrix4().makeTranslation(0, YB, Z(0) + 0.0004));
  // ---- 准星座 ----
  k.tube('blued', 12.5 * U, Z(30), Z(70), { y: YB });
  k.prof('blued', P([36, 9], [66, 9], [61, 36], [45, 36]), 13 * U, { bevel: 0.0012 });
  k.box('blued', 19 * U, 3.4 * U, 20 * U, 0, Y(35), Z(53), { r: 0.0006 });
  for (const s of [-1, 1]) k.prof('blued', P([43, 34], [63, 34], [64, 48], [59, 59], [47, 59], [42, 48]), 2.4 * U, { x: s * 8.3 * U, bevel: 0.0004 });
  k.rod('blued', 1.5 * U, [0, Y(36), Z(53)], [0, Y(55), Z(53)]);
  k.fine(() => {
    k.box('blued', 8 * U, 7 * U, 14 * U, 0, Y(-15), Z(56), { r: 0.0008 });          // 刺刀座
    k.rod('steel', 2.4 * U, [0, Y(-12.5), Z(20)], [0, Y(-12.5), Z(262)]);         // 通条
    k.rod('steel', 3.4 * U, [0, Y(-12.5), Z(14)], [0, Y(-12.5), Z(21)]);
  });
  // ---- 导气箍、导气管 ----
  k.tube('blued', 11 * U, Z(190), Z(233), { y: YB });
  k.prof('blued', P([187, 4], [234, 4], [234, 37], [216, 37], [192, 16]), 17 * U, { bevel: 0.0018 });
  k.tube('steel', 8 * U, Z(232), Z(392), { y: Y(27) });
  k.tube('steel', 10.5 * U, Z(243), Z(252), { y: Y(27) });
  k.tube('steel', 10.5 * U, Z(384), Z(392), { y: Y(27) });
  // ---- 护木（木头）----
  k.sweep('blued', X([[-21, 8], [-21, -22], [-12, -27], [12, -27], [21, -22], [21, 8]]), Z(257), Z(268), { bevel: 0.001 }); // 前护木箍
  k.sweep(wood, X([[-19, 9], [-22.5, -2], [-23.5, -14], [-20, -26], [-12, -31], [12, -31], [20, -26], [23.5, -14], [22.5, -2], [19, 9]]), Z(268), Z(396), { bevel: 0.003 });
  k.sweep(wood, X([[-18, 10], [-19.5, 24], [-15, 36], [-7, 42], [7, 42], [15, 36], [19.5, 24], [18, 10]]), Z(252), Z(384), { bevel: 0.003 });
  // ---- 表尺座、表尺 ----
  k.prof('blued', P([386, -14], [452, -14], [452, 10], [436, 16], [398, 42], [386, 42]), 34 * U, { bevel: 0.002 });
  k.prof('steel', P([392, 43], [444, 39.5], [446, 43], [446, 46], [444, 46.5], [392, 46.5]), 15 * U, { bevel: 0.0008 });
  k.box('steel', 15 * U, 7 * U, 5 * U, 0, Y(48), Z(445), { r: 0.0005 });
  k.fine(() => k.box('blued', 19 * U, 5 * U, 8 * U, 0, Y(45), Z(420), { r: 0.0005 }));
  // ---- 机匣 ----
  k.prof('blued', P([430, -30], [436, -38], [694, -38], [702, -30], [702, 10], [430, 10]), 33 * U, { bevel: 0.0018 });
  k.fine(() => {
    for (const s of [-1, 1]) {
      // 弹匣井上方的冲压凹坑、铆钉
      k.prof('blued', rrect(Z(476), Y(-30), Z(538), Y(-12), 0.004), 1.2 * U, { x: s * 16.6 * U, bevel: 0.0005 });
      for (const [a, b] of [[440, 2], [449, -12], [440, -25], [680, 1], [692, -22], [590, -31], [560, 3]]) k.pin('steel', 1.9 * U, s * 16.2 * U, s * 17.5 * U, Y(b), Z(a));
    }
  });
  // ---- 机匣盖（拱形，带加强筋）----
  const arch = (r, h) => [[-r, 9], ...arcPts(0, 20, 1, Math.PI, 0, 9).map(([c, s2]) => [c * r, 20 + (s2 - 20) * h]), [r, 9]];
  k.sweep('blued', X(arch(16.5, 14.5)), Z(453), Z(699), { bevel: 0.001 });
  k.fine(() => {
    for (const a of [498, 538, 578, 618, 658]) k.sweep('blued', X(arch(17.3, 15.3)), Z(a), Z(a + 6), { bevel: 0.0007 });
    k.box('steel', 8 * U, 6 * U, 4 * U, 0, Y(22), Z(701), { r: 0.0005 }); // 机匣盖卡笋
  });
  // ---- 枪机、拉机柄（右边；开枪时会前后动）----
  k.group('bolt', () => {
    k.prof('bright', P([458, 10.5], [562, 10.5], [562, 23], [458, 23]), 3 * U, { x: 16.2 * U, bevel: 0.0006 });
    k.rod('bright', 4.2 * U, [17 * U, Y(13), Z(520)], [40 * U, Y(17), Z(523)], { r1: 4.9 * U });
    k.ball('bright', 5.2 * U, 5.2 * U, 5.2 * U, new THREE.Matrix4().makeTranslation(41 * U, Y(17.2), Z(523)));
  });
  // ---- 保险（快慢机，右边的长拨片）----
  k.fine(() => {
    k.prof('blued', P([556, -2], [648, -9], [652, -17], [644, -22], [560, -8]), 1.6 * U, { x: 18 * U, bevel: 0.0004 });
    k.pin('steel', 4 * U, 17 * U, 20.5 * U, Y(-16), Z(643));
    k.box('blued', 5 * U, 5 * U, 12 * U, 21 * U, Y(-4), Z(562), { r: 0.0006 });
  });
  // ---- 弹匣（弧形，侧面三道筋；换弹时整个往下抽）----
  k.group('mag', () => {
    const R = 250 * U, h = 31 * U, t0 = -0.14, t1 = t0 - (235 * U) / R;
    const cz = Z(505) - R * Math.cos(t0), cy = Y(-30) - R * Math.sin(t0);
    const band = (r0, r1, a, b, n = 12) => [...arcPts(cz, cy, r1, a, b, n), ...arcPts(cz, cy, r0, b, a, n)];
    k.prof('blued', band(R - h, R + h, t0, t1), 27 * U, { bevel: 0.0025 });
    k.prof('blued', band(R - h - 1.5 * U, R + h + 1.5 * U, t1 + 0.012, t1 - 0.03, 2), 29 * U, { bevel: 0.001 }); // 底板
    k.fine(() => { for (const r of [R - h * 0.56, R, R + h * 0.56]) k.prof('blued', band(r - 2.2 * U, r + 2.2 * U, t0 - 0.13, t1 + 0.05), 29.6 * U, { bevel: 0.0008 }); });
  }, { pivot: [0, Y(-30), Z(478)] }); // 转轴在弹匣前上角的卡榫：卸弹匣时先往前掰
  // ---- 弹匣卡笋、扳机护圈、扳机 ----
  k.prof('blued', P([540, -39], [548, -39], [550, -62], [543, -66], [540, -60]), 11 * U, { bevel: 0.0006 });
  k.prof('blued', P([552, -78], [632, -78], [632, -75], [552, -75]), 14 * U, { bevel: 0.0005 });
  k.prof('blued', P([547, -38], [551, -38], [556, -78], [552, -78]), 14 * U, { bevel: 0.0005 });
  k.prof('blued', P([628, -78], [632, -78], [643, -52], [639, -52]), 14 * U, { bevel: 0.0005 });
  k.prof('steel', P([596, -38], [603, -38], [604, -50], [600, -64], [596, -66], [597, -52]), 5 * U, { bevel: 0.0008 });
  // ---- 握把、枪托（木头）----
  k.prof(woodD, P([640, -38], [686, -38], [694, -60], [704, -100], [700, -128], [672, -134], [660, -110], [650, -80], [643, -52]), 28 * U, { bevel: 0.005 });
  k.prof('wood', P([700, 8], [876, -14], [876, -126], [868, -128], [718, -40], [700, -36]), 34 * U, { bevel: 0.007 });
  k.prof('blued', P([876, -12], [880, -13], [880, -128], [876, -129]), 35 * U, { bevel: 0.001 });

  const g = k.build();
  g.userData.muzzle = new THREE.Vector3(0, YB, Z(0) - 0.012);
  g.userData.boltTravel = 0.07; // 拉机柄能往后拉多远
  return g;
}

// ============================== 手 ==============================
// 手自己的坐标（按右手建，左手镜像）：+Y 朝指尖，+X 朝大拇指那一侧，+Z 是手心朝的方向，原点在手腕
// L：三节指骨的长度；w：手指根部的宽度（手指略扁，厚度是宽度的 FT 倍，越往指尖越细）
const FINGERS = [
  { x: 0.0305, y: 0.097, L: [0.042, 0.026, 0.023], w: 0.0188 },   // 食指
  { x: 0.0105, y: 0.1025, L: [0.046, 0.029, 0.024], w: 0.0195 },  // 中指
  { x: -0.0095, y: 0.0995, L: [0.043, 0.027, 0.023], w: 0.0185 }, // 无名指
  { x: -0.0285, y: 0.09, L: [0.034, 0.021, 0.02], w: 0.0162 },    // 小指
];
const FT = 0.84;
const AX = new THREE.Vector3(1, 0, 0), AZ = new THREE.Vector3(0, 0, 1), ONE3 = new THREE.Vector3(1, 1, 1);

// 手指的一节：m 是这一节的位置和朝向（+Y 沿着指骨，-Z 是指背）；s 是第几节（0 靠手掌，2 是指尖）
function phalanx(k, m, s, L, w0, w1, t, style, lastGlove) {
  const bare = style.fingerless && s > lastGlove, mat = bare ? 'skin' : 'glove';
  const t0 = w0 * t, t1 = w1 * t;
  k.ball(mat, w0 * 0.53, w0 * 0.5, t0 * 0.56, m.clone()); // 关节：比手指稍鼓一点
  if (s < 2) k.loft(mat, [[0, w0, t0], [L * 0.5, (w0 + w1) * 0.485, (t0 + t1) * 0.485], [L, w1, t1]], m.clone());
  else k.loft(mat, [[0, w0, t0], [L * 0.5, w0 * 0.97, t0 * 0.97], [L * 0.8, w0 * 0.9, t0 * 0.86], [L * 0.94, w0 * 0.66, t0 * 0.62], [L, w0 * 0.3, t0 * 0.3]], m.clone());
  k.fine(() => {
    if (!bare && s < 2) k.box('pad', w0 * 0.7, L * 0.58, 0.0034, 0, L * 0.53, -t0 / 2 - 0.0003, { r: 0.0012, m }); // 指背的护垫
    if (bare && s === 2) k.box('nail', w0 * 0.58, 0.0092, 0.0013, 0, L - 0.0086, (-t0 / 2) * 0.84, { r: 0.0005, rx: 0.1, m }); // 指甲
    if (style.fingerless && s === lastGlove) k.loft('glove', [[L - 0.008, w1 * 1.1, t1 * 1.12], [L + 0.001, w1 * 1.13, t1 * 1.15]], m.clone()); // 露指手套的收口
  });
}

// 手掌（连同手背的护甲、手腕的搭扣带）：手腕窄、指根宽，边上磨圆
function palm(k, style) {
  k.sweep('glove', [[-0.029, -0.002], [0.029, -0.002], [0.04, 0.028], [0.0435, 0.06], [0.0405, 0.092], [0.024, 0.1], [0.002, 0.1035], [-0.02, 0.099], [-0.039, 0.087], [-0.0425, 0.05], [-0.0365, 0.02]],
    -0.0135, 0.0135, { bevel: 0.0085, crease: 1.0 });
  k.ball('glove', 0.0185, 0.031, 0.0145, new THREE.Matrix4().makeTranslation(0.0235, 0.036, 0.0095));   // 大鱼际（拇指根的肉）
  k.ball('glove', 0.012, 0.03, 0.011, new THREE.Matrix4().makeTranslation(-0.028, 0.04, 0.0075));       // 小鱼际（小指那一侧的肉）
  k.fine(() => {
    if (style.pads) {
      // 战术手套：指关节上一排硬壳，手背一块护板带两道棱
      for (const f of FINGERS) k.ball('pad', f.w * 0.52, 0.0085, 0.0052, new THREE.Matrix4().makeTranslation(f.x, f.y - 0.003, -0.0142));
      k.box('pad', 0.047, 0.036, 0.0036, 0.0005, 0.052, -0.0152, { r: 0.0015 });
      for (const x of [-0.011, 0.012]) k.box('pad', 0.004, 0.03, 0.0026, x, 0.052, -0.0176, { r: 0.0011 });
    } else {
      // 露指皮手套：手背开一个椭圆口，每个指关节上一个小圆孔，露出皮肤
      k.ball('skin', 0.0095, 0.0125, 0.002, new THREE.Matrix4().makeTranslation(0, 0.054, -0.0142));
      for (const f of FINGERS) k.ball('skin', f.w * 0.3, f.w * 0.3, 0.0018, new THREE.Matrix4().makeTranslation(f.x, f.y - 0.004, -0.0142));
    }
    // 手腕上的搭扣带，带一个扣片
    k.sweep('pad', rrect(-0.0325, -0.0175, 0.0325, 0.0175, 0.012), -0.004, 0.011, { bevel: 0.002, m: new THREE.Matrix4().makeRotationX(-Math.PI / 2) });
    k.box('glove', 0.018, 0.013, 0.003, 0.004, 0.0035, -0.0185, { r: 0.0012 });
  });
}
// 手指的一节（i：第几根手指，s：第几节），搭在 m 这个位置上
const fingerSeg = (k, m, i, s, style) => { const f = FINGERS[i]; phalanx(k, m, s, f.L[s], f.w * (1 - s * 0.07), f.w * (1 - (s + 1) * 0.07), FT, style, 0); };
// 大拇指：比其他手指粗、更圆。指甲那一面朝外（朝手背和拇指一侧之间）
const TL = [0.036, 0.032, 0.027], TW = [0.027, 0.0228, 0.0208], T0 = [0.033, 0.03, 0.008];
const T_OUT = new THREE.Vector3(0.75, -0.35, -0.55).normalize();
const thumbSeg = (k, m, s, style) => phalanx(k, m, s, TL[s], TW[s], s < 2 ? TW[s + 1] : TW[2] * 0.9, 0.9, style, 1);
// 大拇指一节的朝向：+Y 沿着指骨（dir，手的坐标里）
function thumbBasis(dir) {
  const y = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
  const z = T_OUT.clone().addScaledVector(y, -T_OUT.dot(y)).normalize().negate();
  return new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(y, z), y, z);
}

// pose：curl = 四根手指各三节往手心弯多少（弧度）；splay = 各手指左右张开多少；thumb = 大拇指三节各自的方向（手的坐标里）
// style：fingerless = 露指手套（指尖两节露着）；pads = 手背有硬壳护甲
function hand(k, pose, style) {
  palm(k, style);
  const q = new THREE.Quaternion(), qc = new THREE.Quaternion(), d = new THREE.Vector3();
  FINGERS.forEach((f, i) => {
    let p = new THREE.Vector3(f.x, f.y, 0.0015);
    q.setFromAxisAngle(AZ, pose.splay ? pose.splay[i] : 0);
    for (let s = 0; s < 3; s++) {
      q.multiply(qc.setFromAxisAngle(AX, pose.curl[i][s]));
      fingerSeg(k, new THREE.Matrix4().compose(p, q, ONE3), i, s, style);
      p = p.clone().add(d.set(0, f.L[s], 0).applyQuaternion(q));
    }
  });
  let p = new THREE.Vector3(...T0);
  pose.thumb.forEach((dir, s) => {
    const m = thumbBasis(dir).setPosition(p);
    thumbSeg(k, m, s, style);
    p = p.clone().add(new THREE.Vector3(0, TL[s], 0).applyMatrix4(m.clone().setPosition(0, 0, 0)));
  });
}

// ---------------- 会动的手（拿刀的右手）----------------
// 刀的花式动作里手指要松开、捏住、再握紧，所以这只手不合并成一整块：手掌一块，每节指骨各自一个组，
// 可以在两种手型之间连续过渡（setShape）。零件只搭一次，各把刀共用
const rigCache = new Map(), thumbQ = new WeakMap();
function rigPieces(style, cols) {
  const key = JSON.stringify(cols);
  let R = rigCache.get(key);
  if (!R) {
    const I = new THREE.Matrix4();
    const piece = (fn) => { const k = handKit(cols); fn(k); return k.build().children.map((m) => [m.geometry, m.material]); };
    R = {
      palm: piece((k) => palm(k, style)),
      fingers: FINGERS.map((f, i) => [0, 1, 2].map((s) => piece((k) => fingerSeg(k, I.clone(), i, s, style)))),
      thumb: [0, 1, 2].map((s) => piece((k) => thumbSeg(k, I.clone(), s, style))),
    };
    rigCache.set(key, R);
  }
  return R;
}
function thumbQuats(shape) {
  let q = thumbQ.get(shape);
  if (!q) thumbQ.set(shape, (q = shape.thumb.map((d) => new THREE.Quaternion().setFromRotationMatrix(thumbBasis(d)))));
  return q;
}
function rigHand(style, cols) {
  const R = rigPieces(style, cols), g = new THREE.Group();
  const put = (list, to) => { for (const [geo, mat] of list) to.add(new THREE.Mesh(geo, mat)); };
  put(R.palm, g);
  const J = FINGERS.map((f, i) => {
    let par = g;
    return [0, 1, 2].map((s) => {
      const j = new THREE.Group();
      if (s) j.position.set(0, f.L[s - 1], 0); else j.position.set(f.x, f.y, 0.0015);
      put(R.fingers[i][s], j);
      par.add(j);
      return (par = j);
    });
  });
  const T = [0, 1, 2].map((s) => { const j = new THREE.Group(); put(R.thumb[s], j); g.add(j); return j; });
  const qz = new THREE.Quaternion(), qx = new THREE.Quaternion(), v = new THREE.Vector3();
  let last = '';
  // 从手型 a 过渡到手型 b（t：0~1）
  g.userData.setShape = (a, b, t) => {
    const key = a.id + '>' + b.id + '>' + t.toFixed(3);
    if (key === last) return;
    last = key;
    for (let i = 0; i < 4; i++) {
      for (let s = 0; s < 3; s++) {
        qx.setFromAxisAngle(AX, a.curl[i][s] + (b.curl[i][s] - a.curl[i][s]) * t);
        if (s) J[i][s].quaternion.copy(qx);
        else J[i][0].quaternion.copy(qz.setFromAxisAngle(AZ, a.splay[i] + (b.splay[i] - a.splay[i]) * t)).multiply(qx);
      }
    }
    const qa = thumbQuats(a), qb = thumbQuats(b);
    v.set(...T0);
    for (let s = 0; s < 3; s++) {
      T[s].position.copy(v);
      T[s].quaternion.copy(qa[s]).slerp(qb[s], t);
      v.add(qz.copy(T[s].quaternion) && new THREE.Vector3(0, TL[s], 0).applyQuaternion(T[s].quaternion));
    }
  };
  return g;
}

// 把手摆到枪上：grip = 手心握住的那根东西的中心（枪的坐标），thumbDir = 大拇指那一侧朝哪，palmDir = 手心朝哪
function handMatrix(grip, thumbDir, palmDir, left, hold = [0, 0.1, 0.032], fingerDir = null) {
  const z = new THREE.Vector3(...palmDir).normalize();
  let y;
  if (fingerDir) {
    // 直接说手指（手腕 → 指根）朝哪：去掉和手心方向重合的部分
    y = new THREE.Vector3(...fingerDir);
    y.addScaledVector(z, -y.dot(z)).normalize();
  } else {
    const x0 = new THREE.Vector3(...thumbDir).normalize();
    if (left) x0.negate(); // 左手是镜像的：镜像后大拇指在 -X 那边
    y = new THREE.Vector3().crossVectors(z, x0).normalize();
  }
  const x = new THREE.Vector3().crossVectors(y, z);
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  if (left) m.multiply(new THREE.Matrix4().makeScale(-1, 1, 1));
  const h = new THREE.Vector3(...hold).applyMatrix4(m);
  m.setPosition(grip[0] - h.x, grip[1] - h.y, grip[2] - h.z);
  return m;
}

// 一只手的模型（在手自己的坐标里）：同一种姿势、同一副手套只搭一次，各把武器共用（搭一只手要十几毫秒）
const handCache = new Map();
const MIRROR = new THREE.Matrix4().makeScale(-1, 1, 1);
function handMeshes(pose, style, cols, left) {
  const key = (left ? 'L' : 'R') + JSON.stringify(pose) + JSON.stringify(cols);
  let g = handCache.get(key);
  if (!g) {
    const k = handKit(cols);
    if (left) k.with(MIRROR, true, () => hand(k, pose, style)); else hand(k, pose, style);
    g = k.build();
    handCache.set(key, g);
  }
  const c = new THREE.Group();
  for (const m of g.children) c.add(new THREE.Mesh(m.geometry, m.material));
  return c;
}

// 一只手 + 小臂。elbow：手肘在哪（枪的坐标，一般在画面外）
function arm(name, o, style, cols) {
  const left = !!o.left, m = handMatrix(o.grip, o.thumbDir, o.palmDir, left, o.hold, o.fingerDir);
  const g = new THREE.Group();
  g.name = name;
  const h = o.rig ? rigHand(style, cols) : handMeshes(o.pose, style, cols, left);
  if (o.rig) { g.userData.rig = h; h.userData.setShape(o.pose, o.pose, 0); }
  h.matrixAutoUpdate = false;
  h.matrix.copy(m);
  if (left) h.matrix.multiply(MIRROR); // 左手的模型已经镜像过了，这里只剩摆位置
  g.add(h);
  // 小臂：从手腕到手肘的一根扁圆管（扁的方向和手掌一致），靠手腕的一小段是手套的袖口
  const k = handKit(cols);
  const w = new THREE.Vector3(0, -0.004, 0).applyMatrix4(m), e = new THREE.Vector3(...o.elbow);
  const yv = w.clone().sub(e).normalize(); // 手肘 → 手腕
  const zv = new THREE.Vector3().setFromMatrixColumn(m, 0).normalize().cross(yv).normalize();
  const xv = new THREE.Vector3().crossVectors(yv, zv);
  const piece = (mat, t0, t1, r0, r1) => { // t：0 = 手腕，1 = 手肘
    const a = w.clone().lerp(e, t0), b = w.clone().lerp(e, t1);
    const geo = new THREE.CylinderGeometry(r0, r1, a.distanceTo(b), 16);
    geo.scale(1, 1, 0.74);
    k.add(mat, geo, new THREE.Matrix4().makeBasis(xv, yv, zv).setPosition(a.add(b).multiplyScalar(0.5)));
  };
  piece('glove', -0.03, 0.03, 0.0255, 0.03);  // 手套的袖筒：靠手腕这头收细，和手掌接上
  piece('glove', 0.025, 0.085, 0.03, 0.0335);
  piece('sleeve', 0.065, 0.1, 0.037, 0.038);  // 袖口的收边
  // 袖子：越往手肘越粗，中间微微鼓起；褶子只留两道很浅的，免得像一节一节的管子
  piece('sleeve', 0.09, 0.3, 0.0355, 0.0485);
  piece('sleeve', 0.29, 0.6, 0.0485, 0.056);
  piece('sleeve', 0.59, 1, 0.056, 0.066);
  for (const t of [0.24, 0.47]) piece('sleeve', t, t + 0.06, 0.0462 + t * 0.021, 0.0478 + t * 0.021);
  const sl = k.build();
  while (sl.children.length) g.add(sl.children[0]);
  return g;
}

// ---------------- 各种握法 ----------------
// 手指弯多少：握握把（食指伸出去搭扳机）、攥紧细刀柄、托着粗护木、握一个圆罐子、勾住拉机柄、张开放松
const CURL = {
  grip: [[0.35, 0.75, 0.45], [1.25, 1.5, 0.8], [1.3, 1.5, 0.8], [1.3, 1.45, 0.75]],
  fist: [[1.3, 1.6, 0.9], [1.32, 1.6, 0.9], [1.34, 1.6, 0.9], [1.36, 1.55, 0.85]],
  cup: [[0.75, 1.0, 0.55], [0.8, 1.0, 0.55], [0.82, 1.0, 0.55], [0.85, 1.0, 0.5]],
  wrap: [[0.95, 1.2, 0.6], [1.0, 1.2, 0.6], [1.02, 1.2, 0.6], [1.05, 1.15, 0.55]],
  can: [[0.8, 1.0, 0.55], [0.85, 1.0, 0.55], [0.87, 1.0, 0.55], [0.9, 0.95, 0.5]],
  hook: [[0.55, 1.25, 0.85], [0.6, 1.3, 0.85], [0.65, 1.3, 0.85], [0.7, 1.25, 0.8]],
  open: [[0.2, 0.28, 0.16], [0.27, 0.36, 0.2], [0.34, 0.44, 0.24], [0.44, 0.52, 0.3]],
};
// 大拇指：绕过去扣住（握把、刀柄）/ 顺着枪身往前贴着（托护木）/ 翘起来压在上面（C4）/ 放松张着
const THUMB = {
  wrap: [[0.35, 0.45, 0.82], [-0.15, 0.6, 0.78], [-0.3, 0.85, 0.42]],
  along: [[0.45, 0.3, 0.84], [0.75, 0.2, 0.62], [0.9, 0.1, 0.42]],
  top: [[0.5, 0.2, 0.85], [0.3, 0.55, 0.78], [0.05, 0.85, 0.55]],
  open: [[0.72, 0.5, 0.48], [0.66, 0.68, 0.32], [0.55, 0.8, 0.22]],
};
const SPLAY = [-0.1, 0, 0.04, 0.1];
// 拿刀的右手会用到的手型（花式动作里在它们之间过渡）
const shapes = (o) => { for (const id in o) o[id].id = id; return o; };
export const HAND_SHAPES = shapes({
  fist: { curl: CURL.fist, splay: SPLAY, thumb: THUMB.wrap },
  // 抛刀 / 接刀：手掌摊平，大拇指躺在手掌边上（刀在手掌前面转，什么都碰不到）
  flat: { curl: [[0.04, 0.1, 0.08], [0.02, 0.1, 0.08], [0.05, 0.12, 0.1], [0.12, 0.16, 0.12]], splay: [-0.16, -0.04, 0.06, 0.18],
    thumb: [[0.84, 0.54, -0.06], [0.8, 0.6, -0.04], [0.72, 0.69, 0]] },
  // 蝴蝶刀：四指握着安全柄，大拇指让到手掌边上（刀身和咬柄从大拇指这一侧甩过去）
  bfGrip: { curl: [[1.28, 1.5, 0.8], [1.3, 1.5, 0.8], [1.32, 1.5, 0.8], [1.34, 1.45, 0.75]], splay: SPLAY,
    thumb: [[0.85, 0.4, -0.35], [0.82, 0.42, -0.38], [0.78, 0.48, -0.4]] },
  // 蝴蝶刀：大拇指从上面压住安全柄，四指伸直让开（咬柄从手指这一侧转回来）
  bfPinch: { curl: [[-0.06, 0.1, 0.08], [-0.12, 0.1, 0.08], [-0.12, 0.12, 0.1], [-0.08, 0.16, 0.12]], splay: [-0.14, -0.03, 0.06, 0.17],
    thumb: [[0.3, 0.6, 0.74], [0.05, 0.92, 0.38], [0, 0.97, -0.25]] },
  // 爪子刀转刀：只有食指勾着刀环，其余手指张开让刀转过去
  ring: { curl: [[1.3, 1.6, 0.9], [0.1, 0.2, 0.12], [0.08, 0.2, 0.12], [0.1, 0.22, 0.14]], splay: [-0.1, 0.02, 0.1, 0.2],
    thumb: [[0.84, 0.54, -0.06], [0.8, 0.6, -0.04], [0.72, 0.69, 0]] },
});

// 右手握握把：握把中心在 (0, y, z)，握把往后倾 rx（弧度，负数）
const rGrip = (y, z, rx, o = {}) => ({
  grip: [0, y, z], thumbDir: [0, Math.cos(rx), Math.sin(rx)], palmDir: [-0.82, 0, -0.57], elbow: [0.15, -0.27, 0.32],
  pose: { curl: CURL.grip, splay: SPLAY, thumb: THUMB.wrap }, ...o,
});
// 左手从下面托住：托的那一段中心在 (0, y, z)，half 是它中心到底面的距离
const lCup = (y, z, half, o = {}) => ({
  left: true, grip: [0, y, z], thumbDir: [0, 0.12, -1], palmDir: [0.5, 0.87, 0], hold: [0, 0.07, 0.014 + half], elbow: [-0.23, -0.29, 0.12],
  pose: { curl: CURL.cup, splay: [-0.12, -0.03, 0.05, 0.14], thumb: THUMB.along }, ...o,
});
// 左手从左边包住一根竖着的东西（手枪握把上右手的手指、冲锋枪的前握把）
const lWrap = (y, z, o = {}) => ({
  left: true, grip: [0, y, z], thumbDir: [0, 1, -0.25], palmDir: [1, 0, 0.12], hold: [0, 0.095, 0.05], elbow: [-0.2, -0.3, 0.3],
  pose: { curl: CURL.wrap, splay: SPLAY, thumb: [[0.4, 0.5, 0.75], [0.3, 0.8, 0.5], [0.2, 0.95, 0.25]] }, ...o,
});
// 左手从上面扣住（拉机柄、手枪套筒）：手心朝下压在枪顶 (0, y, z) 上，四指搭到右边去
const lOver = (y, z, o = {}) => ({
  left: true, grip: [0, y, z], fingerDir: [1, -0.1, 0.14], palmDir: [0, -1, 0.1], hold: [0, 0.088, 0.016], elbow: [-0.5, -0.2, 0.06],
  pose: { curl: CURL.wrap, splay: SPLAY, thumb: THUMB.wrap }, ...o,
});
// 左手握住枪右边的拉机柄头 (x, y, z)：AK / 加利尔拉栓时是把枪往左侧过来、右侧面朝上，
// 左手从左下方伸过来、手心压在右侧面上、四指搭过拉机柄往后拉（小臂从枪的上面绕回左边）
const lRack = (x, y, z, o = {}) => ({
  left: true, grip: [x, y, z], fingerDir: [-0.19, -0.94, -0.28], palmDir: [-0.99, -0.09, 0.1], hold: [0, 0.088, 0.016], elbow: [-0.01, 0.67, 0.17],
  pose: { curl: CURL.wrap, splay: SPLAY, thumb: THUMB.wrap }, ...o,
});
// 左手手心朝上托着弹匣底（手枪换弹：从下面把弹匣推进握把）
const lPush = (y, z, o = {}) => ({
  left: true, grip: [0, y, z], fingerDir: [0.55, 0.1, -0.83], palmDir: [0.25, 0.95, 0.15], hold: [0, 0.07, 0.02], elbow: [-0.25, -0.4, 0.25],
  pose: { curl: CURL.cup, splay: SPLAY, thumb: THUMB.along }, ...o,
});
// 左手从左边伸过来勾住侧面的拉机柄头 (x, y, z)：手心朝右
const lSide = (x, y, z, o = {}) => ({
  left: true, grip: [x, y, z], fingerDir: [0.2, 0.75, -0.63], palmDir: [0.93, -0.1, 0.35], hold: [0, 0.1, 0.022], elbow: [-0.42, -0.32, 0.22],
  pose: { curl: CURL.hook, splay: SPLAY, thumb: THUMB.along }, ...o,
});
// 左手食指勾住手雷的拉环（拉环在 (-0.018, y, 0)）
const lPin = (y) => ({
  left: true, grip: [-0.018, y, 0], fingerDir: [0.85, 0.3, -0.4], palmDir: [0.15, -0.5, -0.85], hold: [0.028, 0.135, 0.012], elbow: [-0.4, -0.3, 0.25],
  pose: { curl: CURL.hook, splay: SPLAY, thumb: THUMB.along },
});
// 右手握住栓动步枪右边的拉机柄头 (x, y, z)
const rKnob = (x, y, z, o = {}) => ({
  grip: [x, y, z], fingerDir: [-0.1, 0.55, -0.83], palmDir: [-0.86, 0.3, -0.4], hold: [0, 0.092, 0.024], elbow: [0.24, -0.3, 0.36],
  pose: { curl: CURL.can, splay: SPLAY, thumb: THUMB.top }, ...o,
});
// 右手攥着刀柄（照 CS:GO：手背对着自己，四指从刀刃那一侧绕过去，大拇指那一侧朝刀尖，小臂从下面伸上来）
// rig：这只手的手指会动（见 rigHand）
const rKnife = (y, z, o = {}) => ({
  grip: [0, y, z], thumbDir: [0, 0, -1], palmDir: [-1, 0, 0], hold: [0, 0.1, 0.028], elbow: [0.05, 0.36, 0.21],
  pose: HAND_SHAPES.fist, rig: true, ...o,
});

const NADE_R = { grip: [0, 0, 0], thumbDir: [0, 1, -0.1], palmDir: [-0.82, 0, -0.57], hold: [0, 0.095, 0.046], elbow: [0.22, -0.34, 0.4],
  pose: { curl: CURL.can, splay: SPLAY, thumb: THUMB.wrap } };
const RIFLE_POSE = { right: rGrip(-0.052, 0.058, -0.315), left: lCup(0.0334, -0.325, 0.026), leftAct: lRack(0.0476, 0.065, -0.113) };
const SNIPER_POSE = { right: rGrip(-0.068, 0.118, -0.3), left: lCup(0.018, -0.25, 0.022), rightAct: rKnob(0.05, 0.018, 0.122) };
const M4_POSE = { right: rGrip(-0.07, -0.004, -0.3), left: lCup(0.04, -0.352, 0.0325), leftAct: lOver(0.083, 0.01) };
// 每把枪的握法（位置对着各自模型上的握把、护木）。
// leftAct：左手去拉拉机柄 / 套筒时的姿势；leftMag：左手拿弹匣的姿势（不写就用平时托枪的手）；rightAct：右手拉栓的姿势
const POSES = {
  ak47: RIFLE_POSE,
  galil: { ...RIFLE_POSE, leftAct: lRack(0.035, 0.087, -0.113) }, // 拉机柄头往上弯，位置比 AK 的高、靠里
  m4a4: M4_POSE,
  m4a1s: M4_POSE,
  famas: { right: rGrip(-0.068, -0.094, -0.2), left: lCup(0.016, -0.26, 0.056), leftAct: lSide(-0.012, 0.092, -0.08) },
  ssg08: SNIPER_POSE,
  awp: SNIPER_POSE,
  nova: { right: rGrip(-0.062, 0.106, -0.3), left: lCup(0.027, -0.36, 0.024) },
  ump45: { right: rGrip(-0.07, 0.046, -0.24), left: lCup(0.039, -0.255, 0.039), leftAct: lSide(-0.046, 0.056, -0.22) },
  mp9: { right: rGrip(-0.055, 0.02, -0.17), left: lWrap(-0.045, -0.195, { hold: [0, 0.1, 0.032], elbow: [-0.34, -0.3, 0.18] }), leftAct: lOver(0.076, 0.026) },
  mac10: { right: rGrip(-0.055, 0.011, -0.05), left: lWrap(-0.06, 0.008), leftAct: lOver(0.086, -0.07) },
  pistol: { right: rGrip(-0.045, 0.022, -0.34), left: lWrap(-0.06, 0.012), leftAct: lOver(0.052, -0.004), leftMag: lPush(-0.112, 0.045) },
  deagle: { right: rGrip(-0.052, 0.025, -0.34), left: lWrap(-0.068, 0.014), leftAct: lOver(0.064, -0.004), leftMag: lPush(-0.128, 0.05) },
  knife: { right: rKnife(0.011, 0.028) },
  knife_m9: { right: rKnife(0.017, 0.022) },
  knife_butterfly: { right: rKnife(0.012, 0.036) },
  knife_xeno: { right: rKnife(0.01, 0.038) },
  knife_karambit: {
    // 爪子刀横着握：刀柄左右走向，刀环在拳头左边（食指那一侧），手背对着自己
    right: { grip: [0.0085, -0.018, 0.03], thumbDir: [-1, 0, 0], palmDir: [0, 0.2, -1], hold: [0, 0.1, 0.03], elbow: [0.14, -0.42, 0.3],
      pose: HAND_SHAPES.fist, rig: true },
  },
  grenade: { right: NADE_R },
  he: { right: NADE_R, leftAct: lPin(0.045) },
  flash: { right: NADE_R, leftAct: lPin(0.05) },
  smoke: { right: NADE_R, leftAct: lPin(0.062) },
  incgrenade: { right: NADE_R, leftAct: lPin(0.062) },
  c4: {
    // 两只手从下面托着炸弹的两头，大拇指压在上面
    right: { grip: [0.07, 0, 0], thumbDir: [0, 0, -1], palmDir: [-0.3, 0.95, 0], hold: [0, 0.07, 0.047], elbow: [0.3, -0.3, 0.32],
      pose: { curl: CURL.cup, splay: SPLAY, thumb: THUMB.top } },
    left: { left: true, grip: [-0.07, 0, 0], thumbDir: [0, 0, -1], palmDir: [0.3, 0.95, 0], hold: [0, 0.07, 0.047], elbow: [-0.3, -0.3, 0.32],
      pose: { curl: CURL.cup, splay: SPLAY, thumb: THUMB.top } },
  },
};

// ============================== 刀 ==============================
// 刀尖朝 -Z，刀背朝 +Y。会转的零件放在有转轴的组里（spin：整把刀在手里转；蝴蝶刀还有 blade / hB）。
// 样子都是照真实刀具的大致形状自己搭的。
const RX90 = new THREE.Matrix4().makeRotationX(Math.PI / 2);
// 沿 +Y 的放样件（loft）转成沿 +Z：从 (0, y, z) 往后伸，做刀柄
const back = (y, z) => new THREE.Matrix4().makeTranslation(0, y, z).multiply(RX90);
// 刀背上的一排锯齿（侧面轮廓）：从 z0 往刀尖方向排 n 个，齿距 p、齿高 h，y 是刀背的高度
function sawTeeth(z0, n, p, h, y) {
  const pts = [[z0, y - 0.0006]];
  for (let i = 0; i < n; i++) pts.push([z0 - i * p - 0.0004, y + h], [z0 - (i + 1) * p, y + 0.0004]);
  pts.push([z0 - n * p, y - 0.0006]);
  return pts;
}
function knifeDone(g, kind, extra) {
  const U = g.userData;
  U.kfx = { kind, spin: U.spin || null, base: U.spin ? U.spin.position.clone() : null, ...extra };
  U.muzzle = new THREE.Vector3(0, 0.02, -0.25);
  return g;
}

// 默认匕首：水滴头直刀，橡胶刀柄
function knifeDefault(k) {
  k.group('spin', () => {
    k.blade('blade', 'edge', [
      [-0.040, 0.0300, -0.0060, 0.0046, 0.013],
      [-0.125, 0.0300, -0.0065, 0.0046, 0.014],
      [-0.165, 0.0285, -0.0040, 0.0044, 0.014, 0.0030],
      [-0.198, 0.0235, 0.0030, 0.0038, 0.012, 0.0016],
      [-0.220, 0.0165, 0.0100, 0.0024, 0.005, 0.0008],
      [-0.231, 0.0130, 0.0125, 0.0004, 0.0004, 0.0003],
    ]);
    k.fine(() => k.box('blued', 0.0052, 0.0042, 0.09, 0, 0.0215, -0.095, { r: 0.002 })); // 血槽
    k.box('steel', 0.032, 0.05, 0.0085, 0, 0.012, -0.0375, { r: 0.003 });               // 护手
    k.loft('rubber', [[0, 0.0215, 0.029], [0.022, 0.0235, 0.0315], [0.058, 0.025, 0.033], [0.092, 0.0235, 0.031], [0.112, 0.0215, 0.0285]], back(0.011, -0.033), { exp: 3.4 });
    k.fine(() => { for (let i = 0; i < 6; i++) k.box('black', 0.0262, 0.0338, 0.0032, 0, 0.011, -0.016 + i * 0.0165, { r: 0.0012 }); }); // 防滑纹
    k.box('steel', 0.023, 0.031, 0.011, 0, 0.011, 0.0845, { r: 0.004 });                 // 刀尾
    k.fine(() => k.pin('bore', 0.003, -0.0118, 0.0118, 0.011, 0.0855));                  // 挂绳孔
  }, { pivot: [0, 0.012, -0.005] });
  return knifeDone(k.build(), 'plain');
}

// M9 刺刀：宽直刀，刀背一排锯齿，护手上方有套枪口的圆环，圆柱刀柄
function knifeM9(k) {
  k.group('spin', () => {
    k.blade('blade', 'edge', [
      [-0.043, 0.0360, 0.0020, 0.0050, 0.012],
      [-0.135, 0.0360, 0.0012, 0.0050, 0.013],
      [-0.165, 0.0350, 0.0020, 0.0048, 0.013, 0.0026],
      [-0.198, 0.0300, 0.0075, 0.0042, 0.011, 0.0013],
      [-0.221, 0.0235, 0.0145, 0.0026, 0.006, 0.0007],
      [-0.233, 0.0190, 0.0182, 0.0004, 0.0005, 0.0003],
    ]);
    k.prof('blade', sawTeeth(-0.05, 8, 0.0085, 0.0045, 0.036), 0.0044, { bevel: 0.0006 });
    k.fine(() => {
      k.box('blued', 0.0056, 0.0048, 0.085, 0, 0.0262, -0.098, { r: 0.002 });   // 血槽
      k.ball('bore', 0.0029, 0.0034, 0.0085, new THREE.Matrix4().makeTranslation(0, 0.022, -0.186)); // 刀尖附近的长圆孔
    });
    k.box('steel', 0.03, 0.052, 0.0095, 0, 0.019, -0.0385, { r: 0.003 });      // 护手
    k.torus('steel', 0.0105, 0.0032, 0, 0.0565, -0.0385, { ry: Math.PI / 2 }); // 套枪口的圆环
    k.tube('olive', 0.0148, -0.034, 0.076, { y: 0.017 });                      // 刀柄
    for (let i = 0; i < 5; i++) k.tube('oliveD', 0.0157, -0.018 + i * 0.019, -0.0125 + i * 0.019, { y: 0.017 }); // 防滑环
    k.tube('steel', 0.0152, 0.076, 0.088, { y: 0.017 });                       // 刀尾的卡座
    k.fine(() => k.box('steel', 0.011, 0.01, 0.014, 0, 0.034, 0.081, { r: 0.002 }));
  }, { pivot: [0, 0.017, -0.012] });
  return knifeDone(k.build(), 'm9');
}

// 爪子刀：食指套在刀尾的圆环里，弯刀从拳头另一头伸出去、往上弯成爪子（刃口在内弧）。
// 整把刀挂在 spin 组上，转轴就是圆环中心，转刀动作就是绕食指转
function knifeKarambit(k) {
  k.group('spin', () => {
    k.torus('steel', 0.016, 0.0046, 0, 0.012, 0.075);                          // 刀环
    k.loft('rubber', [[0, 0.0125, 0.027], [0.03, 0.0138, 0.0285], [0.066, 0.013, 0.026], [0.093, 0.011, 0.021]], back(0.012, -0.036), { exp: 3 });
    k.fine(() => { for (let i = 0; i < 3; i++) k.pin('brass', 0.0027, -0.0074, 0.0074, 0.012, -0.02 + i * 0.027); });
    k.box('steel', 0.0145, 0.037, 0.008, 0, 0.012, -0.036, { r: 0.002 });      // 护手
    // 弯刀：中线从护手往前走，越走越往上弯，最后刀尖略微勾回来
    const N = k.hd ? 16 : 7, L = 0.124, st = [];
    let z = -0.04, y = 0.012;
    for (let i = 0; i <= N; i++) {
      const s = i / N, phi = -0.18 + 2.15 * Math.pow(s, 0.92);
      const h = 0.027 * (s < 0.35 ? 1 : 1 - Math.pow((s - 0.35) / 0.65, 1.5) * 0.93);
      const nz = Math.sin(phi), ny = Math.cos(phi); // 往内弧那一侧
      st.push([z - (nz * h) / 2, y - (ny * h) / 2, z + (nz * h) / 2, y + (ny * h) / 2,
        0.0036 * (s > 0.85 ? 1 - (s - 0.85) * 5.5 : 1), h * 0.38, 0.0036 * (s > 0.5 ? 1 - (s - 0.5) * 1.6 : 1)]);
      z -= (Math.cos(phi) * L) / N; y += (Math.sin(phi) * L) / N;
    }
    k.blade('blade', 'edge', st, { curve: true });
  }, { pivot: [0, 0.012, 0.075] });
  const g = knifeDone(k.build(), 'karambit');
  g.userData.muzzle.set(0, 0.04, -0.1);
  return g;
}

// 蝴蝶刀：刀身 + 两片刀柄。两片刀柄上下并排，各有一根销轴穿在刀根上：
// 上面那片（hA）握在手里；刀身绕它的销轴转；下面那片（hB，咬柄）装在刀根上、绕自己的销轴转。
// 合起来时刀身转 180° 夹在两片刀柄中间
function knifeButterfly(k) {
  const PA = [0, 0.018, -0.046], PB = [0, 0.006, -0.046];
  const handle = (mat, y0, y1) => {
    const yc = (y0 + y1) / 2, holes = [];
    for (let i = 0; i < 5; i++) holes.push(arcPts(-0.018 + i * 0.026, yc, 0.0033, 0, Math.PI * 2, 10).slice(0, -1)); // 一排减重孔
    k.prof(mat, rrect(-0.0525, y0, 0.104, y1, 0.0045), 0.0105, { bevel: 0.0016, holes });
    k.pin('brass', 0.0034, -0.0062, 0.0062, yc, -0.046);
  };
  k.group('pivot', null, { pivot: PA });
  k.group('hA', () => handle('black', 0.012, 0.024), { pivot: PA, parent: 'pivot' });
  k.group('blade', () => {
    k.blade('blade', 'edge', [
      [-0.054, 0.0232, 0.0008, 0.0036, 0.008],
      [-0.130, 0.0238, 0.0004, 0.0036, 0.009],
      [-0.158, 0.0218, 0.0030, 0.0034, 0.008, 0.0020],
      [-0.176, 0.0172, 0.0088, 0.0022, 0.004, 0.0008],
      [-0.185, 0.0138, 0.0130, 0.0004, 0.0004, 0.0003],
    ]);
    k.box('blade', 0.0036, 0.0225, 0.018, 0, 0.012, -0.049, { r: 0.002 }); // 刀根
  }, { pivot: PA, parent: 'pivot' });
  k.group('hB', () => {
    handle('blued', 0, 0.012);
    k.box('brass', 0.008, 0.006, 0.012, 0, 0.004, 0.106, { r: 0.002 });    // 锁扣
  }, { pivot: PB, parent: 'blade' });
  const g = k.build(), U = g.userData;
  return knifeDone(g, 'butterfly', { pivot: U.pivot, blade: U.blade, hA: U.hA, hB: U.hB });
}

// 剥皮小刀：银色宽刃，刀背靠近护手一排锯齿、刀尖斜削；护手下端往前勾；
// 刀柄是镂空的金属框（三角形镂空），刀尾斜切、挂绳孔上吊着一根小绳
function knifeXeno(k) {
  k.group('spin', () => {
    k.blade('blade', 'edge', [
      [-0.028, 0.0270, -0.0035, 0.0044, 0.010],
      [-0.130, 0.0270, -0.0040, 0.0044, 0.011],
      [-0.160, 0.0235, -0.0010, 0.0040, 0.010, 0.0020],
      [-0.186, 0.0130, 0.0060, 0.0026, 0.005, 0.0008],
      [-0.197, 0.0088, 0.0082, 0.0004, 0.0004, 0.0003],
    ]);
    k.prof('blade', sawTeeth(-0.036, 6, 0.0085, 0.0042, 0.027), 0.0038, { bevel: 0.0006 });
    k.fine(() => k.ball('bore', 0.0026, 0.0045, 0.0045, new THREE.Matrix4().makeTranslation(0, 0.005, -0.042))); // 刃根开孔
    // 护手：薄片，下端往前勾
    k.box('steel', 0.016, 0.046, 0.006, 0, 0.006, -0.025, { r: 0.0015 });
    k.box('steel', 0.016, 0.007, 0.018, 0, -0.016, -0.034, { r: 0.002, rx: -0.5 });
    // 刀柄：一整块板，掏出一排三角形的孔
    const holes = [
      [[-0.010, 0.002], [0.014, 0.002], [0.002, 0.017]], [[0.006, 0.018], [0.030, 0.018], [0.018, 0.003]],
      [[0.022, 0.002], [0.046, 0.002], [0.034, 0.017]], [[0.038, 0.018], [0.062, 0.018], [0.050, 0.003]],
      [[0.054, 0.002], [0.078, 0.002], [0.066, 0.017]], [[0.070, 0.018], [0.092, 0.018], [0.082, 0.003]],
    ];
    k.prof('blued', [[-0.022, -0.004], [0.096, -0.004], [0.113, 0.005], [0.107, 0.024], [-0.022, 0.024]], 0.0115, { bevel: 0.0022, holes });
    k.fine(() => {
      k.pin('bright', 0.0034, -0.0068, 0.0068, 0.01, -0.012);  // 刀柄前端的螺栓
      k.pin('bore', 0.0028, -0.0062, 0.0062, 0.012, 0.104);    // 挂绳孔
    });
  }, { pivot: [0, 0.01, 0.03] });
  // 小绳（单独一个组，挂在挂绳孔上，跟着动作晃）
  k.group('cord', () => {
    k.rod('cord', 0.0016, [0, 0.012, 0.104], [0, -0.02, 0.106]);
    k.ball('cord', 0.0034, 0.0045, 0.0034, new THREE.Matrix4().makeTranslation(0, -0.022, 0.106));
    k.rod('cord', 0.0013, [0, -0.024, 0.106], [0.002, -0.038, 0.107]);
  }, { pivot: [0, 0.012, 0.104], parent: 'spin' });
  const g = k.build();
  return knifeDone(g, 'xeno', { cord: g.userData.cord });
}

// ============================== 对外 ==============================
// 有高精度模型的武器。gun(hd)：hd=true 是第一人称用的，false 是远处看的简化版
const more = (wid, lay) => ({ gun: (hd) => GUNS[wid](new Kit(hd)), lay });
export const HD = {
  ak47: { gun: (hd) => ak47(new Kit(hd)), lay: { pos: [0.18, -0.185, -0.34], rot: [0.02, 0.06, 0] } },
  galil: more('galil', { pos: [0.18, -0.185, -0.34], rot: [0.02, 0.06, 0] }),
  m4a4: more('m4a4', { pos: [0.18, -0.167, -0.278], rot: [0.02, 0.06, 0] }),
  m4a1s: more('m4a1s', { pos: [0.18, -0.167, -0.278], rot: [0.02, 0.06, 0] }),
  famas: more('famas', { pos: [0.18, -0.169, -0.19], rot: [0.02, 0.06, 0] }),
  awp: more('awp', { pos: [0.19, -0.172, -0.39], rot: [0.02, 0.05, 0] }),
  ssg08: more('ssg08', { pos: [0.19, -0.172, -0.39], rot: [0.02, 0.05, 0] }),
  nova: more('nova', { pos: [0.18, -0.175, -0.387], rot: [0.02, 0.06, 0] }),
  ump45: more('ump45', { pos: [0.18, -0.167, -0.33], rot: [0.02, 0.07, 0] }),
  mac10: more('mac10'), mp9: more('mp9'),
  glock: more('glock'), usp: more('usp'), p250: more('p250'), deagle: more('deagle'),
  he: more('he'), flash: more('flash'), smoke: more('smoke'), molotov: more('molotov'), incgrenade: more('incgrenade'), c4: more('c4'),
};
// 刀（按皮肤）
export const HD_KNIVES = {
  default: (hd) => knifeDefault(new Kit(hd)),
  m9: (hd) => knifeM9(new Kit(hd)),
  karambit: (hd) => knifeKarambit(new Kit(hd)),
  butterfly: (hd) => knifeButterfly(new Kit(hd)),
  xeno: (hd) => knifeXeno(new Kit(hd)),
};

export { POSES as HAND_POSES }; // 预览页调姿势用
// 这把武器该怎么握：先按武器名找，再按类型（手枪 / 刀 / 手雷）找
export function handPose(wid, type, skin) {
  if (wid === 'knife') return POSES['knife_' + skin] || POSES.knife;
  return POSES[wid] || POSES[type] || null;
}

function handKit(cols) {
  return new Kit(true, {
    glove: { color: cols.glove, metal: 0, rough: 0.82, tex: 'cloth', uv: 60 },
    pad: { color: cols.pad ?? 0x0e0f11, metal: 0.05, rough: 0.42 },
    sleeve: { color: cols.sleeve, metal: 0, rough: 0.9, tex: 'cloth', uv: 40 },
    skin: { color: cols.skin, metal: 0, rough: 0.78 },
    nail: { color: 0xe3c4b4, metal: 0, rough: 0.35 },
  });
}
const handStyle = (cols) => ({ fingerless: !!cols.fingerless, pads: !cols.fingerless });

// 握着这把武器的手（第一人称）。cols：{ glove, sleeve, skin, fingerless }。
// 返回的组里 userData.rh / lh 是两只手；lhB / lhM / rhB 是做动作时换上的姿势（拉栓、拿弹匣），平时不显示。
// 拿刀的右手（rh.userData.rig）手指会动：rig.userData.setShape(手型 a, 手型 b, 过渡多少)
export function hdHands(pose, cols) {
  if (!pose) return null;
  const g = new THREE.Group(), style = handStyle(cols);
  const put = (name, o) => { if (o) { g.userData[name] = arm(name, o, style, cols); g.add(g.userData[name]); } };
  put('rh', pose.right); put('lh', pose.left); put('lhM', pose.leftMag); put('lhB', pose.leftAct); put('rhB', pose.rightAct);
  return g;
}

// 拿刀时空着的左手：张开、手心朝下放在画面左下（位置直接写在相机坐标里）
export function hdOffHand(cols) {
  return arm('lh', {
    left: true, grip: [-0.105, -0.112, -0.25], fingerDir: [0.66, -0.1, -0.74], palmDir: [0.12, -0.92, -0.37], hold: [0, 0.1, 0],
    elbow: [-0.36, -0.42, 0.18], pose: { curl: CURL.open, splay: [-0.16, -0.05, 0.06, 0.18], thumb: THUMB.open },
  }, handStyle(cols), cols);
}
