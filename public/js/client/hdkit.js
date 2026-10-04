// 高精度模型的建模工具（第一人称的枪和手用）：
// 按侧面轮廓挤出、沿枪管方向扫出截面、圆管、车削件、胶囊（手指），最后按材质合并成几个网格（减少绘制调用）。
// 坐标和旧模型一致：-Z 是枪口方向，+Y 朝上，+X 是持枪人的右手边，单位是米。
import * as THREE from 'three';

// ---------------- 贴图（程序生成，乘在材质颜色上的细节） ----------------
const texCache = new Map();
function detailTex(name) {
  let t = texCache.get(name);
  if (t) return t;
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  let seed = name.length * 7919 + 13;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  // 横向可以无缝平铺的波浪线（木纹 / 拉丝）
  const wavy = (y0, amp, k, ph, w, style) => {
    g.strokeStyle = style;
    g.lineWidth = w;
    for (const oy of [-S, 0, S]) {
      g.beginPath();
      for (let x = 0; x <= S; x += 4) {
        const y = y0 + oy + Math.sin((x / S) * Math.PI * 2 * k + ph) * amp;
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
  };
  if (name === 'wood') {
    g.fillStyle = 'rgb(232,222,212)';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 9; i++) wavy(rnd() * S, 3 + rnd() * 5, 1 + ((rnd() * 2) | 0), rnd() * 6.3, 6 + rnd() * 14, `rgba(110,60,25,${0.08 + rnd() * 0.1})`);
    for (let i = 0; i < 110; i++) wavy(rnd() * S, 1 + rnd() * 3.5, 1 + ((rnd() * 3) | 0), rnd() * 6.3, 0.6 + rnd() * 1.3, `rgba(70,35,12,${0.1 + rnd() * 0.28})`);
    for (let i = 0; i < 30; i++) wavy(rnd() * S, 1 + rnd() * 2, 1 + ((rnd() * 3) | 0), rnd() * 6.3, 0.6 + rnd(), `rgba(255,240,220,${0.06 + rnd() * 0.1})`);
  } else if (name === 'metal') {
    g.fillStyle = 'rgb(226,226,228)';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 160; i++) wavy(rnd() * S, rnd() * 0.8, 1, rnd() * 6.3, 0.5 + rnd(), rnd() < 0.5 ? `rgba(0,0,0,${0.03 + rnd() * 0.07})` : `rgba(255,255,255,${0.04 + rnd() * 0.08})`);
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(0,0,0,${0.04 + rnd() * 0.1})`; g.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2, 1); }
    for (let i = 0; i < 26; i++) {
      // 几道划痕
      g.strokeStyle = `rgba(255,255,255,${0.08 + rnd() * 0.12})`;
      g.lineWidth = 0.7;
      const x = rnd() * S, y = rnd() * S, a = (rnd() - 0.5) * 1.2, l = 8 + rnd() * 26;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
  } else {
    // 布料：细密的经纬线
    g.fillStyle = 'rgb(226,226,226)';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < S; i += 4) {
      g.fillStyle = `rgba(0,0,0,${0.07 + rnd() * 0.07})`; g.fillRect(i, 0, 1.5, S);
      g.fillStyle = `rgba(0,0,0,${0.07 + rnd() * 0.07})`; g.fillRect(0, i, S, 1.5);
      g.fillStyle = `rgba(255,255,255,${0.04 + rnd() * 0.05})`; g.fillRect(i + 2, 0, 1, S);
    }
  }
  t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  texCache.set(name, t);
  return t;
}

// ---------------- 材质 ----------------
// 每种材质：颜色、金属感、粗糙度、细节贴图、贴图密度（每米重复几次）
export const HD_MATS = {
  steel: { color: 0x555960, metal: 0.85, rough: 0.34, tex: 'metal', uv: 7 },       // 枪管、机匣这类钢件
  blued: { color: 0x33363c, metal: 0.82, rough: 0.38, tex: 'metal', uv: 7 },      // 发蓝的深色钢
  bright: { color: 0x8d9299, metal: 0.9, rough: 0.3, tex: 'metal', uv: 7 },       // 磨亮的钢（枪机）
  black: { color: 0x17181b, metal: 0.25, rough: 0.62, tex: 'metal', uv: 7 },      // 黑色塑料 / 烤漆
  wood: { color: 0x7d4524, metal: 0, rough: 0.46, tex: 'wood', uv: 4.5 },          // 木头护木、枪托
  woodD: { color: 0x5b3219, metal: 0, rough: 0.5, tex: 'wood', uv: 4.5 },        // 深一点的木头（握把）
  bore: { color: 0x030303, metal: 0, rough: 1 },                                  // 枪口里面
  blade: { color: 0xb4bbc4, metal: 0.95, rough: 0.3, tex: 'metal', uv: 9 },       // 刀面：缎面钢
  edge: { color: 0xe6eaef, metal: 1, rough: 0.16 },                               // 磨出来的刃面：很亮
  rubber: { color: 0x1c1d20, metal: 0, rough: 0.86 },                             // 橡胶 / 尼龙刀柄
  olive: { color: 0x3a4030, metal: 0, rough: 0.8 },                               // 军绿色塑料
  oliveD: { color: 0x2b3024, metal: 0, rough: 0.82 },
  brass: { color: 0xb8975a, metal: 0.9, rough: 0.35 },                            // 黄铜（销钉）
  cord: { color: 0x26272b, metal: 0, rough: 0.95 },                               // 伞绳
  polymer: { color: 0x212226, metal: 0.05, rough: 0.72 },                         // 手枪的塑料套筒座
  slate: { color: 0x39424d, metal: 0.05, rough: 0.7 },                            // 鸟狙的深蓝灰枪托
  lens: { color: 0x1b2a40, metal: 0.95, rough: 0.08 },                            // 瞄准镜镜片
  glass: { color: 0x5a4a26, metal: 0.2, rough: 0.12 },                            // 燃烧瓶的玻璃
  label: { color: 0xd9d3c0, metal: 0, rough: 0.8 },                               // 标签 / 色带
  rag: { color: 0xd8d2c0, metal: 0, rough: 0.95, tex: 'cloth', uv: 60 },          // 布条
  nadeF: { color: 0x8c9aa6, metal: 0.6, rough: 0.4, tex: 'metal', uv: 9 },        // 闪光弹的壳
  nadeS: { color: 0x596654, metal: 0.1, rough: 0.7 },                             // 烟雾弹的壳
  red: { color: 0x8a2c22, metal: 0.1, rough: 0.6 },
  wireB: { color: 0x2a5cc4, metal: 0.1, rough: 0.6 },
  c4: { color: 0xa49066, metal: 0, rough: 0.85, tex: 'cloth', uv: 30 },           // C4 的油纸包
  lcd: { color: 0x3cff6e, metal: 0, rough: 0.4 },
  keys: { color: 0x9aa0a8, metal: 0.2, rough: 0.5 },
  // 三把花刀用的（glow：自己发光的颜色，glowK：多亮）
  gold: { color: 0xd8a23c, metal: 1, rough: 0.27 },                               // 鎏金
  goldD: { color: 0x9a6a24, metal: 1, rough: 0.36 },
  teal: { color: 0x1487c2, metal: 0.55, rough: 0.3, glow: 0x0a5f8e, glowK: 0.7 },   // 天御刀的刀身：青蓝色、自己发光（底色要深，不然一打光就成白的了）
  tealE: { color: 0x8fe4ff, metal: 0.3, rough: 0.2, glow: 0x35b6dc, glowK: 0.55 },  // 刃面 / 刀身中间那道亮线
  gemB: { color: 0x2d8fff, metal: 0.3, rough: 0.1, glow: 0x1560ff, glowK: 0.9 },    // 蓝宝石
  tealG: { color: 0x1c3a46, metal: 0.1, rough: 0.72 },                              // 缠绳刀柄
  shadow: { color: 0x1c1a24, metal: 0.86, rough: 0.4, tex: 'metal', uv: 9 },        // 影刃：发黑的钢
  shadowE: { color: 0x565070, metal: 1, rough: 0.2 },
  violet: { color: 0x9a5cff, metal: 0.1, rough: 0.3, glow: 0x7a2cff, glowK: 1.25 }, // 刀身里的紫色能量
  violetD: { color: 0x3d2c63, metal: 0.65, rough: 0.38 },                           // 暗紫色的护手、刀尾
  leather: { color: 0x141218, metal: 0, rough: 0.82 },
  lilac: { color: 0xc3bde0, metal: 0.92, rough: 0.26, tex: 'metal', uv: 9 },        // 威龙之刃：淡紫色的亮钢
  neon: { color: 0xff62e2, metal: 0, rough: 0.4, glow: 0xff2ad2, glowK: 1.5 },      // 描边的霓虹粉
  carbon: { color: 0x16151c, metal: 0.45, rough: 0.5 },
  ivory: { color: 0xf5f0ff, metal: 0.2, rough: 0.3, glow: 0xd8c6ff, glowK: 0.45 },  // 刀刃根上那排白色的尖齿
};
const stdCache = new Map(), flatCache = new Map();
// 第一人称用的材质（带金属反光和贴图）；extra 可以加自定义材质（比如按队伍上色的手套）
export function hdMat(key, extra) {
  const def = (extra && extra[key]) || HD_MATS[key];
  const ck = key + ':' + def.color;
  let m = stdCache.get(ck);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: def.color, metalness: def.metal ?? 0, roughness: def.rough ?? 0.8 });
    if (def.tex) { m.map = detailTex(def.tex); m.roughnessMap = m.map; }
    if (def.glow != null) { m.emissive = new THREE.Color(def.glow); m.emissiveIntensity = def.glowK ?? 1; }
    stdCache.set(ck, m);
  }
  return m;
}
// 远处看的模型（别人手里的枪、掉在地上的枪）：只用纯色，和其他旧模型一样
export function flatMat(key, extra) {
  const def = (extra && extra[key]) || HD_MATS[key];
  let m = flatCache.get(def.color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: def.color });
    if (def.glow != null) { m.emissive = new THREE.Color(def.glow); m.emissiveIntensity = (def.glowK ?? 1) * 0.6; }
    flatCache.set(def.color, m);
  }
  return m;
}

// ---------------- 第一人称的环境反光 ----------------
// 金属要有东西可反射才好看：用一个渐变天空 + 几块亮面板烘出一张环境贴图（每个渲染器做一次）
const envCache = new WeakMap();
export function viewEnv(renderer) {
  let tex = envCache.get(renderer);
  if (tex) return tex;
  const sc = new THREE.Scene();
  const dome = new THREE.SphereGeometry(20, 24, 12);
  const pos = dome.attributes.position, col = [];
  const top = new THREE.Color(0.75, 0.86, 1.05), hor = new THREE.Color(1.0, 0.94, 0.84), low = new THREE.Color(0.2, 0.16, 0.12), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i) / 20;
    if (h >= 0) c.copy(hor).lerp(top, Math.pow(h, 0.6)); else c.copy(hor).lerp(low, Math.min(1, -h * 3));
    col.push(c.r, c.g, c.b);
  }
  dome.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  sc.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, toneMapped: false })));
  const panel = (x, y, z, w, h, r, g, b) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), side: THREE.DoubleSide, toneMapped: false }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    sc.add(m);
  };
  panel(6, 12, 5, 9, 9, 9, 8.4, 7.2);      // 太阳那一侧：又亮又暖
  panel(-10, 6, -4, 8, 10, 2.2, 2.6, 3.2); // 另一侧：偏蓝的天光
  panel(0, 3, -14, 16, 5, 1.6, 1.5, 1.3);  // 前方地平线上的一条亮带
  const pm = new THREE.PMREMGenerator(renderer);
  tex = pm.fromScene(sc, 0.03).texture;
  pm.dispose();
  sc.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  envCache.set(renderer, tex);
  return tex;
}

// ---------------- 几何体 ----------------
const V2 = (p) => new THREE.Vector2(p[0], p[1]);

// 光滑法线：同一个位置上、朝向相差不大的面共用平均法线（曲面变光滑，棱角仍然是硬边）
function creaseNormals(geo, angle = 0.62) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const P = g.attributes.position.array, n = P.length / 9;
  const fn = new Float32Array(n * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let f = 0; f < n; f++) {
    a.fromArray(P, f * 9); b.fromArray(P, f * 9 + 3); c.fromArray(P, f * 9 + 6);
    b.sub(a); c.sub(a); b.cross(c);
    const area = b.length();
    if (area > 0) b.multiplyScalar(1 / area);
    fn[f * 3] = b.x; fn[f * 3 + 1] = b.y; fn[f * 3 + 2] = b.z;
  }
  const map = new Map();
  // 同一个位置的顶点归到一起：三个坐标各量化成 17 位整数拼成一个数（比拼字符串快得多；模型都在 ±3 米以内）
  const keyOf = (i) => ((Math.round(P[i] * 20000) + 65536) * 131072 + Math.round(P[i + 1] * 20000) + 65536) * 131072 + Math.round(P[i + 2] * 20000) + 65536;
  for (let v = 0; v < n * 3; v++) {
    const k = keyOf(v * 3);
    let l = map.get(k);
    if (!l) map.set(k, (l = []));
    l.push((v / 3) | 0);
  }
  const N = new Float32Array(P.length), cosA = Math.cos(angle);
  for (let v = 0; v < n * 3; v++) {
    const f = (v / 3) | 0, fx = fn[f * 3], fy = fn[f * 3 + 1], fz = fn[f * 3 + 2];
    let x = 0, y = 0, z = 0;
    for (const o of map.get(keyOf(v * 3))) {
      const ox = fn[o * 3], oy = fn[o * 3 + 1], oz = fn[o * 3 + 2];
      if (ox * fx + oy * fy + oz * fz >= cosA) { x += ox; y += oy; z += oz; }
    }
    const l = Math.hypot(x, y, z) || 1;
    N[v * 3] = x / l; N[v * 3 + 1] = y / l; N[v * 3 + 2] = z / l;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  return g;
}

function extrude(pts, depth, bevel, seg, holes) {
  const shape = new THREE.Shape(pts.map(V2));
  if (holes) for (const h of holes) shape.holes.push(new THREE.Path(h.map(V2)));
  const b = Math.max(0, Math.min(bevel, depth / 2 - 1e-4));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: depth - 2 * b, steps: 1, curveSegments: 4,
    bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: seg,
  });
  geo.translate(0, 0, -(depth - 2 * b) / 2);
  return geo;
}

// 圆角矩形的轮廓点（给 prof / sweep 用）
export function rrect(a0, b0, a1, b1, r, n = 3) {
  const pts = [];
  const arc = (cx, cy, s) => { for (let i = 0; i <= n; i++) { const t = s + (i / n) * Math.PI / 2; pts.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]); } };
  arc(a1 - r, b1 - r, 0); arc(a0 + r, b1 - r, Math.PI / 2); arc(a0 + r, b0 + r, Math.PI); arc(a1 - r, b0 + r, Math.PI * 1.5);
  return pts;
}
// 一段圆弧上的点 [u, v]
export function arcPts(cu, cv, r, t0, t1, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const t = t0 + ((t1 - t0) * i) / n; pts.push([cu + Math.cos(t) * r, cv + Math.sin(t) * r]); }
  return pts;
}

const M4 = new THREE.Matrix4(), EU = new THREE.Euler(), QT = new THREE.Quaternion(), ONE = new THREE.Vector3(1, 1, 1);
export function xform(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), QT.setFromEuler(EU.set(rx, ry, rz)), ONE);
}

// 把一个模型拆成零件来搭：每个零件给一种材质，可以放进有名字的组（弹匣、枪机这些要单独动的）
export class Kit {
  constructor(hd = true, extraMats = null) {
    this.hd = hd;            // true：第一人称（细节全做）；false：远处看的简化版
    this.extra = extraMats;
    this.items = [];
    this.grp = '';
    this.meta = {};          // 各个组的设置：{ pivot: 绕哪个点转, parent: 挂在哪个组下面 }
    this.base = null;        // 当前这批零件统一再乘的矩阵（比如整只手摆到握把上）
    this.flip = false;       // base 是镜像矩阵（左手）时要把三角面翻过来
  }
  get seg() { return this.hd ? 2 : 1; }
  get round() { return this.hd ? 14 : 8; }
  // 有名字的组：里面的零件单独成一组（要单独动的零件）。
  // o.pivot = [x, y, z]：这一组绕这个点转（组的原点放在这里）；o.parent = 另一个组的名字：挂在它下面、跟着它一起动
  group(name, fn, o) { const p = this.grp; this.grp = name; if (o) this.meta[name] = o; if (fn) fn(); this.grp = p; }
  fine(fn) { if (this.hd) fn(); }
  with(matrix, flip, fn) { const b = this.base, f = this.flip; this.base = matrix; this.flip = flip; fn(); this.base = b; this.flip = f; }

  add(mat, geo, m) {
    if (m) geo.applyMatrix4(m);
    if (this.base) geo.applyMatrix4(this.base);
    this.items.push({ mat, geo, grp: this.grp, flip: this.flip });
  }
  // 侧面轮廓 pts=[[z, y]…]，左右方向厚 w，中心在 x
  prof(mat, pts, w, o = {}) {
    let geo = extrude(pts, w, o.bevel ?? 0.002, this.seg, o.holes);
    geo.rotateY(-Math.PI / 2);
    if (o.x) geo.translate(o.x, 0, 0);
    this.add(mat, creaseNormals(geo, o.crease), o.m);
  }
  // 截面 pts=[[x, y]…] 沿枪管方向从 z0 扫到 z1
  sweep(mat, pts, z0, z1, o = {}) {
    const d = Math.abs(z1 - z0);
    const geo = extrude(pts, d, o.bevel ?? 0.0015, this.seg);
    geo.translate(0, 0, (z0 + z1) / 2);
    this.add(mat, creaseNormals(geo, o.crease), o.m);
  }
  // 圆角方盒
  box(mat, w, h, d, x, y, z, o = {}) {
    const r = Math.min(o.r ?? 0.0015, h / 2 - 1e-4, d / 2 - 1e-4);
    const geo = extrude(rrect(-d / 2, -h / 2, d / 2, h / 2, r, this.hd ? 2 : 1), w, o.bevel ?? r, this.seg);
    geo.rotateY(-Math.PI / 2);
    const m = xform(x, y, z, o.rx, o.ry, o.rz);
    this.add(mat, creaseNormals(geo), o.m ? o.m.clone().multiply(m) : m); // o.m：先在自己的小坐标里摆好，再整体搬过去
  }
  // 放样：一串「圆角方」的截面沿 +Y 连起来，做手指、手腕这种略扁、一头粗一头细的东西。
  // rings = [[y, 宽, 厚]…]：宽沿 X，厚沿 Z；exp 越大截面越方
  loft(mat, rings, m, o = {}) {
    const n = o.seg ?? (this.hd ? 12 : 6), e = 2 / (o.exp ?? 2.6), pos = [], idx = [];
    for (const r of rings) {
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2, c = Math.cos(a), s2 = Math.sin(a);
        pos.push((Math.sign(c) * Math.pow(Math.abs(c), e) * r[1]) / 2, r[0], (Math.sign(s2) * Math.pow(Math.abs(s2), e) * r[2]) / 2);
      }
    }
    for (let j = 0; j < rings.length - 1; j++) {
      for (let k = 0; k < n; k++) {
        const a = j * n + k, b = j * n + ((k + 1) % n);
        idx.push(a, a + n, b, b, a + n, b + n);
      }
    }
    const c0 = pos.length / 3, top = (rings.length - 1) * n;
    pos.push(0, rings[0][0], 0, 0, rings[rings.length - 1][0], 0);
    for (let k = 0; k < n; k++) idx.push(c0, k, (k + 1) % n, c0 + 1, top + ((k + 1) % n), top + k);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.add(mat, geo, m);
  }
  // 沿枪管方向的圆管：z0 那头半径 r，z1 那头半径 r1
  tube(mat, r, z0, z1, o = {}) {
    const lo = Math.min(z0, z1), hi = Math.max(z0, z1), rLo = z0 < z1 ? r : o.r1 ?? r, rHi = z0 < z1 ? o.r1 ?? r : r;
    const geo = new THREE.CylinderGeometry(rHi, rLo, hi - lo, o.seg ?? this.round, 1, !!o.open);
    geo.rotateX(Math.PI / 2);
    // 斜切：把一头的端面按高度前后错开（斜口制退器）。cut = ['lo' 或 'hi', 斜率]
    if (o.cut) {
      const P = geo.attributes.position, end = ((o.cut[0] === 'lo' ? -1 : 1) * (hi - lo)) / 2;
      for (let i = 0; i < P.count; i++) if (Math.abs(P.getZ(i) - end) < 1e-6) P.setZ(i, end + o.cut[1] * P.getY(i));
      geo.computeVertexNormals();
    }
    geo.translate(o.x ?? 0, o.y ?? 0, (lo + hi) / 2);
    this.add(mat, geo, o.m);
  }
  // 两点之间的圆棒：a 那头半径 r，b 那头半径 r1
  rod(mat, r, a, b, o = {}) {
    const va = new THREE.Vector3(a[0], a[1], a[2]), vb = new THREE.Vector3(b[0], b[1], b[2]);
    const geo = new THREE.CylinderGeometry(o.r1 ?? r, r, va.distanceTo(vb), o.seg ?? (this.hd ? 10 : 6));
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize()));
    geo.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    this.add(mat, geo, o.m);
  }
  // 横着的圆柱（铆钉、销子、拉机柄）
  pin(mat, r, x0, x1, y, z, o = {}) {
    const geo = new THREE.CylinderGeometry(o.r1 ?? r, r, Math.abs(x1 - x0), o.seg ?? (this.hd ? 10 : 6));
    geo.rotateZ(-Math.PI / 2);
    geo.translate((x0 + x1) / 2, y, z);
    this.add(mat, geo, o.m);
  }
  // 两点之间的胶囊（两头是圆的，手指一节一节用它连起来）。a、b 是 Vector3
  link(mat, r, a, b) {
    const geo = new THREE.CapsuleGeometry(r, a.distanceTo(b), this.hd ? 4 : 2, this.hd ? 10 : 6);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
    geo.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    this.add(mat, geo);
  }
  // 车削件：轮廓 pts=[[z, 半径]…] 绕枪管轴线转一圈（phi0 / phiLen 可以只转一部分）
  lathe(mat, pts, o = {}) {
    const s = pts.slice().sort((a, b) => a[0] - b[0]).map((p) => new THREE.Vector2(Math.max(p[1], 1e-5), p[0]));
    const geo = new THREE.LatheGeometry(s, o.seg ?? this.round, o.phi0 ?? 0, o.phiLen ?? Math.PI * 2);
    geo.rotateX(Math.PI / 2);
    geo.translate(o.x ?? 0, o.y ?? 0, 0);
    this.add(mat, geo, o.m);
  }
  // 椭球
  ball(mat, rx, ry, rz, m) {
    const geo = new THREE.SphereGeometry(1, this.hd ? 14 : 8, this.hd ? 10 : 6);
    geo.scale(rx, ry, rz);
    this.add(mat, geo, m);
  }
  // 圆环（刀环、拉环）：R 是环的半径，r 是环条的粗细；默认环面朝左右（绕 x 轴的一个圈）
  torus(mat, R, r, x, y, z, o = {}) {
    const geo = new THREE.TorusGeometry(R, r, this.hd ? 8 : 5, this.hd ? 22 : 12);
    geo.rotateY(Math.PI / 2);
    const m = xform(x, y, z, o.rx, o.ry, o.rz);
    this.add(mat, geo, o.m ? o.m.clone().multiply(m) : m);
  }
  // 刀身：磨出刃面的刀。直刀 st = [[z, 刀背 y, 刀刃 y, 厚度, 刃面高度, 刀背厚度]…]，从刀根排到刀尖；
  // 弯刀（o.curve）每一站分别写刀背和刀刃的位置：[刀背 z, 刀背 y, 刀刃 z, 刀刃 y, 厚度, 刃面高度, 刀背厚度]
  // （刃面高度：从刃口往刀背磨到多高；刀背厚度不写就和厚度一样，写小了就是刀背上磨出的假刃）
  // mat 是刀面的材质，edgeMat 是磨出来的刃面（一般更亮）
  blade(mat, edgeMat, st, o = {}) {
    const flat = [], edge = [], x = o.x || 0;
    const quad = (out, a, b, c, d) => out.push(...a, ...b, ...c, ...a, ...c, ...d);
    const pts = (s) => {
      const [zs, ys, ze, ye, t, gh, ts = t] = o.curve ? s : [s[0], s[1], s[0], s[2], s[3], s[4], s[5]];
      const L = Math.hypot(zs - ze, ys - ye) || 1e-9, f = Math.min(1, gh / L);
      const zg = ze + (zs - ze) * f, yg = ye + (ys - ye) * f;
      return { A: [x - ts / 2, ys, zs], B: [x + ts / 2, ys, zs], C: [x - t / 2, yg, zg], D: [x + t / 2, yg, zg], E: [x, ye, ze] };
    };
    for (let i = 0; i < st.length - 1; i++) {
      const p = pts(st[i]), q = pts(st[i + 1]);
      quad(flat, p.A, p.B, q.B, q.A);   // 刀背
      quad(flat, p.A, q.A, q.C, p.C);   // 左刀面
      quad(flat, p.B, p.D, q.D, q.B);   // 右刀面
      quad(edge, p.C, q.C, q.E, p.E);   // 左刃面
      quad(edge, p.D, p.E, q.E, q.D);   // 右刃面
    }
    const p0 = pts(st[0]);
    flat.push(...p0.A, ...p0.D, ...p0.B, ...p0.A, ...p0.C, ...p0.D, ...p0.C, ...p0.E, ...p0.D); // 刀根的端面
    // 上面的三角面是按「刀尖朝前、刀背朝上」排的；刀背在另一侧（比如爪子刀，刃在内弧）就把面翻过来
    const p1 = pts(st[1]);
    const tz = p1.A[2] + p1.E[2] - p0.A[2] - p0.E[2], ty = p1.A[1] + p1.E[1] - p0.A[1] - p0.E[1];
    if (tz * (p0.A[1] - p0.E[1]) - ty * (p0.A[2] - p0.E[2]) > 0) {
      for (const arr of [flat, edge]) for (let i = 0; i < arr.length; i += 9) for (let k = 0; k < 3; k++) { const v = arr[i + 3 + k]; arr[i + 3 + k] = arr[i + 6 + k]; arr[i + 6 + k] = v; }
    }
    for (const [m, arr] of [[mat, flat], [edgeMat, edge]]) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      geo.computeVertexNormals();
      this.add(m, creaseNormals(geo, 0.12), o.m);
    }
  }
  // 胶囊（手指的一节）：沿自己的 +Y，从原点伸出 len
  capsule(mat, r, len, m, r1) {
    const geo = r1 != null && r1 !== r
      ? new THREE.CylinderGeometry(r1, r, len, this.hd ? 10 : 6)
      : new THREE.CapsuleGeometry(r, len, this.hd ? 4 : 2, this.hd ? 10 : 6);
    geo.translate(0, len / 2, 0);
    this.add(mat, geo, m);
  }

  // 合并：每个组里每种材质一个网格。返回 Group，带名字的组挂在 userData 上
  build() {
    const root = new THREE.Group(), groups = { '': root }, buckets = new Map(), meta = this.meta;
    const pivotOf = (name) => (meta[name] && meta[name].pivot) || [0, 0, 0];
    // 建一个组：原点放在它的转轴上，挂到上一级的组里
    const mk = (name) => {
      let g = groups[name];
      if (g) return g;
      g = groups[name] = new THREE.Group();
      g.name = name;
      const par = meta[name] && meta[name].parent, pv = pivotOf(name), pp = par ? pivotOf(par) : [0, 0, 0];
      g.position.set(pv[0] - pp[0], pv[1] - pp[1], pv[2] - pp[2]);
      (par ? mk(par) : root).add(g);
      root.userData[name] = g;
      return g;
    };
    for (const it of this.items) {
      const k = it.grp + '|' + it.mat;
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = { grp: it.grp, mat: it.mat, pos: [], nor: [], uv: [] }));
      const geo = it.geo.index ? it.geo.toNonIndexed() : it.geo;
      const P = geo.attributes.position.array, N = geo.attributes.normal.array;
      const def = (this.extra && this.extra[it.mat]) || HD_MATS[it.mat], s = def.uv || 6;
      const pv = pivotOf(it.grp);
      for (let f = 0; f < P.length; f += 9) {
        // 镜像过的零件（左手）要把每个三角形的顶点顺序倒过来，不然面会朝里
        const ord = it.flip ? [0, 6, 3] : [0, 3, 6];
        const ax = P[f + 3] - P[f], ay = P[f + 4] - P[f + 1], az = P[f + 5] - P[f + 2];
        const bx = P[f + 6] - P[f], by = P[f + 7] - P[f + 1], bz = P[f + 8] - P[f + 2];
        const nx = Math.abs(ay * bz - az * by), ny = Math.abs(az * bx - ax * bz), nz = Math.abs(ax * by - ay * bx);
        for (const o of ord) {
          const x = P[f + o], y = P[f + o + 1], z = P[f + o + 2];
          b.pos.push(x - pv[0], y - pv[1], z - pv[2]);
          b.nor.push(N[f + o], N[f + o + 1], N[f + o + 2]);
          // 贴图按面的朝向从三个方向里挑一个投上去；木纹、拉丝都顺着枪管方向
          if (nx >= ny && nx >= nz) b.uv.push(z * s, y * s);
          else if (ny >= nz) b.uv.push(z * s, x * s);
          else b.uv.push(x * s, y * s);
        }
      }
      it.geo.dispose();
    }
    for (const name in meta) mk(name); // 没有零件的空组（只当转轴用）也要建出来
    for (const b of buckets.values()) {
      const g = mk(b.grp);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      geo.computeBoundingSphere();
      g.add(new THREE.Mesh(geo, this.hd ? hdMat(b.mat, this.extra) : flatMat(b.mat, this.extra)));
    }
    this.items.length = 0;
    return root;
  }
}
