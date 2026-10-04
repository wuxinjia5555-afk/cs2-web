// 地图网格构建（合并几何体）、天空与光照
import * as THREE from 'three';
import { getTexture, TEX_SCALE, siteLetter } from './textures.js';

export const THEMES = {
  desert: { skyTop: 0x3d7fd0, skyHor: 0xe8dcc2, fog: 0xdcd2ba, fogNear: 80, fogFar: 260, sun: 0xfff1d8, sunI: 3.0, hemiSky: 0xd4e4ff, hemiGround: 0xa38a62, hemiI: 1.5, sunDir: [0.5, 0.78, 0.36], amb: 0.35 },
  industrial: { skyTop: 0x62758c, skyHor: 0xc7cdd4, fog: 0xb8bfc7, fogNear: 60, fogFar: 210, sun: 0xffffff, sunI: 2.3, hemiSky: 0xdde3ea, hemiGround: 0x6d655b, hemiI: 1.7, sunDir: [-0.42, 0.8, 0.42], amb: 0.45 },
  village: { skyTop: 0x4a86cc, skyHor: 0xf0dcc0, fog: 0xe6d6bc, fogNear: 90, fogFar: 300, sun: 0xffe6c0, sunI: 3.1, hemiSky: 0xd8e6ff, hemiGround: 0x9a8262, hemiI: 1.45, sunDir: [-0.46, 0.74, 0.5], amb: 0.36 },
  dev: { skyTop: 0x3a78d0, skyHor: 0xbfd9f6, fog: 0xc4d8ef, fogNear: 60, fogFar: 220, sun: 0xffffff, sunI: 2.6, hemiSky: 0xe0ebff, hemiGround: 0x7a7a7a, hemiI: 1.6, sunDir: [0.42, 0.84, 0.32], amb: 0.4 },
};

function bucket(map, tex, mode) {
  const key = tex + '|' + mode;
  let b = map.get(key);
  if (!b) {
    b = { tex, mode, pos: [], nor: [], uv: [], col: [], idx: [] };
    map.set(key, b);
  }
  return b;
}

function quad(B, p, n, uv, c) {
  const base = B.pos.length / 3;
  for (let k = 0; k < 4; k++) {
    B.pos.push(p[k][0], p[k][1], p[k][2]);
    B.nor.push(n[0], n[1], n[2]);
    B.uv.push(uv[k][0], uv[k][1]);
    B.col.push(c[k], c[k], c[k]);
  }
  B.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

// 竖直面（可拆分做底部压暗的假 AO）
function side(B, o, a, b, y0, y1, n, uA, uB, s) {
  // a, b: [x, z] 底边两端（从外侧看左->右）
  const segs = [];
  if (o.ao && y1 - y0 > 1.6 && o.aoBase + 1.4 > y0 && o.aoBase + 1.4 < y1) segs.push([y0, o.aoBase + 1.4], [o.aoBase + 1.4, y1]);
  else segs.push([y0, y1]);
  for (const [ya, yb] of segs) {
    const ca = aoCol(o, ya), cb = aoCol(o, yb);
    const p = [[a[0], ya, a[1]], [b[0], ya, b[1]], [b[0], yb, b[1]], [a[0], yb, a[1]]];
    const uv = o.boxUV
      ? [[0, (ya - y0) / (y1 - y0)], [1, (ya - y0) / (y1 - y0)], [1, (yb - y0) / (y1 - y0)], [0, (yb - y0) / (y1 - y0)]]
      : [[uA / s, ya / s], [uB / s, ya / s], [uB / s, yb / s], [uA / s, yb / s]];
    quad(B, p, n, uv, [ca, ca, cb, cb]);
  }
}

function aoCol(o, y) {
  if (!o.ao) return o.sideCol ?? 1;
  const t = Math.max(0, Math.min(1, (y - o.aoBase) / 1.4));
  return o.aoMin + (1 - o.aoMin) * t;
}

function addBox(B, mn, mx, o) {
  const [x0, y0, z0] = mn, [x1, y1, z1] = mx;
  const s = o.scale || 2;
  // 顶面
  if (!o.skipTop) {
    const c = o.topCol ?? 1;
    const uv = o.boxUV ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [[x0 / s, z1 / s], [x1 / s, z1 / s], [x1 / s, z0 / s], [x0 / s, z0 / s]];
    quad(B, [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], uv, [c, c, c, c]);
  }
  if (!o.skipBottom) {
    const c = o.bottomCol ?? 0.6;
    const uv = o.boxUV ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [[x0 / s, z0 / s], [x1 / s, z0 / s], [x1 / s, z1 / s], [x0 / s, z1 / s]];
    quad(B, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], uv, [c, c, c, c]);
  }
  side(B, o, [x1, z1], [x1, z0], y0, y1, [1, 0, 0], -z1, -z0, s);
  side(B, o, [x0, z0], [x0, z1], y0, y1, [-1, 0, 0], z0, z1, s);
  side(B, o, [x0, z1], [x1, z1], y0, y1, [0, 0, 1], x0, x1, s);
  side(B, o, [x1, z0], [x0, z0], y0, y1, [0, 0, -1], -x1, -x0, s);
}


