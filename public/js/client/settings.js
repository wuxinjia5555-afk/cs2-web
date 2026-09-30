// 本地设置（保存在浏览器 localStorage）
const KEY = 'defuse.settings.v1';

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
};

function load() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { s = {}; }
  return { ...DEFAULTS, ...s, xhair: { ...DEFAULTS.xhair, ...(s.xhair || {}) } };
}

export const settings = load();

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {}
}

export function resetSettings() {
  const name = settings.name;
  Object.assign(settings, JSON.parse(JSON.stringify(DEFAULTS)), { name });
  saveSettings();
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
