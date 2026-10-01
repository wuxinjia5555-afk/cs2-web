// 特效：曳光弹、弹孔、粒子（血/尘/火花）、枪口火光、烟雾、燃烧、爆炸
import * as THREE from 'three';
import { softDot, cloud, flame, flare, bulletHole } from './textures.js';

const PVS = `attribute float size; attribute float alpha; attribute vec3 color;
varying float vA; varying vec3 vC; uniform float scale;
void main() {
  vA = alpha; vC = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(size * scale / -mv.z, 256.0);
  gl_Position = projectionMatrix * mv;
}`;
const PFS = `uniform sampler2D map; varying float vA; varying vec3 vC;
void main() {
  vec4 t = texture2D(map, gl_PointCoord);
  gl_FragColor = vec4(vC, t.a * vA);
  if (gl_FragColor.a < 0.01) discard;
  #include <colorspace_fragment>
}`;

class Particles {
  constructor(scene, max = 1600) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.a0 = new Float32Array(max);
    const g = (this.geo = new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: softDot() }, scale: { value: 500 } },
      vertexShader: PVS, fragmentShader: PFS, transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, life, size, r, g, b, alpha = 1, grav = 0, grow = 0, drag = 0) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.size[i] = size; this.alpha[i] = alpha; this.a0[i] = alpha;
    this.life[i] = life; this.maxLife[i] = life; this.grav[i] = grav; this.grow[i] = grow; this.drag[i] = drag;
  }
  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const j = --this.n;
        if (i !== j) {
          for (let k = 0; k < 3; k++) { this.pos[i * 3 + k] = this.pos[j * 3 + k]; this.vel[i * 3 + k] = this.vel[j * 3 + k]; this.col[i * 3 + k] = this.col[j * 3 + k]; }
          this.size[i] = this.size[j]; this.alpha[i] = this.alpha[j]; this.a0[i] = this.a0[j]; this.life[i] = this.life[j];
          this.maxLife[i] = this.maxLife[j]; this.grav[i] = this.grav[j]; this.grow[i] = this.grow[j]; this.drag[i] = this.drag[j];
        }
        continue;
      }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 2] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = this.a0[i] * Math.min(1, t * 2.5);
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    for (const k of ['position', 'color', 'size', 'alpha']) this.geo.attributes[k].needsUpdate = true;
  }
}

