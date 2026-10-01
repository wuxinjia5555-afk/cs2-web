// 入口：主菜单、单机/联机大厅、设置，负责创建 Game
import * as THREE from 'three';
import { settings, saveSettings, resetSettings, applyCrosshair, useTouch, BIND_ACTIONS, defaultBinds } from './client/settings.js';
import { TouchControls } from './client/touch.js';
import { ViewModel } from './client/viewmodel.js';
import { audio } from './client/audio.js';
import { WsNet, LocalNet, defaultServerUrl } from './client/net.js';
import { Game } from './client/game.js';
import { MAP_LIST, getMap } from './shared/maps.js';
import { mapImage } from './client/mapimg.js';
import { buildMapMeshes, setupEnvironment } from './client/world.js';
import { setMaxAnisotropy } from './client/textures.js';
import { drawQR } from './client/qr.js';
import { account, initAccount, login, register, logout, uploadNow, adoptToken } from './client/account.js';

window.__gameReady = true;

// 从 http 切到 https 时带过来的设置（两个地址的浏览器存储是分开的）
{
  const q = new URLSearchParams(location.search);
  const imp = q.get('import'), tk = q.get('tk');
  if (imp || tk) {
    if (imp) try { Object.assign(settings, JSON.parse(decodeURIComponent(escape(atob(imp))))); saveSettings(); } catch {}
    if (tk) adoptToken(tk); // 换公网地址时带过来的登录状态
    q.delete('import');
    q.delete('tk');
    history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : ''));
  }
}
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------- 渲染器 ----------------
const canvas = $('gl');
const TOUCH = useTouch();
if (TOUCH) document.body.classList.add('touch');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !TOUCH, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2) * settings.res);
renderer.setSize(innerWidth, innerHeight, false);
setMaxAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

// ---------------- 菜单背景：绕地图旋转的镜头 ----------------
class MenuScene {
  constructor() { this.scene = null; this.mapId = null; this.running = false; this.loop = (t) => this.frame(t); }
  setMap(id) {
    if (this.mapId === id && this.scene) return;
    this.mapId = id;
    const map = getMap(id);
    if (this.scene) this.scene.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    this.scene = new THREE.Scene();
    setupEnvironment(this.scene, map, settings.shadows);
    this.scene.add(buildMapMeshes(map));
    this.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.5, 900);
    this.center = new THREE.Vector3(map.bounds.x1 / 2, 0, map.bounds.z1 / 2);
    this.radius = Math.max(map.bounds.x1, map.bounds.z1) * 0.62;
  }
  start() {
    if (this.running) return;
    this.running = true;
    this.raf = requestAnimationFrame(this.loop);
  }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }
  frame(t) {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    if (!this.scene) return;
    const a = t * 0.00005;
    this.camera.position.set(this.center.x + Math.cos(a) * this.radius, this.radius * 0.5, this.center.z + Math.sin(a) * this.radius);
    this.camera.lookAt(this.center.x, 0, this.center.z);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    renderer.autoClear = true;
    renderer.render(this.scene, this.camera);
  }
}
const menuScene = new MenuScene();

// ---------------- 通用 ----------------
let game = null;
let lobby = null;
let starting = null;
let settingsReturn = null;

function toast(text, ms = 2800) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), ms);
}

function showMenu(id) {
  for (const m of document.querySelectorAll('.menu')) m.classList.toggle('hidden', m.id !== id);
  if (id !== 'menu-online' && lobby) { clearInterval(lobby.timer); lobby.timer = null; }
}

function hideMenus() { for (const m of document.querySelectorAll('.menu')) m.classList.add('hidden'); }

function loading(on, text) {
  $('loading').classList.toggle('hidden', !on);
  if (text) $('loading-text').textContent = text;
}

function playerName() {
  let n = $('name-input').value.trim();
  if (!n) { n = '玩家' + Math.floor(1000 + Math.random() * 9000); $('name-input').value = n; }
  settings.name = n;
  saveSettings();
  return n;
}

function goFullscreen() {
  askGyro();
  if (!settings.fullscreen || document.fullscreenElement) return;
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req) return;
  try {
    const p = req.call(el, { navigationUI: 'hide' });
    const after = () => {
      if (!TOUCH && navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock().catch(() => {});
      if (TOUCH && screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
    };
    if (p && p.then) p.then(after).catch(() => {});
    else after();
  } catch {}
}

// 陀螺仪只能在 https 下用：问一下要不要切过去，设置跟着带过去
async function goHttps() {
  let port = 8443;
  try {
    const j = await (await fetch('/api/info', { cache: 'no-store' })).json();
    if (j.lanHttps && j.lanHttps[0]) port = +new URL(j.lanHttps[0]).port || 8443;
  } catch {}
  const q = new URLSearchParams(location.search);
  q.set('import', btoa(unescape(encodeURIComponent(JSON.stringify(settings)))));
  location.href = `https://${location.hostname}:${port}${location.pathname}?${q}`;
}
window.__gyroNeedsHttps = () => {
  if (location.protocol === 'https:') { toast('这个浏览器不支持陀螺仪'); return; }
  if (confirm('陀螺仪只能在 https 地址下使用。\n现在切换到 https 打开吗？（你的设置会一起带过去）\n\n第一次会提示“不安全 / 非私人连接”：\niPhone 点「显示详细信息 → 访问此网站」\n安卓点「高级 → 继续前往」')) goHttps();
};

function updateGyroStatus() {
  const el = $('gyro-status');
  if (!el) return;
  let t;
  if (!window.isSecureContext) t = '⚠ 当前是 http 地址，陀螺仪用不了。打开上面的「陀螺仪瞄准」会提示切换到 https。';
  else if (!window.DeviceMotionEvent) t = '⚠ 这个浏览器不支持陀螺仪。';
  else if (!settings.gyro) t = '陀螺仪：未开启。';
  else if (game && game.touch && game.touch.gyroOn) t = game.touch.motionSeen ? '✓ 陀螺仪正在工作' : '陀螺仪已开启，等待数据…（iPhone 要在弹窗里允许“运动与方向”）';
  else t = '陀螺仪已开启：进入游戏后生效（iPhone 第一次会弹出授权，点允许）。';
  el.textContent = t;
}
setInterval(() => { if (!$('menu-settings').classList.contains('hidden')) updateGyroStatus(); }, 800);

// iOS 需要在点击时申请陀螺仪权限
function askGyro() {
  if (!TOUCH || !settings.gyro) return;
  const DME = window.DeviceMotionEvent;
  if (DME && typeof DME.requestPermission === 'function') DME.requestPermission().catch(() => {});
}

// 竖屏提示（游戏中）
function checkOrientation() {
  const portrait = innerHeight > innerWidth * 1.05;
  $('rotate').classList.toggle('hidden', !(TOUCH && game && portrait));
}
addEventListener('resize', checkOrientation);
addEventListener('orientationchange', () => setTimeout(checkOrientation, 200));
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => { if (TOUCH) e.preventDefault(); });

