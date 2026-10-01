// 物理：世界碰撞（AABB + 网格加速）、玩家移动（Source 风格）、射线检测、命中盒
import { P, HG } from './constants.js';

const EPS = 1e-4;
const tmpList = [];

export class World {
  constructor(boxes) {
    this.boxes = boxes;
    const n = boxes.length;
    const b = (this.b = new Float64Array(n * 6));
    let minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity;
    for (let i = 0; i < n; i++) {
      const bx = boxes[i];
      b[i * 6] = bx.min[0]; b[i * 6 + 1] = bx.min[1]; b[i * 6 + 2] = bx.min[2];
      b[i * 6 + 3] = bx.max[0]; b[i * 6 + 4] = bx.max[1]; b[i * 6 + 5] = bx.max[2];
      if (bx.min[0] < minx) minx = bx.min[0];
      if (bx.min[2] < minz) minz = bx.min[2];
      if (bx.max[0] > maxx) maxx = bx.max[0];
      if (bx.max[2] > maxz) maxz = bx.max[2];
    }
    const gs = (this.gs = 4);
    this.gx0 = Math.floor(minx) - 1;
    this.gz0 = Math.floor(minz) - 1;
    this.gw = Math.ceil((maxx - this.gx0) / gs) + 1;
    this.gh = Math.ceil((maxz - this.gz0) / gs) + 1;
    this.cells = new Array(this.gw * this.gh);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = [];
    for (let i = 0; i < n; i++) {
      const c0 = this._cx(b[i * 6]), c1 = this._cx(b[i * 6 + 3]);
      const r0 = this._cz(b[i * 6 + 2]), r1 = this._cz(b[i * 6 + 5]);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.cells[r * this.gw + c].push(i);
    }
    this.stamp = new Uint32Array(n);
    this.sid = 1;
  }

  _cx(x) { return Math.max(0, Math.min(this.gw - 1, Math.floor((x - this.gx0) / this.gs))); }
  _cz(z) { return Math.max(0, Math.min(this.gh - 1, Math.floor((z - this.gz0) / this.gs))); }
  _nextSid() {
    if (++this.sid >= 0xfffffff0) { this.stamp.fill(0); this.sid = 1; }
    return this.sid;
  }

