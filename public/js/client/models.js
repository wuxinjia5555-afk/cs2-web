// 程序生成的模型：士兵（低多边形）；武器、投掷物、C4 用 hdmodels.js / hdguns.js 里的高精度模型
import * as THREE from 'three';
import { textSprite, flare } from './textures.js';
import { HD, HD_KNIVES } from './hdmodels.js';

const geoCache = new Map();
const matCache = new Map();

export function mat(color, extra) {
  const key = color + (extra ? JSON.stringify(extra) : '');
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, ...(extra || {}) });
    matCache.set(key, m);
  }
  return m;
}

function boxGeo(w, h, d) {
  const k = `b${w},${h},${d}`;
  let g = geoCache.get(k);
  if (!g) { g = new THREE.BoxGeometry(w, h, d); geoCache.set(k, g); }
  return g;
}

// ---------- 合并网格（减少绘制调用，手机上很重要） ----------
const mergeCache = new Map();
let vcolMat = null;
function vertexColorMat() {
  if (!vcolMat) vcolMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  return vcolMat;
}
function mergeMeshes(meshes, key) {
  if (key && mergeCache.has(key)) return mergeCache.get(key);
  const pos = [], nor = [], col = [];
  const c = new THREE.Color();
  for (const m of meshes) {
    m.updateMatrix();
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    g.applyMatrix4(m.matrix);
    c.copy(m.material.color);
    const P = g.attributes.position.array, N = g.attributes.normal.array;
    for (let i = 0; i < P.length; i++) { pos.push(P[i]); nor.push(N[i]); }
    for (let i = 0; i < P.length / 3; i++) col.push(c.r, c.g, c.b);
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  if (key) mergeCache.set(key, geo);
  return geo;
}
// 把一个组里的直接子网格合并成一个（保留子组层级，便于做动画）
export function collapse(group, key) {
  const meshes = group.children.filter((o) => o.isMesh);
  if (meshes.length > 1) {
    const geo = mergeMeshes(meshes, key);
    for (const m of meshes) group.remove(m);
    const mm = new THREE.Mesh(geo, vertexColorMat());
    mm.castShadow = true;
    group.add(mm);
  }
  let i = 0;
  for (const ch of group.children) {
    if (!ch.isMesh && !ch.isSprite) collapse(ch, key ? key + '/' + i : null);
    i++;
  }
}

function box(w, h, d, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(boxGeo(w, h, d), mat(color));
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  return m;
}
// ---------------- 武器 ----------------
// 武器模型都在 hdmodels.js / hdguns.js 里（高精度）。这里分两种用法：
//   第一人称（merged = false）：完整版，零件分组（弹匣、枪机……可以单独动）
//   别人手里 / 地上的（merged = true）：简化版，整把枪合并成一个网格、只有顶点颜色；每种武器只搭一次，之后共用
const worldGeo = new Map();
function worldWeapon(key, build) {
  let geo = worldGeo.get(key);
  if (!geo) {
    const src = build();
    src.updateMatrixWorld(true);
    const pos = [], nor = [], col = [], c = new THREE.Color();
    src.traverse((m) => {
      if (!m.isMesh) return;
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      c.copy(m.material.color);
      const P = g.attributes.position.array, N = g.attributes.normal.array;
      for (let i = 0; i < P.length; i++) { pos.push(P[i]); nor.push(N[i]); }
      for (let i = 0; i < P.length / 3; i++) col.push(c.r, c.g, c.b);
      g.dispose();
    });
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    geo.userData.muzzle = src.userData.muzzle || new THREE.Vector3();
    src.traverse((m) => { if (m.isMesh) m.geometry.dispose(); });
    worldGeo.set(key, geo);
  }
  const g = new THREE.Group(), mesh = new THREE.Mesh(geo, vertexColorMat());
  mesh.castShadow = true;
  g.add(mesh);
  g.userData.muzzle = geo.userData.muzzle;
  return g;
}

export function makeWeapon(id, merged = false, skin = null) {
  const knife = !HD[id];
  const sk = knife ? (skin && HD_KNIVES[skin] ? skin : 'default') : null;
  const build = (hd) => (knife ? HD_KNIVES[sk](hd) : HD[id].gun(hd));
  const g = merged ? worldWeapon(knife ? 'knife:' + sk : id, () => build(false)) : build(true);
  if (!merged) g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData.id = id;
  return g;
}

// ---------------- 士兵 ----------------
const TEAM_COL = {
  T: { shirt: 0x8a6d46, vest: 0x5d4d34, pants: 0x5b4a35, boots: 0x2a2520, skin: 0xc49470, head: 0x252526, glove: 0x2c2620, accent: 0x9b7b4c },
  CT: { shirt: 0x2f4865, vest: 0x2a3a4e, pants: 0x28384c, boots: 0x16181b, skin: 0xd1a07c, head: 0x1f2b3b, glove: 0x1c1f24, accent: 0x3c5a7c },
};

export class PlayerModel {
  constructor(team, name) {
    const P = TEAM_COL[team] || TEAM_COL.T;
    this.team = team;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.hips = new THREE.Group();
    this.hips.position.y = 0.82;
    this.body.add(this.hips);
    const leg = (x) => {
      const L = new THREE.Group();
      L.position.set(x, 0, 0);
      L.add(box(0.17, 0.44, 0.2, P.pants, 0, -0.22, 0));
      const shin = new THREE.Group();
      shin.position.set(0, -0.44, 0);
      shin.add(box(0.155, 0.3, 0.18, P.pants, 0, -0.15, 0));
      shin.add(box(0.17, 0.09, 0.27, P.boots, 0, -0.335, -0.035));
      L.add(shin);
      L.userData.shin = shin;
      this.hips.add(L);
      return L;
    };
    this.legL = leg(-0.105);
    this.legR = leg(0.105);
    this.upper = new THREE.Group();
    this.hips.add(this.upper);
    this.upper.add(box(0.42, 0.34, 0.24, P.pants, 0, 0.1, 0));
    this.upper.add(box(0.44, 0.4, 0.26, P.shirt, 0, 0.44, 0));
    this.upper.add(box(0.47, 0.38, 0.3, P.vest, 0, 0.42, 0));
    this.upper.add(box(0.16, 0.12, 0.05, P.accent, -0.1, 0.38, -0.16));
    this.upper.add(box(0.16, 0.12, 0.05, P.accent, 0.1, 0.38, -0.16));
    this.head = new THREE.Group();
    this.head.position.set(0, 0.68, 0);
    this.upper.add(this.head);
    this.head.add(box(0.1, 0.07, 0.1, P.skin, 0, 0.02, 0));
    this.head.add(box(0.24, 0.28, 0.26, team === 'CT' ? P.skin : P.head, 0, 0.175, 0));
    if (team === 'CT') {
      this.head.add(box(0.28, 0.12, 0.3, P.head, 0, 0.3, 0.005));
      this.head.add(box(0.2, 0.05, 0.02, 0x111111, 0, 0.21, -0.135));
      this.head.add(box(0.26, 0.05, 0.27, P.head, 0, 0.24, 0.01));
    } else {
      this.head.add(box(0.2, 0.05, 0.015, P.skin, 0, 0.2, -0.13));
      this.head.add(box(0.05, 0.02, 0.01, 0x111111, -0.05, 0.2, -0.139));
      this.head.add(box(0.05, 0.02, 0.01, 0x111111, 0.05, 0.2, -0.139));
    }
    this.arms = new THREE.Group();
    this.arms.position.set(0, 0.56, 0);
    this.upper.add(this.arms);
    this.arms.add(box(0.1, 0.1, 0.28, P.shirt, 0.2, -0.07, -0.1, -0.35, 0.2));
    this.arms.add(box(0.09, 0.09, 0.26, P.shirt, 0.13, -0.13, -0.33, -0.1, 0.35));
    this.arms.add(box(0.08, 0.08, 0.08, P.glove, 0.07, -0.13, -0.45));
    this.arms.add(box(0.1, 0.1, 0.28, P.shirt, -0.2, -0.07, -0.12, -0.3, -0.35));
    this.arms.add(box(0.09, 0.09, 0.28, P.shirt, -0.08, -0.08, -0.38, -0.05, -0.55));
    this.arms.add(box(0.08, 0.08, 0.08, P.glove, 0.0, -0.06, -0.54));
    this.gunHolder = new THREE.Group();
    this.gunHolder.position.set(0.06, -0.09, -0.45);
    this.arms.add(this.gunHolder);
    this.c4 = makeWeapon('c4', true);
    this.c4.position.set(0, 0.42, 0.19);
    this.c4.rotation.set(Math.PI / 2, 0, 0);
    this.c4.visible = false;
    this.upper.add(this.c4);
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
    collapse(this.root, 'p:' + team);
    this.tag = null;
    if (name) this.setName(name, team);
    this.wid = null;
    this.phase = 0;
    this.crouchAmt = 0;
    this.deadT = -1;
    this.walkAmp = 0;
  }

  setName(name, team) {
    if (this.tag) { this.root.remove(this.tag); this.tag.material.map.dispose(); this.tag.material.dispose(); }
    const tex = textSprite(name, team === 'CT' ? '#9cc7ff' : '#ffd08a');
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
    this.tag.scale.set(0.2, 0.05, 1);
    this.tag.position.y = 2.15;
    this.tag.renderOrder = 20;
    this.tag.visible = false;
    this.root.add(this.tag);
  }

  setWeapon(wid, skin = null) {
    const key = wid + (wid === 'knife' && skin ? ':' + skin : '');
    if (this.wkey === key) return;
    this.wkey = key;
    this.wid = wid;
    while (this.gunHolder.children.length) this.gunHolder.remove(this.gunHolder.children[0]);
    if (wid) this.gunHolder.add(makeWeapon(wid, true, wid === 'knife' ? skin : null));
  }

  // 记录倒下的方向（世界坐标里“被推开”的方向），yaw 是尸体的朝向
  setDeathPush(dx, dz, yaw) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    this.fallYaw = Math.atan2(dx * c - dz * s, dx * s + dz * c);
    this.fallRoll = (Math.random() - 0.5) * 0.6;
  }

  // st: {speed, crouch, pitch, alive, bomb, now}
  update(dt, st) {
    if (!st.alive) {
      if (this.deadT < 0) {
        this.deadT = 0;
        this.body.rotation.order = 'YXZ';
        if (this.fallYaw == null) this.fallYaw = 0;
      }
      this.deadT += dt;
      const T = 0.55;
      const k = Math.min(1, this.deadT / T);
      // 先一个踉跄，再加速摔倒，落地轻轻弹一下
      const e = k * k * (2.2 - 1.2 * k);
      const bt = (this.deadT - T) / 0.22;
      const bounce = bt > 0 && bt < 1 ? Math.sin(bt * Math.PI) * 0.07 : 0;
      this.crouchAmt *= Math.max(0, 1 - dt * 5);
      const c = this.crouchAmt;
      this.body.rotation.y = this.fallYaw;
      this.body.rotation.x = (Math.PI / 2) * e - bounce;
      this.body.rotation.z = (this.fallRoll || 0) * e;
      this.body.position.y = 0.12 * e;
      this.hips.position.y = 0.82 - 0.4 * c;
      this.upper.rotation.x = 0.06 * e;
      this.head.rotation.x = 0.3 * e;
      this.arms.rotation.x = 1.25 * e;
      this.legL.rotation.x = 1.1 * c + 0.35 * e;
      this.legR.rotation.x = 1.1 * c + 0.05 * e;
      this.legL.userData.shin.rotation.x = -2.0 * c - 0.7 * e;
      this.legR.userData.shin.rotation.x = -2.0 * c - 0.15 * e;
      this.c4.visible = false;
      if (this.tag) this.tag.visible = false;
      return;
    }
    if (this.deadT >= 0) {
      this.deadT = -1;
      this.fallYaw = null;
      this.body.rotation.set(0, 0, 0);
      this.body.position.y = 0;
    }
    this.crouchAmt += ((st.crouch ? 1 : 0) - this.crouchAmt) * Math.min(1, dt * 12);
    const c = this.crouchAmt;
    const amp = Math.min(1, st.speed / 5);
    this.walkAmp += (amp - this.walkAmp) * Math.min(1, dt * 8);
    this.phase += dt * (3 + st.speed * 1.5) * (st.speed > 0.3 ? 1 : 0);
    const sw = Math.sin(this.phase) * 0.65 * this.walkAmp * (1 - c * 0.6);
    this.hips.position.y = 0.82 - 0.4 * c;
    this.legL.rotation.x = 1.1 * c + sw;
    this.legR.rotation.x = 1.1 * c - sw;
    this.legL.userData.shin.rotation.x = -2.0 * c - Math.max(0, -sw) * 0.9;
    this.legR.userData.shin.rotation.x = -2.0 * c - Math.max(0, sw) * 0.9;
    // 中弹时身体一缩
    const ht = this.hitT != null && st.now != null ? st.now - this.hitT : 9;
    const fl = ht >= 0 && ht < 0.22 ? Math.sin((ht / 0.22) * Math.PI) * 0.3 : 0;
    this.upper.rotation.x = -0.18 * c + fl;
    this.arms.rotation.x = (st.pitch || 0) + 0.18 * c - fl * 0.7;
    this.head.rotation.x = (st.pitch || 0) * 0.5 + 0.18 * c + fl * 0.6;
    this.c4.visible = !!st.bomb;
  }
}

