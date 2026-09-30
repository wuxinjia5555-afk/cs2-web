// 投掷物/掉落物弹道（确定性模拟：服务端与客户端用相同代码得到相同轨迹）

export const NADE = {
  he: { fuse: 1.6, radius: 9, dmg: 98 },
  flash: { fuse: 1.6, range: 32 },
  smoke: { radius: 3.4, dur: 18, minAge: 1.0 },
  molotov: { radius: 2.7, dur: 7, dps: 40, maxAir: 2.0 },
};
export const NADE_STEP = 1 / 64;
export const G_GRAV = 8.13;

export function makeProjectile(o, v, elast = 0.45) {
  return { x: o[0], y: o[1], z: o[2], vx: v[0], vy: v[1], vz: v[2], rest: false, ground: false, bounces: 0, age: 0, elast, hitGround: false };
}

// 推进一步；返回本步是否发生了弹跳
export function stepProjectile(g, dt, world, grav = G_GRAV) {
  g.age += dt;
  if (g.rest) return false;
  let bounced = false;
  g.vy -= grav * dt;
  let rem = dt;
  for (let it = 0; it < 4 && rem > 1e-7; it++) {
    const sp = Math.sqrt(g.vx * g.vx + g.vy * g.vy + g.vz * g.vz);
    if (sp < 1e-6) break;
    const dx = g.vx / sp, dy = g.vy / sp, dz = g.vz / sp;
    const dist = sp * rem;
    const h = world.raycast(g.x, g.y, g.z, dx, dy, dz, dist + 0.06);
    if (!h || h.t > dist + 0.05) {
      g.x += g.vx * rem; g.y += g.vy * rem; g.z += g.vz * rem;
      break;
    }
    const t = Math.max(0, h.t - 0.05);
    g.x += dx * t; g.y += dy * t; g.z += dz * t;
    rem -= t / sp;
    const vn = g.vx * h.nx + g.vy * h.ny + g.vz * h.nz;
    if (vn < 0) {
      const k = 1 + g.elast;
      g.vx -= k * vn * h.nx; g.vy -= k * vn * h.ny; g.vz -= k * vn * h.nz;
      g.vx *= 0.8; g.vz *= 0.8;
      g.bounces++;
      if (Math.abs(vn) > 1.5) bounced = true;
      if (h.ny > 0.7) {
        g.ground = true; g.hitGround = true;
        if (g.vy < 1.2) g.vy = 0;
      }
    }
  }
  // 地面滚动与静止判定
  if (g.ground && g.vy === 0) {
    const d = world.raycast(g.x, g.y, g.z, 0, -1, 0, 0.12);
    if (d) {
      const f = Math.max(0, 1 - 2.5 * dt);
      g.vx *= f; g.vz *= f;
      if (g.vx * g.vx + g.vz * g.vz < 0.04) { g.vx = 0; g.vz = 0; g.rest = true; }
    } else {
      g.ground = false;
    }
  }
  return bounced;
}

// 投掷初速度：strength 0..1（右键轻抛 ~0.35，左键全力 1）
export function throwVelocity(dir, strength, pv) {
  const speed = 7 + 10.5 * strength;
  return [dir[0] * speed + pv[0], dir[1] * speed + pv[1] * 0.5, dir[2] * speed + pv[2]];
}
