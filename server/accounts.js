// 账号：名称 + 密码（scrypt 加盐哈希，不存明文），登录后发一个随机令牌（存在浏览器里，下次自动登录）。
// 每个账号存一份设置（手机按键布局、灵敏度、键位、刀皮肤……），换设备 / 换网址登录就能拿回来。
// 数据存在 server/data/accounts.json（不进 git）；配了 Upstash（免费云端 Redis）就存云端——
// 部署到 Render 免费版时必须这样，因为它的硬盘每次休眠 / 重启都会清空。
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 存储出错时只用这些固定的说明，绝不能把令牌之类的值带进错误信息（会写进日志、显示在 /api/info 上）
const fail = (why) => Object.assign(new Error(why), { safe: true });

// Upstash 的地址和令牌是在网页上粘贴的：可能带引号、空格、换行，
// 甚至把 Upstash 页面上 .env 的两行（UPSTASH_REDIS_REST_URL="…" 和 UPSTASH_REDIS_REST_TOKEN="…"）一起粘进了同一格
const unq = (v) => String(v || '').trim().replace(/^["']+|["']+$/g, '').trim();
function upstashEnv() {
  const raw = [String(process.env.UPSTASH_REDIS_REST_URL || ''), String(process.env.UPSTASH_REDIS_REST_TOKEN || '')];
  const found = {};
  for (const text of raw) {
    for (const line of text.split(/[\r\n]+/)) {
      const m = line.match(/^\s*(?:export\s+)?(UPSTASH_REDIS_REST_URL|UPSTASH_REDIS_REST_TOKEN)\s*=\s*(.*)$/);
      if (m) found[m[1]] = unq(m[2]);
    }
  }
  // 没有「KEY=」的普通值：取第一行
  const plain = (text) => (/^\s*(?:export\s+)?[A-Z_]+\s*=/.test(text) ? '' : unq(text.split(/[\r\n]+/).find((l) => l.trim()) || ''));
  return {
    url: found.UPSTASH_REDIS_REST_URL || plain(raw[0]),
    token: (found.UPSTASH_REDIS_REST_TOKEN || plain(raw[1])).replace(/\s+/g, ''),
  };
}

// 账号数据存哪：环境变量里有 Upstash 的地址和令牌就存云端（整份数据存成一个键），否则存本机文件
function makeStore(file) {
  const { url, token } = upstashEnv();
  if (url || token) {
    const KEY = process.env.ACCOUNTS_KEY || 'defuse:accounts';
    // 只填了一个、填反了、格式不对：直接说清楚（不能退回存本机文件，Render 上的文件一休眠就没了）
    let bad = '';
    if (!url || !token) bad = 'UPSTASH_REDIS_REST_URL 和 UPSTASH_REDIS_REST_TOKEN 要两个都填';
    else if (!/^https?:\/\//i.test(url)) bad = /^https?:\/\//i.test(token) ? 'UPSTASH_REDIS_REST_URL 和 UPSTASH_REDIS_REST_TOKEN 好像填反了' : 'UPSTASH_REDIS_REST_URL 应该以 https:// 开头';
    else if (!/^[A-Za-z0-9=_-]+$/.test(token)) bad = 'UPSTASH_REDIS_REST_TOKEN 格式不对：只填那一长串字母和数字，不要带别的';
    const cmd = async (args) => {
      if (bad) throw fail(bad);
      let r;
      try {
        r = await fetch(url.replace(/\/$/, ''), { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify(args), signal: AbortSignal.timeout(15000) });
      } catch (e) {
        const code = String((e.cause && e.cause.code) || e.name || '');
        if (/abort|timeout/i.test(code)) throw fail('连接 Upstash 超时，过一会儿会自动重试');
        if (/ENOTFOUND|EAI_AGAIN/.test(code)) throw fail('找不到这个地址：检查 UPSTASH_REDIS_REST_URL');
        throw fail('连不上 Upstash：检查 UPSTASH_REDIS_REST_URL' + (/^[A-Z_]+$/.test(code) ? `（${code}）` : ''));
      }
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) {
        const m = String(j.error || '');
        if (/noperm|read.?only/i.test(m)) throw fail('这是只读令牌：要用 Read-Only Token 没勾选时的那串');
        if (r.status === 401 || /unauthorized|wrongpass/i.test(m)) throw fail('令牌不对：检查 UPSTASH_REDIS_REST_TOKEN');
        throw fail(`Upstash 返回错误（HTTP ${r.status}）`);
      }
      return j.result;
    };
    return {
      cloud: true,
      where: 'Upstash 云端',
      async load() {
        const s = await cmd(['GET', KEY]);
        if (!s) return null;
        try { return JSON.parse(s); } catch { throw fail('云端的账号数据格式坏了'); }
      },
      async save(text) { await cmd(['SET', KEY, text]); },
    };
  }
  return {
    cloud: false,
    where: file,
    async load() {
      let s;
      try { s = fs.readFileSync(file, 'utf8'); } catch { return null; } // 还没有这个文件：新的空数据
      try { return JSON.parse(s); } catch { throw fail('账号数据文件格式坏了：' + file); }
    },
    async save(text) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file + '.tmp', text);
      fs.renameSync(file + '.tmp', file);
    },
  };
}

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

