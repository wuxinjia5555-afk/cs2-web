// 游戏服务器：静态网页 + WebSocket 联机 + 房间大厅（零第三方依赖，three.js 由 npm 安装后本地托管）
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleUpgrade } from './ws.js';
import { Room } from '../public/js/shared/room.js';
import { MAP_LIST } from '../public/js/shared/maps.js';
import { TICK_RATE } from '../public/js/shared/constants.js';
import { cleanText } from '../public/js/shared/util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const THREE_DIR = path.join(ROOT, 'node_modules', 'three', 'build');
const PORT = Number(process.env.PORT) || 8080;
const MAX_ROOMS = 40;
const MAX_HUMANS = 12;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function serveFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': file.startsWith(THREE_DIR) ? 'public, max-age=604800' : 'no-cache',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
}

function json(res, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  res.end(s);
}

const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); res.end(); return; }
  if (pathname === '/api/rooms') return json(res, { rooms: roomList(), online: conns.size });
  if (pathname === '/healthz') { res.writeHead(200); res.end('ok'); return; }
  if (pathname === '/api/info') return json(res, { lan: lanUrls() });
  if (pathname.startsWith('/lib/three/')) return serveFile(req, res, path.join(THREE_DIR, path.basename(pathname)));
  if (pathname === '/') pathname = '/index.html';
  const file = path.normalize(path.join(PUBLIC, pathname));
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); res.end(); return; }
  serveFile(req, res, file);
});

// ---------------- 房间 ----------------
const rooms = new Map();
const conns = new Set();
const sessions = new Map(); // 断线等待重连：sid -> { entry, pid, timer }
const RESUME_MS = 90000;
let nextConn = 1;

const cleanSid = (v) => (typeof v === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(v) ? v : null);

// 断线：保留玩家位置一段时间，等他重连
function holdForResume(conn) {
  const e = conn.entry, pid = conn.pid;
  e.clients.delete(pid);
  const p = e.room.players.get(pid);
  if (p) p.away = true;
  const old = sessions.get(conn.sid);
  if (old) clearTimeout(old.timer);
  const timer = setTimeout(() => {
    sessions.delete(conn.sid);
    if (!e.room.players.has(pid)) return;
    try { e.room.removePlayer(pid); } catch (err) { console.error('removePlayer', err); }
    if (!e.clients.size) e.emptySince = Date.now();
  }, RESUME_MS);
  sessions.set(conn.sid, { entry: e, pid, timer });
  if (!e.clients.size) e.emptySince = Date.now();
  conn.entry = null;
  conn.pid = null;
}

// 重连：回到原房间、原角色
function tryResume(conn) {
  const ss = sessions.get(conn.sid);
  if (!ss) return false;
  sessions.delete(conn.sid);
  clearTimeout(ss.timer);
  const e = ss.entry;
  const p = rooms.get(e.code) === e ? e.room.players.get(ss.pid) : null;
  if (!p) return false;
  if (conn.entry) leaveRoom(conn);
  conn.entry = e;
  conn.pid = ss.pid;
  e.clients.set(ss.pid, conn);
  p.away = false;
  e.room.sendInit(p);
  console.log(`[room ${e.code}] ${p.name} 重新连接`);
  return true;
}

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s;
  do {
    s = '';
    for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)];
  } while (rooms.has(s));
  return s;
}

function roomList() {
  return [...rooms.values()].map((e) => ({ ...e.room.info(), humans: e.clients.size, max: MAX_HUMANS }));
}

function createRoom(opts) {
  const code = makeCode();
  const entry = { code, clients: new Map(), emptySince: Date.now(), room: null, acc: 0 };
  const o = opts && typeof opts === 'object' ? opts : {};
  entry.room = new Room(
    {
      code,
      name: cleanText(o.name, 24) || '房间 ' + code,
      map: MAP_LIST.some((m) => m.id === o.map) ? o.map : 'sandstorm',
      mode: o.mode === 'dm' ? 'dm' : 'bomb',
      bots: o.bots !== false,
      botDiff: Number(o.botDiff),
      teamSize: Number(o.teamSize),
      maxRounds: Number(o.maxRounds),
      ff: !!o.ff,
      warmup: true,
    },
    {
      send(pid, msg) {
        const c = entry.clients.get(pid);
        if (c) c.sendObj(msg);
      },
      broadcast(msg, except) {
        if (!entry.clients.size) return;
        const s = JSON.stringify(msg);
        const snap = msg.t === 's';
        for (const [pid, c] of entry.clients) if (pid !== except) c.sendRaw(s, snap);
      },
    },
  );
  rooms.set(code, entry);
  console.log(`[room] 创建 ${code} 地图=${entry.room.map.id} 模式=${entry.room.opts.mode}`);
  return entry;
}

function joinRoom(conn, entry) {
  if (conn.entry) leaveRoom(conn);
  conn.entry = entry;
  entry.room.addHuman(conn.name, (p) => {
    conn.pid = p.id;
    entry.clients.set(p.id, conn);
  });
}