  // 查询与 AABB 严格相交的盒子，结果写入 out，返回数量
  query(minx, miny, minz, maxx, maxy, maxz, out) {
    out.length = 0;
    const sid = this._nextSid();
    const c0 = this._cx(minx), c1 = this._cx(maxx), r0 = this._cz(minz), r1 = this._cz(maxz);
    const b = this.b, st = this.stamp;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cell = this.cells[r * this.gw + c];
        for (let k = 0; k < cell.length; k++) {
          const i = cell[k];
          if (st[i] === sid) continue;
          st[i] = sid;
          const o = i * 6;
          if (b[o] < maxx && b[o + 3] > minx && b[o + 1] < maxy && b[o + 4] > miny && b[o + 2] < maxz && b[o + 5] > minz) out.push(i);
        }
      }
    }
    return out.length;
  }

  // 射线（dir 需归一化），返回最近命中 {t, i, nx, ny, nz} 或 null
  raycast(ox, oy, oz, dx, dy, dz, maxT) {
    const b = this.b, gs = this.gs, st = this.stamp;
    const sid = this._nextSid();
    const ix = 1 / (dx || 1e-12), iy = 1 / (dy || 1e-12), iz = 1 / (dz || 1e-12);
    let best = maxT, hit = -1, axis = 0;
    let cx = Math.floor((ox - this.gx0) / gs), cz = Math.floor((oz - this.gz0) / gs);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    let tMaxX = dx !== 0 ? (this.gx0 + (cx + (dx > 0 ? 1 : 0)) * gs - ox) / dx : Infinity;
    let tMaxZ = dz !== 0 ? (this.gz0 + (cz + (dz > 0 ? 1 : 0)) * gs - oz) / dz : Infinity;
    const tDX = dx !== 0 ? Math.abs(gs / dx) : Infinity;
    const tDZ = dz !== 0 ? Math.abs(gs / dz) : Infinity;
    for (let guard = 0; guard < 2000; guard++) {
      if (cx >= 0 && cx < this.gw && cz >= 0 && cz < this.gh) {
        const cell = this.cells[cz * this.gw + cx];
        for (let k = 0; k < cell.length; k++) {
          const i = cell[k];
          if (st[i] === sid) continue;
          st[i] = sid;
          const o = i * 6;
          let t1 = (b[o] - ox) * ix, t2 = (b[o + 3] - ox) * ix;
          let tmin = t1 < t2 ? t1 : t2, tmax = t1 < t2 ? t2 : t1, ax = 0;
          t1 = (b[o + 1] - oy) * iy; t2 = (b[o + 4] - oy) * iy;
          let lo = t1 < t2 ? t1 : t2, hi = t1 < t2 ? t2 : t1;
          if (lo > tmin) { tmin = lo; ax = 1; }
          if (hi < tmax) tmax = hi;
          t1 = (b[o + 2] - oz) * iz; t2 = (b[o + 5] - oz) * iz;
          lo = t1 < t2 ? t1 : t2; hi = t1 < t2 ? t2 : t1;
          if (lo > tmin) { tmin = lo; ax = 2; }
          if (hi < tmax) tmax = hi;
          if (tmax >= 0 && tmin <= tmax && tmin < best) {
            if (tmin < 0) { best = 0; hit = i; axis = -1; }
            else { best = tmin; hit = i; axis = ax; }
          }
        }
      } else {
        if ((dx === 0 && (cx < 0 || cx >= this.gw)) || (dz === 0 && (cz < 0 || cz >= this.gh))) break;
        if ((cx < 0 && stepX < 0) || (cx >= this.gw && stepX > 0) || (cz < 0 && stepZ < 0) || (cz >= this.gh && stepZ > 0)) break;
      }
      let t;
      if (tMaxX < tMaxZ) { t = tMaxX; tMaxX += tDX; cx += stepX; }
      else { t = tMaxZ; tMaxZ += tDZ; cz += stepZ; }
      if (t > best) break;
    }
    if (hit < 0) return null;
    let nx = 0, ny = 0, nz = 0;
    if (axis === 0) nx = dx > 0 ? -1 : 1;
    else if (axis === 1) ny = dy > 0 ? -1 : 1;
    else if (axis === 2) nz = dz > 0 ? -1 : 1;
    else { nx = -dx; ny = -dy; nz = -dz; }
    return { t: best, i: hit, nx, ny, nz };
  }

  // 两点之间是否无遮挡
  clear(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-6) return true;
    const h = this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d);
    return !h || h.t >= d - 0.02;
  }
}

export function hullBlocked(world, x, y, z, h) {
  const r = P.radius;
  return world.query(x - r, y, z - r, x + r, y + h, z + r, tmpList) > 0;
}

// 沿单轴移动并处理碰撞，返回是否被阻挡
function moveAxis(world, s, axis, amount, h) {
  if (amount === 0) return false;
  const r = P.radius, b = world.b;
  const steps = Math.max(1, Math.ceil(Math.abs(amount) / 0.3));
  const inc = amount / steps;
  for (let k = 0; k < steps; k++) {
    let x = s.x, y = s.y, z = s.z;
    if (axis === 0) x += inc; else if (axis === 1) y += inc; else z += inc;
    const n = world.query(x - r, y, z - r, x + r, y + h, z + r, tmpList);
    let blocked = false;
    for (let j = 0; j < n; j++) {
      const o = tmpList[j] * 6;
      if (axis === 0) {
        if (inc > 0) { if (s.x + r <= b[o] + 1e-3) { x = Math.min(x, b[o] - r - EPS); blocked = true; } }
        else if (s.x - r >= b[o + 3] - 1e-3) { x = Math.max(x, b[o + 3] + r + EPS); blocked = true; }
      } else if (axis === 1) {
        if (inc > 0) { if (s.y + h <= b[o + 1] + 1e-3) { y = Math.min(y, b[o + 1] - h - EPS); blocked = true; } }
        else if (s.y >= b[o + 4] - 1e-3) { y = Math.max(y, b[o + 4] + EPS); blocked = true; }
      } else {
        if (inc > 0) { if (s.z + r <= b[o + 2] + 1e-3) { z = Math.min(z, b[o + 2] - r - EPS); blocked = true; } }
        else if (s.z - r >= b[o + 5] - 1e-3) { z = Math.max(z, b[o + 5] + r + EPS); blocked = true; }
      }
    }
    s.x = x; s.y = y; s.z = z;
    if (blocked) return true;
  }
  return false;
}

