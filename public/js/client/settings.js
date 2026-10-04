// 本地设置（保存在浏览器 localStorage）
const KEY = 'defuse.settings.v1';

// 设备是否为触屏手机/平板（不考虑用户设置）
export function deviceIsTouch() {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const anyFine = matchMedia('(any-pointer: fine)').matches;
  const ua = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return (coarse && !anyFine) || (ua && navigator.maxTouchPoints > 0);
}

// 电脑键位：[动作, 名称, 默认按键（e.code）]。游戏逻辑里认的是每个动作的第一个默认键
export const BIND_ACTIONS = [
  ['forward', '前进', ['KeyW']], ['back', '后退', ['KeyS']], ['left', '向左', ['KeyA']], ['right', '向右', ['KeyD']],
  ['jump', '跳跃', ['Space']], ['crouch', '下蹲', ['ControlLeft', 'KeyC']], ['walk', '静步', ['ShiftLeft', 'ShiftRight']],
  ['reload', '换弹', ['KeyR']], ['use', '拾取 / 拆包', ['KeyE']], ['drop', '丢弃武器', ['KeyG']], ['inspect', '检视武器', ['KeyF']],
  ['lastWeapon', '上一把武器', ['KeyQ']], ['slot1', '主武器', ['Digit1']], ['slot2', '手枪', ['Digit2']], ['slot3', '刀', ['Digit3']],
  ['slot4', '投掷物', ['Digit4']], ['slot5', 'C4 炸弹', ['Digit5']], ['buy', '购买菜单', ['KeyB']], ['score', '计分板', ['Tab']],
  ['chat', '全体聊天', ['KeyY', 'Enter']], ['teamChat', '队伍聊天', ['KeyU']], ['team', '选择队伍', ['KeyM']],
];
export const defaultBinds = () => Object.fromEntries(BIND_ACTIONS.map(([a, , k]) => [a, k.slice()]));

export const DEFAULTS = {
  name: '',
  sens: 2.0,
  zoomSens: 1.0,
  volume: 0.7,
  gunVol: 0.8,
  stepVol: 0.7,
  soundViz: true,
  hitmarker: true, // 打中时准星旁边的四条线
  quickStop: true, // 手机：松开摇杆立刻急停
  fpsCap: 0, // 帧率上限（0 = 不限）
  joyMode: 'float', // 手机移动摇杆：float 浮动（按哪里就在哪里）/ fixed 固定（位置大小在自定义按键布局里调）
  res: 1.0,
  shadows: true,
  voice: true,
  fullscreen: true,
  showFps: true,
  xhair: { color: '#3cff6e', len: 6, gap: 4, thick: 2, dot: false, dynamic: true, outline: true },
  lastMap: 'sandstorm',
  // 触屏
  touchMode: 'auto',
  touchSens: 1.0,
  aimAssist: true,
  autoFire: false,
  sniperHold: false, // 手机：狙击枪按住开火键开镜，松手开枪
  gyro: false,
  gyroSens: 1.0,
  btnScale: 1.0,
  btnOpacity: 0.6,
  leftFire: true,
  vibrate: true,
  touchZoomSens: 0.8,
  touchSensX: 1.0, // 滑屏横向 / 纵向灵敏度倍数
  touchSensY: 1.0,
  gyroSensX: 1.0, // 陀螺仪横向 / 纵向灵敏度倍数
  gyroSensY: 1.0,
  crouchMode: 'toggle', // toggle 点按切换 / hold 按住 / mixed 混合
  rangeDmg: true,
  scopeMode: 'toggle',
  gyroScope: false,
  gyroInvX: false,
  gyroInvY: false,
  gyroSwap: false,
  fireDragLook: true,
  // 自定义按钮布局：{ 按钮: { x, y（占屏幕宽高的比例，按钮中心）, s（大小倍数） } }
  touchLayout: {},
  binds: defaultBinds(),
  skins: { knife: 'default' }, // 背包里选的皮肤
  loadout: null,
  custom: null,        // 自定义模式上次用的那套设置
  customTpl: [],       // 自定义模式存下来的模板               // 配装（没改过就是 null，用默认的；见 shared/weapons.js 的 LOADOUT_DEFAULT）
};

// 默认值 + 保存的值（嵌套的对象逐项合并，新版本加的设置项也有默认值）
function merge(base, s) {
  return { ...base, ...s, xhair: { ...base.xhair, ...(s.xhair || {}) }, binds: { ...base.binds, ...(s.binds || {}) }, touchLayout: s.touchLayout || {}, skins: { ...base.skins, ...(s.skins || {}) } };
}

function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { s = null; }
  const base = JSON.parse(JSON.stringify(DEFAULTS));
  if (!s) {
    // 首次打开：手机默认用更省电的画质
    if (deviceIsTouch()) { base.shadows = false; base.res = 0.75; base.xhair.len = 7; base.xhair.thick = 2; }
    return base;
  }
  return merge(base, s);
}

export const settings = load();

// saved：每次保存设置后调用（账号模块用它把设置同步到服务器）
export const settingsHooks = { saved: null };

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {}
  if (settingsHooks.saved) settingsHooks.saved();
}

// 用账号里的设置整个替换本地设置；keep 里的键保留这台设备自己的值（画质等）
export function replaceSettings(remote, keep = []) {
  const local = {};
  for (const k of keep) if (k in settings) local[k] = settings[k];
  const next = merge(JSON.parse(JSON.stringify(DEFAULTS)), { ...remote, ...local });
  for (const k of Object.keys(settings)) delete settings[k];
  Object.assign(settings, next);
}

export function resetSettings() {
  const name = settings.name;
  Object.assign(settings, JSON.parse(JSON.stringify(DEFAULTS)), { name });
  if (deviceIsTouch()) { settings.shadows = false; settings.res = 0.75; }
  saveSettings();
}

// 当前是否使用触屏操作（URL 参数 ?touch=1/0 可强制）
export function useTouch() {
  const q = new URLSearchParams(location.search).get('touch');
  if (q === '1') return true;
  if (q === '0') return false;
  if (settings.touchMode === 'on') return true;
  if (settings.touchMode === 'off') return false;
  return deviceIsTouch();
}

// 把准星设置应用到某个准星元素上
export function applyCrosshair(el, gapOverride) {
  const x = settings.xhair;
  el.style.setProperty('--xc', x.color);
  el.style.setProperty('--xl', x.len + 'px');
  el.style.setProperty('--xt', x.thick + 'px');
  el.style.setProperty('--xg', (gapOverride ?? x.gap) + 'px');
  el.classList.toggle('withdot', !!x.dot);
  el.classList.toggle('outline', !!x.outline);
}