// 往桶里加一个多边形（扇形三角化），每个顶点各有自己的法线、贴图坐标和明暗
function poly(B, pts) {
  const base = B.pos.length / 3;
  for (const p of pts) {
    B.pos.push(p[0], p[1], p[2]);
    B.nor.push(p[3], p[4], p[5]);
    B.uv.push(p[6], p[7]);
    B.col.push(p[8], p[8], p[8]);
  }
  for (let k = 1; k + 1 < pts.length; k++) B.idx.push(base, base + k, base + k + 1);
}

// 坎的侧面（竖直的面）：a → b 是从外面看过去从左到右的底边；ta / tb 是两头顶上的高度，ba / bb 是两头底下的高度
function skirt(B, ax, az, bx, bz, ta, tb, ba, bb, s) {
  if (ta - ba < 1e-3 && tb - bb < 1e-3) return;
  const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1;
  const nx = -dz / len, nz = dx / len; // 从左到右的方向是 (nz, -nx)
  const ua = (ax * nz - az * nx) / s, ub = (bx * nz - bz * nx) / s;
  const col = (h) => 0.62 + 0.38 * Math.max(0, Math.min(1, h / 1.4));
  const V = (x, z, u, y, h) => [x, y, z, nx, 0, nz, u, y / s, col(h)];
  const band = (a0, b0, a1, b1) => { // 一条横带：下沿 a0 / b0，上沿 a1 / b1（都是高度）
    const pts = [V(ax, az, ua, a0, a0 - ba), V(bx, bz, ub, b0, b0 - bb)];
    if (b1 - b0 > 1e-4) pts.push(V(bx, bz, ub, b1, b1 - bb));
    if (a1 - a0 > 1e-4) pts.push(V(ax, az, ua, a1, a1 - ba));
    if (pts.length >= 3) poly(B, pts);
  };
  // 高的坎分两段：底下 1.4 米从暗到亮（墙根的阴影），上面是正常亮度
  const ma = Math.min(ta, ba + 1.4), mb = Math.min(tb, bb + 1.4);
  band(ba, bb, ma, mb);
  if (ta - ma > 1e-4 || tb - mb > 1e-4) band(ma, mb, ta, tb);
}

