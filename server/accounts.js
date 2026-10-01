// 账号：名称 + 密码（scrypt 加盐哈希，不存明文），登录后发一个随机令牌（存在浏览器里，下次自动登录）。
// 每个账号存一份设置（手机按键布局、灵敏度、键位、刀皮肤……），换设备 / 换网址登录就能拿回来。
// 数据存在 server/data/accounts.json（不进 git）。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const TOKEN_DAYS = 180;
const MAX_SETTINGS = 100000; // 设置 JSON 最多 100KB
// 皮肤：默认匕首人人都有，其他刀要用金币解锁（新账号金币为 0）
export const SKIN_PRICE = 1599;
export const KNIFE_SKINS = ['butterfly', 'karambit', 'm9', 'xeno'];
const MAX_FRIENDS = 100;

const scrypt = (pw, salt) => new Promise((resolve, reject) => crypto.scrypt(pw, salt, 32, (err, key) => (err ? reject(err) : resolve(key))));

export function cleanName(n) {
  return String(n == null ? '' : n).normalize('NFC').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().replace(/\s+/g, ' ');
}

// 开发者密码：只存加盐哈希（server/data/dev.json，不进 git）
export function setDevPassword(file, pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 32).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ salt, hash }));
}

export function createAccounts(file, devFile) {
  // 每次用到时再读：改了开发者密码不用重启服务器
  const devCfg = () => { try { return JSON.parse(fs.readFileSync(devFile, 'utf8')); } catch { return null; } };
  let db = { users: {}, tokens: {} };
  try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  if (!db.users) db.users = {};
  if (!db.tokens) db.tokens = {};
  let timer = null;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file + '.tmp', JSON.stringify(db));
        fs.renameSync(file + '.tmp', file);
      } catch (e) { console.error('[账号] 保存失败', e.message); }
    }, 300);
  };
  const key = (name) => name.toLowerCase();
  const fails = new Map(); // 账号 -> { n, t }：密码连续错太多次就先锁一会儿
  let regs = []; // 最近的注册时间（防止被刷）

  function issue(k) {
    const tk = crypto.randomBytes(24).toString('hex');
    db.tokens[tk] = { u: k, t: Date.now() };
    save();
    return tk;
  }
  function userOf(tk) {
    const e = typeof tk === 'string' && db.tokens[tk];
    if (!e) return null;
    if (Date.now() - e.t > TOKEN_DAYS * 864e5 || !db.users[e.u]) { delete db.tokens[tk]; save(); return null; }
    return e.u;
  }
  const okSettings = (s) => s && typeof s === 'object' && !Array.isArray(s) && JSON.stringify(s).length <= MAX_SETTINGS;
  // 老账号没有这些字段：补上
  const fix = (u) => {
    if (!Number.isFinite(u.coins)) u.coins = 0;
    if (!Array.isArray(u.owned)) u.owned = [];
    if (!Array.isArray(u.friends)) u.friends = [];
    if (!Array.isArray(u.inbox)) u.inbox = [];
    return u;
  };
  const owns = (u, skin) => !skin || skin === 'default' || u.dev || u.owned.includes(skin);
  // 给客户端看的账号信息
  const view = (k) => {
    const u = fix(db.users[k]);
    const friends = u.friends.filter((f) => db.users[f]).map((f) => ({ name: db.users[f].name, seen: db.users[f].seen || 0 }));
    return { name: u.name, coins: u.dev ? -1 : u.coins, owned: u.dev ? KNIFE_SKINS.slice() : u.owned.slice(), dev: !!u.dev, friends, inbox: u.inbox.slice(-20), price: SKIN_PRICE };
  };
  const touch = (k) => { db.users[k].seen = Date.now(); };
  const skinName = { butterfly: '蝴蝶刀', karambit: '爪子刀', m9: 'M9 刺刀', xeno: '剥皮小刀' };

  return {
    count: () => Object.keys(db.users).length,

    async register(name, pw, settings) {
      name = cleanName(name);
      if (name.length < 2 || name.length > 16) return { error: '名称要 2~16 个字' };
      if (/^bot\b/i.test(name)) return { error: '名称不能以 BOT 开头' };
      if (typeof pw !== 'string' || pw.length < 4 || pw.length > 64) return { error: '密码要 4~64 位' };
      const k = key(name);
      if (db.users[k]) return { error: '这个名称已经被注册了，换一个吧' };
      const now = Date.now();
      regs = regs.filter((t) => now - t < 10 * 60e3);
      if (regs.length >= 30) return { error: '注册的人太多了，过几分钟再试' };
      regs.push(now);
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = (await scrypt(pw, salt)).toString('hex');
      if (db.users[k]) return { error: '这个名称已经被注册了，换一个吧' };
      db.users[k] = { name, salt, hash, created: now, updated: now, seen: now, settings: okSettings(settings) ? settings : {} };
      save();
      console.log(`[账号] 注册 ${name}（共 ${Object.keys(db.users).length} 个）`);
      return { token: issue(k), ...view(k), settings: db.users[k].settings, updated: now };
    },

    async login(name, pw) {
      name = cleanName(name);
      const k = key(name), u = db.users[k];
      const f = fails.get(k);
      if (f && f.n >= 8 && Date.now() - f.t < 5 * 60e3) return { error: '密码错太多次了，5 分钟后再试' };
      const hash = await scrypt(typeof pw === 'string' ? pw : '', u ? u.salt : 'x');
      if (!u || !crypto.timingSafeEqual(hash, Buffer.from(u.hash, 'hex'))) {
        const g = f && Date.now() - f.t < 5 * 60e3 ? f : { n: 0, t: 0 };
        fails.set(k, { n: g.n + 1, t: Date.now() });
        return { error: '名称或密码不对' };
      }
      fails.delete(k);
      touch(k);
      return { token: issue(k), ...view(k), settings: u.settings || {}, updated: u.updated || 0 };
    },

    me(tk) {
      const k = userOf(tk);
      if (!k) return { error: '登录已失效，请重新登录', expired: true };
      const u = db.users[k];
      touch(k);
      save();
      return { ...view(k), settings: u.settings || {}, updated: u.updated || 0 };
    },

    // 联机时校验刀皮肤：没解锁的不能用（返回 true 表示可以用）
    canUse(tk, skin) {
      if (!skin || skin === 'default') return true;
      const k = userOf(tk);
      return !!k && owns(fix(db.users[k]), skin);
    },

    // 用金币解锁皮肤
    unlock(tk, skin) {
      const k = userOf(tk);
      if (!k) return { error: '登录已失效，请重新登录', expired: true };
      if (!KNIFE_SKINS.includes(skin)) return { error: '没有这个皮肤' };
      const u = fix(db.users[k]);
      if (owns(u, skin)) return { ok: true, ...view(k) };
      if (u.coins < SKIN_PRICE) return { error: `金币不够（需要 ${SKIN_PRICE}，你有 ${u.coins}）` };
      u.coins -= SKIN_PRICE;
      u.owned.push(skin);
      save();
      return { ok: true, ...view(k) };
    },

    // 按名称搜索玩家（不分大小写，包含就算）
    search(tk, q) {
      const k = userOf(tk);
      if (!k) return { error: '登录已失效，请重新登录', expired: true };
      q = cleanName(q).toLowerCase();
      if (!q) return { list: [] };
      const me = fix(db.users[k]);
      const list = Object.entries(db.users).filter(([key]) => key !== k && key.includes(q)).slice(0, 12)
        .map(([key, u]) => ({ name: u.name, friend: me.friends.includes(key) }));
      return { list };
    },

    // 加好友：双方互相加上
    addFriend(tk, name) {
      const k = userOf(tk);
      if (!k) return { error: '登录已失效，请重新登录', expired: true };
      const f = cleanName(name).toLowerCase();
      if (!db.users[f]) return { error: '没有这个玩家' };
      if (f === k) return { error: '不能加自己为好友' };
      const a = fix(db.users[k]), b = fix(db.users[f]);
      if (a.friends.length >= MAX_FRIENDS) return { error: '好友太多了' };
      if (!a.friends.includes(f)) a.friends.push(f);
      if (!b.friends.includes(k)) b.friends.push(k);
      b.inbox.push({ t: Date.now(), from: a.name, kind: 'friend' });
      save();
      return { ok: true, ...view(k) };
    },

    removeFriend(tk, name) {
      const k = userOf(tk);
      if (!k) return { error: '登录已失效，请重新登录', expired: true };
      const f = cleanName(name).toLowerCase();
      const a = fix(db.users[k]);
      a.friends = a.friends.filter((x) => x !== f);
      if (db.users[f]) { const b = fix(db.users[f]); b.friends = b.friends.filter((x) => x !== k); }
      save();
      return { ok: true, ...view(k) };
    },

    // 送好友金币或皮肤（开发者金币无限、皮肤送了自己也还在）
    gift(tk, to, coins, skin) {
      const k = userOf(tk);
      if (!k) return { error: '登录已失效，请重新登录', expired: true };
      const f = cleanName(to).toLowerCase();
      const a = fix(db.users[k]);
      if (!db.users[f] || !a.friends.includes(f)) return { error: '只能送给好友' };
      const b = fix(db.users[f]);
      if (skin) {
        if (!KNIFE_SKINS.includes(skin)) return { error: '没有这个皮肤' };
        if (!owns(a, skin)) return { error: '你还没有这个皮肤' };
        if (owns(b, skin)) return { error: `${b.name} 已经有这个皮肤了` };
        if (!a.dev) a.owned = a.owned.filter((x) => x !== skin);
        b.owned.push(skin);
        b.inbox.push({ t: Date.now(), from: a.name, kind: 'skin', v: skin });
        save();
        return { ok: true, text: `已把${skinName[skin] || skin}送给 ${b.name}`, ...view(k) };
      }
      const n = Math.floor(Number(coins));
      if (!Number.isFinite(n) || n <= 0 || n > 1e9) return { error: '金币数量不对' };
      if (!a.dev && a.coins < n) return { error: `金币不够（你有 ${a.coins}）` };
      if (!a.dev) a.coins -= n;
      b.coins = Math.min(1e12, b.coins + n);
      b.inbox.push({ t: Date.now(), from: a.name, kind: 'coins', v: n });
      save();
      return { ok: true, text: `已送给 ${b.name} ${n} 金币`, ...view(k) };
    },

    // 收件箱看过了：删掉 upTo 之前（含）的消息
    ackInbox(tk, upTo) {
      const k = userOf(tk);
      if (!k) return { error: '登录已失效，请重新登录', expired: true };
      const u = fix(db.users[k]), t = Number(upTo) || Date.now();
      u.inbox = u.inbox.filter((e) => e.t > t);
      save();
      return { ok: true };
    },

    // 开发者模式：输对密码打开（全部皮肤 + 无限金币），也可以关掉
    async dev(tk, pw, off) {
      const k = userOf(tk);
      if (!k) return { error: '登录已失效，请重新登录', expired: true };
      const u = fix(db.users[k]);
      if (off) { u.dev = false; save(); return { ok: true, ...view(k) }; }
      const cfg = devCfg();
      if (!cfg) return { error: '服务器没有设置开发者密码' };
      const fk = 'dev:' + k, f = fails.get(fk);
      if (f && f.n >= 5 && Date.now() - f.t < 10 * 60e3) return { error: '密码错太多次了，10 分钟后再试' };
      const h = await scrypt(typeof pw === 'string' ? pw : '', cfg.salt);
      if (!crypto.timingSafeEqual(h, Buffer.from(cfg.hash, 'hex'))) {
        const g = f && Date.now() - f.t < 10 * 60e3 ? f : { n: 0, t: 0 };
        fails.set(fk, { n: g.n + 1, t: Date.now() });
        return { error: '密码不对' };
      }
      fails.delete(fk);
      u.dev = true;
      save();
      console.log(`[账号] ${u.name} 打开了开发者模式`);
      return { ok: true, ...view(k) };
    },

    saveSettings(tk, settings) {
      const k = userOf(tk);
      if (!k) return { error: '登录已失效，请重新登录', expired: true };
      if (!okSettings(settings)) return { error: '设置数据不对或太大' };
      const u = db.users[k];
      u.settings = settings;
      u.updated = Date.now();
      save();
      return { ok: true, updated: u.updated };
    },

    logout(tk) {
      if (typeof tk === 'string' && db.tokens[tk]) { delete db.tokens[tk]; save(); }
      return { ok: true };
    },
  };
}