function leaveRoom(conn) {
  const e = conn.entry;
  if (!e) return;
  e.clients.delete(conn.pid);
  try { e.room.removePlayer(conn.pid); } catch (err) { console.error('removePlayer', err); }
  conn.entry = null;
  conn.pid = null;
  if (!e.clients.size) e.emptySince = Date.now();
}

function handleMsg(conn, m) {
  switch (m.t) {
    case 'hello':
      conn.name = cleanText(m.name, 16) || '玩家';
      conn.sid = cleanSid(m.sid);
      conn.sendObj({ t: 'welcome', id: conn.id, maps: MAP_LIST });
      if (conn.sid && !conn.entry) tryResume(conn);
      return;
    case 'ping':
      conn.sendObj({ t: 'pong', c: m.c });
      return;
    case 'rooms':
      conn.sendObj({ t: 'rooms', list: roomList(), online: conns.size });
      return;
    case 'create': {
      if (rooms.size >= MAX_ROOMS) { conn.sendObj({ t: 'err', text: '服务器房间已满，请稍后再试' }); return; }
      joinRoom(conn, createRoom(m.opts));
      return;
    }
    case 'join': {
      const e = rooms.get(String(m.code || '').trim().toUpperCase());
      if (!e) { conn.sendObj({ t: 'err', text: '房间不存在或已关闭' }); return; }
      if (e.clients.size >= MAX_HUMANS) { conn.sendObj({ t: 'err', text: '房间人数已满' }); return; }
      joinRoom(conn, e);
      return;
    }
    case 'leave':
      leaveRoom(conn);
      conn.sendObj({ t: 'left' });
      return;
    default:
      if (conn.entry && conn.pid != null) {
        try { conn.entry.room.handle(conn.pid, m); } catch (err) { console.error('room.handle', m.t, err); }
      }
  }
}

server.on('upgrade', (req, socket, head) => {
  let pathname = '';
  try { pathname = new URL(req.url, 'http://x').pathname; } catch {}
  if (pathname !== '/ws') { socket.destroy(); return; }
  handleUpgrade(req, socket, head, (ws) => {
    const conn = {
      id: nextConn++, ws, name: '玩家', entry: null, pid: null, msgCount: 0, msgWindow: Date.now(),
      sendRaw(s, droppable) {
        if (!ws.open) return;
        if (droppable && ws.buffered > 256 * 1024) return;
        ws.send(s);
      },
      sendObj(o) { this.sendRaw(JSON.stringify(o), false); },
    };
    conns.add(conn);
    ws.on('message', (data) => {
      if (typeof data !== 'string' || data.length > 16384) return;
      const now = Date.now();
      if (now - conn.msgWindow > 1000) { conn.msgWindow = now; conn.msgCount = 0; }
      if (++conn.msgCount > 240) return;
      let m;
      try { m = JSON.parse(data); } catch { return; }
      if (!m || typeof m.t !== 'string') return;
      handleMsg(conn, m);
    });
    ws.on('close', () => {
      conns.delete(conn);
      if (conn.entry && conn.sid && conn.pid != null && rooms.get(conn.entry.code) === conn.entry) holdForResume(conn);
      else leaveRoom(conn);
    });
  });
});

// ---------------- 主循环 ----------------
let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  for (const [code, e] of rooms) {
    if (!e.clients.size) {
      if (now - e.emptySince > 60000) { rooms.delete(code); console.log(`[room] 关闭 ${code}`); }
      continue;
    }
    e.acc += dt;
    let n = 0;
    while (e.acc >= 1 / TICK_RATE && n < 5) {
      try { e.room.tick(); } catch (err) { console.error(`[room ${code}] tick`, err); }
      e.acc -= 1 / TICK_RATE;
      n++;
    }
    if (n >= 5) e.acc = 0;
  }
}, 1000 / TICK_RATE / 2);

setInterval(() => {
  const now = Date.now();
  for (const c of conns) {
    if (now - c.ws.lastSeen > 45000) c.ws.close(1001);
    else c.ws.ping();
  }
}, 15000);

function lanUrls() {
  const lan = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (/vmware|virtualbox|vethernet|loopback|docker|wsl|tailscale|zerotier/i.test(name)) continue;
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (!/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) continue;
      const rank = (/wlan|wi-?fi|wireless|无线/i.test(name) ? 2 : 0) + (a.address.startsWith('192.168.') ? 1 : 0);
      lan.push({ url: `http://${a.address}:${PORT}`, rank });
    }
  }
  return lan.sort((x, y) => y.rank - x.rank).map((x) => x.url);
}

server.listen(PORT, () => {
  const hasThree = fs.existsSync(path.join(THREE_DIR, 'three.module.js'));
  console.log(`DEFUSE 服务器已启动: http://localhost:${PORT}  (three.js 本地托管: ${hasThree ? '是' : '否，将使用 CDN'})`);
  const lan = lanUrls();
  if (lan.length) console.log('手机 / 同一 Wi-Fi 的朋友打开：' + lan.join('  ') + '  （主菜单「手机扫码」可直接扫码）');
});
