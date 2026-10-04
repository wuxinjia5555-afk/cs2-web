// HUD 与游戏内界面：雷达、状态、计时比分、击杀信息、伤害方向、买枪菜单、记分板、聊天
import { WEAPONS, EQUIP, BUY_MENU, moveSpeed } from '../shared/weapons.js';
import { clamp } from '../shared/util.js';
import { F, TEAM_NAME } from '../shared/constants.js';
import { mapImage } from './mapimg.js';
import { settings, applyCrosshair } from './settings.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const WNAME = { world: '摔落', c4: 'C4 爆炸', he: '手雷', molotov: '燃烧', incgrenade: '燃烧', knife: '匕首' };
export const weaponName = (w) => WNAME[w] || (WEAPONS[w] && WEAPONS[w].name) || (EQUIP[w] && EQUIP[w].name) || w;
export const SKIN_NAME = { butterfly: '蝴蝶刀', karambit: '爪子刀', m9: 'M9 刺刀', xeno: '剥皮小刀', tianyu: '天御刀', shadow: '影刃', dragon: '威龙之刃' };
const knifeLabel = (skin) => SKIN_NAME[skin] || '匕首';
const REASON = { elim: '全歼敌人', time: '时间耗尽', bomb: '目标已被摧毁', defuse: '炸弹已被拆除' };

export class Hud {
  constructor(game) {
    this.scopeBlur = 0; this.scopeBlurPx = 0; // 开着镜走动时准星线糊多少
    this.g = game;
    this.root = $('hud');
    this.cache = {};
    this.radar = $('radar');
    this.rctx = this.radar.getContext('2d');
    this.radarImg = mapImage(game.map, 8, { zones: false });
    this.feed = [];
    this.chatLines = [];
    this.dmgEls = [];
    this.centerT = 0;
    this.hitT = 0;
    this.weaponListT = 0;
    this.moneyPopT = 0;
    this.buyOpen = false;
    this.buyCat = -1;
    this.sbOpen = false;
    this.sbT = 0;
    this.xh = $('crosshair');
    applyCrosshair(this.xh);
    this.buildBuyMenu();
    this.clearTransient();
  }

  show() { this.root.classList.remove('hidden'); }
  hide() {
    this.root.classList.add('hidden');
    for (const id of ['buymenu', 'scoreboard', 'teamselect', 'pause', 'matchend']) $(id).classList.add('hidden');
  }

  clearTransient() {
    $('killfeed').innerHTML = '';
    $('chatlog').innerHTML = '';
    $('dmg-dirs').innerHTML = '';
    $('round-end').classList.add('hidden');
    $('death-info').classList.add('hidden');
    $('spec-info').classList.add('hidden');
    $('center-msg').textContent = '';
    this.feed = [];
  }

  set(id, v) {
    if (this.cache[id] === v) return;
    this.cache[id] = v;
    $(id).textContent = v;
  }
  toggle(id, on) {
    const k = '_v' + id;
    if (this.cache[k] === on) return;
    this.cache[k] = on;
    $(id).classList.toggle('hidden', !on);
  }
  cls(id, name, on) {
    const k = '_c' + id + name;
    if (this.cache[k] === on) return;
    this.cache[k] = on;
    $(id).classList.toggle(name, on);
  }

  // ---------------- 每帧 ----------------
  // 声纹：方向 ang（0=正前方，顺时针为正），强度 s（0~1）
  soundPing(ang, s, kind) {
    const now = this.g.now;
    if (!this.pings) this.pings = [];
    for (const p of this.pings) {
      let da = p.a - ang;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      if (p.kind === kind && now - p.t < 0.3 && Math.abs(da) < 0.25) { p.a = ang; p.s = Math.max(p.s, s); p.t = now; return; }
    }
    this.pings.push({ a: ang, s, t: now, kind });
    if (this.pings.length > 24) this.pings.shift();
  }