// 第一人称手臂颜色
export function armColors(team) {
  const P = TEAM_COL[team] || TEAM_COL.T;
  // 匪徒戴露指手套、光着小臂；警察戴全指战术手套、穿长袖
  return { sleeve: P.shirt, glove: P.glove, skin: P.skin, fingerless: team !== 'CT' };
}
export { box as mbox };

// 死斗血包：白色医疗箱 + 红十字，底下一团绿光
export function makeHealthPack() {
  const g = new THREE.Group();
  const kit = new THREE.Group();
  const red = 0xe2262c;
  kit.add(box(0.32, 0.2, 0.24, 0xf1f2f4));
  kit.add(box(0.322, 0.04, 0.242, 0xcfd4da, 0, -0.07, 0));
  kit.add(box(0.15, 0.012, 0.045, red, 0, 0.106, 0));
  kit.add(box(0.045, 0.012, 0.15, red, 0, 0.106, 0));
  for (const s of [-1, 1]) {
    kit.add(box(0.12, 0.035, 0.012, red, 0, 0.01, s * 0.121));
    kit.add(box(0.035, 0.12, 0.012, red, 0, 0.01, s * 0.121));
  }
  kit.add(box(0.12, 0.025, 0.03, 0x3a3f46, 0, 0.12, 0));
  g.add(kit);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: flare(), color: 0x5dff8a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.75 }));
  glow.scale.set(0.95, 0.95, 1);
  g.add(glow);
  kit.scale.setScalar(1.3);
  g.userData.kit = kit;
  g.userData.glow = glow;
  return g;
}