export class Effects {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.pools = [];
    this.low = !!opts.low;
    this.parts = new Particles(scene);
    // 曳光弹
    this.maxTr = 64;
    this.trPos = new Float32Array(this.maxTr * 6);
    this.trCol = new Float32Array(this.maxTr * 6);
    this.trLife = new Float32Array(this.maxTr);
    this.trIdx = 0;
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.trPos, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('color', new THREE.BufferAttribute(this.trCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracers = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.tracers.frustumCulled = false;
    scene.add(this.tracers);
    // 弹孔
    this.maxHoles = 220;
    this.holes = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.09, 0.09),
      new THREE.MeshLambertMaterial({ map: bulletHole(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
      this.maxHoles,
    );
    this.holes.count = 0;
    this.holes.frustumCulled = false;
    this.holeIdx = 0;
    scene.add(this.holes);
    this.tmpObj = new THREE.Object3D();
    // 枪口火光（其他玩家）
    this.flashes = [];
    for (let k = 0; k < 10; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flare(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: 0xffd9a0 }));
      s.visible = false;
      s.userData.t = 0;
      scene.add(s);
      this.flashes.push(s);
    }
    this.flashIdx = 0;
    this.smokes = [];
    this.fires = [];
    this.booms = [];
    this.lights = [];
    for (let k = 0; k < (this.low ? 0 : 3); k++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 1.5);
      l.userData.busy = false;
      scene.add(l);
      this.lights.push(l);
    }
    this.cloudTex = cloud();
    this.flameTex = flame();
    this.time = 0;
  }

  setPointScale(h, fovDeg) {
    this.parts.mat.uniforms.scale.value = h / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  tracer(ax, ay, az, bx, by, bz, bright = 1) {
    const i = this.trIdx++ % this.maxTr;
    // 只画一段（从起点往前 70% 开始的一截，像 CS 的短曳光）
    const t0 = 0.08 + Math.random() * 0.2;
    this.trPos.set([ax + (bx - ax) * t0, ay + (by - ay) * t0, az + (bz - az) * t0, bx, by, bz], i * 6);
    this.trLife[i] = 0.07 * bright;
    this.trCol.set([1, 0.85, 0.55, 0.9, 0.7, 0.35], i * 6);
  }

  impact(x, y, z, nx, ny, nz, surface = 'wall') {
    const i = this.holeIdx++ % this.maxHoles;
    const o = this.tmpObj;
    o.position.set(x + nx * 0.01, y + ny * 0.01, z + nz * 0.01);
    o.lookAt(x + nx, y + ny, z + nz);
    o.rotateZ(Math.random() * 6.28);
    o.scale.setScalar(0.7 + Math.random() * 0.6);
    o.updateMatrix();
    this.holes.setMatrixAt(i, o.matrix);
    this.holes.count = Math.min(this.maxHoles, Math.max(this.holes.count, i + 1));
    this.holes.instanceMatrix.needsUpdate = true;
    const dust = surface === 'metal' ? [0.6, 0.6, 0.62] : [0.72, 0.64, 0.5];
    for (let k = 0; k < 6; k++) {
      this.parts.emit(x, y, z, nx * 1.5 + (Math.random() - 0.5) * 1.5, ny * 1.5 + Math.random() * 1.2, nz * 1.5 + (Math.random() - 0.5) * 1.5,
        0.5 + Math.random() * 0.4, 0.12 + Math.random() * 0.1, dust[0], dust[1], dust[2], 0.7, 2, 0.35, 2);
    }
    for (let k = 0; k < 3; k++) {
      this.parts.emit(x, y, z, nx * 4 + (Math.random() - 0.5) * 4, ny * 4 + Math.random() * 3, nz * 4 + (Math.random() - 0.5) * 4,
        0.15 + Math.random() * 0.15, 0.035, 1, 0.8, 0.4, 1, 12, 0, 0);
    }
  }

  blood(x, y, z, dx, dy, dz, hs) {
    const n = hs ? 14 : 8;
    for (let k = 0; k < n; k++) {
      this.parts.emit(x, y, z, dx * 2 + (Math.random() - 0.5) * 2.2, dy * 2 + Math.random() * 1.6, dz * 2 + (Math.random() - 0.5) * 2.2,
        0.35 + Math.random() * 0.3, 0.08 + Math.random() * 0.1, 0.55, 0.03, 0.03, 0.95, 7, 0.1, 1);
    }
    this.parts.emit(x, y, z, 0, 0.3, 0, 0.35, 0.35, 0.45, 0.02, 0.02, 0.6, 0, 0.8, 0);
  }

  // 尸体下面慢慢扩散开的血泊（gy 是地面高度）
  bloodPool(x, gy, z) {
    if (!this.poolGeo) this.poolGeo = new THREE.CircleGeometry(1, 20);
    const m = new THREE.Mesh(this.poolGeo, new THREE.MeshBasicMaterial({
      color: 0x520707, transparent: true, opacity: 0.88, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }));
    m.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI);
    m.position.set(x, gy + 0.015, z);
    m.renderOrder = 1;
    m.userData = { t: 0, size: 0.5 + Math.random() * 0.3, sy: 0.7 + Math.random() * 0.3 };
    m.scale.set(0.05, 0.05 * m.userData.sy, 1);
    this.scene.add(m);
    this.pools.push(m);
    if (this.pools.length > 16) { const old = this.pools.shift(); this.scene.remove(old); old.material.dispose(); }
  }

  muzzle(x, y, z) {
    const s = this.flashes[this.flashIdx++ % this.flashes.length];
    s.position.set(x, y, z);
    const k = 0.35 + Math.random() * 0.25;
    s.scale.set(k, k, 1);
    s.material.rotation = Math.random() * 6.28;
    s.visible = true;
    s.userData.t = 0.05;
  }

  // 烟雾弹：一团大小不一的云朵精灵
  addSmoke(id, x, y, z, dur, age = 0) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const sprites = [];
    const n = this.low ? 26 : 40;
    for (let k = 0; k < n; k++) {
      const m = new THREE.SpriteMaterial({ map: this.cloudTex, color: new THREE.Color().setHSL(0.1, 0.03, 0.52 + Math.random() * 0.12), transparent: true, depthWrite: false, opacity: 0 });
      const s = new THREE.Sprite(m);
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 2.7, h = Math.random() * 3.0;
      s.userData.target = new THREE.Vector3(Math.cos(a) * r, 0.4 + h, Math.sin(a) * r);
      s.userData.size = 3.0 + Math.random() * 1.7;
      s.userData.spin = (Math.random() - 0.5) * 0.3;
      s.position.set(0, 0.2, 0);
      s.renderOrder = 6;
      g.add(s);
      sprites.push(s);
    }
    this.scene.add(g);
    this.smokes.push({ id, g, sprites, t: age, dur, x, y, z });
  }

  removeSmoke(id) {
    const i = this.smokes.findIndex((s) => s.id === id);
    if (i >= 0) { this.disposeGroup(this.smokes[i].g); this.smokes.splice(i, 1); }
  }

  // 相机在烟里有多深（0..1）
  smokeDensityAt(p) {
    let best = 0;
    for (const s of this.smokes) {
      const grow = Math.min(1, s.t / 1.5);
      const fade = s.t > s.dur - 2 ? Math.max(0, (s.dur - s.t) / 2) : 1;
      const dx = p.x - s.x, dy = p.y - (s.y + 1.2), dz = p.z - s.z;
      const d = Math.sqrt(dx * dx + dy * dy * 1.4 + dz * dz);
      const r = 3.3 * grow;
      if (d < r) best = Math.max(best, Math.min(1, (1 - d / r) * 2.2) * fade);
    }
    return best;
  }

  addFire(id, x, y, z, dur, age = 0) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const sprites = [];
    for (let k = 0; k < (this.low ? 16 : 26); k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flameTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, color: 0xffffff }));
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 2.5;
      s.position.set(Math.cos(a) * r, 0.35, Math.sin(a) * r);
      s.userData.base = 0.6 + Math.random() * 0.7;
      s.userData.ph = Math.random() * 10;
      s.renderOrder = 7;
      g.add(s);
      sprites.push(s);
    }
    const light = this.takeLight(0xff7a2a, 9, x, y + 0.8, z);
    this.scene.add(g);
    this.fires.push({ id, g, sprites, light, t: age, dur, x, y, z, nextCrackle: 0 });
  }

  removeFire(id) {
    const i = this.fires.findIndex((f) => f.id === id);
    if (i >= 0) { this.freeLight(this.fires[i].light); this.disposeGroup(this.fires[i].g); this.fires.splice(i, 1); }
  }

  takeLight(color, dist, x, y, z) {
    const l = this.lights.find((q) => !q.userData.busy);
    if (!l) return null;
    l.userData.busy = true;
    l.color.set(color);
    l.distance = dist;
    l.position.set(x, y, z);
    l.intensity = 0;
    return l;
  }

  freeLight(l) {
    if (!l) return;
    l.intensity = 0;
    l.userData.busy = false;
  }

  explosion(x, y, z, scale = 1) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flare(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, color: 0xffc070 }));
    s.position.set(x, y + 0.5, z);
    s.scale.set(1, 1, 1);
    this.scene.add(s);
    const light = this.takeLight(0xffa050, 22 * scale, x, y + 1, z);
    this.booms.push({ s, light, t: 0, scale });
    for (let k = 0; k < 40 * scale; k++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2, v = 4 + Math.random() * 9;
      this.parts.emit(x, y + 0.3, z, Math.cos(a) * Math.cos(e) * v, Math.sin(e) * v, Math.sin(a) * Math.cos(e) * v, 0.5 + Math.random() * 0.6, 0.12, 1, 0.7 + Math.random() * 0.3, 0.3, 1, 9, 0, 0.5);
    }
    for (let k = 0; k < 22 * scale; k++) {
      const a = Math.random() * Math.PI * 2, v = 0.5 + Math.random() * 2.5;
      this.parts.emit(x, y + 0.4, z, Math.cos(a) * v, 0.8 + Math.random() * 1.8, Math.sin(a) * v, 1.6 + Math.random() * 1.2, 0.9 + Math.random(), 0.28, 0.26, 0.24, 0.75, -0.2, 1.4, 0.8);
    }
  }

  flashPop(x, y, z) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flare(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, color: 0xffffff }));
    s.position.set(x, y, z);
    this.scene.add(s);
    const light = this.takeLight(0xffffff, 25, x, y, z);
    this.booms.push({ s, light, t: 0, scale: 0.8, flash: true });
  }

  disposeGroup(g) {
    this.scene.remove(g);
    g.traverse((o) => { if (o.material) o.material.dispose(); });
  }

  clearRound() {
    for (const m of this.pools) { this.scene.remove(m); m.material.dispose(); }
    this.pools = [];
    for (const s of this.smokes) this.disposeGroup(s.g);
    for (const f of this.fires) { this.freeLight(f.light); this.disposeGroup(f.g); }
    this.smokes = [];
    this.fires = [];
  }

  update(dt, camPos, audio) {
    this.time += dt;
    this.parts.update(dt);
    for (const m of this.pools) {
      const u = m.userData;
      if (u.t >= 2.5) continue;
      u.t += dt;
      const k = Math.min(1, u.t / 2.5);
      const r = 0.05 + u.size * (1 - (1 - k) * (1 - k) * (1 - k));
      m.scale.set(r, r * u.sy, 1);
    }
    for (let i = 0; i < this.maxTr; i++) {
      if (this.trLife[i] > 0) {
        this.trLife[i] -= dt;
        const k = Math.max(0, this.trLife[i] / 0.07);
        this.trCol[i * 6] = 1 * k; this.trCol[i * 6 + 1] = 0.85 * k; this.trCol[i * 6 + 2] = 0.55 * k;
        this.trCol[i * 6 + 3] = 0.9 * k; this.trCol[i * 6 + 4] = 0.7 * k; this.trCol[i * 6 + 5] = 0.35 * k;
      }
    }
    this.tracers.geometry.attributes.position.needsUpdate = true;
    this.tracers.geometry.attributes.color.needsUpdate = true;
    for (const s of this.flashes) {
      if (!s.visible) continue;
      s.userData.t -= dt;
      if (s.userData.t <= 0) s.visible = false;
    }
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const sm = this.smokes[i];
      sm.t += dt;
      if (sm.t > sm.dur) { this.disposeGroup(sm.g); this.smokes.splice(i, 1); continue; }
      const grow = Math.min(1, sm.t / 1.5);
      const fade = sm.t > sm.dur - 2 ? Math.max(0, (sm.dur - sm.t) / 2) : 1;
      for (const s of sm.sprites) {
        s.position.lerp(s.userData.target, Math.min(1, dt * 3));
        const sz = s.userData.size * (0.3 + 0.7 * grow);
        s.scale.set(sz, sz, 1);
        s.material.rotation += s.userData.spin * dt;
        s.material.opacity = 0.92 * grow * fade;
      }
    }
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t += dt;
      if (f.t > f.dur) { this.freeLight(f.light); this.disposeGroup(f.g); this.fires.splice(i, 1); continue; }
      const fade = f.t > f.dur - 1 ? Math.max(0, f.dur - f.t) : Math.min(1, f.t * 4);
      for (const s of f.sprites) {
        const fl = 0.75 + 0.25 * Math.sin(this.time * 13 + s.userData.ph) + Math.random() * 0.12;
        const sz = s.userData.base * fl * fade;
        s.scale.set(sz, sz * 1.5, 1);
        s.position.y = 0.3 + sz * 0.5;
      }
      if (f.light) f.light.intensity = (5 + Math.random() * 2.5) * fade;
      if (Math.random() < dt * 3) this.parts.emit(f.x + (Math.random() - 0.5) * 4, f.y + 0.8, f.z + (Math.random() - 0.5) * 4, 0, 1.2, 0, 1.4, 0.7, 0.18, 0.17, 0.16, 0.5, -0.3, 1.2, 0);
      if (audio && this.time > f.nextCrackle) { f.nextCrackle = this.time + 0.15 + Math.random() * 0.25; audio.play('crackle', [f.x, f.y, f.z], fade); }
    }
    for (let i = this.booms.length - 1; i >= 0; i--) {
      const b = this.booms[i];
      b.t += dt;
      const dur = b.flash ? 0.25 : 0.4;
      const p = b.t / dur;
      if (p >= 1) {
        this.scene.remove(b.s); b.s.material.dispose();
        this.freeLight(b.light);
        this.booms.splice(i, 1);
        continue;
      }
      const sz = (b.flash ? 3 : 6) * b.scale * (0.4 + p);
      b.s.scale.set(sz, sz, 1);
      b.s.material.opacity = 1 - p;
      if (b.light) b.light.intensity = (b.flash ? 40 : 30) * b.scale * (1 - p);
    }
  }
}
