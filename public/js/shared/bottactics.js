// 地图战术：使用可走路径、真实视线和已知情报；与瞄准难度分开。
import { P, TIMES } from './constants.js';
import { WEAPONS } from './weapons.js';

const postsCache = new WeakMap(), defuseCache = new WeakMap();
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export function routeDistance(r, p, x, z) {
  const nav = r.nav, goal = nav.nearestWalkable(x, z);
  let start = nav.nearestWalkable(p.x, p.z, p.y, true), length = 0, last = p;
  if (start < 0 && nav.lower) {
    const out = nav.lower.wayOut(p.x, p.z, p.y);
    if (!out) return Infinity;
    for (const cell of out) { const c = nav.lower.center(cell); length += distance(last, c); last = c; }
    start = nav.nearestWalkable(last.x, last.z, last.y);
  }
  const cells = nav.findPath(start, goal);
  if (!cells) return Infinity;
  for (const cell of cells) { const c = nav.center(cell); length += distance(last, c); last = c; }
  return length + distance(last, { x, z });
}
export function coverAt(r, c) {
  let cover = 0;
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4;
    const h = r.world.raycast(c.x, c.y + 1.1, c.z, Math.cos(a), 0, Math.sin(a), 2.4);
    if (h) cover += 1 - h.t / 3;
  }
  return cover;
}

