// 武器数据（参考 CS2 数值），后坐力图案、精度与伤害计算
import { dirFromAngles, clamp } from './util.js';

const U = 0.0254; // 起源引擎单位 -> 米

// 生成可学习的固定后坐力图案：每发 [水平增量, 垂直增量]（角度）
function pattern(n, up, side, phase = 0) {
  const out = [];
  for (let k = 1; k <= n; k++) {
    let dp, dy;
    if (k === 1) { dp = up * 0.55; dy = 0; }
    else if (k <= 9) { dp = up * (1.12 - 0.045 * k); dy = side * 0.12 * Math.sin(k * 1.7 + phase); }
    else { dp = up * (k < 20 ? 0.1 : 0.05); dy = side * 0.85 * Math.sin((k - 9) * 0.55 + Math.PI + phase); }
    out.push([dy, dp]);
  }
  return out;
}

function sp(o) {
  return Object.assign({ base: 0.0006, stand: 0.005, crouch: 0.004, move: 0.12, air: 0.4, fire: 0.008, recover: 0.35, cap: 0.06 }, o);
}

export const WEAPONS = {
  knife: { id: 'knife', name: '匕首', slot: 3, type: 'knife', speed: 250 * U, deploy: 0.5, killReward: 1500, pen: 0.85 },

  glock: {
    id: 'glock', name: 'Glock-18', slot: 2, type: 'pistol', team: 'T', price: 200, dmg: 30, pen: 0.47, rpm: 400,
    mag: 20, res: 120, reload: 2.2, speed: 240 * U, rm: 0.85, deploy: 0.6, killReward: 300,
    spread: sp({ base: 0.001, stand: 0.0065, crouch: 0.005, move: 0.025, air: 0.22, fire: 0.028, recover: 0.3, cap: 0.08 }),
    recoil: { up: 1.3, side: 0.35, rec: 7 },
  },
  usp: {
    id: 'usp', name: 'USP-S', slot: 2, type: 'pistol', team: 'CT', price: 200, dmg: 35, pen: 0.505, rpm: 352,
    mag: 12, res: 24, reload: 2.2, speed: 240 * U, rm: 0.91, deploy: 0.6, killReward: 300, silenced: true,
    spread: sp({ base: 0.0008, stand: 0.0045, crouch: 0.0035, move: 0.02, air: 0.2, fire: 0.03, recover: 0.32, cap: 0.08 }),
    recoil: { up: 1.5, side: 0.3, rec: 7 },
  },
  p250: {
    id: 'p250', name: 'P250', slot: 2, type: 'pistol', price: 300, dmg: 38, pen: 0.64, rpm: 400,
    mag: 13, res: 26, reload: 2.2, speed: 240 * U, rm: 0.85, deploy: 0.6, killReward: 300,
    spread: sp({ base: 0.001, stand: 0.006, crouch: 0.0047, move: 0.024, air: 0.22, fire: 0.04, recover: 0.33, cap: 0.09 }),
    recoil: { up: 1.8, side: 0.4, rec: 7 },
  },
  deagle: {
    id: 'deagle', name: '沙漠之鹰', slot: 2, type: 'pistol', price: 700, dmg: 53, pen: 0.932, rpm: 267,
    mag: 7, res: 35, reload: 2.2, speed: 230 * U, rm: 0.81, deploy: 0.7, killReward: 300,
    spread: sp({ base: 0.002, stand: 0.0055, crouch: 0.0045, move: 0.065, air: 0.35, fire: 0.075, recover: 0.45, cap: 0.12 }),
    recoil: { up: 4.2, side: 0.9, rec: 5 },
  },

  mac10: {
    id: 'mac10', name: 'MAC-10', slot: 1, type: 'smg', team: 'T', price: 1050, dmg: 29, pen: 0.575, rpm: 800,
    mag: 30, res: 100, reload: 2.6, speed: 240 * U, rm: 0.8, auto: true, deploy: 0.7, killReward: 600,
    spread: sp({ base: 0.002, stand: 0.011, crouch: 0.009, move: 0.03, air: 0.2, fire: 0.007, recover: 0.3, cap: 0.05 }),
    recoil: { up: 0.55, side: 0.6, rec: 6 },
  },
  mp9: {
    id: 'mp9', name: 'MP9', slot: 1, type: 'smg', team: 'CT', price: 1250, dmg: 26, pen: 0.6, rpm: 857,
    mag: 30, res: 120, reload: 2.1, speed: 240 * U, rm: 0.87, auto: true, deploy: 0.7, killReward: 600,
    spread: sp({ base: 0.002, stand: 0.0095, crouch: 0.0078, move: 0.028, air: 0.2, fire: 0.0065, recover: 0.3, cap: 0.05 }),
    recoil: { up: 0.5, side: 0.5, rec: 6, phase: 0.8 },
  },
  ump45: {
    id: 'ump45', name: 'UMP-45', slot: 1, type: 'smg', price: 1200, dmg: 35, pen: 0.65, rpm: 666,
    mag: 25, res: 100, reload: 3.3, speed: 230 * U, rm: 0.75, auto: true, deploy: 0.8, killReward: 600,
    spread: sp({ base: 0.002, stand: 0.0085, crouch: 0.0068, move: 0.03, air: 0.2, fire: 0.007, recover: 0.3, cap: 0.05 }),
    recoil: { up: 0.6, side: 0.5, rec: 6, phase: 1.6 },
  },
  nova: {
    id: 'nova', name: 'Nova 霰弹枪', slot: 1, type: 'shotgun', price: 1050, dmg: 26, pellets: 9, pen: 0.5, rpm: 68,
    mag: 8, res: 32, reload: 3.0, speed: 220 * U, rm: 0.7, deploy: 0.8, killReward: 900,
    spread: sp({ base: 0, pellet: 0.045, stand: 0.008, crouch: 0.006, move: 0.02, air: 0.15, fire: 0, recover: 0.3, cap: 0.05 }),
    recoil: { up: 3, side: 0.6, rec: 5 },
  },

  galil: {
    id: 'galil', name: '加利尔 AR', slot: 1, type: 'rifle', team: 'T', price: 1800, dmg: 30, pen: 0.775, rpm: 666,
    mag: 35, res: 90, reload: 3.0, speed: 215 * U, rm: 0.98, auto: true, deploy: 1.0, killReward: 300,
    spread: sp({ stand: 0.0055, crouch: 0.0042, move: 0.13, air: 0.4, fire: 0.0085 }),
    recoil: { up: 0.72, side: 1.1, rec: 6, phase: 0.4 },
  },
  famas: {
    id: 'famas', name: '法玛斯', slot: 1, type: 'rifle', team: 'CT', price: 2050, dmg: 30, pen: 0.7, rpm: 666,
    mag: 25, res: 90, reload: 3.3, speed: 220 * U, rm: 0.96, auto: true, deploy: 1.0, killReward: 300,
    spread: sp({ stand: 0.005, crouch: 0.0038, move: 0.12, air: 0.4, fire: 0.0082 }),
    recoil: { up: 0.7, side: 1.0, rec: 6, phase: 2.6 },
  },
  ak47: {
    id: 'ak47', name: 'AK-47', slot: 1, type: 'rifle', team: 'T', price: 2700, dmg: 36, pen: 0.775, rpm: 600,
    mag: 30, res: 90, reload: 2.5, speed: 215 * U, rm: 0.98, auto: true, deploy: 1.0, killReward: 300,
    spread: sp({ stand: 0.0048, crouch: 0.0036, move: 0.14, air: 0.42, fire: 0.0078 }),
    recoil: { up: 0.78, side: 1.25, rec: 6 },
  },
  m4a4: {
    id: 'm4a4', name: 'M4A4', slot: 1, type: 'rifle', team: 'CT', price: 3100, dmg: 33, pen: 0.7, rpm: 666,
    mag: 30, res: 90, reload: 3.1, speed: 225 * U, rm: 0.97, auto: true, deploy: 1.0, killReward: 300,
    spread: sp({ stand: 0.004, crouch: 0.003, move: 0.12, air: 0.38, fire: 0.0072 }),
    recoil: { up: 0.7, side: 1.0, rec: 6, phase: 1.2 },
  },
  m4a1s: {
    id: 'm4a1s', name: 'M4A1-S', slot: 1, type: 'rifle', team: 'CT', price: 2900, dmg: 38, pen: 0.7, rpm: 600,
    mag: 20, res: 80, reload: 3.1, speed: 225 * U, rm: 0.99, auto: true, deploy: 1.0, killReward: 300, silenced: true,
    spread: sp({ stand: 0.0035, crouch: 0.0026, move: 0.11, air: 0.38, fire: 0.0062 }),
    recoil: { up: 0.62, side: 0.8, rec: 6.5, phase: 2.1 },
  },
  ssg08: {
    id: 'ssg08', name: 'SSG 08 鸟狙', slot: 1, type: 'sniper', price: 1700, dmg: 88, pen: 0.85, rpm: 48,
    mag: 10, res: 90, reload: 3.7, speed: 230 * U, rm: 0.98, deploy: 1.0, killReward: 300, scope: [30.7, 11.3],
    spread: sp({ base: 0.0003, stand: 0.045, crouch: 0.04, scoped: 0.0022, move: 0.1, air: 0.12, fire: 0, recover: 0.3, cap: 0.01 }),
    recoil: { up: 2.5, side: 0.4, rec: 5 },
  },
  awp: {
    id: 'awp', name: 'AWP 大狙', slot: 1, type: 'sniper', price: 4750, dmg: 115, pen: 0.975, rpm: 41,
    mag: 5, res: 30, reload: 3.7, speed: 200 * U, scopedSpeed: 100 * U, rm: 0.99, deploy: 1.2, killReward: 100, scope: [30.7, 7.5],
    spread: sp({ base: 0.0002, stand: 0.08, crouch: 0.07, scoped: 0.0012, move: 0.22, air: 0.5, fire: 0, recover: 0.3, cap: 0.01 }),
    recoil: { up: 3.5, side: 0.5, rec: 4.5 },
  },

  he: { id: 'he', name: '高爆手雷', slot: 4, type: 'grenade', price: 300, max: 1, speed: 245 * U, deploy: 0.5, killReward: 300, pen: 0.575 },
  flash: { id: 'flash', name: '闪光弹', slot: 4, type: 'grenade', price: 200, max: 2, speed: 245 * U, deploy: 0.5 },
  smoke: { id: 'smoke', name: '烟雾弹', slot: 4, type: 'grenade', price: 300, max: 1, speed: 245 * U, deploy: 0.5 },
  molotov: { id: 'molotov', name: '燃烧瓶', slot: 4, type: 'grenade', team: 'T', price: 400, max: 1, speed: 245 * U, deploy: 0.5, killReward: 300, pen: 1 },
  incgrenade: { id: 'incgrenade', name: '燃烧弹', slot: 4, type: 'grenade', team: 'CT', price: 500, max: 1, speed: 245 * U, deploy: 0.5, killReward: 300, pen: 1 },

  c4: { id: 'c4', name: 'C4 炸弹', slot: 5, type: 'c4', speed: 250 * U, deploy: 0.8, pen: 0.5 },
};

