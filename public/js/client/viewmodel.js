// 第一人称武器（独立场景渲染，不会穿墙），含晃动、后坐、换弹、切枪、挥刀、检视动画
import * as THREE from 'three';
import { makeWeapon, armColors, mbox } from './models.js';
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
    const lay = LAYOUT[type] || LAYOUT.rifle;
    const g = new THREE.Group();
    const gun = makeWeapon(wid);
    g.add(gun);
    const col = armColors(this.team);
    // 右手握把 + 前臂
    g.add(mbox(0.05, 0.09, 0.075, col.glove, 0.0, -0.045, 0.03, -0.3));
    g.add(mbox(0.078, 0.078, 0.34, col.sleeve, 0.05, -0.16, 0.2, 0.7, -0.25));
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
    let g = this.cache.get(wid);
    if (!g) { g = this.build(wid); this.cache.set(wid, g); }
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

  onFire(now, strength = 1) {
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
    const kickZ = type === 'sniper' ? 0.07 : type === 'pistol' ? 0.035 : type === 'shotgun' ? 0.07 : 0.028;
    const kickR = type === 'sniper' ? 0.18 : type === 'pistol' ? 0.16 : type === 'shotgun' ? 0.2 : 0.06;
    pz += this.kick * kickZ;
    rx += this.kick * kickR;

    // 拔枪
    if (this.drawDur > 0) {
      const p = clamp((now - this.drawStart) / this.drawDur, 0, 1);
      const e = 1 - Math.pow(1 - p, 3);
      py -= (1 - e) * 0.22;
      rx -= (1 - e) * 0.7;
    }
    // 换弹
    const gun = g.userData.gun;
    const mag = gun.userData.mag;
    if (mag && mag.userData.base === undefined) mag.userData.base = mag.position.clone();
    if (this.reloadDur > 0) {
      const p = clamp((now - this.reloadStart) / this.reloadDur, 0, 1);
      const s = Math.sin(p * Math.PI);
      rx -= s * 0.35;
      rz += s * 0.45;
      py -= s * 0.04;
      if (mag) {
        const out = p < 0.2 ? p / 0.2 : p < 0.55 ? 1 : p < 0.75 ? 1 - (p - 0.55) / 0.2 : 0;
        mag.position.copy(mag.userData.base);
        mag.position.y -= out * 0.18;
        mag.visible = !(p > 0.3 && p < 0.5);
      }
      if (p >= 1) this.reloadDur = 0;
    } else if (mag) {
      mag.position.copy(mag.userData.base);
      mag.visible = true;
    }
    // 挥刀
    if (this.knifeT >= 0) {
      const dur = this.knifeStab ? 0.55 : 0.32;
      const p = (now - this.knifeT) / dur;
      if (p >= 1) this.knifeT = -1;
      else {
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
      const p = (now - this.inspectT) / 2.6;
      if (p >= 1) this.inspectT = -1;
      else {
        const s = Math.sin(Math.min(1, p * 2.2) * Math.PI / 2) * (p > 0.8 ? (1 - p) / 0.2 : 1);
        ry -= s * 1.1;
        rz += s * 0.5;
        px -= s * 0.05;
        py += s * 0.03;
      }
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