// 玩家是否碰到梯子（梯子是一个贴着墙的长方体范围，nx/nz 是梯子朝外的方向）
function ladderAt(world, s, h) {
  const L = world.ladders;
  if (!L || !L.length) return null;
  const r = P.radius + 0.05;
  for (const l of L) {
    if (s.x + r < l.min[0] || s.x - r > l.max[0] || s.z + r < l.min[2] || s.z - r > l.max[2]) continue;
    if (s.y > l.max[1] || s.y + h < l.min[1]) continue;
    return l;
  }
  return null;
}

function applyFriction(s, dt) {
  const speed = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
  if (speed < 1e-4) { s.vx = 0; s.vz = 0; return; }
  const control = speed < P.stopSpeed ? P.stopSpeed : speed;
  const ns = Math.max(speed - control * P.friction * dt, 0) / speed;
  s.vx *= ns; s.vz *= ns;
}

function accelerate(s, wx, wz, wishspeed, dt) {
  if (wishspeed <= 0) return;
  const add = wishspeed - (s.vx * wx + s.vz * wz);
  if (add <= 0) return;
  let as = P.accel * dt * wishspeed;
  if (as > add) as = add;
  s.vx += as * wx; s.vz += as * wz;
}

function airAccelerate(s, wx, wz, wishspeed, dt) {
  if (wishspeed <= 0) return;
  const add = Math.min(wishspeed, P.airCap) - (s.vx * wx + s.vz * wz);
  if (add <= 0) return;
  let as = P.airAccel * wishspeed * dt;
  if (as > add) as = add;
  s.vx += as * wx; s.vz += as * wz;
}

// 新建移动状态
export function newMoveState(x = 0, y = 0, z = 0) {
  return { x, y, z, vx: 0, vy: 0, vz: 0, onGround: false, crouched: false, jumpHeld: false };
}

