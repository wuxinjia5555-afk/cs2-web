// 账号：登录后设置存在服务器上（手机按键布局、灵敏度、键位、刀皮肤……），换设备 / 换网址登录就能拿回来。
// 画质这类跟设备有关的设置不同步（手机和电脑本来就该不一样）。
import { settings, saveSettings, settingsHooks, replaceSettings } from './settings.js';

const TK = 'defuse.token', DIRTY = 'defuse.syncDirty';
export const LOCAL_ONLY = ['res', 'shadows', 'touchMode', 'lastMap', 'fullscreen'];
// state：'' 未登录 / loading 登录中 / ok 已同步 / pending 等待上传 / saving 上传中 / error 同步失败
export const account = { name: '', token: '', state: '', lastSync: 0, onChange: null };

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch {} },
};
const changed = () => { if (account.onChange) account.onChange(); };

function syncable() {
  const o = JSON.parse(JSON.stringify(settings));
  for (const k of LOCAL_ONLY) delete o[k];
  return o;
}

async function api(what, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (account.token) headers.Authorization = 'Bearer ' + account.token;
  const r = await fetch('/api/account/' + what, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// 改设置时不要触发上传（比如刚从服务器拿下来的设置）
let muted = false;
function quietSave() { muted = true; saveSettings(); muted = false; }

function applyRemote(remote) {
  muted = true;
  replaceSettings(remote || {}, LOCAL_ONLY);
  settings.name = account.name;
  saveSettings();
  muted = false;
}

function signedIn(r) {
  if (r.token) account.token = r.token;
  account.name = r.name;
  account.state = 'ok';
  account.lastSync = Date.now();
  ls.set(TK, account.token);
  ls.set(DIRTY, null);
}

function expire() {
  account.token = '';
  account.name = '';
  ls.set(TK, null);
}

// 注册：这台设备现在的设置作为账号的设置存上去
export async function register(name, password) {
  let r;
  try { r = await api('register', { name, password, settings: { ...syncable(), name: String(name).trim() } }); } catch { return { error: '连不上服务器，检查一下网络' }; }
  if (r.error) return r;
  signedIn(r);
  settings.name = r.name;
  quietSave();
  changed();
  return r;
}

// 登录：用账号里的设置覆盖这台设备的设置
export async function login(name, password) {
  let r;
  try { r = await api('login', { name, password }); } catch { return { error: '连不上服务器，检查一下网络' }; }
  if (r.error) return r;
  signedIn(r);
  applyRemote(r.settings);
  changed();
  return r;
}

export async function logout() {
  clearTimeout(upTimer);
  try { await api('logout', {}); } catch {}
  expire();
  account.state = '';
  ls.set(DIRTY, null);
  changed();
}

let upTimer = null;
export async function uploadNow() {
  clearTimeout(upTimer);
  if (!account.token) return;
  account.state = 'saving';
  changed();
  try {
    const r = await api('settings', { settings: syncable() });
    if (r.error) { account.state = r.expired ? '' : 'error'; if (r.expired) expire(); }
    else { account.state = 'ok'; account.lastSync = Date.now(); ls.set(DIRTY, null); }
  } catch {
    account.state = 'error';
    upTimer = setTimeout(uploadNow, 15000); // 网络不好：过一会儿再试
  }
  changed();
}

// 每次改设置（saveSettings）都会走到这里：等 1.5 秒没再改就传上去
settingsHooks.saved = () => {
  if (muted || !account.token) return;
  ls.set(DIRTY, '1');
  account.state = 'pending';
  clearTimeout(upTimer);
  upTimer = setTimeout(uploadNow, 1500);
  changed();
};

// 关页面 / 切到后台时，还没传上去的设置马上发出去
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden' || !account.token || ls.get(DIRTY) !== '1') return;
  clearTimeout(upTimer);
  try { navigator.sendBeacon('/api/account/settings', new Blob([JSON.stringify({ tk: account.token, settings: syncable() })], { type: 'application/json' })); } catch {}
});

// 打开页面时：有令牌就自动登录。这台设备有还没传上去的改动 → 先传上去；否则用账号里的设置
export async function initAccount() {
  const tk = ls.get(TK);
  if (!tk) return;
  account.token = tk;
  account.state = 'loading';
  changed();
  try {
    const r = await api('me');
    if (r.error) {
      if (r.expired) expire();
      account.state = r.expired ? '' : 'error';
    } else {
      account.name = r.name;
      if (ls.get(DIRTY) === '1') {
        settings.name = r.name;
        quietSave();
        await uploadNow();
        return;
      }
      applyRemote(r.settings);
      account.state = 'ok';
      account.lastSync = Date.now();
    }
  } catch {
    account.state = 'error';
  }
  changed();
}

// 换公网地址时把令牌带过去（不同地址的浏览器存储是分开的）
export function adoptToken(tk) {
  if (typeof tk === 'string' && /^[0-9a-f]{48}$/.test(tk)) ls.set(TK, tk);
}
