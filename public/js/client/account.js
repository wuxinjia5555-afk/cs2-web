// 账号：登录后设置存在服务器上（手机按键布局、灵敏度、键位、刀皮肤……），换设备 / 换网址登录就能拿回来。
// 画质这类跟设备有关的设置不同步（手机和电脑本来就该不一样）。
// 金币、已解锁的皮肤、好友、开发者模式也都在账号里（服务器说了算）。
import { settings, saveSettings, settingsHooks, replaceSettings } from './settings.js';

const TK = 'defuse.token', DIRTY = 'defuse.syncDirty', VIEW = 'defuse.acctView';
export const LOCAL_ONLY = ['res', 'shadows', 'touchMode', 'lastMap', 'fullscreen'];
export const SKIN_IDS = ['butterfly', 'karambit', 'm9', 'xeno', 'tianyu', 'shadow', 'dragon', 'taki'];
// state：'' 未登录 / loading 登录中 / ok 已同步 / pending 等待上传 / saving 上传中 / error 同步失败
// coins：-1 表示无限（开发者模式）；owned：已解锁的刀（null = 还不知道）
export const account = {
  name: '', token: '', state: '', lastSync: 0, onChange: null,
  coins: 0, owned: null, dev: false, friends: [], price: 1599, onInbox: null,
};

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

// 服务器发来的账号信息：金币 / 皮肤 / 好友 / 收件箱
function setView(r) {
  if (!r || r.error) return;
  if (Number.isFinite(r.coins)) account.coins = r.coins;
  if (Array.isArray(r.owned)) account.owned = r.owned.filter((x) => SKIN_IDS.includes(x));
  if (typeof r.dev === 'boolean') account.dev = r.dev;
  if (Array.isArray(r.friends)) account.friends = r.friends;
  if (Number.isFinite(r.price)) account.price = r.price;
  if (Array.isArray(r.owned)) ls.set(VIEW, JSON.stringify({ n: r.name || account.name, coins: account.coins, owned: account.owned, dev: account.dev }));
  if (Array.isArray(r.inbox)) showInbox(r.inbox);
}

// 收件箱（谁加了你、谁送了你东西）：每条只提示一次，提示完告诉服务器删掉
const inboxSeen = new Set();
function showInbox(list) {
  const fresh = list.filter((e) => e && !inboxSeen.has(e.t + '|' + e.from + '|' + e.kind));
  if (!fresh.length) return;
  for (const e of fresh) inboxSeen.add(e.t + '|' + e.from + '|' + e.kind);
  if (account.onInbox) account.onInbox(fresh);
  const upTo = Math.max(...fresh.map((e) => e.t));
  api('inbox-ack', { upTo }).catch(() => {});
}

// 是否拥有这把刀（默认匕首人人都有；没登录只有默认匕首）
export function ownsSkin(id) {
  return !id || id === 'default' || account.dev || (account.owned || []).includes(id);
}

// 装备着没解锁的刀 → 换回默认匕首（还不知道账号里有什么就先不动）
export function checkSkin() {
  if (account.token && account.owned == null) return;
  const k = settings.skins && settings.skins.knife;
  if (k && k !== 'default' && !ownsSkin(k)) {
    settings.skins.knife = 'default';
    saveSettings();
  }
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
  account.coins = 0;
  account.owned = null;
  account.dev = false;
  account.friends = [];
  ls.set(TK, null);
  ls.set(VIEW, null);
}

// 注册：这台设备现在的设置作为账号的设置存上去
export async function register(name, password) {
  let r;
  try { r = await api('register', { name, password, settings: { ...syncable(), name: String(name).trim() } }); } catch { return { error: '连不上服务器，检查一下网络' }; }
  if (r.error) return r;
  signedIn(r);
  setView(r);
  settings.name = r.name;
  quietSave();
  checkSkin();
  changed();
  return r;
}

// 登录：用账号里的设置覆盖这台设备的设置
export async function login(name, password) {
  let r;
  try { r = await api('login', { name, password }); } catch { return { error: '连不上服务器，检查一下网络' }; }
  if (r.error) return r;
  signedIn(r);
  setView(r);
  applyRemote(r.settings);
  checkSkin();
  changed();
  return r;
}

export async function logout() {
  clearTimeout(upTimer);
  try { await api('logout', {}); } catch {}
  expire();
  account.state = '';
  ls.set(DIRTY, null);
  checkSkin();
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
  if (!tk) { checkSkin(); return; }
  account.token = tk;
  account.state = 'loading';
  // 先用上次存的（网络不好时也知道自己有哪些刀）
  try {
    const v = JSON.parse(ls.get(VIEW) || 'null');
    if (v && Array.isArray(v.owned)) { account.owned = v.owned.filter((x) => SKIN_IDS.includes(x)); account.coins = v.coins | 0; account.dev = !!v.dev; }
  } catch {}
  changed();
  try {
    const r = await api('me');
    if (r.error) {
      if (r.expired) expire();
      account.state = r.expired ? '' : 'error';
    } else {
      account.name = r.name;
      setView(r);
      if (ls.get(DIRTY) === '1') {
        settings.name = r.name;
        quietSave();
        checkSkin();
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
  checkSkin();
  changed();
}

// 金币 / 皮肤 / 好友 / 开发者模式的请求（都要先登录）
async function call(what, body) {
  if (!account.token) return { error: '请先登录账号' };
  let r;
  try { r = await api(what, body); } catch { return { error: '连不上服务器，检查一下网络' }; }
  if (r.expired) { expire(); account.state = ''; checkSkin(); changed(); return r; }
  if (!r.error) { setView(r); checkSkin(); changed(); }
  return r;
}
// 刷新金币、好友在线、收件箱（不动设置）
export const refreshAccount = () => (account.token ? call('me') : Promise.resolve({ error: '请先登录账号' }));
export const unlockSkin = (skin) => call('unlock', { skin });
export const searchPlayers = (q) => call('search?q=' + encodeURIComponent(q));
export const addFriend = (name) => call('friend-add', { name });
export const removeFriend = (name) => call('friend-remove', { name });
export const giftCoins = (to, coins) => call('gift', { to, coins });
export const giftSkin = (to, skin) => call('gift', { to, skin });
export const devOn = (password) => call('dev', { password });
export const devOff = () => call('dev', { off: true });

// 换公网地址时把令牌带过去（不同地址的浏览器存储是分开的）
export function adoptToken(tk) {
  if (typeof tk === 'string' && /^[0-9a-f]{48}$/.test(tk)) ls.set(TK, tk);
}