// 推进一步玩家移动。cmd: {fwd, side, jump, crouch, walk, yaw, speed, frozen}
export function stepPlayer(s, cmd, dt, world) {
  const dh = P.standH - P.crouchH;
  if (cmd.crouch && !s.crouched) {
    if (!s.onGround) s.y += dh; // 空中下蹲：收腿（可蹲跳上更高的箱子）
    s.crouched = true;
  } else if (!cmd.crouch && s.crouched) {
    if (s.onGround) {
      if (!hullBlocked(world, s.x, s.y, s.z, P.standH)) s.crouched = false;
    } else if (!hullBlocked(world, s.x, s.y - dh, s.z, P.standH)) {
      s.y -= dh; s.crouched = false;
    } else if (!hullBlocked(world, s.x, s.y, s.z, P.standH)) {
      s.crouched = false;
    }
  }
  const h = s.crouched ? P.crouchH : P.standH;

  const fwd = cmd.frozen ? 0 : cmd.fwd, side = cmd.frozen ? 0 : cmd.side;
  const sy = Math.sin(cmd.yaw), cy = Math.cos(cmd.yaw);
  let wx = -sy * fwd + cy * side;
  let wz = -cy * fwd - sy * side;
  const wl = Math.sqrt(wx * wx + wz * wz);
  let wishspeed = 0;
  if (wl > 1e-6) {
    wx /= wl; wz /= wl;
    wishspeed = cmd.speed * (s.crouched ? P.crouchMul : cmd.walk ? P.walkMul : 1);
  }

  // 梯子：朝着梯子走就是爬（看上面往上爬、看下面往下爬），不按方向就挂在梯子上；跳跃跳离梯子
  if (s.ladderCD > 0) s.ladderCD -= dt;
  const lad = cmd.frozen || s.ladderCD > 0 ? null : ladderAt(world, s, h);
  if (lad) {
    const mag = Math.min(1, wl);
    const a = mag > 1e-6 ? -(wx * lad.nx + wz * lad.nz) : 0; // >0：朝着梯子
    const climb = a * mag * ((cmd.pitch || 0) > -0.35 ? 1 : -1);
    // 站在梯子脚下又不是往上爬：照常走路（这样能离开梯子）
    if (!(s.onGround && climb <= 0.05)) {
      if (cmd.jump && !s.jumpHeld) {
        s.jumpHeld = true;
        s.ladderCD = 0.35;
        s.vx = lad.nx * 3.2; s.vz = lad.nz * 3.2; s.vy = 2.4;
      } else {
        if (!cmd.jump) s.jumpHeld = false;
        const lx = (wx + lad.nx * a) * mag, lz = (wz + lad.nz * a) * mag; // 沿着梯子横着挪
        s.vx = lx * 1.5 - lad.nx * 0.6; // 轻轻贴着梯子，爬到顶会被带上平台
        s.vz = lz * 1.5 - lad.nz * 0.6;
        s.vy = climb * P.ladderSpeed;
      }
      s.onGround = false;
      if (moveAxis(world, s, 0, s.vx * dt, h)) s.vx = 0;
      if (moveAxis(world, s, 2, s.vz * dt, h)) s.vz = 0;
      if (moveAxis(world, s, 1, s.vy * dt, h)) { if (s.vy < 0) s.onGround = true; s.vy = 0; }
      return;
    }
  }

  if (s.onGround) {
    if (cmd.jump && !s.jumpHeld && !cmd.frozen) {
      s.vy = P.jumpVel;
      s.onGround = false;
      s.jumpHeld = true;
      airAccelerate(s, wx, wz, wishspeed, dt);
    } else {
      applyFriction(s, dt);
      accelerate(s, wx, wz, wishspeed, dt);
    }
  } else {
    airAccelerate(s, wx, wz, wishspeed, dt);
  }
  if (!cmd.jump) s.jumpHeld = false;

  s.vy -= P.gravity * dt;
  if (s.vy < -P.maxFall) s.vy = -P.maxFall;

  const wasGround = s.onGround;
  s.onGround = false;
  const dx = s.vx * dt, dz = s.vz * dt;
  if (wasGround) {
    const sx = s.x, sy0 = s.y, sz = s.z, svx = s.vx, svz = s.vz;
    const bx = moveAxis(world, s, 0, dx, h); if (bx) s.vx = 0;
    const bz = moveAxis(world, s, 2, dz, h); if (bz) s.vz = 0;
    if (bx || bz) {
      // 尝试上台阶
      const ax = s.x, az = s.z, avx = s.vx, avz = s.vz;
      const d1 = (ax - sx) * (ax - sx) + (az - sz) * (az - sz);
      s.x = sx; s.y = sy0; s.z = sz; s.vx = svx; s.vz = svz;
      moveAxis(world, s, 1, P.stepH, h);
      const up = s.y - sy0;
      const bx2 = moveAxis(world, s, 0, dx, h);
      const bz2 = moveAxis(world, s, 2, dz, h);
      moveAxis(world, s, 1, -up, h);
      const d2 = (s.x - sx) * (s.x - sx) + (s.z - sz) * (s.z - sz);
      if (up > 0.01 && d2 > d1 + 1e-8) {
        if (bx2) s.vx = 0;
        if (bz2) s.vz = 0;
      } else {
        s.x = ax; s.y = sy0; s.z = az; s.vx = avx; s.vz = avz;
      }
    }
  } else {
    if (moveAxis(world, s, 0, dx, h)) s.vx = 0;
    if (moveAxis(world, s, 2, dz, h)) s.vz = 0;
  }

  const vyBefore = s.vy;
  if (moveAxis(world, s, 1, s.vy * dt, h)) {
    if (vyBefore < 0) s.onGround = true;
    s.vy = 0;
  }
  // 贴地：下台阶时不腾空
  if (wasGround && !s.onGround && vyBefore <= 0) {
    const y0 = s.y;
    if (moveAxis(world, s, 1, -P.stepH, h)) { s.onGround = true; s.vy = 0; }
    else s.y = y0;
  }
}