for (const w of Object.values(WEAPONS)) {
  if (w.recoil) w.pat = pattern(Math.max(w.mag, 30), w.recoil.up, w.recoil.side, w.recoil.phase || 0);
}

export const EQUIP = {
  vest: { id: 'vest', name: '防弹衣', price: 650 },
  vesthelm: { id: 'vesthelm', name: '防弹衣+头盔', price: 1000 },
  kit: { id: 'kit', name: '拆弹器', price: 400, team: 'CT' },
};

export const BUY_MENU = [
  { cat: '手枪', items: ['glock', 'usp', 'p250', 'deagle'] },
  { cat: '微冲 / 霰弹', items: ['mac10', 'mp9', 'ump45', 'nova'] },
  { cat: '步枪', items: ['galil', 'famas', 'ak47', 'm4a4', 'm4a1s', 'ssg08', 'awp'] },
  { cat: '装备', items: ['vest', 'vesthelm', 'kit'] },
  { cat: '投掷物', items: ['flash', 'smoke', 'he', 'molotov', 'incgrenade'] },
];

export const NADE_TYPES = ['he', 'flash', 'smoke', 'molotov', 'incgrenade'];
export const MAX_NADES = 4;

export const defaultPistol = (team) => (team === 'CT' ? 'usp' : 'glock');