// 地面（高度场）：平的格子合并成大块；斜的格子一格一格画（扭着的格子从中心分成 4 个三角）；格子之间、格子和矮墙之间的坎补上竖直的面
function addTerrain(buckets, map) {
  const hf = map.hf, { W, H, S, y, on } = hf, n = W * H;
  const hide = hf.hide, cliffMat = map.def.cliffMat || map.def.wallMat;
  const flat = (i) => { const o = i * 4; return Math.abs(y[o] - y[o + 1]) < 1e-4 && Math.abs(y[o] - y[o + 2]) < 1e-4 && Math.abs(y[o] - y[o + 3]) < 1e-4; };
  const used = new Uint8Array(n);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const i = r * W + c;
    if (used[i] || !on[i] || (hide && hide[i])) continue;
    const mat = hf.mats[hf.mat[i]], s = TEX_SCALE[mat] || 2, B = bucket(buckets, mat, 'w');
    if (flat(i)) {
      const same = (j) => !used[j] && on[j] && !(hide && hide[j]) && hf.mat[j] === hf.mat[i] && flat(j) && Math.abs(y[j * 4] - y[i * 4]) < 1e-4;
      let c1 = c, r1 = r;
      while (c1 + 1 < W && same(r * W + c1 + 1)) c1++;
      outer: while (r1 + 1 < H) {
        for (let cc = c; cc <= c1; cc++) if (!same((r1 + 1) * W + cc)) break outer;
        r1++;
      }
      for (let rr = r; rr <= r1; rr++) for (let cc = c; cc <= c1; cc++) used[rr * W + cc] = 1;
      const x0 = c * S, x1 = (c1 + 1) * S, z0 = r * S, z1 = (r1 + 1) * S, h = y[i * 4];
      quad(B, [[x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0]], [0, 1, 0], [[x0 / s, z1 / s], [x1 / s, z1 / s], [x1 / s, z0 / s], [x0 / s, z0 / s]], [1, 1, 1, 1]);
      continue;
    }
    used[i] = 1;
    const o = i * 4, x0 = c * S, x1 = x0 + S, z0 = r * S, z1 = z0 + S;
    // 每个角的法线：把这个角上接在一起的几格的坡度平均一下，坡面看起来就是圆滑的，不是一格一格的棱
    const vert = (k) => {
      const u = k & 1, v = k >> 1, vc = c + u, vr = r + v, h = y[o + k];
      let gx = 0, gz = 0, cnt = 0;
      for (let q = 0; q < 4; q++) {
        const jc = vc - 1 + (q & 1), jr = vr - 1 + (q >> 1);
        if (jc < 0 || jr < 0 || jc >= W || jr >= H) continue;
        const j = jr * W + jc, p = j * 4, ku = 1 - (q & 1), kv = 1 - (q >> 1);
        if (!on[j] || Math.abs(y[p + kv * 2 + ku] - h) > 2e-3) continue;
        gx += ((1 - kv) * (y[p + 1] - y[p]) + kv * (y[p + 3] - y[p + 2])) / S;
        gz += ((1 - ku) * (y[p + 2] - y[p]) + ku * (y[p + 3] - y[p + 1])) / S;
        cnt++;
      }
      gx /= cnt || 1; gz /= cnt || 1;
      const il = 1 / Math.sqrt(gx * gx + 1 + gz * gz), x = u ? x1 : x0, z = v ? z1 : z0;
      return [x, h, z, -gx * il, il, -gz * il, x / s, z / s, 1];
    };
    const v00 = vert(0), v10 = vert(1), v01 = vert(2), v11 = vert(3);
    if (Math.abs(y[o] - y[o + 1] - y[o + 2] + y[o + 3]) < 1e-3) poly(B, [v01, v11, v10, v00]);
    else {
      const hm = (y[o] + y[o + 1] + y[o + 2] + y[o + 3]) / 4, gx = (y[o + 1] - y[o] + y[o + 3] - y[o + 2]) / (2 * S), gz = (y[o + 2] - y[o] + y[o + 3] - y[o + 1]) / (2 * S);
      const il = 1 / Math.sqrt(gx * gx + 1 + gz * gz), xm = x0 + S / 2, zm = z0 + S / 2;
      const m = [xm, hm, zm, -gx * il, il, -gz * il, xm / s, zm / s, 1];
      poly(B, [m, v01, v11]); poly(B, [m, v11, v10]); poly(B, [m, v10, v00]); poly(B, [m, v00, v01]);
    }
  }
  // 坎的侧面
  const CB = bucket(buckets, cliffMat, 'w'), cs = TEX_SCALE[cliffMat] || 2;
  const pair = (ax, az, bx, bz, iA, iB, jA, jB) => {
    // 一条边的两头 A、B；i 这边两头的高度是 iA / iB，j 那边是 jA / jB。a → b 的走向要保证 i 高的时候面朝 j
    const dA = iA - jA, dB = iB - jB;
    if (Math.abs(dA) < 2e-3 && Math.abs(dB) < 2e-3) return;
    if (dA >= -2e-3 && dB >= -2e-3) skirt(CB, ax, az, bx, bz, iA, iB, jA, jB, cs);
    else if (dA <= 2e-3 && dB <= 2e-3) skirt(CB, bx, bz, ax, az, jB, jA, iB, iA, cs);
    else {
      // 两头一高一低：从交叉的那一点分成两半
      const t = dA / (dA - dB), mx = ax + (bx - ax) * t, mz = az + (bz - az) * t, hm = iA + (iB - iA) * t;
      if (dA > 0) { skirt(CB, ax, az, mx, mz, iA, hm, jA, hm, cs); skirt(CB, bx, bz, mx, mz, jB, hm, iB, hm, cs); }
      else { skirt(CB, mx, mz, ax, az, hm, jA, hm, iA, cs); skirt(CB, mx, mz, bx, bz, hm, iB, hm, jB, cs); }
    }
  };
  const wallTop = (j) => map.wtop[j];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const i = r * W + c, o = i * 4;
    if (!on[i]) continue;
    const x0 = c * S, x1 = x0 + S, z0 = r * S, z1 = z0 + S;
    // 右边、下边的邻居：是地面就两格比一比；是墙 / 箱子而且比这边的地面矮，就把露出来的那一截补上
    if (c + 1 < W) {
      const j = i + 1, p = j * 4;
      if (on[j]) pair(x1, z1, x1, z0, y[o + 3], y[o + 1], y[p + 2], y[p]);
      else { const t = wallTop(j); pair(x1, z1, x1, z0, y[o + 3], y[o + 1], Math.min(t, y[o + 3]), Math.min(t, y[o + 1])); }
    }
    if (r + 1 < H) {
      const j = i + W, p = j * 4;
      if (on[j]) pair(x0, z1, x1, z1, y[o + 2], y[o + 3], y[p], y[p + 1]);
      else { const t = wallTop(j); pair(x0, z1, x1, z1, y[o + 2], y[o + 3], Math.min(t, y[o + 2]), Math.min(t, y[o + 3])); }
    }
    if (c > 0 && !on[i - 1]) { const t = wallTop(i - 1); pair(x0, z0, x0, z1, y[o], y[o + 2], Math.min(t, y[o]), Math.min(t, y[o + 2])); }
    if (r > 0 && !on[i - W]) { const t = wallTop(i - W); pair(x1, z0, x0, z0, y[o + 1], y[o], Math.min(t, y[o + 1]), Math.min(t, y[o])); }
  }
}

