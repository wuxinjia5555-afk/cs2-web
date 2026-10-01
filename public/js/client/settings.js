// 本地设置（保存在浏览器 localStorage）
const KEY = 'defuse.settings.v1';

// 设备是否为触屏手机/平板（不考虑用户设置）
export function deviceIsTouch() {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const anyFine = matchMedia('(any-pointer: fine)').matches;
  const ua = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return (coarse && !anyFine) || (ua && navigator.maxTouchPoints > 0);
}

export const DEFAULTS = {
  name: '',
  sens: 2.0,
  zoomSens: 1.0,
  volume: 0.7,
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
  return { ...base, ...s, xhair: { ...base.xhair, ...(s.xhair || {}) } };
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