function resize() {
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2) * settings.res);
  renderer.setSize(innerWidth, innerHeight, false);
}
addEventListener('resize', () => { if (!game) resize(); });

// ---------------- 地图卡片 ----------------
function mapCards(containerId, onPick) {
  const box = $(containerId);
  box.innerHTML = '';
  let selected = settings.lastMap && MAP_LIST.some((m) => m.id === settings.lastMap) ? settings.lastMap : MAP_LIST[0].id;
  for (const m of MAP_LIST) {
    const card = document.createElement('button');
    card.className = 'map-card' + (m.id === selected ? ' sel' : '');
    card.dataset.map = m.id;
    const img = mapImage(getMap(m.id), 4);
    const cv = document.createElement('canvas');
    cv.width = 160; cv.height = 160;
    const ctx = cv.getContext('2d');
    const s = Math.min(160 / img.width, 160 / img.height);
    ctx.drawImage(img, (160 - img.width * s) / 2, (160 - img.height * s) / 2, img.width * s, img.height * s);
    card.appendChild(cv);
    card.insertAdjacentHTML('beforeend', `<b>${esc(m.name)}</b><span>${esc(m.desc)}</span>`);
    card.addEventListener('click', () => {
      selected = m.id;
      for (const c of box.querySelectorAll('.map-card')) c.classList.toggle('sel', c.dataset.map === m.id);
      settings.lastMap = m.id;
      saveSettings();
      audio.init();
      audio.play('click');
      if (onPick) onPick(m.id);
    });
    box.appendChild(card);
  }
  return () => selected;
}

// ---------------- 开始游戏 ----------------
function startGame(net, init, extra = []) {
  starting = { pending: extra.slice() };
  if (!net.isLocal) net.onmessage = (m) => { if (starting) starting.pending.push(m); };
  menuScene.stop();
  hideMenus();
  loading(true, `正在加载地图：${getMap(init.map).name}…`);
  setTimeout(() => {
    setTimeout(checkOrientation, 50);
    try {
      const pending = starting ? starting.pending : [];
      starting = null;
      game = window.__game = new Game({
        renderer, net, init, pending,
        onNetLost: () => reconnect(net),
        onExit: (opts = {}) => {
          game = window.__game = null;
          if (opts.init) {
            // 断线重连成功：用服务器发来的最新状态重新进入对局
            hideReconnect();
            startGame(net, opts.init, opts.rest || []);
            return;
          }
          hideReconnect();
          if (newestPublic) { moveToPublic(); return; } // 公网地址换过了：回到菜单就跳到新地址
          checkOrientation();
          resize();
          if (net.isLocal) { showMenu('menu-main'); }
          else {
            net.send({ t: 'leave' });
            net.onmessage = lobbyMsg;
            net.onclose = lobbyClosed;
            showMenu('menu-online');
            openOnline();
          }
          menuScene.setMap(settings.lastMap || 'sandstorm');
          menuScene.start();
        },
      });
      maybeFsHelp();
    } catch (e) {
      console.error(e);
      toast('启动游戏失败：' + e.message, 6000);
      showMenu('menu-main');
      menuScene.start();
    }
    loading(false);
  }, 30);
}

// ---------------- 断线重连 ----------------
let reconnecting = false;
let initWait = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function showReconnect(text, final = false) {
  $('reconnect').classList.remove('hidden');
  $('rc-title').textContent = final ? '无法重新连接' : '连接中断';
  $('rc-text').textContent = text;
  $('rc-spin').classList.toggle('hidden', final);
  $('rc-btns').classList.toggle('hidden', !final);
}
function hideReconnect() {
  $('reconnect').classList.add('hidden');
  clearTimeout(initWait);
}