export async function createAccounts(file, devFile) {
  // 开发者密码：server/data/dev.json（每次用到时再读，改了密码不用重启）；
  // 部署到云上时也可以用环境变量 DEV_PASSWORD（启动时算成加盐哈希，明文马上从环境变量里删掉）
  let envDev = null;
  const envPw = String(process.env.DEV_PASSWORD || '').trim();
  if (envPw) {
    const salt = crypto.randomBytes(16).toString('hex');
    envDev = { salt, hash: crypto.scryptSync(envPw, salt, 32).toString('hex') };
  }
  delete process.env.DEV_PASSWORD;
  const devCfg = () => { try { return JSON.parse(fs.readFileSync(devFile, 'utf8')); } catch { return envDev; } };

  // 读账号数据。读不出来时千万不能当成空数据（会把云端的数据覆盖掉）：
  // 游戏照常能玩，账号功能先停用，后台每 15 秒再试一次，读到了就恢复
  const store = makeStore(file);
  let db = null, loadErr = '';
  async function load(tries) {
    for (let i = 0; i < tries; i++) {
      try {
        const d = (await store.load()) || { users: {}, tokens: {} };
        if (!d.users) d.users = {};
        if (!d.tokens) d.tokens = {};
        db = d;
        loadErr = '';
        console.log(`[账号] ${Object.keys(db.users).length} 个账号，存在 ${store.where}`);
        return;
      } catch (e) {
        loadErr = e.safe ? e.message : `读取出错（${e.name || 'Error'}）`; // 只用固定说明，不带原始错误内容
        console.error(`[账号] 读取账号数据失败（${store.where}）：${loadErr}`);
        if (i < tries - 1) await sleep(2000);
      }
    }
    console.error('[账号] 先不用账号功能（游戏照常能玩），15 秒后再试');
    setTimeout(() => load(1), 15000);
  }
  await load(3);
  const startedAt = Date.now();

  // 保存：改完等一会儿一起存（云端 1.5 秒）；存失败了过几秒再试
  let timer = null, inflight = null, again = false;
  const save = (delay = store.cloud ? 1500 : 300) => {
    clearTimeout(timer);
    timer = setTimeout(flush, delay);
  };
  async function flush() {
    clearTimeout(timer);
    timer = null;
    if (!db) return;
    if (inflight) { again = true; return inflight; } // 正在存：存完再存一次最新的
    inflight = store.save(JSON.stringify(db)).catch((e) => {
      console.error('[账号] 保存失败，5 秒后重试：', e.safe ? e.message : e.name || 'Error');
      if (!timer) timer = setTimeout(flush, 5000);
    });
    await inflight;
    inflight = null;
    if (again) { again = false; await flush(); }
  }
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

  const api = {
    count: () => (db ? Object.keys(db.users).length : 0),
    // 账号功能现在能不能用（给 /api/info 看，方便查问题；不含任何密钥）
    status: () => ({ ok: !!db, where: store.cloud ? 'cloud' : 'file', err: db ? '' : loadErr }),
    // 关服务器前把还没存的数据马上存掉
    async flush() {
      if (inflight) await inflight;
      if (timer || again) await flush();
    },

    // 搬家：新服务器上一个账号都没有时（只限启动后 30 分钟内），把旧服务器的账号数据整个导进来，只能导一次
    importAll(data) {
      if (Object.keys(db.users).length) return { error: '这里已经有账号了，不能再导入' };
      if (Date.now() - startedAt > 30 * 60e3) return { error: '只能在服务器启动后 30 分钟内导入，重启一下服务器再试' };
      if (!data || typeof data !== 'object' || !data.users || typeof data.users !== 'object') return { error: '数据格式不对' };
      const users = {};
      for (const [k, u] of Object.entries(data.users)) {
        if (!u || typeof u.name !== 'string' || typeof u.salt !== 'string' || typeof u.hash !== 'string' || k !== key(cleanName(u.name))) return { error: '账号数据格式不对：' + k };
        users[k] = u;
      }
      const tokens = {};
      for (const [tk, e] of Object.entries(data.tokens || {})) if (/^[0-9a-f]{48}$/.test(tk) && e && users[e.u]) tokens[tk] = { u: e.u, t: Number(e.t) || Date.now() };
      db.users = users;
      db.tokens = tokens;
      save(0);
      console.log(`[账号] 导入了 ${Object.keys(users).length} 个账号`);
      return { ok: true, count: Object.keys(users).length };
    },

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
      touch(k); // 在线时间不单独存（省云端读写次数），跟下次别的改动一起存
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
  // 账号数据还没读出来：所有账号接口先返回「暂时不可用」（联机时只能用默认匕首）
  for (const [name, fn] of Object.entries(api)) {
    if (['count', 'status', 'flush'].includes(name)) continue;
    api[name] = (...args) => {
      if (!db) return name === 'canUse' ? !args[1] || args[1] === 'default' : { error: '账号服务暂时连不上，请稍后再试' };
      return fn(...args);
    };
  }
  return api;
}
