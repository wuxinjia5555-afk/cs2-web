// 通用小工具（共享）

export const DEG = Math.PI / 180;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

// b - a 的最短角度差
export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export const lerpAngle = (a, b, t) => a + angleDiff(a, b) * t;

// yaw=0 朝向 -Z，pitch 正值为抬头
export function dirFromAngles(yaw, pitch, out = [0, 0, 0]) {
  const cp = Math.cos(pitch);
  out[0] = -Math.sin(yaw) * cp;
  out[1] = Math.sin(pitch);
  out[2] = -Math.cos(yaw) * cp;
  return out;
}
export function anglesFromDir(dx, dy, dz) {
  return [Math.atan2(-dx, -dz), Math.atan2(dy, Math.sqrt(dx * dx + dz * dz))];
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const r2 = (v) => Math.round(v * 100) / 100;
export const r3 = (v) => Math.round(v * 1000) / 1000;

export function shuffle(arr, rnd = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}
export const pick = (arr, rnd = Math.random) => arr[Math.floor(rnd() * arr.length)];

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const isVec3 = (a) => Array.isArray(a) && a.length === 3 && isNum(a[0]) && isNum(a[1]) && isNum(a[2]);

export function cleanText(s, max) {
  return String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
}
