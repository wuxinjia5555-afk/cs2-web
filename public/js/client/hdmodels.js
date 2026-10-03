// 高精度模型：第一人称的枪和握枪的手。
// 零件都是照真枪的大致尺寸自己搭出来的（见 hdkit.js），没有用任何游戏的模型或贴图。
import * as THREE from 'three';
import { Kit, arcPts, rrect } from './hdkit.js';

const U = 0.00116; // 真枪的 1 毫米 = 模型里的这么多米（比真枪略大一点，第一人称里更饱满）
const YB = 0.045;  // 枪管轴线的高度（和旧模型一致，枪口火光、曳光弹的位置不用改）

// ============================== AK-47 ==============================
// 尺寸写的都是真枪上的毫米数：第一个数是离枪口多远，第二个数是比枪管轴线高多少
function ak47(k) {
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
  k.sweep('wood', X([[-19, 9], [-22.5, -2], [-23.5, -14], [-20, -26], [-12, -31], [12, -31], [20, -26], [23.5, -14], [22.5, -2], [19, 9]]), Z(268), Z(396), { bevel: 0.003 });
  k.sweep('wood', X([[-18, 10], [-19.5, 24], [-15, 36], [-7, 42], [7, 42], [15, 36], [19.5, 24], [18, 10]]), Z(252), Z(384), { bevel: 0.003 });
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
  });
  // ---- 弹匣卡笋、扳机护圈、扳机 ----
  k.prof('blued', P([540, -39], [548, -39], [550, -62], [543, -66], [540, -60]), 11 * U, { bevel: 0.0006 });
  k.prof('blued', P([552, -78], [632, -78], [632, -75], [552, -75]), 14 * U, { bevel: 0.0005 });
  k.prof('blued', P([547, -38], [551, -38], [556, -78], [552, -78]), 14 * U, { bevel: 0.0005 });
  k.prof('blued', P([628, -78], [632, -78], [643, -52], [639, -52]), 14 * U, { bevel: 0.0005 });
  k.prof('steel', P([596, -38], [603, -38], [604, -50], [600, -64], [596, -66], [597, -52]), 5 * U, { bevel: 0.0008 });
  // ---- 握把、枪托（木头）----
  k.prof('woodD', P([640, -38], [686, -38], [694, -60], [704, -100], [700, -128], [672, -134], [660, -110], [650, -80], [643, -52]), 28 * U, { bevel: 0.005 });
  k.prof('wood', P([700, 8], [876, -14], [876, -126], [868, -128], [718, -40], [700, -36]), 34 * U, { bevel: 0.007 });
  k.prof('blued', P([876, -12], [880, -13], [880, -128], [876, -129]), 35 * U, { bevel: 0.001 });

  const g = k.build();
  g.userData.muzzle = new THREE.Vector3(0, YB, Z(0) - 0.012);
  return g;
}

// ============================== 手 ==============================
// 手自己的坐标（按右手建，左手镜像）：+Y 朝指尖，+X 朝大拇指那一侧，+Z 是手心朝的方向，原点在手腕
const FINGERS = [
  { x: 0.030, y: 0.098, L: [0.044, 0.027, 0.022], r: 0.0105 },  // 食指
  { x: 0.010, y: 0.103, L: [0.048, 0.031, 0.024], r: 0.011 },   // 中指
  { x: -0.010, y: 0.100, L: [0.044, 0.029, 0.023], r: 0.0105 }, // 无名指
  { x: -0.029, y: 0.091, L: [0.035, 0.022, 0.020], r: 0.0095 }, // 小指
];
const AX = new THREE.Vector3(1, 0, 0), AZ = new THREE.Vector3(0, 0, 1);

// pose：curl = 四根手指各三节往手心弯多少（弧度）；splay = 各手指左右张开多少；thumb = 大拇指三节各自的方向（手的坐标里）
// style：fingerless = 露指手套；pads = 手背有护甲块
function hand(k, pose, style) {
  // 手掌
  k.sweep('glove', [[-0.030, 0], [0.030, 0], [0.041, 0.03], [0.044, 0.062], [0.040, 0.094], [0.022, 0.103], [0, 0.105], [-0.022, 0.099], [-0.040, 0.088], [-0.043, 0.05], [-0.037, 0.02]],
    -0.014, 0.014, { bevel: 0.008, crease: 1.0 });
  // 大鱼际（拇指根的那块肉）
  k.ball('glove', 0.019, 0.03, 0.014, new THREE.Matrix4().makeTranslation(0.024, 0.036, 0.01));
  // 四根手指
  const q = new THREE.Quaternion(), qc = new THREE.Quaternion(), d = new THREE.Vector3();
  FINGERS.forEach((f, i) => {
    let p = new THREE.Vector3(f.x, f.y, 0.001);
    q.setFromAxisAngle(AZ, pose.splay ? pose.splay[i] : 0);
    for (let s = 0; s < 3; s++) {
      q.multiply(qc.setFromAxisAngle(AX, pose.curl[i][s]));
      const n = p.clone().add(d.set(0, f.L[s], 0).applyQuaternion(q));
      k.link(style.fingerless && s > 0 ? 'skin' : 'glove', f.r * (1 - s * 0.07), p, n);
      p = n;
    }
  });
  // 大拇指
  let p = new THREE.Vector3(0.034, 0.03, 0.01);
  const TL = [0.038, 0.031, 0.026], TR = [0.0138, 0.012, 0.011];
  pose.thumb.forEach((dir, s) => {
    const n = p.clone().add(d.set(dir[0], dir[1], dir[2]).normalize().multiplyScalar(TL[s]));
    k.link(style.fingerless && s === 2 ? 'skin' : 'glove', TR[s], p, n);
    p = n;
  });
  k.fine(() => {
    // 手背：指关节上的护甲块、手背上的缝线条
    if (style.pads) for (const f of FINGERS) k.box('pad', 0.015, 0.008, 0.017, f.x, f.y - 0.004, -0.0165, { rx: Math.PI / 2, r: 0.003 });
    k.box('pad', 0.05, 0.004, 0.04, 0, 0.052, -0.0145, { rx: Math.PI / 2, r: 0.0015 });
    // 手腕上的搭扣带
    k.sweep('pad', rrect(-0.033, -0.018, 0.033, 0.018, 0.012), -0.006, 0.008, { bevel: 0.002, m: new THREE.Matrix4().makeRotationX(-Math.PI / 2) });
  });
}