// ---------- 命中盒 ----------
// [底, 顶, 半宽, 部位]
const HB_STAND = [[1.52, 1.83, 0.14, HG.HEAD], [1.1, 1.52, 0.23, HG.CHEST], [0.82, 1.1, 0.21, HG.STOMACH], [0, 0.82, 0.2, HG.LEGS]];
const HB_CROUCH = [[1.08, 1.37, 0.14, HG.HEAD], [0.72, 1.08, 0.23, HG.CHEST], [0.48, 0.72, 0.21, HG.STOMACH], [0, 0.48, 0.22, HG.LEGS]];

function rayAabb(ox, oy, oz, ix, iy, iz, x0, y0, z0, x1, y1, z1) {
  let t1 = (x0 - ox) * ix, t2 = (x1 - ox) * ix;
  let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
  t1 = (y0 - oy) * iy; t2 = (y1 - oy) * iy;
  tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
  t1 = (z0 - oz) * iz; t2 = (z1 - oz) * iz;
  tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
  if (tmax < 0 || tmin > tmax) return -1;
  return tmin < 0 ? 0 : tmin;
}

export function rayPlayer(ox, oy, oz, dx, dy, dz, px, py, pz, crouched, maxT) {
  const ix = 1 / (dx || 1e-12), iy = 1 / (dy || 1e-12), iz = 1 / (dz || 1e-12);
  const H = crouched ? P.crouchH : P.standH;
  const bt = rayAabb(ox, oy, oz, ix, iy, iz, px - 0.45, py, pz - 0.45, px + 0.45, py + H + 0.05, pz + 0.45);
  if (bt < 0 || bt > maxT) return null;
  const hb = crouched ? HB_CROUCH : HB_STAND;
  let best = maxT, g = -1;
  for (let k = 0; k < hb.length; k++) {
    const e = hb[k];
    const t = rayAabb(ox, oy, oz, ix, iy, iz, px - e[2], py + e[0], pz - e[2], px + e[2], py + e[1], pz + e[2]);
    if (t >= 0 && t < best) { best = t; g = e[3]; }
  }
  return g < 0 ? null : { t: best, g };
}

// 子弹追踪：先打墙，再打人。targets: [{id, x, y, z, crouched}]
// 返回 {kind: 0 无/1 墙/2 人, t, x, y, z, ...}
export function traceShot(world, ox, oy, oz, dx, dy, dz, maxDist, targets, skipId) {
  const w = world.raycast(ox, oy, oz, dx, dy, dz, maxDist);
  let t = w ? w.t : maxDist;
  let res = w ? { kind: 1, t, nx: w.nx, ny: w.ny, nz: w.nz, i: w.i } : { kind: 0, t };
  for (let k = 0; k < targets.length; k++) {
    const tg = targets[k];
    if (tg.id === skipId) continue;
    const h = rayPlayer(ox, oy, oz, dx, dy, dz, tg.x, tg.y, tg.z, tg.crouched, t);
    if (h && h.t < t) { t = h.t; res = { kind: 2, t, id: tg.id, g: h.g, tg }; }
  }
  res.x = ox + dx * res.t; res.y = oy + dy * res.t; res.z = oz + dz * res.t;
  return res;
}

// 线段与球是否相交（烟雾遮挡）
export function segSphere(ax, ay, az, bx, by, bz, cx, cy, cz, r) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const fx = ax - cx, fy = ay - cy, fz = az - cz;
  const a = dx * dx + dy * dy + dz * dz;
  const c = fx * fx + fy * fy + fz * fz - r * r;
  if (c <= 0) return true;
  if (a < 1e-9) return false;
  const b = 2 * (fx * dx + fy * dy + fz * dz);
  let disc = b * b - 4 * a * c;
  if (disc < 0) return false;
  disc = Math.sqrt(disc);
  const t1 = (-b - disc) / (2 * a), t2 = (-b + disc) / (2 * a);
  return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1) || (t1 < 0 && t2 > 1);
}