// 从来敌路线提取入口；选能看见入口、身侧有掩体的站位。结果按地图缓存。
export function defensePosts(r, siteName, incomingTeam) {
  let cache = postsCache.get(r.map);
  if (!cache) postsCache.set(r.map, cache = new Map());
  const key = siteName + incomingTeam;
  if (cache.has(key)) return cache.get(key);
  const site = r.map.sites[siteName], nav = r.nav;
  if (!site?.cells.length) return [];
  const center = { x: site.cx, z: site.cz }, goal = nav.nearestWalkable(site.cx, site.cz);
  const radius = Math.max(site.x1 - site.x0, site.z1 - site.z0) / 2 + 4;
  const starts = r.map.spawns[incomingTeam].filter((_, k) => k % 3 === 0);
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4, cell = nav.nearestWalkable(center.x + Math.cos(a) * (radius + 14), center.z + Math.sin(a) * (radius + 14));
    if (cell >= 0) starts.push(nav.center(cell));
  }
  const lanes = [];
  for (const start of starts) {
    const path = nav.findPath(nav.nearestWalkable(start.x, start.z), goal);
    if (!path) continue;
    const index = path.findIndex(c => distance(nav.center(c), center) < radius);
    if (index <= 0) continue;
    const watch = nav.center(path[Math.max(0, index - Math.ceil(2 / nav.S))]);
    if (lanes.every(c => distance(c, watch) > 4)) lanes.push(watch);
  }
  const cells = nav.walkList.filter(c => distance(nav.center(c), center) < radius + 5);
  const stride = Math.max(1, Math.ceil(cells.length / 150)), candidates = [];
  for (let k = 0; k < cells.length; k += stride) {
    const cell = cells[k], point = nav.center(cell), cover = coverAt(r, point);
    for (let lane = 0; lane < lanes.length; lane++) {
      const watch = lanes[lane], dist = distance(point, watch);
      if (dist < 4 || dist > 26 || !r.world.clear(point.x, point.y + P.standEye, point.z, watch.x, watch.y + 1.3, watch.z)) continue;
      const dx = (watch.x - point.x) / dist, dz = (watch.z - point.z) / dist;
      // 不把最高分的窄门中心当架点：身侧至少还能留一个队友的通行身位。
      if (![-1, 1].some(side => nav.clearAt(point.x - dz * 1.15 * side, point.z + dx * 1.15 * side, point.y))) continue;
      const score = cover * 2.5 - Math.abs(dist - 11) * 0.12 - distance(point, center) * 0.06;
      candidates.push({ cell, point, watch, cover, lane, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const posts = [];
  // 每条入口先分配一个，随后补互相有身位间隔的站位。
  for (let lane = 0; lane < lanes.length; lane++) {
    const post = candidates.find(c => c.lane === lane && posts.every(p => distance(p.point, c.point) > 2.5));
    if (post) posts.push(post);
  }
  for (const post of candidates) {
    if (posts.length >= 12) break;
    if (posts.every(p => distance(p.point, post.point) > 2.5)) posts.push(post);
  }
  if (!posts.length) {
    const point = nav.center(site.cells[0]);
    posts.push({ cell: site.cells[0], point, watch: lanes[0] || r.map.spawns[incomingTeam][0], cover: coverAt(r, point), lane: 0 });
  }
  cache.set(key, posts);
  return posts;
}

export function choosePost(brain, siteName, incomingTeam) {
  const r = brain.room, p = brain.p, posts = defensePosts(r, siteName, incomingTeam);
  let best = null, score = -Infinity;
  for (let k = 0; k < posts.length; k++) {
    const post = posts[k];
    let s = post.cover - distance(p, post.point) * 0.015 + (k === p.id % Math.min(4, posts.length) ? 2 : 0);
    for (const q of r.players.values()) {
      if (q !== p && q.alive && q.team === p.team && q.bot?.holdPost?.cell === post.cell) s -= 8;
    }
    if (s > score) { score = s; best = post; }
  }
  return best;
}

// 同队共用一次评估：有钳子的近处队友优先拆，其他人掩护。
export function bestDefuser(r) {
  const b = r.bomb;
  if (!b || b.st !== 'planted') return null;
  if (b.defuser != null) {
    const p = r.players.get(b.defuser);
    if (p?.alive && p.defusing && p.defuseEnd + 0.15 < b.explodeAt) return p;
  }
  const cached = defuseCache.get(r);
  if (cached && cached.bomb === b && r.time < cached.until && (!cached.player || cached.player.alive)) return cached.player;
  let best = null, shortest = Infinity;
  for (const p of r.players.values()) {
    if (!p.alive || p.team !== 'CT' || !p.isBot || p.dummy) continue;
    const dist = Math.max(0, routeDistance(r, p, b.x, b.z) - 1.3);
    const travel = dist / Math.max(3.5, WEAPONS[p.inv[1]?.w]?.speed || 5.5);
    const eta = travel + (p.kit ? TIMES.defuseKit : TIMES.defuse) + 0.65;
    if (eta < b.explodeAt - r.time && eta < shortest) { shortest = eta; best = p; }
  }
  defuseCache.set(r, { bomb: b, until: r.time + 0.6, player: best });
  return best;
}

export function escapeRadius(p) {
  // 爆炸伤害 500 * exp(-d² / (2 * 11²))；留出余量，不能只躲在墙后。
  return Math.max(30, 11 * Math.sqrt(2 * Math.log(500 / Math.max(1, p.hp * 0.45))) + 2);
}
export function retreatPost(brain, bomb = null) {
  const r = brain.room, p = brain.p, nav = r.nav, safe = bomb ? escapeRadius(p) : 0;
  const threats = [];
  if (brain.lastSeen && r.time - brain.lastSeenT < 6) threats.push(brain.lastSeen);
  if (brain.alertPos && r.time - brain.alertT < 4) threats.push(brain.alertPos);
  for (const e of r.intel[p.team]?.values() || []) if (r.time - e.t < 4) threats.push(e);
  const candidates = [], stride = Math.max(1, Math.ceil(nav.walkList.length / 100));
  for (let k = 0; k < nav.walkList.length; k += stride) {
    const cell = nav.walkList[k], point = nav.center(cell);
    if (bomb && distance(point, bomb) < safe) continue;
    const cover = coverAt(r, point);
    let score = cover * 2 - distance(p, point) * 0.2;
    for (const e of threats) {
      score += Math.min(40, distance(point, e)) * 0.05;
      if (r.world.clear(point.x, point.y + P.standEye, point.z, e.x, (e.y || 0) + 1.3, e.z)) score -= 5;
    }
    candidates.push({ cell, point, cover, score, watch: threats[0] || bomb || r.map.spawns[p.team === 'T' ? 'CT' : 'T'][0] });
  }
  candidates.sort((a, b) => b.score - a.score);
  let best = null, score = -Infinity;
  for (const c of candidates.slice(0, 8)) {
    const route = routeDistance(r, p, c.point.x, c.point.z);
    const s = c.score - route * 0.12;
    if (Number.isFinite(route) && s > score) { score = s; best = { ...c, route }; }
  }
  return best;
}
