// 地图网格构建（合并几何体）、天空与光照
import * as THREE from 'three';
import { getTexture, TEX_SCALE, siteLetter } from './textures.js';

export const THEMES = {
  desert: { skyTop: 0x3d7fd0, skyHor: 0xe8dcc2, fog: 0xdcd2ba, fogNear: 80, fogFar: 260, sun: 0xfff1d8, sunI: 3.0, hemiSky: 0xd4e4ff, hemiGround: 0xa38a62, hemiI: 1.5, sunDir: [0.5, 0.78, 0.36], amb: 0.35 },
  industrial: { skyTop: 0x62758c, skyHor: 0xc7cdd4, fog: 0xb8bfc7, fogNear: 60, fogFar: 210, sun: 0xffffff, sunI: 2.3, hemiSky: 0xdde3ea, hemiGround: 0x6d655b, hemiI: 1.7, sunDir: [-0.42, 0.8, 0.42], amb: 0.45 },
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

export function buildMapMeshes(map) {
  const group = new THREE.Group();
  const buckets = new Map();
  const barrels = [];
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
