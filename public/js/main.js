// 入口：主菜单、单机/联机大厅、设置，负责创建 Game
import * as THREE from 'three';
import { settings, saveSettings, resetSettings, applyCrosshair, useTouch } from './client/settings.js';
import { audio } from './client/audio.js';
import { WsNet, LocalNet, defaultServerUrl } from './client/net.js';
import { Game } from './client/game.js';
import { MAP_LIST, getMap } from './shared/maps.js';
import { mapImage } from './client/mapimg.js';
import { buildMapMeshes, setupEnvironment } from './client/world.js';
import { setMaxAnisotropy } from './client/textures.js';
import { drawQR } from './client/qr.js';

window.__gameReady = true;
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
      showReconnect(`网络断开了，正在重新连接…（第 ${i + 1} 次）`);
      await sleep(delays[i]);
    }
  }
  reconnecting = false;
  if (game) showReconnect('连接不上服务器。请检查手机网络 / Wi-Fi，然后点「重试」。', true);
}

$('rc-retry').addEventListener('click', () => { if (game) reconnect(game.net); });
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
  const relayout = () => { if (game && game.touch) game.touch.applyLayout(); };
  rng('s-tsens', 'touchSens', settings, (v) => v.toFixed(2));
  rng('s-bscale', 'btnScale', settings, (v) => Math.round(v * 100) + '%', relayout);
  rng('s-bop', 'btnOpacity', settings, (v) => Math.round(v * 100) + '%', relayout);
  rng('s-gsens', 'gyroSens', settings, (v) => v.toFixed(1));
  chk('s-assist', 'aimAssist', settings);
  chk('s-autofire', 'autoFire', settings);
  chk('s-leftfire', 'leftFire', settings, relayout);
  chk('s-gyro', 'gyro', settings, () => {
    askGyro();
    if (game && game.touch) { if (settings.gyro) game.touch.enableGyro(); else game.touch.disableGyro(); }
  });
  const tm = $('s-touchmode');
  tm.value = settings.touchMode;
  tm.onchange = () => { settings.touchMode = tm.value; saveSettings(); toast('操作方式将在刷新页面后生效'); };
  prev();
}

function openSettings(onClose) {
  settingsReturn = onClose || null;
  bindSettings();
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

// ---------------- 手机扫码 ----------------
async function playUrl() {
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (!local) return { url: location.origin + location.pathname, local: false };
  try {
    const r = await fetch('/api/info', { cache: 'no-store' });
    const j = await r.json();
    if (j.lan && j.lan.length) return { url: j.lan[0] + '/', local: true, all: j.lan };
  } catch {}
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
      : '用手机相机或浏览器扫一扫即可打开（横屏游玩）。';
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