async function reconnect(net) {
  if (reconnecting || !net || net.isLocal || !game) return;
  reconnecting = true;
  clearTimeout(initWait);
  showReconnect('网络断开了，正在重新连接…');
  const delays = [300, 800, 1500, 2500, 4000, 5000, 6000, 8000, 10000, 12000];
  for (let i = 0; i < delays.length && game; i++) {
    try {
      await net.connect(8000);
      net.send({ t: 'hello', name: settings.name || playerName(), sid: net.sid });
      reconnecting = false;
      showReconnect('已连上服务器，正在回到房间…');
      initWait = setTimeout(() => {
        if (game) showReconnect('回不到原来的房间了（房间已关闭，或者服务器重启过）。请返回大厅重新加入。', true);
      }, 6000);
      return;
    } catch {
      // 公网地址换过了（免费隧道每小时换）而且新地址连不上：直接跳到新地址，进去后重新加入房间
      if (newestPublic && i >= 1) {
        showReconnect('公网地址换了，正在跳到新地址…（打开后如果有 Enter site 就点一下，再重新加入房间）');
        await sleep(1500);
        moveToPublic();
        return;
      }
      showReconnect(`网络断开了，正在重新连接…（第 ${i + 1} 次）`);
      await sleep(delays[i]);
    }
  }
  reconnecting = false;
  if (game) showReconnect('连接不上服务器。请检查手机网络 / Wi-Fi，然后点「重试」。', true);
}

$('rc-retry').addEventListener('click', () => { if (game) reconnect(game.net); });

// ---------------- 公网地址自动跟随 ----------------
// 免费隧道的地址每小时换一次：服务器会在旧地址到期前先开好新地址。页面开着就自动跟过去（设置一起带过去，
// 因为不同地址的浏览器存储是分开的）；对局里先不跳，断线重连时直接连新地址，打完回到菜单再跳
const TUNNEL_HOST = /\.(pinggy-free\.link|pinggy\.link|pinggy\.net|lhr\.life|localhost\.run)$/i;
let newestPublic = '';
let followTip = false;
function moveToPublic() {
  const q = new URLSearchParams(location.search);
  q.set('import', btoa(unescape(encodeURIComponent(JSON.stringify(settings)))));
  if (account.token) q.set('tk', account.token);
  location.replace(`${newestPublic}${location.pathname}?${q}`);
}
async function followPublic() {
  if (!TUNNEL_HOST.test(location.hostname)) return;
  let u;
  try {
    const j = await (await fetch('/api/info', { cache: 'no-store' })).json();
    if (!j.public) return;
    u = new URL(j.public);
  } catch { return; }
  if (u.host === location.host) return;
  newestPublic = u.origin;
  if (!game) { moveToPublic(); return; }
  if (!game.net.isLocal) game.net.url = `wss://${u.host}/ws`;
  if (!followTip) { followTip = true; toast('公网地址马上要换了（免费隧道每小时换一次）。这局照常打，回到菜单会自动跳到新地址', 6000); }
}
setTimeout(followPublic, 4000);
setInterval(followPublic, 40000);
$('rc-lobby').addEventListener('click', () => { hideReconnect(); if (game) game.exit(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && game && !game.net.isLocal && !game.net.open) reconnect(game.net);
});

// ---------------- iPhone 全屏说明 ----------------
const IOS = /iPhone|iPod/i.test(navigator.userAgent);
const standalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches;
window.__showFsHelp = () => { $('fshelp').classList.remove('hidden'); if (game) game.input.releaseAll(); };
$('fs-ok').addEventListener('click', () => $('fshelp').classList.add('hidden'));
function maybeFsHelp() {
  if (!TOUCH || !IOS || standalone()) return;
  let seen = false;
  try { seen = localStorage.getItem('defuse.fshelp') === '1'; localStorage.setItem('defuse.fshelp', '1'); } catch {}
  if (!seen) setTimeout(() => { if (game) window.__showFsHelp(); }, 1200);
}

// ---------------- 单机 ----------------
let offMap = null;
function openOffline() {
  showMenu('menu-offline');
  if (!offMap) offMap = mapCards('off-maps', (id) => menuScene.setMap(id));
}
$('btn-offline').addEventListener('click', () => { audio.init(); audio.play('click'); openOffline(); });
$('btn-start-offline').addEventListener('click', () => {
  audio.init();
  goFullscreen();
  const opts = {
    map: offMap(), mode: $('off-mode').value, bots: true,
    botDiff: +$('off-diff').value, teamSize: +$('off-size').value, maxRounds: +$('off-rounds').value,
  };
  const net = new LocalNet(opts, playerName());
  net.onmessage = (m) => {
    if (m.t === 'init' && !game && !starting) startGame(net, m);
    else if (starting) starting.pending.push(m);
  };
  net.connect();
});

// ---------------- 靶场 ----------------
$('btn-range').addEventListener('click', () => {
  audio.init();
  goFullscreen();
  const net = new LocalNet({ map: 'range', mode: 'range', bots: false }, playerName());
  net.onmessage = (m) => {
    if (m.t === 'init' && !game && !starting) startGame(net, m);
    else if (starting) starting.pending.push(m);
  };
  net.connect();
});
document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'rs-reset' && game && game.rangeStats) {
    Object.assign(game.rangeStats, { shots: 0, hits: 0, hs: 0, kills: 0 });
    game.hud.rangeStats(game.rangeStats);
  }
});

// ---------------- 联机 ----------------
function serverUrl() {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q;
  return defaultServerUrl();
}

function setStatus(t) { $('net-status').textContent = t; }

function lobbyClosed() {
  setStatus('连接已断开');
  if (lobby) lobby.net = null;
  if (!game) $('room-list').innerHTML = '<div class="empty">与服务器的连接已断开，点「刷新」重新连接</div>';
}

