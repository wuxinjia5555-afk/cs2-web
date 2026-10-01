// 账号：名称 + 密码（scrypt 加盐哈希，不存明文），登录后发一个随机令牌（存在浏览器里，下次自动登录）。
// 每个账号存一份设置（手机按键布局、灵敏度、键位、刀皮肤……），换设备 / 换网址登录就能拿回来。
// 数据存在 server/data/accounts.json（不进 git）。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const TOKEN_DAYS = 180;
const MAX_SETTINGS = 100000; // 设置 JSON 最多 100KB

const scrypt = (pw, salt) => new Promise((resolve, reject) => crypto.scrypt(pw, salt, 32, (err, key) => (err ? reject(err) : resolve(key))));

export function cleanName(n) {
  return String(n == null ? '' : n).normalize('NFC').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().replace(/\s+/g, ' ');
}

export function createAccounts(file) {
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
      db.users[k] = { name, salt, hash, created: now, updated: now, settings: okSettings(settings) ? settings : {} };
      save();
      console.log(`[账号] 注册 ${name}（共 ${Object.keys(db.users).length} 个）`);
      return { token: issue(k), name, settings: db.users[k].settings, updated: now };
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
      return { token: issue(k), name: u.name, settings: u.settings || {}, updated: u.updated || 0 };
    },

    me(tk) {
      const k = userOf(tk);
      if (!k) return { error: '登录已失效，请重新登录', expired: true };
      const u = db.users[k];
      return { name: u.name, settings: u.settings || {}, updated: u.updated || 0 };
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