// 把手摆到枪上：grip = 手心握住的那根东西的中心（枪的坐标），thumbDir = 大拇指那一侧朝哪，palmDir = 手心朝哪
function handMatrix(grip, thumbDir, palmDir, left, hold = [0, 0.1, 0.032]) {
  const z = new THREE.Vector3(...palmDir).normalize();
  const x0 = new THREE.Vector3(...thumbDir).normalize();
  if (left) x0.negate(); // 左手是镜像的：镜像后大拇指在 -X 那边
  const y = new THREE.Vector3().crossVectors(z, x0).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  if (left) m.multiply(new THREE.Matrix4().makeScale(-1, 1, 1));
  const h = new THREE.Vector3(...hold).applyMatrix4(m);
  m.setPosition(grip[0] - h.x, grip[1] - h.y, grip[2] - h.z);
  return m;
}

// 一只手 + 小臂。elbow：手肘在哪（枪的坐标，一般在画面外）
function arm(k, name, o, style) {
  const m = handMatrix(o.grip, o.thumbDir, o.palmDir, !!o.left, o.hold);
  k.group(name, () => {
    k.with(m, !!o.left, () => hand(k, o.pose, style));
    // 小臂：从手腕到手肘的一根扁圆管（扁的方向和手掌一致），靠手腕的一小段是手套的袖口
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
    piece('glove', -0.02, 0.1, 0.03, 0.034);
    // 袖子：越往手肘越粗，中间鼓一点，再加几道褶子，免得像一根直管子
    piece('sleeve', 0.07, 0.1, 0.039, 0.04); // 袖口收边
    piece('sleeve', 0.09, 0.32, 0.036, 0.05);
    piece('sleeve', 0.3, 0.62, 0.05, 0.057);
    piece('sleeve', 0.6, 1, 0.057, 0.066);
    for (const t of [0.19, 0.3, 0.44]) piece('sleeve', t, t + 0.035, 0.047 + t * 0.022, 0.049 + t * 0.022);
  });
}

// 握步枪的两只手：右手握握把（食指搭在扳机上），左手托着护木
const RIFLE_POSE = {
  right: {
    grip: [0.001, -0.052, 0.058], thumbDir: [0, 0.95, -0.31], palmDir: [-0.82, 0, -0.57], elbow: [0.2, -0.3, 0.42],
    pose: {
      curl: [[0.35, 0.75, 0.45], [1.25, 1.5, 0.8], [1.3, 1.5, 0.8], [1.3, 1.45, 0.75]],
      splay: [-0.1, 0, 0.04, 0.1],
      thumb: [[0.35, 0.45, 0.82], [-0.15, 0.6, 0.78], [-0.3, 0.85, 0.42]],
    },
  },
  left: {
    left: true, grip: [0, 0.0334, -0.325], thumbDir: [0, 0.12, -1], palmDir: [0.5, 0.87, 0], hold: [0, 0.07, 0.04], elbow: [-0.36, -0.3, 0.2],
    pose: {
      curl: [[0.75, 1.0, 0.55], [0.8, 1.0, 0.55], [0.82, 1.0, 0.55], [0.85, 1.0, 0.5]],
      splay: [-0.12, -0.03, 0.05, 0.14],
      thumb: [[0.45, 0.3, 0.84], [0.75, 0.2, 0.62], [0.9, 0.1, 0.42]],
    },
  },
};

// ============================== 对外 ==============================
// 有高精度模型的武器。gun(hd)：hd=true 是第一人称用的，false 是远处看的简化版
export const HD = {
  ak47: { gun: (hd) => ak47(new Kit(hd)), pose: RIFLE_POSE, lay: { pos: [0.115, -0.15, -0.27], rot: [0.03, 0.1, 0] } },
};

// 握着这把枪的两只手（第一人称）。cols：{ glove, sleeve, skin, fingerless }
export function hdHands(wid, cols) {
  const def = HD[wid];
  if (!def) return null;
  const k = new Kit(true, {
    glove: { color: cols.glove, metal: 0, rough: 0.82, tex: 'cloth', uv: 60 },
    pad: { color: cols.pad ?? 0x111214, metal: 0.1, rough: 0.55, tex: 'metal', uv: 20 },
    sleeve: { color: cols.sleeve, metal: 0, rough: 0.9, tex: 'cloth', uv: 40 },
    skin: { color: cols.skin, metal: 0, rough: 0.8 },
  });
  const style = { fingerless: !!cols.fingerless, pads: !cols.fingerless };
  arm(k, 'rh', def.pose.right, style);
  arm(k, 'lh', def.pose.left, style);
  return k.build();
}
