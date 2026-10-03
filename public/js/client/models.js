// 程序生成的低多边形模型：士兵、武器、投掷物、C4
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
function cylGeo(r, h, seg = 12) {
  const k = `c${r},${h},${seg}`;
  let g = geoCache.get(k);
  if (!g) { g = new THREE.CylinderGeometry(r, r, h, seg); geoCache.set(k, g); }
  return g;
}
function sphGeo(r) {
  const k = `s${r}`;
  let g = geoCache.get(k);
  if (!g) { g = new THREE.SphereGeometry(r, 12, 8); geoCache.set(k, g); }
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
function cyl(r, h, color, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(cylGeo(r, h), mat(color));
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  return m;
}

const C = {
  black: 0x1c1d20, dark: 0x2e3034, metal: 0x505359, silver: 0xb4b8bd, wood: 0x80501f, woodD: 0x5d3a18,
  olive: 0x5a6040, green: 0x46573a, tan: 0xa89066, blue: 0x34465c, red: 0x8a2c22, glass: 0x6e5a2e,
};

// ---------------- 武器 ----------------
function rifleAK(g, furn = C.wood, furnD = C.woodD, body = C.dark) {
  g.add(box(0.05, 0.07, 0.3, body, 0, 0.035, -0.1));
  g.add(box(0.045, 0.02, 0.26, C.metal, 0, 0.078, -0.1));
  g.add(box(0.05, 0.05, 0.16, furn, 0, 0.03, -0.33));
  g.add(box(0.03, 0.025, 0.14, furn, 0, 0.068, -0.32));
  g.add(box(0.022, 0.022, 0.26, C.dark, 0, 0.045, -0.53));
  g.add(box(0.012, 0.045, 0.012, C.dark, 0, 0.072, -0.62));
  g.add(box(0.03, 0.03, 0.05, C.dark, 0, 0.045, -0.68));
  g.userData.mag = box(0.036, 0.17, 0.06, C.dark, 0, -0.06, -0.17, 0.38);
  g.add(g.userData.mag);
  g.add(box(0.034, 0.1, 0.045, furnD, 0, -0.04, 0.02, -0.3));
  g.add(box(0.042, 0.08, 0.26, furn, 0, 0.0, 0.17, 0.12));
  g.userData.muzzle = new THREE.Vector3(0, 0.045, -0.72);
}

function rifleM4(g, silenced = false) {
  g.add(box(0.05, 0.075, 0.28, C.black, 0, 0.03, -0.1));
  g.add(box(0.03, 0.035, 0.1, C.dark, 0, 0.085, -0.06));
  g.add(box(0.058, 0.058, 0.22, C.dark, 0, 0.03, -0.35));
  g.add(box(0.012, 0.06, 0.012, C.black, 0, 0.075, -0.46));
  if (silenced) {
    g.add(box(0.036, 0.036, 0.24, C.black, 0, 0.035, -0.58));
    g.userData.muzzle = new THREE.Vector3(0, 0.035, -0.72);
  } else {
    g.add(box(0.02, 0.02, 0.18, C.dark, 0, 0.035, -0.55));
    g.add(box(0.028, 0.028, 0.05, C.black, 0, 0.035, -0.66));
    g.userData.muzzle = new THREE.Vector3(0, 0.035, -0.7);
  }
  g.userData.mag = box(0.034, 0.15, 0.06, C.dark, 0, -0.07, -0.14, 0.12);
  g.add(g.userData.mag);
  g.add(box(0.032, 0.09, 0.045, C.black, 0, -0.045, 0.02, -0.3));
  g.add(box(0.03, 0.03, 0.12, C.dark, 0, 0.04, 0.1));
  g.add(box(0.045, 0.09, 0.13, C.black, 0, 0.02, 0.2));
}

function famas(g) {
  g.add(box(0.055, 0.1, 0.5, C.black, 0, 0.03, -0.08));
  g.add(box(0.02, 0.045, 0.32, C.dark, 0, 0.11, -0.12));
  g.add(box(0.02, 0.02, 0.14, C.dark, 0, 0.03, -0.4));
  g.add(box(0.034, 0.1, 0.045, C.black, 0, -0.05, -0.1, -0.2));
  g.userData.mag = box(0.034, 0.13, 0.06, C.dark, 0, -0.06, 0.08, 0.1);
  g.add(g.userData.mag);
  g.userData.muzzle = new THREE.Vector3(0, 0.03, -0.48);
}

function sniper(g, body, big) {
  const L = big ? 0.5 : 0.44;
  g.add(box(big ? 0.06 : 0.048, big ? 0.08 : 0.065, L, body, 0, 0.02, -0.05));
  g.add(box(big ? 0.028 : 0.02, big ? 0.028 : 0.02, 0.45, C.dark, 0, 0.04, -0.52));
  if (big) g.add(box(0.042, 0.042, 0.06, C.black, 0, 0.04, -0.76));
  g.add(cyl(big ? 0.028 : 0.022, 0.32, C.black, 0, 0.12, -0.08, Math.PI / 2));
  g.add(cyl(big ? 0.036 : 0.028, 0.06, C.black, 0, 0.12, -0.26, Math.PI / 2));
  g.add(cyl(big ? 0.032 : 0.026, 0.05, C.black, 0, 0.12, 0.09, Math.PI / 2));
  g.add(box(0.02, 0.04, 0.02, C.dark, 0, 0.085, -0.16));
  g.add(box(0.02, 0.04, 0.02, C.dark, 0, 0.085, 0.0));
  g.userData.mag = box(0.045, 0.07, 0.08, C.dark, 0, -0.045, -0.08);
  g.add(g.userData.mag);
  g.add(box(0.034, 0.1, 0.045, C.black, 0, -0.045, 0.08, -0.35));
  g.add(box(big ? 0.06 : 0.045, big ? 0.12 : 0.09, 0.26, body, 0, -0.01, 0.3));
  g.userData.muzzle = new THREE.Vector3(0, 0.04, big ? -0.8 : -0.76);
}

function pistol(g, slide, frame, len = 0.19, silenced = false, big = false) {
  const sh = big ? 0.055 : 0.042;
  g.add(box(big ? 0.036 : 0.03, sh, len, slide, 0, 0.035, -0.07));
  g.add(box(big ? 0.034 : 0.028, 0.022, len * 0.8, frame, 0, 0.005, -0.06));
  g.add(box(big ? 0.036 : 0.03, 0.11, 0.05, frame === C.silver ? C.black : frame, 0, -0.045, 0.02, -0.25));
  g.userData.mag = box(0.026, 0.03, 0.04, C.black, 0, -0.1, 0.035, -0.25);
  g.add(g.userData.mag);
  g.add(box(0.008, 0.022, 0.04, frame, 0, -0.012, -0.035));
  if (silenced) {
    g.add(box(0.032, 0.032, 0.16, C.black, 0, 0.035, -0.24));
    g.userData.muzzle = new THREE.Vector3(0, 0.035, -0.33);
  } else {
    g.userData.muzzle = new THREE.Vector3(0, 0.035, -0.07 - len / 2 - 0.01);
  }
}

function smg(g, kind) {
  if (kind === 'mac10') {
    g.add(box(0.05, 0.09, 0.2, C.dark, 0, 0.02, -0.08));
    g.add(box(0.02, 0.02, 0.06, C.black, 0, 0.045, -0.21));
    g.userData.mag = box(0.034, 0.12, 0.045, C.black, 0, -0.12, 0.01);
    g.add(box(0.034, 0.1, 0.05, C.dark, 0, -0.04, 0.01, -0.1));
    g.add(g.userData.mag);
    g.userData.muzzle = new THREE.Vector3(0, 0.045, -0.25);
  } else if (kind === 'mp9') {
    g.add(box(0.045, 0.07, 0.24, C.black, 0, 0.03, -0.1));
    g.add(box(0.03, 0.07, 0.03, C.black, 0, -0.04, -0.2));
    g.add(box(0.034, 0.1, 0.045, C.black, 0, -0.04, 0.01, -0.15));
    g.userData.mag = box(0.03, 0.1, 0.04, C.dark, 0, -0.12, 0.02, -0.15);
    g.add(g.userData.mag);
    g.add(box(0.015, 0.015, 0.2, C.dark, 0.03, 0.02, 0.06));
    g.userData.muzzle = new THREE.Vector3(0, 0.035, -0.25);
  } else {
    g.add(box(0.05, 0.085, 0.34, C.dark, 0, 0.02, -0.1));
    g.add(box(0.02, 0.02, 0.06, C.black, 0, 0.035, -0.29));
    g.userData.mag = box(0.034, 0.14, 0.06, C.black, 0, -0.08, -0.15, 0.1);
    g.add(g.userData.mag);
    g.add(box(0.034, 0.1, 0.045, C.black, 0, -0.045, 0.03, -0.3));
    g.add(box(0.035, 0.07, 0.2, C.black, 0, 0.01, 0.17));
    g.userData.muzzle = new THREE.Vector3(0, 0.035, -0.33);
  }
}

function shotgun(g) {
  g.add(box(0.05, 0.075, 0.22, C.dark, 0, 0.03, -0.05));
  g.add(box(0.028, 0.028, 0.5, C.black, 0, 0.055, -0.4));
  g.add(box(0.03, 0.03, 0.38, C.dark, 0, 0.02, -0.36));
  g.userData.mag = box(0.048, 0.048, 0.13, C.woodD, 0, 0.02, -0.36);
  g.add(g.userData.mag);
  g.add(box(0.034, 0.1, 0.045, C.black, 0, -0.04, 0.05, -0.3));
  g.add(box(0.045, 0.09, 0.26, C.black, 0, 0.0, 0.18, 0.1));
  g.userData.muzzle = new THREE.Vector3(0, 0.055, -0.66);
}

function grenade(g, type) {
  if (type === 'he') {
    g.add(new THREE.Mesh(sphGeo(0.035), mat(C.olive)));
    g.add(box(0.012, 0.05, 0.012, C.metal, 0.012, 0.035, 0));
  } else if (type === 'flash') {
    g.add(cyl(0.024, 0.1, 0x8c9196, 0, 0, 0));
    g.add(cyl(0.018, 0.02, C.metal, 0, 0.06, 0));
  } else if (type === 'smoke') {
    g.add(cyl(0.028, 0.11, 0x5c6b56, 0, 0, 0));
    g.add(cyl(0.02, 0.02, C.metal, 0, 0.065, 0));
  } else if (type === 'molotov') {
    g.add(cyl(0.03, 0.12, C.glass, 0, 0, 0));
    g.add(cyl(0.012, 0.06, C.glass, 0, 0.09, 0));
    g.add(box(0.03, 0.05, 0.02, 0xd8d2c0, 0, 0.12, 0, 0, 0, 0.4));
  } else {
    g.add(cyl(0.028, 0.11, 0x80858a, 0, 0, 0));
    g.add(cyl(0.029, 0.02, C.red, 0, 0.02, 0));
  }
  g.userData.muzzle = new THREE.Vector3(0, 0, 0);
}

function c4(g) {
  g.add(box(0.2, 0.065, 0.12, 0xa49066, 0, 0, 0));
  g.add(box(0.08, 0.012, 0.07, C.dark, 0.03, 0.036, 0));
  g.add(box(0.05, 0.013, 0.02, 0x3cff6e, 0.03, 0.04, -0.02));
  g.add(box(0.012, 0.012, 0.13, C.red, -0.07, 0.036, 0));
  g.add(box(0.012, 0.012, 0.13, 0x2a5cc4, -0.05, 0.036, 0));
  g.userData.muzzle = new THREE.Vector3(0, 0, 0);
}

const WEAPON_IDS = new Set(['ak47', 'galil', 'm4a4', 'm4a1s', 'famas', 'awp', 'ssg08', 'glock', 'usp', 'p250', 'deagle', 'mac10', 'mp9', 'ump45', 'nova',
  'he', 'flash', 'smoke', 'molotov', 'incgrenade', 'c4']);
export function makeWeapon(id, merged = false, skin = null) {
  const g = new THREE.Group();
  // 刀（按皮肤）：第一人称用完整版，别人手里 / 地上的用简化版
  if (id === 'knife' || !WEAPON_IDS.has(id)) {
    const sk = skin && HD_KNIVES[skin] ? skin : 'default';
    const kg = HD_KNIVES[sk](!merged);
    kg.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    kg.userData.id = id;
    if (merged) collapse(kg, 'w:knife:' + sk);
    return kg;
  }
  // 有高精度模型的枪：第一人称用完整版，别人手里 / 地上的用简化版（照旧合并成一个网格）
  if (HD[id]) {
    const hg = HD[id].gun(!merged);
    hg.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    hg.userData.id = id;
    if (merged) collapse(hg, 'w:' + id);
    return hg;
  }
  switch (id) {
    case 'ak47': rifleAK(g); break;
    case 'galil': rifleAK(g, C.olive, C.dark, C.dark); break;
    case 'm4a4': rifleM4(g, false); break;
    case 'm4a1s': rifleM4(g, true); break;
    case 'famas': famas(g); break;
    case 'awp': sniper(g, C.green, true); break;
    case 'ssg08': sniper(g, C.blue, false); break;
    case 'glock': pistol(g, C.dark, C.black, 0.19); break;
    case 'usp': pistol(g, C.black, C.dark, 0.2, true); break;
    case 'p250': pistol(g, C.metal, C.black, 0.17); break;
    case 'deagle': pistol(g, C.silver, C.silver, 0.25, false, true); break;
    case 'mac10': case 'mp9': case 'ump45': smg(g, id); break;
    case 'nova': shotgun(g); break;
    case 'he': case 'flash': case 'smoke': case 'molotov': case 'incgrenade': grenade(g, id); break;
    case 'c4': c4(g); break;
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData.id = id;
  if (merged) collapse(g, 'w:' + id);
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
