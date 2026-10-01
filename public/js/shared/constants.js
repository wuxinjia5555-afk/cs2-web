// 共享常量（服务端与浏览器共用，不能引用任何浏览器/Node 专有 API）

export const VERSION = 1;
export const TICK_RATE = 30;          // 服务器逻辑帧率
export const PHYS_DT = 1 / 64;        // 客户端物理步长（64 tick）
export const INTERP_DELAY = 0.1;      // 其他玩家插值延迟（秒）
export const LEVEL_H = 0.4;           // 地图高度层级，每级 0.4 米

// 移动物理（Source 引擎风格，单位：米 / 秒）
export const P = {
  gravity: 20.3,
  jumpVel: 7.25,
  radius: 0.4,
  standH: 1.83,
  crouchH: 1.37,
  standEye: 1.63,
  crouchEye: 1.17,
  stepH: 0.45,
  ladderSpeed: 2.4, // 爬梯子速度（米/秒）
  accel: 5.5,
  airAccel: 12,
  friction: 5.2,
  stopSpeed: 2.03,
  airCap: 0.76,
  maxFall: 40,
  walkMul: 0.52,
  crouchMul: 0.46, // 蹲走速度（CS2 原版 0.34，玩家反馈太慢）
};

// 命中部位
export const HG = { HEAD: 0, CHEST: 1, STOMACH: 2, LEGS: 3 };
export const HG_MULT = [4, 1, 1.25, 0.75];
export const HG_NAME = ['头部', '胸部', '腹部', '腿部'];

// 快照中的玩家状态位
export const F = {
  CROUCH: 1, WALK: 2, GROUND: 4, ALIVE: 8, SCOPED: 16, DEFUSING: 32, PLANTING: 64,
  RELOADING: 128, BOMB: 256, KIT: 512, SPOT_T: 1024, SPOT_CT: 2048, BOT: 4096, PROTECT: 8192,
};

// 经济（与 CS2 竞技模式一致）
export const ECON = {
  start: 800, max: 16000,
  winElim: 3250, winTime: 3250, winBomb: 3500, winDefuse: 3500,
  lossBase: 1400, lossStep: 500, lossMaxSteps: 4,
  plantTeamBonus: 800, plantReward: 300, defuseReward: 300,
  teamKillPenalty: 300,
};

// 时间（秒）
export const TIMES = {
  freeze: 6, round: 115, bomb: 40, plant: 3.2, defuse: 10, defuseKit: 5,
  roundEnd: 6, buy: 20, matchEnd: 12, dmRespawn: 1.6, warmupRespawn: 1.2,
  dmLength: 600, warmupMax: 240, protect: 1.0,
};

export const TEAM_NAME = { T: '匪徒 T', CT: '警察 CT', SPEC: '观战' };

export function otherTeam(t) {
  return t === 'T' ? 'CT' : t === 'CT' ? 'T' : t;
}
