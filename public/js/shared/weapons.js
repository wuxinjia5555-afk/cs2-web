// 武器数据（参考 CS2 数值），后坐力图案、精度与伤害计算
import { dirFromAngles, clamp, DEG } from './util.js';

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
    recoil: { up: 1.2, side: 0.3, rec: 10, lin: 3, wait: 0.11 },
  },
  usp: {
    id: 'usp', name: 'USP-S', slot: 2, type: 'pistol', team: 'CT', price: 200, dmg: 35, pen: 0.505, rpm: 352,
    mag: 12, res: 24, reload: 2.2, speed: 240 * U, rm: 0.91, deploy: 0.6, killReward: 300, silenced: true,
    spread: sp({ base: 0.0006, stand: 0.0038, crouch: 0.003, move: 0.02, air: 0.2, fire: 0.026, recover: 0.3, cap: 0.06 }),
    recoil: { up: 1.1, side: 0.2, rec: 10, lin: 3, wait: 0.11 },
  },
  p250: {
    id: 'p250', name: 'P250', slot: 2, type: 'pistol', price: 300, dmg: 38, pen: 0.64, rpm: 400,
    mag: 13, res: 26, reload: 2.2, speed: 240 * U, rm: 0.85, deploy: 0.6, killReward: 300,
    spread: sp({ base: 0.001, stand: 0.006, crouch: 0.0047, move: 0.024, air: 0.22, fire: 0.04, recover: 0.33, cap: 0.09 }),
    recoil: { up: 1.6, side: 0.35, rec: 9, lin: 3, wait: 0.12 },
  },
  deagle: {
    id: 'deagle', name: '沙漠之鹰', slot: 2, type: 'pistol', price: 700, dmg: 53, pen: 0.932, rpm: 267,
    mag: 7, res: 35, reload: 2.2, speed: 230 * U, rm: 0.81, deploy: 0.7, killReward: 300,
    spread: sp({ base: 0.0015, stand: 0.005, crouch: 0.004, move: 0.065, air: 0.35, fire: 0.06, recover: 0.5, cap: 0.1 }),
    recoil: { up: 4.2, side: 0.8, rec: 10, lin: 6, wait: 0.12 },
  },
  // P2000：和 USP-S 二选一的 CT 默认手枪（不带消音器，弹匣多一发）
  p2000: {
    id: 'p2000', name: 'P2000', slot: 2, type: 'pistol', team: 'CT', price: 200, dmg: 35, pen: 0.505, rpm: 352,
    mag: 13, res: 52, reload: 2.2, speed: 240 * U, rm: 0.91, deploy: 0.6, killReward: 300,
    spread: sp({ base: 0.0007, stand: 0.0045, crouch: 0.0035, move: 0.02, air: 0.2, fire: 0.027, recover: 0.3, cap: 0.065 }),
    recoil: { up: 1.2, side: 0.25, rec: 10, lin: 3, wait: 0.11 },
  },
  elite: {
    id: 'elite', name: '双持伯莱塔', slot: 2, type: 'pistol', price: 300, dmg: 38, pen: 0.575, rpm: 500,
    mag: 30, res: 120, reload: 3.8, speed: 240 * U, rm: 0.79, deploy: 0.7, killReward: 300, dual: true,
    spread: sp({ base: 0.0015, stand: 0.008, crouch: 0.0065, move: 0.02, air: 0.22, fire: 0.024, recover: 0.3, cap: 0.085 }),
    recoil: { up: 1.3, side: 0.4, rec: 10, lin: 3, wait: 0.1 },
  },
  fiveseven: {
    id: 'fiveseven', name: 'FN57', slot: 2, type: 'pistol', team: 'CT', price: 500, dmg: 32, pen: 0.9115, rpm: 400,
    mag: 20, res: 100, reload: 2.2, speed: 240 * U, rm: 0.81, deploy: 0.6, killReward: 300,
    spread: sp({ base: 0.0008, stand: 0.005, crouch: 0.004, move: 0.016, air: 0.2, fire: 0.03, recover: 0.3, cap: 0.08 }),
    recoil: { up: 1.4, side: 0.3, rec: 10, lin: 3, wait: 0.11 },
  },
  tec9: {
    id: 'tec9', name: 'Tec-9', slot: 2, type: 'pistol', team: 'T', price: 500, dmg: 33, pen: 0.906, rpm: 500,
    mag: 18, res: 90, reload: 2.5, speed: 240 * U, rm: 0.83, deploy: 0.6, killReward: 300,
    spread: sp({ base: 0.0012, stand: 0.0062, crouch: 0.005, move: 0.014, air: 0.2, fire: 0.036, recover: 0.36, cap: 0.1 }),
    recoil: { up: 1.7, side: 0.45, rec: 9, lin: 3, wait: 0.1 },
  },
  // CZ75：全自动手枪，只有 12 发、备弹也只有 12 发，击杀奖励少
  cz75: {
    id: 'cz75', name: 'CZ75 自动手枪', slot: 2, type: 'pistol', price: 500, dmg: 31, pen: 0.7765, rpm: 600,
    mag: 12, res: 12, reload: 2.7, speed: 240 * U, rm: 0.85, auto: true, deploy: 0.75, killReward: 100,
    spread: sp({ base: 0.0012, stand: 0.0065, crouch: 0.005, move: 0.03, air: 0.25, fire: 0.03, recover: 0.4, cap: 0.11 }),
    recoil: { up: 1.5, side: 0.8, rec: 7, phase: 0.7 },
  },
  // R8 左轮：按下去先扳击锤（windup 秒）才响，一枪很重
  revolver: {
    id: 'revolver', name: 'R8 左轮', slot: 2, type: 'pistol', price: 600, dmg: 86, pen: 0.932, rpm: 120,
    mag: 8, res: 8, reload: 2.3, speed: 220 * U, rm: 0.94, deploy: 0.7, killReward: 300, windup: 0.2,
    spread: sp({ base: 0.0006, stand: 0.0035, crouch: 0.003, move: 0.06, air: 0.35, fire: 0.07, recover: 0.55, cap: 0.12 }),
    recoil: { up: 5.0, side: 0.9, rec: 9, lin: 6, wait: 0.15 },
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
  mp7: {
    id: 'mp7', name: 'MP7', slot: 1, type: 'smg', price: 1500, dmg: 29, pen: 0.625, rpm: 750,
    mag: 30, res: 120, reload: 3.1, speed: 220 * U, rm: 0.85, auto: true, deploy: 0.8, killReward: 600,
    spread: sp({ base: 0.0018, stand: 0.009, crouch: 0.0072, move: 0.03, air: 0.2, fire: 0.0062, recover: 0.3, cap: 0.045 }),
    recoil: { up: 0.5, side: 0.42, rec: 6, phase: 2.2 },
  },
  mp5sd: {
    id: 'mp5sd', name: 'MP5-SD', slot: 1, type: 'smg', price: 1500, dmg: 27, pen: 0.625, rpm: 750,
    mag: 30, res: 120, reload: 3.0, speed: 235 * U, rm: 0.85, auto: true, deploy: 0.8, killReward: 600, silenced: true,
    spread: sp({ base: 0.0016, stand: 0.0088, crouch: 0.007, move: 0.026, air: 0.2, fire: 0.006, recover: 0.3, cap: 0.045 }),
    recoil: { up: 0.46, side: 0.4, rec: 6, phase: 3.0 },
  },
  p90: {
    id: 'p90', name: 'P90', slot: 1, type: 'smg', price: 2350, dmg: 26, pen: 0.69, rpm: 857,
    mag: 50, res: 100, reload: 3.3, speed: 230 * U, rm: 0.86, auto: true, deploy: 0.8, killReward: 300,
    spread: sp({ base: 0.002, stand: 0.0105, crouch: 0.0088, move: 0.022, air: 0.18, fire: 0.0058, recover: 0.3, cap: 0.05 }),
    recoil: { up: 0.45, side: 0.55, rec: 6, phase: 1.1 },
  },
  bizon: {
    id: 'bizon', name: 'PP-野牛', slot: 1, type: 'smg', price: 1400, dmg: 27, pen: 0.575, rpm: 750,
    mag: 64, res: 120, reload: 2.4, speed: 240 * U, rm: 0.8, auto: true, deploy: 0.8, killReward: 600,
    spread: sp({ base: 0.0022, stand: 0.0115, crouch: 0.0095, move: 0.026, air: 0.2, fire: 0.006, recover: 0.3, cap: 0.055 }),
    recoil: { up: 0.48, side: 0.6, rec: 6, phase: 2.7 },
  },
  // XM1014：半自动霰弹枪，按住就一直打
  xm1014: {
    id: 'xm1014', name: 'XM1014 连喷', slot: 1, type: 'shotgun', price: 2000, dmg: 20, pellets: 6, pen: 0.8, rpm: 171,
    mag: 7, res: 32, reload: 3.0, speed: 215 * U, rm: 0.7, auto: true, deploy: 0.8, killReward: 900,
    spread: sp({ base: 0, pellet: 0.05, stand: 0.008, crouch: 0.006, move: 0.02, air: 0.15, fire: 0.006, recover: 0.3, cap: 0.05 }),
    recoil: { up: 2.6, side: 0.6, rec: 5 },
  },
  sawedoff: {
    id: 'sawedoff', name: '截短霰弹枪', slot: 1, type: 'shotgun', team: 'T', price: 1100, dmg: 32, pellets: 8, pen: 0.75, rpm: 71,
    mag: 7, res: 32, reload: 3.2, speed: 210 * U, rm: 0.45, deploy: 0.8, killReward: 900,
    spread: sp({ base: 0, pellet: 0.07, stand: 0.008, crouch: 0.006, move: 0.02, air: 0.15, fire: 0, recover: 0.3, cap: 0.05 }),
    recoil: { up: 3.4, side: 0.7, rec: 5 },
  },
  mag7: {
    id: 'mag7', name: 'MAG-7 警喷', slot: 1, type: 'shotgun', team: 'CT', price: 1300, dmg: 30, pellets: 8, pen: 0.75, rpm: 71,
    mag: 5, res: 32, reload: 2.4, speed: 225 * U, rm: 0.45, deploy: 0.8, killReward: 900,
    spread: sp({ base: 0, pellet: 0.055, stand: 0.008, crouch: 0.006, move: 0.02, air: 0.15, fire: 0, recover: 0.3, cap: 0.05 }),
    recoil: { up: 3.2, side: 0.6, rec: 5 },
  },
  m249: {
    id: 'm249', name: 'M249', slot: 1, type: 'mg', price: 5200, dmg: 32, pen: 0.8, rpm: 750,
    mag: 100, res: 200, reload: 5.7, speed: 195 * U, rm: 0.97, auto: true, deploy: 1.2, killReward: 300,
    spread: sp({ stand: 0.0065, crouch: 0.005, move: 0.17, air: 0.45, fire: 0.0075, cap: 0.07 }),
    recoil: { up: 0.82, side: 1.5, rec: 6, phase: 0.9 },
  },
  negev: {
    id: 'negev', name: '内格夫', slot: 1, type: 'mg', price: 1700, dmg: 35, pen: 0.71, rpm: 800,
    mag: 150, res: 300, reload: 5.7, speed: 150 * U, rm: 0.97, auto: true, deploy: 1.2, killReward: 300,
    spread: sp({ stand: 0.0075, crouch: 0.006, move: 0.2, air: 0.5, fire: 0.007, cap: 0.075 }),
    recoil: { up: 0.7, side: 1.3, rec: 6, phase: 1.9 },
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
    spread: sp({ base: 0.0005, stand: 0.0032, crouch: 0.0024, move: 0.11, air: 0.38, fire: 0.0055, cap: 0.035 }),
    recoil: { up: 0.52, side: 0.5, rec: 7, phase: 2.1 },
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
  // SG 553 / AUG：带瞄准镜的步枪，右键开镜（只有一档），开镜后更准、走得慢
  sg553: {
    id: 'sg553', name: 'SG 553', slot: 1, type: 'rifle', team: 'T', price: 3000, dmg: 30, pen: 1.0, rpm: 545,
    mag: 30, res: 90, reload: 2.8, speed: 210 * U, scopedSpeed: 150 * U, rm: 0.98, auto: true, deploy: 1.0, killReward: 300, scope: [36],
    spread: sp({ stand: 0.0045, crouch: 0.0034, scoped: 0.0022, move: 0.13, air: 0.4, fire: 0.0075 }),
    recoil: { up: 0.8, side: 1.15, rec: 6, phase: 3.3 },
  },
  aug: {
    id: 'aug', name: 'AUG', slot: 1, type: 'rifle', team: 'CT', price: 3300, dmg: 28, pen: 0.9, rpm: 600,
    mag: 30, res: 90, reload: 3.8, speed: 220 * U, scopedSpeed: 150 * U, rm: 0.98, auto: true, deploy: 1.0, killReward: 300, scope: [36],
    spread: sp({ stand: 0.0042, crouch: 0.0032, scoped: 0.002, move: 0.12, air: 0.38, fire: 0.007 }),
    recoil: { up: 0.66, side: 0.95, rec: 6, phase: 0.2 },
  },
  // 连狙：按住就一直打，开完枪不会退镜
  g3sg1: {
    id: 'g3sg1', name: 'G3SG1 连狙', slot: 1, type: 'sniper', team: 'T', price: 5000, dmg: 80, pen: 0.825, rpm: 240,
    mag: 20, res: 90, reload: 4.7, speed: 215 * U, scopedSpeed: 120 * U, rm: 0.98, auto: true, deploy: 1.1, killReward: 300, scope: [30.7, 11.3],
    spread: sp({ base: 0.0003, stand: 0.03, crouch: 0.025, scoped: 0.0018, move: 0.2, air: 0.5, fire: 0.012, recover: 0.45, cap: 0.06 }),
    recoil: { up: 1.6, side: 0.5, rec: 6, phase: 1.4 },
  },
  scar20: {
    id: 'scar20', name: 'SCAR-20 连狙', slot: 1, type: 'sniper', team: 'CT', price: 5000, dmg: 80, pen: 0.825, rpm: 240,
    mag: 20, res: 90, reload: 3.1, speed: 215 * U, scopedSpeed: 120 * U, rm: 0.98, auto: true, deploy: 1.1, killReward: 300, scope: [30.7, 11.3],
    spread: sp({ base: 0.0003, stand: 0.03, crouch: 0.025, scoped: 0.0018, move: 0.2, air: 0.5, fire: 0.012, recover: 0.45, cap: 0.06 }),
    recoil: { up: 1.6, side: 0.5, rec: 6, phase: 2.5 },
  },

  he: { id: 'he', name: '高爆手雷', slot: 4, type: 'grenade', price: 300, max: 1, speed: 245 * U, deploy: 0.5, killReward: 300, pen: 0.575 },
  flash: { id: 'flash', name: '闪光弹', slot: 4, type: 'grenade', price: 200, max: 2, speed: 245 * U, deploy: 0.5 },
  smoke: { id: 'smoke', name: '烟雾弹', slot: 4, type: 'grenade', price: 300, max: 1, speed: 245 * U, deploy: 0.5 },
  molotov: { id: 'molotov', name: '燃烧瓶', slot: 4, type: 'grenade', team: 'T', price: 400, max: 1, speed: 245 * U, deploy: 0.5, killReward: 300, pen: 1 },
  incgrenade: { id: 'incgrenade', name: '燃烧弹', slot: 4, type: 'grenade', team: 'CT', price: 500, max: 1, speed: 245 * U, deploy: 0.5, killReward: 300, pen: 1 },

  c4: { id: 'c4', name: 'C4 炸弹', slot: 5, type: 'c4', speed: 250 * U, deploy: 0.8, pen: 0.5 },
};

// 超出图案后（无限子弹一直压枪）循环使用的最后一段：只保留左右晃动，并且一圈下来左右正好抵消，不会往一边越飘越远
const LOOP = 12;
for (const w of Object.values(WEAPONS)) {
  if (!w.recoil) continue;
  w.pat = pattern(Math.max(w.mag, 30), w.recoil.up, w.recoil.side, w.recoil.phase || 0);
  const tail = w.pat.slice(-LOOP).map((k) => k[0]);
  const mean = tail.reduce((a, b) => a + b, 0) / LOOP;
  w.loopKick = tail.map((v) => [v - mean, 0]);
}

// 第 spray 发的后坐力（角度）：[水平, 垂直]
export function patternKick(w, spray) {
  const i = Math.floor(spray), n = w.pat.length;
  return i < n ? w.pat[i] : w.loopKick[(i - n) % LOOP];
}

// 开一枪后的计数：超出图案后在最后一段里循环，计数不会无限增长
export function nextSpray(w, spray) {
  const s = spray + 1, n = w.pat.length;
  return s >= n + LOOP ? s - LOOP : s;
}

export const EQUIP = {
  vest: { id: 'vest', name: '防弹衣', price: 650 },
  vesthelm: { id: 'vesthelm', name: '防弹衣+头盔', price: 1000 },
  kit: { id: 'kit', name: '拆弹器', price: 400, team: 'CT' },
};

// 买枪菜单的分类（顺序照 CS2：装备、手枪、中级武器、步枪、投掷物；数字键也是这个顺序）
// key：这一栏归配装管（见下面的 LOADOUT_POOL），对局里只摆配装里带的那 5 把；items 是这一栏所有的东西
export const BUY_MENU = [
  { cat: '装备', en: 'EQUIPMENT', items: ['vest', 'vesthelm', 'kit'] },
  { cat: '手枪', en: 'PISTOLS', key: 'pistol', items: ['glock', 'usp', 'p2000', 'elite', 'p250', 'tec9', 'fiveseven', 'cz75', 'deagle', 'revolver'] },
  { cat: '中级武器', en: 'MID-TIER', key: 'mid', items: ['mac10', 'mp9', 'mp7', 'mp5sd', 'ump45', 'p90', 'bizon', 'nova', 'xm1014', 'sawedoff', 'mag7', 'm249', 'negev'] },
  { cat: '步枪', en: 'RIFLES', key: 'rifle', items: ['galil', 'famas', 'ak47', 'm4a4', 'm4a1s', 'sg553', 'aug', 'ssg08', 'awp', 'g3sg1', 'scar20'] },
  { cat: '投掷物', en: 'GRENADES', items: ['flash', 'smoke', 'he', 'molotov', 'incgrenade'] },
];

// ---------------- 配装（照 CS2）----------------
// 武器太多，一局里带不全：每个阵营的手枪、中级武器、步枪各有 5 个栏位，开局前在主菜单的「配装」里选好带哪几把，
// 买枪菜单里就只有这些。手枪的第一个栏位是起始手枪（出生时手里的那把）：匪徒固定是格洛克，警察可以在 USP-S 和 P2000 里选
export const LOADOUT_SLOTS = 5;
export const LOADOUT_KEYS = ['pistol', 'mid', 'rifle'];
export const LOADOUT_POOL = {
  T: {
    pistol: ['glock', 'elite', 'p250', 'tec9', 'cz75', 'deagle', 'revolver'],
    mid: ['mac10', 'mp7', 'mp5sd', 'ump45', 'p90', 'bizon', 'nova', 'xm1014', 'sawedoff', 'm249', 'negev'],
    rifle: ['galil', 'ak47', 'sg553', 'ssg08', 'awp', 'g3sg1'],
  },
  CT: {
    pistol: ['usp', 'p2000', 'elite', 'p250', 'fiveseven', 'cz75', 'deagle', 'revolver'],
    mid: ['mp9', 'mp7', 'mp5sd', 'ump45', 'p90', 'bizon', 'nova', 'xm1014', 'mag7', 'm249', 'negev'],
    rifle: ['famas', 'm4a4', 'm4a1s', 'aug', 'ssg08', 'awp', 'scar20'],
  },
};
export const LOADOUT_DEFAULT = {
  T: { pistol: ['glock', 'elite', 'p250', 'tec9', 'deagle'], mid: ['mac10', 'mp7', 'ump45', 'p90', 'nova'], rifle: ['galil', 'ak47', 'sg553', 'ssg08', 'awp'] },
  CT: { pistol: ['usp', 'elite', 'p250', 'fiveseven', 'deagle'], mid: ['mp9', 'mp7', 'ump45', 'p90', 'nova'], rifle: ['famas', 'm4a4', 'm4a1s', 'ssg08', 'awp'] },
};
export const START_PISTOLS = { T: ['glock'], CT: ['usp', 'p2000'] };
// 把一份配装整理成合规的：只留池子里有的、不重复的，起始手枪放第一格，不够 5 把的拿默认的补上
export function fixLoadout(lo) {
  const out = {};
  for (const team of ['T', 'CT']) {
    out[team] = {};
    for (const key of LOADOUT_KEYS) {
      const pool = LOADOUT_POOL[team][key], def = LOADOUT_DEFAULT[team][key];
      const src = lo && lo[team] && Array.isArray(lo[team][key]) ? lo[team][key] : def;
      let list = [];
      for (const id of src) if (pool.includes(id) && !list.includes(id)) list.push(id);
      if (key === 'pistol') {
        const sp = START_PISTOLS[team];
        const first = list.find((id) => sp.includes(id)) || sp[0];
        list = [first, ...list.filter((id) => !sp.includes(id))];
      }
      list = list.slice(0, LOADOUT_SLOTS);
      for (const id of [...def, ...pool]) {
        if (list.length >= LOADOUT_SLOTS) break;
        if (!list.includes(id) && !(key === 'pistol' && START_PISTOLS[team].includes(id))) list.push(id);
      }
      out[team][key] = list;
    }
  }
  return out;
}

export const NADE_TYPES = ['he', 'flash', 'smoke', 'molotov', 'incgrenade'];
export const MAX_NADES = 4;

// 出生时手里的手枪：sp 是配装里选的起始手枪（不合规就用默认的）
export const defaultPistol = (team, sp) => (START_PISTOLS[team] && START_PISTOLS[team].includes(sp) ? sp : team === 'CT' ? 'usp' : 'glock');

// 后坐力与精度恢复（玩家和机器人共用）。s: {punchP, punchY, spray, fireAcc}，since：距上一枪的秒数
export function recoverRecoil(s, w, dt, since) {
  const rc = w.recoil;
  if (rc) {
    const iv = w.rpm ? 60 / w.rpm : 0.1;
    // 停火后最多等 0.15 秒就开始回正（以前按射速算，大狙、霰弹枪要等快 2 秒）
    if (since > (rc.wait != null ? rc.wait : Math.min(iv * 1.3, 0.15))) {
      // 指数回正 + 线性回正：自动武器约 0.3 秒、狙击枪 / 霰弹枪约 0.4 秒回到准星
      const slow = w.type === 'sniper' || w.type === 'shotgun';
      const rec = w.auto ? Math.max(rc.rec, 10) : slow ? Math.max(rc.rec, 9) : rc.rec;
      const lin = rc.lin != null ? rc.lin : w.auto ? 5 : slow ? 6 : 0;
      const k = Math.exp(-rec * dt);
      s.punchP *= k;
      s.punchY *= k;
      // 线性回正：最后一点偏移也能很快归零（类似 CS 的 recoil_decay_lin）
      if (lin) {
        const m = Math.hypot(s.punchP, s.punchY);
        if (m > 0) {
          const f = Math.max(0, m - lin * DEG * dt) / m;
          s.punchP *= f;
          s.punchY *= f;
        }
      }
      // 计数回落：打得越多回落越快，停火约 0.3 秒就回到第一发
      s.spray = Math.max(0, s.spray - (dt / iv) * 2.5 - s.spray * 4 * dt);
    }
  }
  // 开枪带来的额外扩散：和 CS 一样，recover 秒后恢复到 10%
  if (w.spread) s.fireAcc *= Math.exp((-dt * Math.LN10) / w.spread.recover);
}

export function dmgAt(w, dist) {
  return w.dmg * Math.pow(w.rm || 1, dist / 12.7);
}

// 中弹减速：被这种武器打中后，最快只能跑到平时的几成（1 = 不减速）。步枪、狙击枪、霰弹枪、刀压得最狠，
// 手枪、冲锋枪、手雷轻一些；摔伤、火烧、炸弹爆炸不减速。之后每秒恢复 TAG_RECOVER
export const TAG_RECOVER = 0.9;
export function tagOf(wid) {
  if (wid === 'knife') return 0.5;
  if (wid === 'he') return 0.65;
  const w = WEAPONS[wid];
  if (!w || !w.dmg) return 1;
  return w.type === 'pistol' || w.type === 'smg' ? 0.65 : 0.5;
}
// 把水平速度压到不超过 max（中弹的那一瞬间用）
export function capSpeed(s, max) {
  const sp = Math.hypot(s.vx, s.vz);
  if (sp > max) { s.vx *= max / sp; s.vz *= max / sp; }
}

export function moveSpeed(w, scoped) {
  if (!w) return 250 * U;
  return scoped && w.scopedSpeed ? w.scopedSpeed : w.speed;
}

// 蹲稳在地上开枪更稳（玩家和机器人共用）：后坐力小一些，连射时越打越散的幅度也小一些。跳起来蹲不算
export const CROUCH_RECOIL = 0.78; // 蹲着时每一枪的后坐力乘这个
export const CROUCH_FIRE = 0.6;    // 蹲着时每一枪增加的散布乘这个
export const steady = (crouched, onGround) => !!crouched && !!onGround;

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

export const isGun = (w) => !!w && (w.type === 'pistol' || w.type === 'smg' || w.type === 'shotgun' || w.type === 'rifle' || w.type === 'sniper' || w.type === 'mg');
// 栓动狙击枪（开一枪要拉一次栓、开完枪会退镜）；连狙不算
// ---------- 自定义模式的规则 ----------
// 建房间时带过来的规则先在这里整理成合规的（服务器、人机练习、界面都用这一份）
export const RULE_DEFAULT = {
  teamT: 5, teamCT: 5, win: 8, freeze: 6, roundTime: 115, bomb: true, swap: true, respawn: 'none', respawnTime: 3,
  armor: 'default', ammo: 'default', money: false, weapons: 'all', drop: true, hp: 100, steps: true, special: 'none',
};
export const RULE_CHOICES = {
  respawn: ['none', 'spawn', 'place'], armor: ['default', 'none', 'light', 'heavy'], ammo: ['default', 'mag', 'reserve'],
  weapons: ['all', 'pistol', 'smg', 'rifle', 'sniper', 'shotgun', 'knife', 'random'], special: ['none', 'lowgrav', 'fast'],
};
export const RULE_RANGE = { teamT: [1, 5], teamCT: [1, 5], win: [1, 16], freeze: [0, 60], roundTime: [20, 600], respawnTime: [0, 30], hp: [1, 500] };
export function fixRules(r) {
  if (!r || typeof r !== 'object') return null;
  const o = {};
  for (const k in RULE_DEFAULT) {
    const d = RULE_DEFAULT[k], v = r[k];
    if (RULE_RANGE[k]) o[k] = typeof v === 'number' && Number.isFinite(v) ? Math.min(RULE_RANGE[k][1], Math.max(RULE_RANGE[k][0], k === 'respawnTime' ? Math.round(v * 2) / 2 : Math.round(v))) : d;
    else if (RULE_CHOICES[k]) o[k] = RULE_CHOICES[k].includes(v) ? v : d;
    else o[k] = v == null ? d : !!v;
  }
  return o;
}
const RULE_TYPE = { pistol: ['pistol'], smg: ['smg'], rifle: ['rifle'], sniper: ['sniper'], shotgun: ['shotgun'] };
// 这个房间里能不能买这样东西（武器 id 或者装备 id）
export function ruleAllows(rules, id) {
  if (!rules) return true;
  const w = WEAPONS[id];
  if (!w) return id === 'kit' ? rules.bomb : rules.armor === 'default'; // 装备：护甲只有「默认」时能自己买；没炸弹就不用拆弹器
  if (w.slot === 4) return rules.weapons !== 'knife' && rules.weapons !== 'random';
  if (rules.weapons === 'all') return true;
  if (rules.weapons === 'knife' || rules.weapons === 'random') return false;
  return RULE_TYPE[rules.weapons].includes(w.type) || (rules.weapons === 'rifle' && w.type === 'mg');
}
// 「随机武器」的池子
export const RULE_RANDOM = ['ak47', 'm4a4', 'm4a1s', 'galil', 'famas', 'sg553', 'aug', 'awp', 'ssg08', 'mp9', 'mac10', 'mp7', 'p90', 'ump45', 'bizon', 'nova', 'xm1014', 'mag7', 'negev', 'deagle', 'revolver', 'elite'];

export const isBoltSniper = (w) => !!w && w.type === 'sniper' && !w.auto;
