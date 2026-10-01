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
  gyro: false,
  gyroSens: 1.0,
  btnScale: 1.0,
  btnOpacity: 0.6,
  leftFire: true,
  vibrate: true,
  touchZoomSens: 0.8,
  gyroScope: false,
  gyroInvX: false,
  gyroInvY: false,
  // 自定义按钮布局：{ 按钮: { x, y（占屏幕宽高的比例，按钮中心）, s（大小倍数） } }
  touchLayout: {},
  binds: defaultBinds(),
};

function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { s = null; }
  const base = JSON.parse(JSON.stringify(DEFAULTS));
  if (!s) {
    // 首次打开：手机默认用更省电的画质
    if (deviceIsTouch()) { base.shadows = false; base.res = 0.75; base.xhair.len = 7; base.xhair.thick = 2; }
    return base;
  }
  return { ...base, ...s, xhair: { ...base.xhair, ...(s.xhair || {}) }, binds: { ...base.binds, ...(s.binds || {}) }, touchLayout: s.touchLayout || {} };
}

export const settings = load();

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {}
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