function lobbyMsg(m) {
  switch (m.t) {
    case 'welcome': setStatus('已连接'); break;
    case 'rooms': renderRooms(m.list || [], m.online); break;
    case 'err': toast(m.text); break;
    case 'init':
      if (!game && !starting) startGame(lobby.net, m);
      break;
    default:
      if (starting) starting.pending.push(m);
  }
}

async function openOnline(autoJoin) {
  showMenu('menu-online');
  if (!lobby) lobby = { net: null, timer: null };
  if (!onMap) onMap = mapCards('on-maps', (id) => menuScene.setMap(id));
  if (!lobby.net || !lobby.net.open) {
    setStatus('连接中…');
    $('room-list').innerHTML = '<div class="empty">正在连接服务器…（免费服务器休眠后首次唤醒可能需要 30~60 秒）</div>';
    const net = new WsNet(serverUrl());
    try {
      await net.connect(70000);
    } catch (e) {
      setStatus('连接失败');
      $('room-list').innerHTML = `<div class="empty">无法连接联机服务器（${esc(e.message)}）。<br>单机练习不受影响；如果是自己部署的服务器，请确认它已经启动。</div>`;
      return;
    }
    lobby.net = net;
    net.onmessage = lobbyMsg;
    net.onclose = lobbyClosed;
    net.send({ t: 'hello', name: playerName(), sid: net.sid });
  }
  lobby.net.send({ t: 'rooms' });
  if (!lobby.timer) lobby.timer = setInterval(() => { if (lobby.net && lobby.net.open && !game) lobby.net.send({ t: 'rooms' }); }, 3000);
  if (autoJoin) joinRoom(autoJoin);
}

const PHASE = { warmup: '热身中', freeze: '进行中', live: '进行中', over: '进行中', matchover: '结算中', dm: '进行中', idle: '等待中' };
function renderRooms(list, online) {
  setStatus(`已连接 · 在线 ${online ?? '?'} 人`);
  const box = $('room-list');
  if (!list.length) { box.innerHTML = '<div class="empty">暂时没有房间，点右上角「创建房间」开一个，再把房间码发给朋友</div>'; return; }
  let html = '<div class="room-row head"><span>房间码</span><span>名称</span><span>地图</span><span>模式</span><span>人数</span><span>状态</span><span></span></div>';
  for (const r of list) {
    const st = r.mode === 'dm' ? PHASE[r.phase] || '' : r.phase === 'warmup' ? '热身中' : `${r.sc.CT}:${r.sc.T} 第${r.round}局`;
    html += `<div class="room-row"><span class="code">${esc(r.code)}</span><span>${esc(r.name)}</span><span>${esc(r.mapName)}</span><span>${r.mode === 'dm' ? '死斗' : '爆破'}</span><span>${r.humans}人${r.bots ? ' +' + r.bots + 'BOT' : ''}</span><span>${esc(st)}</span><span><button class="btn small accent" data-join="${esc(r.code)}">加入</button></span></div>`;
  }
  box.innerHTML = html;
  for (const b of box.querySelectorAll('[data-join]')) b.addEventListener('click', () => { goFullscreen(); joinRoom(b.dataset.join); });
}

function joinRoom(code) {
  code = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) { toast('房间码是 4 位字母/数字'); return; }
  if (!lobby || !lobby.net || !lobby.net.open) { openOnline(code); return; }
  audio.init();
  lobby.net.send({ t: 'join', code });
}