export function dmgAt(w, dist) {
  return w.dmg * Math.pow(w.rm || 1, dist / 12.7);
}

export function moveSpeed(w, scoped) {
  if (!w) return 250 * U;
  return scoped && w.scopedSpeed ? w.scopedSpeed : w.speed;
}

// 当前不精确度（弧度）。st: {speed, onGround, crouched, scoped, fireAcc, maxSpeed}
export function inaccuracy(w, st) {
  const s = w.spread;
  if (!s) return 0;
  let v = s.base;
  if (w.scope && st.scoped) v += st.crouched ? s.scoped * 0.7 : s.scoped;
  else v += st.crouched ? s.crouch : s.stand;
  const ms = st.maxSpeed || 6;
  v += s.move * clamp((st.speed - ms * 0.34) / (ms * 0.66), 0, 1);
  if (!st.onGround) v += s.air;
  v += st.fireAcc || 0;
  return v;
}

// 在锥形范围内随机一个方向（中心偏向分布，同 CS）
export function spreadDir(yaw, pitch, inacc, rnd, out) {
  const a = rnd() * Math.PI * 2, r = inacc * rnd();
  return dirFromAngles(yaw + Math.cos(a) * r, pitch + Math.sin(a) * r, out);
}

export const isGun = (w) => !!w && (w.type === 'pistol' || w.type === 'smg' || w.type === 'shotgun' || w.type === 'rifle' || w.type === 'sniper');