  drawPings(now) {
    const cv = $('soundviz');
    if (!cv || (!(this.pings && this.pings.length) && !this.pingDrawn)) return;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const w = window.innerWidth, h = window.innerHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    this.pingDrawn = false;
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) * (this.g.isTouch ? 0.19 : 0.15);
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 3;
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i], life = p.kind === 'shot' ? 1.2 : p.kind === 'bomb' ? 2 : 0.9, age = now - p.t;
      if (age > life || age < 0) { this.pings.splice(i, 1); continue; }
      const al = (1 - age / life) * p.s;
      const base = p.a - Math.PI / 2;
      const col = p.kind === 'shot' ? '255,170,40' : p.kind === 'bomb' ? '255,230,60' : '255,72,60';
      for (let k = 0; k < 3; k++) {
        const r = R + k * 9 + age * 16;
        const span = (p.kind === 'shot' ? 0.26 : 0.2) - k * 0.03;
        ctx.beginPath();
        ctx.arc(cx, cy, r, base - span, base + span);
        ctx.strokeStyle = `rgba(${col},${(al * (1 - k * 0.3)).toFixed(3)})`;
        ctx.lineWidth = p.kind === 'shot' ? 5 : 4;
        ctx.stroke();
      }
      if (p.kind === 'shot' || p.kind === 'bomb') {
        // 枪声：外圈再加一个小三角箭头
        const r = R + 34 + age * 16, ax = cx + Math.cos(base) * r, ay = cy + Math.sin(base) * r;
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(base + Math.PI / 2);
        ctx.fillStyle = `rgba(${col},${al.toFixed(3)})`;
        ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(5, 3); ctx.lineTo(-5, 3); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      this.pingDrawn = true;
    }
  }

  update(dt) {
    const g = this.g, me = g.me, now = g.now;
    this.drawPings(now);
    const spectating = !me.alive;
    const specP = spectating && g.specId != null ? g.players.get(g.specId) : null;
    // 血量护甲
    const hp = specP ? specP.hp : me.hp;
    this.set('hp', String(hp));
    this.cls('hp', 'low', hp <= 25);
    this.set('armor', specP ? '-' : String(me.armor));
    this.set('armor-ico', me.helmet ? '⛑' : '⛨');
    this.set('money', '$' + me.money);
    this.toggle('buyzone', me.alive && g.canBuy());
    this.toggle('ico-bomb', !!me.inv[5] && me.alive);
    this.toggle('ico-kit', me.kit && me.alive);
    if (this.moneyPopT && now > this.moneyPopT) { this.moneyPopT = 0; $('money-pop').classList.remove('show'); }
    if (this.coinPopT && now > this.coinPopT) { this.coinPopT = 0; $('coin-pop').classList.remove('show'); }
    // 弹药
    const w = g.curWeapon();
    const item = me.inv[me.slot];
    this.set('weapon-name', specP ? weaponName(specP.wid || 'knife') : w.id === 'knife' ? knifeLabel(g.vm.knifeSkin) : weaponName(w.id));
    if (!specP && item && (me.slot === 1 || me.slot === 2)) {
      this.set('clip', String(item.clip));
      this.set('reserve', '/ ' + item.res);
      this.cls('clip', 'low', item.clip <= Math.ceil((WEAPONS[item.w].mag || 1) * 0.2));
    } else if (!specP && me.slot === 4) {
      this.set('clip', String(me.inv[4].filter((x) => x === (me.nade || me.inv[4][0])).length));
      this.set('reserve', '');
    } else {
      this.set('clip', specP ? '' : '-');
      this.set('reserve', '');
    }
    $('weapon-list').style.opacity = now < this.weaponListT ? '1' : '0';
    // 顶部计时 / 比分
    this.updateTop(now);
    // 准星
    this.updateCrosshair();
    // 命中标记
    $('hitmarker').style.opacity = now < this.hitT ? '1' : '0';
    if (this.centerT && now > this.centerT) { this.centerT = 0; this.set('center-msg', ''); }
    // 击杀信息淡出
    for (let i = this.feed.length - 1; i >= 0; i--) {
      const f = this.feed[i];
      if (now > f.t + 7) { f.el.remove(); this.feed.splice(i, 1); }
      else if (now > f.t + 6) f.el.style.opacity = '0';
    }
    for (let i = this.chatLines.length - 1; i >= 0; i--) {
      const c = this.chatLines[i];
      if (now > c.t + 12) { c.el.remove(); this.chatLines.splice(i, 1); }
      else if (now > c.t + 10 && !g.chatOpen) c.el.style.opacity = '0';
      else c.el.style.opacity = '1';
    }
    for (let i = this.dmgEls.length - 1; i >= 0; i--) {
      const d = this.dmgEls[i];
      const a = d.ang - g.yaw;
      d.el.style.transform = `rotate(${-a}rad)`;
      if (now > d.t + 1.2) { d.el.remove(); this.dmgEls.splice(i, 1); }
      else if (now > d.t + 0.6) d.el.style.opacity = '0';
    }
    // 叠加层
    $('fx-flash').style.opacity = g.flashAlpha.toFixed(3);
    $('fx-smoke').style.opacity = g.smokeAlpha.toFixed(3);
    $('fx-hurt').style.opacity = Math.max(0, g.hurtT - now).toFixed(3);
    $('fx-heal').style.opacity = Math.max(0, ((g.healT || 0) - now) * 1.6).toFixed(3);
    const scoped = me.alive && g.w.scope > 0;
    this.toggle('scope', scoped || (!me.alive && !!g.specScoped));
    // 开着镜走动 / 跳起来：准星线变粗变糊（这时候打不准），站稳了才是一条细线
    let blur = 0;
    if (scoped) {
      const s = g.sim, ms = moveSpeed(g.curWeapon(), true);
      blur = s.onGround ? clamp((Math.hypot(s.vx, s.vz) - ms * 0.3) / (ms * 0.7), 0, 1) : 1;
    }
    this.scopeBlur += (blur - this.scopeBlur) * Math.min(1, dt * (blur > this.scopeBlur ? 14 : 9));
    const sb = Math.round(this.scopeBlur * 14) / 2; // 最多 7 像素，按半个像素一档（免得每帧都改样式）
    if (sb !== this.scopeBlurPx) { this.scopeBlurPx = sb; $('scope').style.setProperty('--sb', sb + 'px'); }
    // 进度条
    let prog = null;
    if (g.w.planting) prog = ['正在安放炸弹…', (now - g.w.plantStart) / 3.2];
    else if (g.w.defusing) prog = [me.kit ? '正在拆除炸弹（拆弹器）…' : '正在拆除炸弹…', (now - g.w.defuseStart) / g.w.defuseDur];
    this.toggle('progress', !!prog);
    if (prog) {
      this.set('progress-label', prog[0]);
      $('progress-fill').style.width = Math.min(100, prog[1] * 100).toFixed(1) + '%';
    }
    this.set('hint', g.hintText());
    this.set('target-name', g.targetName || '');
    // 观战
    const noMate = spectating && !specP && me.team !== 'SPEC' && g.noSpecMate && g.mode === 'bomb' && !(g.deathT >= 0 && now - g.deathT < 3);
    this.toggle('spec-info', !!specP || (spectating && me.team === 'SPEC') || noMate);
    const T = g.isTouch;
    if (specP) $('spec-info').innerHTML = `正在观战：<b class="${specP.team === 'CT' ? 'ct-c' : 't-c'}">${esc(specP.name)}</b> ♥ ${specP.hp}<small>${T ? '点下方 ◀ ▶ 切换观战对象' : '左键/右键 切换观战对象'}</small>`;
    else if (noMate) $('spec-info').innerHTML = '队友已全部阵亡<small>等待下一回合</small>';
    else if (spectating && me.team === 'SPEC') $('spec-info').innerHTML = T ? '自由观战（左侧摇杆移动，右侧滑动转视角）<small>点 ☰ 菜单选择阵营加入游戏</small>' : '自由观战（WASD 移动，空格/Ctrl 升降）<small>按 M 选择阵营加入游戏</small>';
    if (g.frameN % 2 === 0) this.drawRadar();
    if (this.sbOpen && now > this.sbT) { this.sbT = now + 0.5; this.renderScoreboard(); }
    if (this.buyOpen) this.updateBuyMenu();
    this.set('fps', settings.showFps ? `${g.fps} FPS · ${g.net.isLocal ? '本地' : g.ping + ' ms'}` : '');
  }

  updateTop(now) {
    const g = this.g, r = g.round;
    const scT = r.sc ? r.sc.T : 0, scCT = r.sc ? r.sc.CT : 0;
    const dm = g.mode !== 'bomb';
    this.set('score-t', dm ? '' : String(scT));
    this.set('score-ct', dm ? '' : String(scCT));
    this.toggle('score-t', !dm);
    this.toggle('score-ct', !dm);
    const svNow = g.serverNow();
    let left = r.pe > 0 ? Math.max(0, (r.pe - svNow) / 1000) : 0;
    const planted = g.bomb && g.bomb.st === 'planted';
    let label = '';
    if (r.ph === 'warmup') label = '热身';
    else if (r.ph === 'dm') label = '死斗';
    else if (r.ph === 'range') label = '训练场';
    else if (r.ph === 'freeze') label = '购买阶段';
    else if (r.ph === 'matchover') label = '比赛结束';
    else if (r.ph === 'idle') label = '等待玩家';
    else label = `第 ${r.n} / ${r.max} 回合`;
    this.set('round-label', label);
    let txt;
    if (planted && r.ph === 'live') txt = '💣';
    else if ((r.ph === 'warmup' || r.ph === 'range') && r.pe < 0) txt = '∞';
    else txt = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
    this.set('timer', txt);
    this.cls('timer', 'bomb', planted && r.ph === 'live');
    this.cls('timer', 'low', !planted && r.ph === 'live' && left < 10);
    // 存活图标
    if (g.frameN % 10 === 0) {
      const teams = { T: [], CT: [] };
      for (const p of g.players.values()) if (teams[p.team]) teams[p.team].push(p);
      for (const t of ['T', 'CT']) {
        const html = teams[t].sort((a, b) => a.id - b.id).map((p) => `<i class="${p.alive ? t.toLowerCase() : 'dead'}${p.id === g.myId ? ' me' : ''}"></i>`).join('');
        if (this.cache['alive' + t] !== html) { this.cache['alive' + t] = html; $(t === 'T' ? 'alive-t' : 'alive-ct').innerHTML = dm ? '' : html; }
      }
      // 阶段提示
      let banner = '';
      if (r.ph === 'freeze') banner = g.isTouch ? '购买阶段 · 点左上角「购买」' : '购买阶段 · 按 B 打开购买菜单';
      else if (r.ph === 'live' && svNow < r.be && g.canBuy()) banner = `购买时间剩余 ${Math.ceil((r.be - svNow) / 1000)} 秒`;
      this.set('phase-banner', banner);
      this.toggle('phase-banner', !!banner);
      let warm = '';
      if (r.ph === 'warmup') {
        warm = g.isHost() ? (g.isTouch ? '热身阶段 · 你是房主：点 ☰ 菜单「开始比赛」' : '热身阶段 · 你是房主：按 F2 或在 Esc 菜单中「开始比赛」') : '热身阶段 · 等待房主开始比赛';
        if (r.pe > 0) warm += `（${Math.ceil(left)} 秒后自动开始）`;
      } else if (r.ph === 'idle') warm = '请选择阵营开始游戏';
      this.set('warmup-info', warm);
      this.toggle('warmup-info', !!warm);
    }
  }

  updateCrosshair() {
    const g = this.g;
    // 大狙、鸟狙不开镜时没有准星（和 CS2 一样）
    const sniper = g.curWeapon().type === 'sniper';
    const show = g.me.alive && g.w.scope === 0 && !g.paused && !sniper;
    this.cls('crosshair', 'hidden', !show);
    if (!show) return;
    const x = settings.xhair;
    let gap = x.gap;
    if (x.dynamic) gap += g.crosshairSpread();
    const v = Math.round(gap);
    if (this.cache._gap !== v) { this.cache._gap = v; this.xh.style.setProperty('--xg', v + 'px'); }
  }

  refreshCrosshair() { applyCrosshair(this.xh); this.cache._gap = null; }

  // ---------------- 雷达 ----------------
  drawRadar() {
    const g = this.g, ctx = this.rctx, W = 200, c = W / 2;
    const map = g.map;
    ctx.clearRect(0, 0, W, W);
    const cp = g.radarCenter();
    const yaw = cp.yaw;
    const pxPerM = 2.3;
    const imgPpm = 8 / map.S;
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(yaw);
    ctx.scale(pxPerM / imgPpm, pxPerM / imgPpm);
    ctx.translate(-cp.x * imgPpm, -cp.z * imgPpm);
    ctx.globalAlpha = 0.9;
    ctx.drawImage(this.radarImg, 0, 0);
    ctx.globalAlpha = 1;
    const k = imgPpm;
    const inv = imgPpm / pxPerM;
    const dot = (x, z, color, r, ring) => {
      ctx.beginPath();
      ctx.arc(x * k, z * k, r * inv, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      if (ring) { ctx.lineWidth = 1.5 * inv; ctx.strokeStyle = ring; ctx.stroke(); }
    };
    const myTeam = g.me.team;
    const spotBit = myTeam === 'T' ? F.SPOT_T : F.SPOT_CT;
    const dm = g.mode === 'dm';
    for (const p of g.players.values()) {
      if (p.id === g.myId || !p.rp) continue;
      const alive = !!(p.rp.f & F.ALIVE);
      const mate = !dm && p.team === myTeam;
      if (!alive) {
        if (mate && g.now - (p.deathT || 0) < 6) {
          ctx.strokeStyle = p.team === 'CT' ? '#62a0f7' : '#e3a346';
          ctx.lineWidth = 2 * inv;
          const x = p.rp.x * k, z = p.rp.z * k, s = 4 * inv;
          ctx.beginPath(); ctx.moveTo(x - s, z - s); ctx.lineTo(x + s, z + s); ctx.moveTo(x + s, z - s); ctx.lineTo(x - s, z + s); ctx.stroke();
        }
        continue;
      }
      if (mate || myTeam === 'SPEC') {
        dot(p.rp.x, p.rp.z, p.team === 'CT' ? '#62a0f7' : '#e3a346', 4.2, '#000');
        const fx = -Math.sin(p.rp.yaw), fz = -Math.cos(p.rp.yaw);
        ctx.beginPath();
        ctx.moveTo(p.rp.x * k, p.rp.z * k);
        ctx.lineTo((p.rp.x + fx * 3) * k, (p.rp.z + fz * 3) * k);
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1.5 * inv;
        ctx.stroke();
        if (p.rp.f & F.BOMB && myTeam !== 'CT') dot(p.rp.x, p.rp.z, 'rgba(255,60,40,0.9)', 2, null);
      } else if ((!dm && p.rp.f & spotBit) || (dm && g.now - (p.lastShotT || -9) < 1.2)) {
        dot(p.rp.x, p.rp.z, '#ff3b30', 4.2, '#000');
      }
    }
    const b = g.bomb;
    if (b && (b.st === 'planted' || (b.st === 'dropped' && myTeam !== 'CT'))) {
      ctx.fillStyle = b.st === 'planted' && Math.floor(g.now * 4) % 2 ? '#ff3b30' : '#ffd23f';
      const s = 5 * inv;
      ctx.fillRect(b.x * k - s, b.z * k - s * 0.7, s * 2, s * 1.4);
    }
    ctx.restore();
    // 自己
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(c, c - 7);
    ctx.lineTo(c + 5, c + 5);
    ctx.lineTo(c, c + 2);
    ctx.lineTo(c - 5, c + 5);
    ctx.closePath();
    ctx.fill();
  }

  // ---------------- 事件 ----------------
  center(text, dur = 3) {
    this.set('center-msg', text);
    this.centerT = this.g.now + dur;
  }

  // 靶场：命中时在准星旁弹出伤害数字
  damagePop(d, head, kill) {
    const el = document.createElement('div');
    el.className = 'dmg-pop' + (head ? ' hs' : '') + (kill ? ' kill' : '');
    el.textContent = (head ? '爆头 ' : '') + Math.round(d);
    el.style.left = `calc(50% + ${26 + Math.random() * 22}px)`;
    el.style.top = `calc(50% - ${8 + Math.random() * 18}px)`;
    $('hud').appendChild(el);
    setTimeout(() => el.remove(), 950);
  }

  rangeStats(st) {
    const el = $('range-stats');
    el.classList.remove('hidden');
    const acc = st.shots ? Math.min(100, Math.round((st.hits / st.shots) * 100)) : 0;
    const hs = st.hits ? Math.round((st.hs / st.hits) * 100) : 0;
    el.innerHTML = `<b>训练统计</b><span>开枪 ${st.shots}</span><span>命中率 ${acc}%</span><span>爆头率 ${hs}%</span><span>击杀 ${st.kills}</span><button id="rs-reset">清零</button>`;
  }

  // 弹药补满：子弹数闪一下绿色
  ammoRefill() {
    const el = $('ammo-box');
    el.classList.remove('refill');
    void el.offsetWidth;
    el.classList.add('refill');
  }

  hitmarker(hs, kill = false) {
    if (settings.hitmarker === false) return;
    const el = $('hitmarker');
    this.hitT = this.g.now + (kill ? 0.45 : hs ? 0.25 : 0.15);
    el.classList.toggle('hs', !!hs && !kill);
    el.classList.remove('kill');
    if (kill) { void el.offsetWidth; el.classList.add('kill'); }
  }

  // 屏幕中央的击杀提示（连杀会额外显示“双杀/三杀…”）
  killConfirm({ name, team, weapon, hs, streak, reward }) {
    const el = $('kill-banner');
    const st = streak >= 2 ? ['', '', '双杀！', '三杀！', '四杀！', '五杀！'][streak] || `${streak} 连杀！` : '';
    el.innerHTML = `<div class="kb-main${hs ? ' hs' : ''}"><span class="kb-icon">${hs ? '◎' : '✖'}</span><span class="kb-label">${hs ? '爆头击杀' : '击杀'}</span><span class="kb-name ${this.teamCls(team)}">${esc(name)}</span></div>`
      + `<div class="kb-sub">${esc(weaponName(weapon))}${reward ? ` <span class="kb-money">+$${reward}</span>` : ''}</div>`
      + (st ? `<div class="kb-streak s${Math.min(streak, 5)}">${st}</div>` : '');
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    $('kill-icons').innerHTML = '<i>☠</i>'.repeat(Math.min(streak, 10));
  }

  assistNote(name) {
    const el = $('kill-banner');
    el.innerHTML = `<div class="kb-sub assist">助攻 · ${esc(name)}</div>`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  clearKillIcons() {
    $('kill-icons').innerHTML = '';
  }

  // 打比赛挣到金币：钱数下面冒一行小字，短时间内连着挣的加在一起
  coinPop(n) {
    const el = $('coin-pop'), now = this.g.now;
    this.coinSum = now < (this.coinPopT || 0) ? (this.coinSum || 0) + n : n;
    el.textContent = `+${this.coinSum} 金币`;
    el.classList.add('show');
    this.coinPopT = now + 2.5;
  }

  moneyPop(delta) {
    const el = $('money-pop');
    el.textContent = (delta > 0 ? '+$' : '-$') + Math.abs(delta);
    el.classList.toggle('neg', delta < 0);
    el.classList.add('show');
    this.moneyPopT = this.g.now + 2.2;
  }

  damageFrom(ang) {
    const el = document.createElement('div');
    el.className = 'dmg-dir';
    $('dmg-dirs').appendChild(el);
    this.dmgEls.push({ el, ang, t: this.g.now });
    if (this.dmgEls.length > 6) { this.dmgEls[0].el.remove(); this.dmgEls.shift(); }
  }

  teamCls(team) { return this.g.mode === 'dm' ? 'dm-c' : team === 'CT' ? 'ct-c' : 't-c'; }

  killFeed(m) {
    const g = this.g;
    const k = g.players.get(m.k), v = g.players.get(m.v), a = g.players.get(m.as);
    const el = document.createElement('div');
    el.className = 'kf' + (m.k === g.myId || m.v === g.myId || m.as === g.myId ? ' mine' : '');
    let html = '';
    if (k && m.k !== m.v) html += `<span class="${this.teamCls(k.team)}">${esc(k.name)}</span>`;
    if (a) html += `<span class="as">+ ${esc(a.name)}</span>`;
    html += `<span class="w">${esc(m.w === 'knife' && k && k.skin ? knifeLabel(k.skin) : weaponName(m.w))}</span>`;
    if (m.hs) html += '<span class="hs">⌖ 爆头</span>';
    if (v) html += `<span class="${this.teamCls(v.team)}">${esc(v.name)}</span>`;
    el.innerHTML = html;
    $('killfeed').appendChild(el);
    this.feed.push({ el, t: g.now });
    if (this.feed.length > 6) { this.feed[0].el.remove(); this.feed.shift(); }
  }

  chat(m) {
    const el = document.createElement('div');
    el.className = 'chat-line';
    if (m.sys) el.innerHTML = `<span class="sys">${esc(m.text)}</span>`;
    else {
      const tag = (m.dead ? '*死亡* ' : '') + (m.team ? '(队伍) ' : '');
      el.innerHTML = `<span class="${this.teamCls(m.tm)}">${esc(tag + m.n)}</span>: ${esc(m.tx)}`;
    }
    $('chatlog').appendChild(el);
    this.chatLines.push({ el, t: this.g.now });
    if (this.chatLines.length > 8) { this.chatLines[0].el.remove(); this.chatLines.shift(); }
  }

  roundEnd(m) {
    const g = this.g;
    const el = $('round-end');
    el.className = m.w === 'CT' ? 'ct' : 't';
    $('round-end-title').textContent = m.w === 'CT' ? '警察 CT 胜利' : '匪徒 T 胜利';
    const mvp = g.players.get(m.mvp);
    let sub = REASON[m.r] || '';
    if (mvp) sub += ` · MVP：${mvp.name}`;
    if (m.half) sub += ' · 半场结束，即将交换阵营';
    $('round-end-sub').textContent = sub;
    el.classList.remove('hidden');
  }
  hideRoundEnd() { $('round-end').classList.add('hidden'); }

  deathInfo(killer, wid, hs) {
    const el = $('death-info');
    if (!killer) el.innerHTML = '你阵亡了';
    else el.innerHTML = `你被 <b class="${this.teamCls(killer.team)}">${esc(killer.name)}</b> 用 ${esc(weaponName(wid))} 击杀${hs ? '（爆头）' : ''}`;
    el.classList.remove('hidden');
  }
  hideDeath() { $('death-info').classList.add('hidden'); }

  showWeaponList() {
    const g = this.g, me = g.me;
    const rows = [];
    const add = (s, name) => rows.push(`<div class="${me.slot === s ? 'cur' : ''}"><kbd>${s}</kbd>${esc(name)}</div>`);
    if (me.inv[1]) add(1, weaponName(me.inv[1].w));
    if (me.inv[2]) add(2, weaponName(me.inv[2].w));
    add(3, knifeLabel(g.vm.knifeSkin));
    if (me.inv[4].length) add(4, [...new Set(me.inv[4])].map(weaponName).join(' / '));
    if (me.inv[5]) add(5, 'C4 炸弹');
    $('weapon-list').innerHTML = rows.join('');
    this.weaponListT = g.now + 2.2;
  }

  // ---------------- 买枪菜单 ----------------
  buildBuyMenu() {
    const grid = $('buy-grid');
    grid.innerHTML = '';
    BUY_MENU.forEach((col, ci) => {
      const div = document.createElement('div');
      div.className = 'buy-col';
      div.dataset.cat = ci;
      div.innerHTML = `<h4><kbd>${ci + 1}</kbd>${col.cat}</h4>`;
      col.items.forEach((id, ii) => {
        const w = WEAPONS[id] || EQUIP[id];
        const b = document.createElement('button');
        b.className = 'buy-item';
        b.dataset.item = id;
        const team = w.team ? (w.team === 'CT' ? '仅 CT' : '仅 T') : '';
        let stat = '';
        if (w.dmg) stat = `伤害 ${w.dmg}${w.pellets ? '×' + w.pellets : ''} · ${w.mag} 发`;
        b.innerHTML = `<kbd>${ii + 1}</kbd><b>${w.name}</b><span>$${w.price}</span><small>${team} ${stat}</small><i class="buy-rf" title="原价退回">↩ 退款</i>`;
        b.addEventListener('click', (e) => {
          if (e.target.closest('.buy-rf')) { this.g.refund(id); return; }
          this.g.buy(id);
        });
        // 电脑：右键退款（和 CS2 一样）
        b.addEventListener('contextmenu', (e) => { e.preventDefault(); if (b.classList.contains('rf')) this.g.refund(id); });
        div.appendChild(b);
      });
      grid.appendChild(div);
    });
  }

  openBuy() {
    this.buyOpen = true;
    this.buyCat = -1;
    $('buymenu').classList.remove('hidden');
    this.cache._buyState = null;
    this.updateBuyMenu();
  }
  closeBuy() {
    this.buyOpen = false;
    $('buymenu').classList.add('hidden');
  }

  buyKey(n) {
    if (this.buyCat < 0) {
      if (n >= 1 && n <= BUY_MENU.length) this.buyCat = n - 1;
    } else {
      const id = BUY_MENU[this.buyCat].items[n - 1];
      if (id) this.g.buy(id);
      this.buyCat = -1;
    }
    document.querySelectorAll('.buy-col').forEach((el) => el.classList.toggle('active', +el.dataset.cat === this.buyCat));
  }

  updateBuyMenu() {
    const g = this.g, me = g.me;
    const free = g.round.ph === 'warmup' || g.round.ph === 'dm';
    const svNow = g.serverNow();
    const rfs = me.rf || [];
    const state = [me.money, me.team, me.armor, me.helmet, me.kit, me.inv[1] && me.inv[1].w, me.inv[2] && me.inv[2].w, me.inv[4].join(), free, Math.ceil((g.round.be - svNow) / 1000), rfs.join(), g.inBuyZone()].join('|');
    if (this.cache._buyState === state) return;
    this.cache._buyState = state;
    this.set('buy-money', '$' + me.money);
    let tip = free ? '热身/死斗：免费购买' : '';
    if (!free && rfs.length && g.canBuy()) tip = (g.isTouch ? '点“↩ 退款”' : '右键或点“↩ 退款”') + '可以原价退回这回合买的东西 · ';
    if (!free) {
      if (g.round.ph === 'freeze') tip += '购买阶段';
      else if (g.round.ph === 'live' && svNow < g.round.be) tip += `购买时间剩余 ${Math.ceil((g.round.be - svNow) / 1000)} 秒`;
      else tip = '购买时间已结束';
      if (!g.inBuyZone()) tip += ' · 不在购买区';
    }
    this.set('buy-time', tip);
    for (const b of document.querySelectorAll('.buy-item')) {
      const id = b.dataset.item;
      const w = WEAPONS[id] || EQUIP[id];
      let price = w.price;
      if (id === 'vesthelm' && me.armor >= 100) price = 350;
      const teamBad = w.team && w.team !== me.team && g.mode === 'bomb';
      const owned = (me.inv[1] && me.inv[1].w === id) || (me.inv[2] && me.inv[2].w === id) || (id === 'kit' && me.kit) || (id === 'vest' && me.armor >= 100) || (id === 'vesthelm' && me.armor >= 100 && me.helmet);
      const canRf = !free && rfs.includes(id) && g.canBuy();
      b.disabled = !canRf && (teamBad || (!free && price > me.money) || (g.mode === 'dm' && WEAPONS[id] && WEAPONS[id].slot === 4));
      b.classList.toggle('owned', !!owned);
      b.classList.toggle('rf', canRf);
      b.querySelector('span').textContent = free ? '免费' : '$' + price;
    }
  }

  // ---------------- 记分板 ----------------
  openScoreboard() { this.sbOpen = true; this.sbT = 0; $('scoreboard').classList.remove('hidden'); }
  closeScoreboard() { this.sbOpen = false; $('scoreboard').classList.add('hidden'); }

  scoreboardHTML() {
    const g = this.g;
    const rows = (list, showMoney) => list.map((p) => `<div class="sb-row${p.alive ? '' : ' dead'}${p.id === g.myId ? ' me' : ''}">
      <span class="nm">${esc(p.name)}${p.bot ? '<i>BOT</i>' : ''}${p.id === g.hostId ? '<i>👑房主</i>' : ''}</span>
      <span>${p.k || 0}</span><span>${p.d || 0}</span><span>${p.a || 0}</span><span>${p.sc || 0}</span><span>${p.mv ? '★' + p.mv : ''}</span>
      <span>${showMoney ? '$' + (p.money ?? 0) : ''}</span><span>${p.bot ? 'BOT' : (p.ping ?? 0) + 'ms'}</span></div>`).join('');
    const head = '<div class="sb-row head"><span>玩家</span><span>击杀</span><span>死亡</span><span>助攻</span><span>得分</span><span>MVP</span><span>金钱</span><span>延迟</span></div>';
    const all = [...g.players.values()];
    const sort = (a, b) => (b.sc || 0) - (a.sc || 0) || (b.k || 0) - (a.k || 0);
    if (g.mode !== 'bomb') {
      return `<div class="sb-team"><div class="sb-team-head"><span>${g.mode === 'range' ? '训练场' : '死斗排行'}</span><span></span></div>${head}${rows(all.filter((p) => p.team !== 'SPEC').sort((a, b) => (b.k || 0) - (a.k || 0)), false)}</div>`;
    }
    const sc = g.round.sc || { T: 0, CT: 0 };
    let html = '';
    for (const t of ['CT', 'T']) {
      html += `<div class="sb-team ${t.toLowerCase()}"><div class="sb-team-head"><span>${TEAM_NAME[t]}</span><span>${sc[t]}</span></div>${head}${rows(all.filter((p) => p.team === t).sort(sort), t === g.me.team)}</div>`;
    }
    const spec = all.filter((p) => p.team === 'SPEC');
    if (spec.length) html += `<div class="sb-team spec"><div class="sb-team-head"><span>观战</span><span>${spec.map((p) => esc(p.name)).join('、')}</span></div></div>`;
    return html;
  }

  renderScoreboard() {
    const g = this.g;
    $('sb-body').innerHTML = this.scoreboardHTML();
    $('sb-title').textContent = `${g.map.name} · ${g.mode === 'dm' ? '死斗' : g.mode === 'range' ? '训练场' : '爆破模式'}`;
    $('sb-info').textContent = g.net.isLocal ? '单机练习' : `房间 ${g.code} · ${g.roomName}`;
  }

  matchEnd(m) {
    const g = this.g;
    if (g.mode === 'dm') {
      const w = g.players.get(m.w);
      $('me-title').textContent = w ? `🏆 ${w.name} 获得死斗第一` : '死斗结束';
      $('me-score').textContent = '';
    } else {
      $('me-title').textContent = m.w === 'draw' ? '平局' : m.w === g.me.team ? '🏆 胜利！' : m.w === 'CT' ? '警察 CT 赢得比赛' : '匪徒 T 赢得比赛';
      $('me-score').innerHTML = `<span class="ct-c">${m.sc.CT}</span> : <span class="t-c">${m.sc.T}</span>`;
    }
    $('me-body').innerHTML = this.scoreboardHTML();
    $('matchend').classList.remove('hidden');
  }
  hideMatchEnd() { $('matchend').classList.add('hidden'); }
}