let onMap = null;
$('btn-online').addEventListener('click', () => { audio.init(); audio.play('click'); openOnline(); });
$('btn-refresh').addEventListener('click', () => openOnline());
$('btn-join').addEventListener('click', () => { goFullscreen(); joinRoom($('join-code').value); });
$('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom($('join-code').value); });
$('btn-show-create').addEventListener('click', () => { $('create-form').classList.remove('hidden'); $('on-name').value ||= `${playerName()} 的房间`; });
$('btn-hide-create').addEventListener('click', () => $('create-form').classList.add('hidden'));
$('btn-create').addEventListener('click', () => {
  if (!lobby || !lobby.net || !lobby.net.open) { toast('还没有连接到服务器'); return; }
  audio.init();
  goFullscreen();
  lobby.net.send({
    t: 'create',
    opts: {
      name: $('on-name').value.trim(), map: onMap(), mode: $('on-mode').value, bots: $('on-bots').value === '1',
      botDiff: +$('on-diff').value, teamSize: +$('on-size').value, maxRounds: +$('on-rounds').value,
    },
  });
});

// ---------------- 设置 ----------------
function bindSettings() {
  const x = settings.xhair;
  const rng = (id, key, obj, fmt, after) => {
    const el = $(id), label = $('v-' + id.slice(2));
    el.value = obj[key];
    const upd = () => { obj[key] = +el.value; if (label) label.textContent = fmt ? fmt(obj[key]) : obj[key]; saveSettings(); if (after) after(); };
    el.oninput = upd;
    if (label) label.textContent = fmt ? fmt(obj[key]) : obj[key];
  };
  const chk = (id, key, obj, after) => {
    const el = $(id);
    el.checked = !!obj[key];
    el.onchange = () => { obj[key] = el.checked; saveSettings(); if (after) after(); };
  };
  const prev = () => applyCrosshair($('xh-prev'));
  rng('s-sens', 'sens', settings, (v) => v.toFixed(2));
  rng('s-zoom', 'zoomSens', settings, (v) => v.toFixed(2));
  rng('s-vol', 'volume', settings, (v) => Math.round(v * 100) + '%', () => audio.setVolume(settings.volume));
  let gunPreview = 0;
  rng('s-stepvol', 'stepVol', settings, (v) => Math.round(v * 100) + '%', () => {
    if (performance.now() - gunPreview < 250) return;
    gunPreview = performance.now();
    audio.init();
    audio.step(null, 0.5, 'hard');
  });
  chk('s-soundviz', 'soundViz', settings);
  chk('s-hitmarker', 'hitmarker', settings);
  chk('s-quickstop', 'quickStop', settings);
  rng('s-gunvol', 'gunVol', settings, (v) => Math.round(v * 100) + '%', () => {
    // 拖动时试播一声（限速）
    if (performance.now() - gunPreview < 300) return;
    gunPreview = performance.now();
    audio.init();
    audio.shot('ak47', null);
  });
  rng('s-res', 'res', settings, (v) => Math.round(v * 100) + '%', () => { if (!game) resize(); });
  rng('s-xlen', 'len', x, null, prev);
  rng('s-xgap', 'gap', x, null, prev);
  rng('s-xthick', 'thick', x, null, prev);
  $('s-xcolor').value = x.color;
  $('s-xcolor').oninput = () => { x.color = $('s-xcolor').value; saveSettings(); prev(); };
  chk('s-xdot', 'dot', x, prev);
  chk('s-xdyn', 'dynamic', x);
  chk('s-shadows', 'shadows', settings, () => toast('阴影设置将在下一局生效'));
  chk('s-voice', 'voice', settings);
  chk('s-full', 'fullscreen', settings);
  chk('s-fps', 'showFps', settings);
  {
    const el = $('s-fpscap');
    el.value = String(settings.fpsCap || 0);
    el.onchange = () => { settings.fpsCap = +el.value; saveSettings(); };
  }
  const relayout = () => { if (game && game.touch) game.touch.applyLayout(); };
  rng('s-tsens', 'touchSens', settings, (v) => v.toFixed(2));
  rng('s-bscale', 'btnScale', settings, (v) => Math.round(v * 100) + '%', relayout);
  rng('s-bop', 'btnOpacity', settings, (v) => Math.round(v * 100) + '%', relayout);
  rng('s-gsens', 'gyroSens', settings, (v) => v.toFixed(1));
  rng('s-tzoom', 'touchZoomSens', settings, (v) => v.toFixed(2));
  rng('s-tsx', 'touchSensX', settings, (v) => '×' + v.toFixed(2));
  rng('s-tsy', 'touchSensY', settings, (v) => '×' + v.toFixed(2));
  rng('s-gsx', 'gyroSensX', settings, (v) => '×' + v.toFixed(2));
  rng('s-gsy', 'gyroSensY', settings, (v) => '×' + v.toFixed(2));
  for (const [id, key] of [['s-crouchmode', 'crouchMode'], ['s-scopemode', 'scopeMode'], ['s-joymode', 'joyMode']]) {
    const el = $(id);
    el.value = settings[key] || el.options[0].value;
    el.onchange = () => { settings[key] = el.value; saveSettings(); relayout(); };
  }
  chk('s-gyroscope', 'gyroScope', settings);
  chk('s-gyroinvx', 'gyroInvX', settings);
  chk('s-gyroinvy', 'gyroInvY', settings);
  chk('s-gyroswap', 'gyroSwap', settings);
  chk('s-firedrag', 'fireDragLook', settings);
  renderBinds();
  updateGyroStatus();
  chk('s-assist', 'aimAssist', settings);
  chk('s-autofire', 'autoFire', settings);
  chk('s-leftfire', 'leftFire', settings, relayout);
  chk('s-vibrate', 'vibrate', settings);
  chk('s-gyro', 'gyro', settings, () => {
    if (settings.gyro && !window.isSecureContext) { window.__gyroNeedsHttps(); updateGyroStatus(); return; }
    askGyro();
    if (game && game.touch) { if (settings.gyro) game.touch.enableGyro(); else game.touch.disableGyro(); }
  });
  const tm = $('s-touchmode');
  tm.value = settings.touchMode;
  tm.onchange = () => { settings.touchMode = tm.value; saveSettings(); toast('操作方式将在刷新页面后生效'); };
  prev();
}

// ---------------- 电脑键位 ----------------
const KEY_NAMES = {
  Space: '空格', ControlLeft: '左 Ctrl', ControlRight: '右 Ctrl', ShiftLeft: '左 Shift', ShiftRight: '右 Shift', AltLeft: '左 Alt', AltRight: '右 Alt',
  Tab: 'Tab', Enter: '回车', Backquote: '`', CapsLock: 'Caps', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
};
const keyName = (c) => (!c ? '—' : c.startsWith('Key') ? c.slice(3) : c.startsWith('Digit') ? c.slice(5) : c.startsWith('Numpad') ? '小键盘' + c.slice(6) : KEY_NAMES[c] || c);
let bindCapture = null;

function renderBinds() {
  const box = $('binds-list');
  $('binds-sec').classList.toggle('hidden', TOUCH);
  if (TOUCH) return;
  box.innerHTML = BIND_ACTIONS.map(([act, name]) => {
    const keys = settings.binds[act] || [];
    const cell = (i) => `<button class="bind-key${bindCapture && bindCapture.act === act && bindCapture.i === i ? ' wait' : ''}" data-act="${act}" data-i="${i}">${bindCapture && bindCapture.act === act && bindCapture.i === i ? '按下新键…' : esc(keyName(keys[i]))}</button>`;
    return `<div class="bind-row"><span>${esc(name)}</span>${cell(0)}${cell(1)}</div>`;
  }).join('');
}

function applyBinds() {
  saveSettings();
  if (game) game.input.setBinds(settings.binds);
  renderBinds();
}

$('binds-list').addEventListener('click', (e) => {
  const b = e.target.closest('.bind-key');
  if (!b) return;
  bindCapture = { act: b.dataset.act, i: +b.dataset.i };
  renderBinds();
});
window.addEventListener('keydown', (e) => {
  if (!bindCapture) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const { act, i } = bindCapture;
  bindCapture = null;
  if (e.code === 'Escape') { renderBinds(); return; }
  const list = (settings.binds[act] || []).slice();
  if (e.code === 'Backspace' || e.code === 'Delete') list[i] = null;
  else {
    // 这个键原来绑在别的动作上：从那里拿走
    for (const [a] of BIND_ACTIONS) if (a !== act) settings.binds[a] = (settings.binds[a] || []).filter((k) => k !== e.code);
    for (let j = 0; j < list.length; j++) if (list[j] === e.code) list[j] = null;
    list[i] = e.code;
  }
  settings.binds[act] = list.filter(Boolean);
  applyBinds();
  audio.play('click');
}, true);
$('btn-binds-reset').addEventListener('click', () => { settings.binds = defaultBinds(); applyBinds(); toast('已恢复默认键位'); });

// ---------------- 手机按键布局 ----------------
$('btn-touch-layout').addEventListener('click', () => {
  audio.init();
  const ret = settingsReturn;
  settingsReturn = null;
  $('menu-settings').classList.add('hidden');
  const back = () => openSettings(ret);
  if (game && game.touch) {
    $('pause').classList.add('hidden');
    game.touch.startEdit(back);
  } else {
    const fake = { input: { vKey() {}, vMouse() {}, releaseAll() {}, moveX: 0, moveY: 0 }, me: { alive: true, inv: [] }, w: {} };
    const tc = new TouchControls(fake, { preview: true });
    tc.startEdit(() => { tc.destroy(); back(); });
  }
});

// 设置分栏：记住上次看的那一栏（手机默认「手机操作」，电脑默认「电脑操作」）
function setTab(tab) {
  for (const b of document.querySelectorAll('#set-tabs [data-tab]')) b.classList.toggle('on', b.dataset.tab === tab);
  for (const sec of document.querySelectorAll('.set-tab')) sec.classList.toggle('on', sec.dataset.tab === tab);
  try { localStorage.setItem('defuse.setTab', tab); } catch {}
}
for (const b of document.querySelectorAll('#set-tabs [data-tab]')) b.addEventListener('click', () => { audio.play('click'); setTab(b.dataset.tab); });

function openSettings(onClose) {
  settingsReturn = onClose || null;
  bindSettings();
  let tab = null;
  try { tab = localStorage.getItem('defuse.setTab'); } catch {}
  setTab(tab && document.querySelector(`.set-tab[data-tab="${tab}"]`) ? tab : TOUCH ? 'touch' : 'ctl');
  $('menus').classList.remove('hidden');
  for (const m of document.querySelectorAll('.menu')) m.classList.toggle('hidden', m.id !== 'menu-settings');
  $('menu-settings').style.background = game ? 'rgba(5,8,12,0.75)' : '';
}
window.__openSettings = openSettings;

$('btn-settings').addEventListener('click', () => { audio.init(); openSettings(null); });
$('btn-settings-back').addEventListener('click', () => {
  $('menu-settings').classList.add('hidden');
  if (settingsReturn) { const f = settingsReturn; settingsReturn = null; f(); }
  else showMenu('menu-main');
});
$('btn-settings-reset').addEventListener('click', () => { resetSettings(); bindSettings(); audio.setVolume(settings.volume); toast('已恢复默认设置'); });
$('btn-help').addEventListener('click', () => { audio.init(); showMenu('menu-help'); });

// ---------------- 背包（皮肤） ----------------
const KNIVES = [
  { id: 'default', name: '默认匕首', rarity: '普通', cls: 'r-common', desc: '警察和匪徒的默认刀具。' },
  { id: 'butterfly', name: '★ 蝴蝶刀', rarity: '隐秘', cls: 'r-covert', desc: '拔刀时甩开刀柄、“咔”一声合进手里；按 F 检视会连续开合两次。' },
  { id: 'karambit', name: '★ 爪子刀', rarity: '隐秘', cls: 'r-covert', desc: '食指套着刀环，拔刀时绕手指转两圈接住；按 F 检视会正转、反转再甩一圈。' },
  { id: 'm9', name: '★ M9 刺刀', rarity: '隐秘', cls: 'r-covert', desc: '拔刀时把刀抛起来翻一圈再接住；按 F 检视会转刀给你看两面，再抛一次。' },
  { id: 'xeno', name: '★ 剥皮小刀', rarity: '隐秘', cls: 'r-covert', desc: '瓦罗兰特「异星猎人」小刀：锯齿刀背、镂空刀柄、刀尾挂绳。拔刀时在手里翻一圈握住；检视会翻面看两面，再在指间转两圈。' },
];
let inv = null;

function invNow() { return performance.now() / 1000; }

function renderInv() {
  const cur = settings.skins.knife || 'default';
  $('inv-knives').innerHTML = KNIVES.map((k) => `<button class="inv-item ${k.cls}${inv.sel === k.id ? ' sel' : ''}" data-k="${k.id}">
    <span class="inv-n">${esc(k.name)}</span><span class="inv-r">${esc(k.rarity)}</span>${cur === k.id ? '<span class="inv-eq">已装备</span>' : ''}</button>`).join('');
  const k = KNIVES.find((x) => x.id === inv.sel);
  $('inv-name').textContent = k.name;
  $('inv-name').className = 'inv-name ' + k.cls;
  $('inv-desc').textContent = k.desc;
  $('inv-equip').textContent = cur === k.id ? '✓ 已装备' : '装备';
  $('inv-equip').disabled = cur === k.id;
}

function invShow(id) {
  inv.sel = id;
  inv.vm.knifeSkin = id;
  inv.vm.wid = null;
  inv.vm.setWeapon('knife', 0.5, invNow());
  invCenter();
  renderInv();
}

// 不同的刀在第一人称里的位置不一样，预览时都挪到画面中间
function invCenter() {
  const lay = inv.vm.cur && inv.vm.cur.userData.lay;
  if (lay) inv.vm.root.position.set(0.04 - lay.pos[0], -0.05 - lay.pos[1], -0.18 - lay.pos[2]);
}

function invLoop() {
  if (!inv || $('menu-inventory').classList.contains('hidden')) { if (inv) inv.running = false; return; }
  const c = $('inv-canvas');
  const w = c.clientWidth, h = c.clientHeight;
  if (w && h && (inv.w !== w || inv.h !== h)) { inv.w = w; inv.h = h; inv.r.setSize(w, h, false); inv.vm.resize(w / h); }
  const now = invNow(), dt = Math.min(0.05, now - (inv.last || now));
  inv.last = now;
  inv.vm.update(dt, { now, speed: 0, onGround: true, crouch: false, mdx: Math.sin(now * 0.7) * 30, mdy: Math.cos(now * 0.5) * 12, scoped: false, hidden: false, silenced: false });
  inv.r.render(inv.vm.scene, inv.vm.camera);
  requestAnimationFrame(invLoop);
}

function openInventory() {
  audio.init();
  showMenu('menu-inventory');
  if (!inv) {
    const r = new THREE.WebGLRenderer({ canvas: $('inv-canvas'), antialias: true, alpha: true });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const vm = new ViewModel();
    vm.setTeam('CT');
    vm.sfx = (k) => audio.play(k);
    inv = { r, vm, sel: 'default' };
  }
  invShow(settings.skins.knife || 'default');
  if (!inv.running) { inv.running = true; inv.last = 0; requestAnimationFrame(invLoop); }
}

$('btn-inv').addEventListener('click', openInventory);
$('inv-knives').addEventListener('click', (e) => {
  const b = e.target.closest('[data-k]');
  if (b) { audio.play('click'); invShow(b.dataset.k); }
});
$('inv-draw').addEventListener('click', () => { inv.vm.wid = null; inv.vm.setWeapon('knife', 0.5, invNow()); if (!inv.vm.knifeFx()) audio.play('deploy'); });
$('inv-inspect').addEventListener('click', () => { inv.vm.drawDur = 0; inv.vm.onInspect(invNow()); });
$('inv-equip').addEventListener('click', () => {
  settings.skins.knife = inv.sel;
  saveSettings();
  audio.play('buy');
  toast('已装备：' + KNIVES.find((k) => k.id === inv.sel).name.replace('★ ', ''));
  renderInv();
});

// ---------------- 手机扫码 ----------------
async function playUrl() {
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  try {
    const r = await fetch('/api/info', { cache: 'no-store' });
    const j = await r.json();
    // 有公网地址就优先用公网地址：在哪都能扫码进来
    if (j.public) return { url: j.public.replace(/\/$/, '') + '/', local: false, public: true };
    if (!local) return { url: location.origin + location.pathname, local: false };
    if (j.lanHttps && j.lanHttps.length) return { url: j.lanHttps[0] + '/', local: true, https: true, plain: j.lan && j.lan[0] ? j.lan[0] + '/' : null };
    if (j.lan && j.lan.length) return { url: j.lan[0] + '/', local: true };
  } catch {}
  if (!local) return { url: location.origin + location.pathname, local: false };
  return { url: null, local: true };
}

async function showQR(roomCode) {
  const info = await playUrl();
  const box = $('qrbox');
  $('qr-title').textContent = roomCode ? `扫码加入房间 ${roomCode}` : '手机扫码游玩';
  if (!info.url) {
    $('qr-canvas').classList.add('hidden');
    $('qr-url').textContent = '没有找到局域网地址';
    $('qr-tip').textContent = '请确认这台电脑已连接 Wi-Fi / 网线，然后重试。';
  } else {
    const url = info.url + (roomCode ? `?room=${roomCode}` : '');
    $('qr-canvas').classList.remove('hidden');
    drawQR($('qr-canvas'), url, 8);
    $('qr-url').textContent = url;
    $('qr-tip').innerHTML = info.local
      ? '手机和这台电脑连<b>同一个 Wi-Fi</b>，用手机相机或浏览器扫一扫即可打开。<br>请横屏游玩；进入后点「联机对战」可以和电脑上的玩家一起玩。'
        + (info.https ? `<br><b>第一次打开会提示“不安全 / 非私人连接”</b>：点「显示详细信息 → 访问此网站」（安卓点「高级 → 继续前往」）。用 https 打开手机陀螺仪才能用。${info.plain ? `<br>不想看到提示也可以用：${info.plain}${roomCode ? `?room=${roomCode}` : ''}（不能用陀螺仪）` : ''}` : '')
      : info.public ? '<b>公网地址</b>：不管在哪、用不用同一个 Wi-Fi，扫一扫都能打开（横屏游玩）。<br>需要这台电脑开着服务器。' : '用手机相机或浏览器扫一扫即可打开（横屏游玩）。';
    $('qr-copy').onclick = () => navigator.clipboard?.writeText(url).then(() => toast('已复制：' + url), () => toast(url));
  }
  box.classList.remove('hidden');
}
window.__showQR = showQR;
$('btn-qr').addEventListener('click', () => { audio.init(); showQR(null); });
$('qr-close').addEventListener('click', () => {
  $('qrbox').classList.add('hidden');
  if (game && game.paused) game.showPause();
});
for (const b of document.querySelectorAll('[data-back]')) b.addEventListener('click', () => { audio.play('click'); showMenu('menu-main'); });

$('name-input').value = settings.name || '';
$('name-input').addEventListener('change', () => { settings.name = $('name-input').value.trim(); saveSettings(); });

// ---------------- 账号 ----------------
let acctTab = 'login';
function syncText() {
  switch (account.state) {
    case 'loading': return '登录中…';
    case 'pending': case 'saving': return '设置同步中…';
    case 'error': return '同步失败（网络不好，会自动重试）';
    case 'ok': return '设置已同步到账号';
    default: return '';
  }
}
function renderAccount() {
  const on = !!account.name;
  $('acct-status').innerHTML = on ? `👤 <b>${esc(account.name)}</b> · ${esc(syncText())}` : account.state === 'loading' ? '登录中…' : '未登录 · 设置只存在这台设备上';
  $('btn-account').textContent = on ? '账号' : '登录 / 注册';
  $('name-input').disabled = on;
  $('name-input').value = on ? account.name : settings.name || '';
  $('name-input').title = on ? '登录后昵称就是账号名称' : '';
  $('acct-out').classList.toggle('hidden', on);
  $('acct-in').classList.toggle('hidden', !on);
  $('acct-me-name').textContent = account.name;
  const t = account.lastSync ? new Date(account.lastSync).toTimeString().slice(0, 5) : '';
  $('acct-sync').textContent = on ? `${syncText()}${t && account.state === 'ok' ? `（${t}）` : ''}。在别的手机 / 电脑上用这个账号登录，就能用同一套设置。` : '';
}
function setAcctTab(tab) {
  acctTab = tab;
  for (const b of document.querySelectorAll('.acct-tabs [data-tab]')) b.classList.toggle('on', b.dataset.tab === tab);
  for (const el of document.querySelectorAll('.acct-reg')) el.classList.toggle('hidden', tab !== 'reg');
  for (const el of document.querySelectorAll('.acct-login')) el.classList.toggle('hidden', tab !== 'login');
  $('acct-submit').textContent = tab === 'reg' ? '注册并登录' : '登录';
  $('acct-pw').autocomplete = tab === 'reg' ? 'new-password' : 'current-password';
  $('acct-msg').textContent = '';
}
async function acctSubmit() {
  const name = $('acct-name').value.trim(), pw = $('acct-pw').value, pw2 = $('acct-pw2').value;
  const msg = (t) => { $('acct-msg').textContent = t; };
  if (name.length < 2) return msg('名称至少 2 个字');
  if (pw.length < 4) return msg('密码至少 4 位');
  if (acctTab === 'reg' && pw !== pw2) return msg('两次输入的密码不一样');
  $('acct-submit').disabled = true;
  msg(acctTab === 'reg' ? '正在注册…' : '正在登录…');
  const r = acctTab === 'reg' ? await register(name, pw) : await login(name, pw);
  $('acct-submit').disabled = false;
  if (r.error) return msg(r.error);
  $('acct-pw').value = '';
  $('acct-pw2').value = '';
  msg('');
  audio.setVolume(settings.volume);
  toast(acctTab === 'reg' ? `注册成功，欢迎 ${r.name}！设置已存进账号` : `欢迎回来，${r.name}！已换成账号里的设置`);
  showMenu('menu-main');
}
account.onChange = renderAccount;
$('btn-account').addEventListener('click', () => { audio.init(); audio.play('click'); renderAccount(); setAcctTab(acctTab); showMenu('menu-account'); });
for (const b of document.querySelectorAll('.acct-tabs [data-tab]')) b.addEventListener('click', () => { audio.play('click'); setAcctTab(b.dataset.tab); });
$('acct-submit').addEventListener('click', acctSubmit);
for (const id of ['acct-name', 'acct-pw', 'acct-pw2']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') acctSubmit(); });
$('acct-logout').addEventListener('click', async () => { await logout(); toast('已退出登录（这台设备上的设置还在）'); renderAccount(); });
$('acct-sync-now').addEventListener('click', () => uploadNow());
renderAccount();
initAccount().then(() => audio.setVolume(settings.volume));

window.addEventListener('error', (e) => { if (e && e.message) console.error(e.message); });

// ---------------- 启动 ----------------
loading(true, '正在生成地图与贴图…');
setTimeout(() => {
  try {
    menuScene.setMap(settings.lastMap || 'sandstorm');
    menuScene.start();
  } catch (e) {
    console.error(e);
    toast('3D 场景初始化失败：' + e.message, 8000);
  }
  loading(false);
  if (TOUCH) {
    let seen = false;
    try { seen = localStorage.getItem('defuse.mobiletip') === '1'; localStorage.setItem('defuse.mobiletip', '1'); } catch {}
    const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (!seen) toast(ios ? '提示：横屏游玩；在 Safari 里点「分享 → 添加到主屏幕」可以全屏玩' : '提示：请横屏游玩，进入游戏会自动全屏', 7000);
  }
  const room = new URLSearchParams(location.search).get('room');
  if (room) {
    if (!settings.name) playerName();
    openOnline(room.toUpperCase());
    toast('正在加入房间 ' + room.toUpperCase() + '…');
  }
}, 30);