export function buildMapMeshes(map) {
  const group = new THREE.Group();
  const buckets = new Map();
  const barrels = [];
  if (map.hf) addTerrain(buckets, map);
  // 只画不挡人的装饰（梯子）
  for (const bx of map.decos || []) {
    if (bx.uv === 'box') addBox(bucket(buckets, bx.mat, 'b'), bx.min, bx.max, { boxUV: true, sideCol: 0.96 });
    else addBox(bucket(buckets, bx.mat, 'w'), bx.min, bx.max, { scale: TEX_SCALE[bx.mat] || 2 });
  }
  for (const bx of map.boxes) {
    const scale = TEX_SCALE[bx.mat] || 2;
    switch (bx.kind) {
      case 'floor':
        addBox(bucket(buckets, bx.mat, 'w'), bx.min, bx.max, { scale, skipBottom: true, ao: true, aoBase: bx.max[1] - 1.4, aoMin: 0.8 });
        break;
      case 'wall':
        addBox(bucket(buckets, bx.mat, 'w'), bx.min, bx.max, { scale, skipBottom: bx.min[1] < -0.5, bottomCol: 0.55, ao: true, aoBase: 0, aoMin: 0.62 });
        break;
      case 'low':
        addBox(bucket(buckets, bx.mat, 'w'), bx.min, bx.max, { scale, skipBottom: true, ao: true, aoBase: bx.min[1], aoMin: 0.7 });
        break;
      case 'crates': {
        // 一堆箱子：碰撞是一整块，画出来按 1.3 米左右一个切成小箱子（横着切、也一层一层往上码），箱子之间留一条细缝
        const B2 = bucket(buckets, bx.mat, 'b'), [x0, , z0] = bx.min, [x1, top, z1] = bx.max, base = Math.min(bx.base, top - 0.3);
        const nx = Math.max(1, Math.round((x1 - x0) / 1.3)), nz = Math.max(1, Math.round((z1 - z0) / 1.3)), ny = Math.max(1, Math.round((top - base) / 1.25));
        const g = 0.012;
        for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
          const a = [x0 + ((x1 - x0) * ix) / nx + (ix ? g : 0), base + ((top - base) * iy) / ny - (iy ? 0 : 0.6), z0 + ((z1 - z0) * iz) / nz + (iz ? g : 0)];
          const b = [x0 + ((x1 - x0) * (ix + 1)) / nx - (ix < nx - 1 ? g : 0), base + ((top - base) * (iy + 1)) / ny - (iy < ny - 1 ? g : 0), z0 + ((z1 - z0) * (iz + 1)) / nz - (iz < nz - 1 ? g : 0)];
          addBox(B2, a, b, { boxUV: true, skipBottom: true, skipTop: iy < ny - 1, ao: iy === 0, aoBase: base, aoMin: 0.72 });
        }
        break;
      }
      case 'roof':
        addBox(bucket(buckets, bx.mat, 'w'), bx.min, bx.max, { scale, bottomCol: 0.5, sideCol: 0.8 });
        break;
      case 'crate':
        addBox(bucket(buckets, bx.mat, 'b'), bx.min, bx.max, { boxUV: true, skipBottom: true, ao: true, aoBase: bx.min[1], aoMin: 0.72 });
        break;
      case 'crate2': {
        const mid = bx.min[1] + (bx.max[1] - bx.min[1]) / 2;
        addBox(bucket(buckets, bx.mat, 'b'), bx.min, [bx.max[0], mid, bx.max[2]], { boxUV: true, skipBottom: true, ao: true, aoBase: bx.min[1], aoMin: 0.72 });
        const i = 0.08;
        addBox(bucket(buckets, bx.mat, 'b'), [bx.min[0] + i, mid, bx.min[2] + i], [bx.max[0] - i, bx.max[1], bx.max[2] - i], { boxUV: true, skipBottom: true, ao: true, aoBase: mid - 0.3, aoMin: 0.8 });
        break;
      }
      case 'barrel':
        barrels.push(bx);
        break;
      default:
        addBox(bucket(buckets, bx.mat || 'concrete', 'w'), bx.min, bx.max, { scale, ao: false });
    }
  }
  for (const b of buckets.values()) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
    geo.setIndex(b.idx);
    geo.computeBoundingSphere();
    const mat = new THREE.MeshLambertMaterial({ map: getTexture(b.tex), vertexColors: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  if (barrels.length) {
    const geo = new THREE.CylinderGeometry(0.4, 0.4, 1.0, 16);
    const mat = new THREE.MeshLambertMaterial({ map: getTexture('barrel') });
    for (const bx of barrels) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set((bx.min[0] + bx.max[0]) / 2, bx.min[1] + 0.5, (bx.min[2] + bx.max[2]) / 2);
      m.rotation.y = (bx.min[0] * 7.3 + bx.min[2] * 3.1) % 6.28;
      m.castShadow = true;
      m.receiveShadow = true;
      m.updateMatrix();
      m.matrixAutoUpdate = false;
      group.add(m);
    }
  }
  // 包点字母
  for (const s of Object.values(map.sites)) {
    const w = Math.min(6, (s.x1 - s.x0) * 0.6);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, w),
      new THREE.MeshLambertMaterial({ map: siteLetter(s.name), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(s.cx, s.y + 0.015, s.cz);
    m.receiveShadow = true;
    m.renderOrder = 1;
    group.add(m);
  }
  return group;
}

const SKY_VS = `varying vec3 vDir;
void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FS = `uniform vec3 top; uniform vec3 hor; uniform vec3 sunDir; varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(hor, top, pow(h, 0.55));
  if (d.y < 0.0) c = mix(hor, hor * 0.7, clamp(-d.y * 3.0, 0.0, 1.0));
  float s = max(dot(d, sunDir), 0.0);
  c += vec3(1.0, 0.92, 0.75) * (pow(s, 900.0) * 4.0 + pow(s, 14.0) * 0.22);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

export function setupEnvironment(scene, map, shadows) {
  const th = THEMES[map.theme] || THEMES.desert;
  scene.background = new THREE.Color(th.skyHor);
  scene.fog = new THREE.Fog(th.fog, th.fogNear, th.fogFar);
  const sunDir = new THREE.Vector3(...th.sunDir).normalize();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(450, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: { top: { value: new THREE.Color(th.skyTop) }, hor: { value: new THREE.Color(th.skyHor) }, sunDir: { value: sunDir } },
      vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, fog: false,
    }),
  );
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  scene.add(sky);

  const hemi = new THREE.HemisphereLight(th.hemiSky, th.hemiGround, th.hemiI);
  scene.add(hemi);
  const amb = new THREE.AmbientLight(0xffffff, th.amb);
  scene.add(amb);
  const sun = new THREE.DirectionalLight(th.sun, th.sunI);
  const cx = (map.bounds.x1) / 2, cz = (map.bounds.z1) / 2;
  const half = Math.max(map.bounds.x1, map.bounds.z1) * 0.62;
  sun.position.set(cx + sunDir.x * 120, sunDir.y * 120, cz + sunDir.z * 120);
  sun.target.position.set(cx, 0, cz);
  scene.add(sun.target);
  if (shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera;
    c.left = -half; c.right = half; c.top = half; c.bottom = -half;
    c.near = 10; c.far = 300;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.04;
  }
  scene.add(sun);
  return {
    sky, sun, hemi, amb,
    follow(pos) { sky.position.copy(pos); },
  };
}
