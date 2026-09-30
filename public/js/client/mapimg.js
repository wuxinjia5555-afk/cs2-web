// 地图俯视图（雷达与菜单预览共用），纯 2D Canvas
import { CELL } from '../shared/maps.js';

export function mapImage(map, ppc = 8, opts = {}) {
  const c = document.createElement('canvas');
  c.width = map.W * ppc;
  c.height = map.H * ppc;
  const ctx = c.getContext('2d');
  const { W, H } = map;
  for (let r = 0; r < H; r++) {
    for (let col = 0; col < W; col++) {
      const i = r * W + col;
      const t = map.type[i];
      let fill;
      if (t === CELL.WALL) fill = map.wh && map.wh[i] ? '#46505e' : 'rgba(0,0,0,0)';
      else if (t === CELL.CRATE || t === CELL.CRATE2) fill = t === CELL.CRATE ? '#7a6548' : '#5e4d37';
      else if (t === CELL.LOW) fill = '#8a7c5e';
      else if (t === CELL.BARREL) fill = '#7b3a2d';
      else {
        const l = 84 + map.level[i] * 16;
        fill = `rgb(${l},${l + 6},${l + 14})`;
      }
      ctx.fillStyle = fill;
      ctx.fillRect(col * ppc, r * ppc, ppc, ppc);
    }
  }
  // 墙边描线
  ctx.fillStyle = 'rgba(210,220,235,0.55)';
  const e = Math.max(1, ppc / 6);
  for (let r = 0; r < H; r++) {
    for (let col = 0; col < W; col++) {
      if (map.type[r * W + col] !== CELL.WALL) continue;
      const nb = (dc, dr) => {
        const cc = col + dc, rr = r + dr;
        return cc >= 0 && rr >= 0 && cc < W && rr < H && map.type[rr * W + cc] !== CELL.WALL;
      };
      if (nb(1, 0)) ctx.fillRect((col + 1) * ppc - e, r * ppc, e, ppc);
      if (nb(-1, 0)) ctx.fillRect(col * ppc, r * ppc, e, ppc);
      if (nb(0, 1)) ctx.fillRect(col * ppc, (r + 1) * ppc - e, ppc, e);
      if (nb(0, -1)) ctx.fillRect(col * ppc, r * ppc, ppc, e);
    }
  }
  const k = ppc / map.S;
  if (opts.zones !== false) {
    for (const [team, zones] of Object.entries(map.buy)) {
      ctx.fillStyle = team === 'T' ? 'rgba(227,163,70,0.18)' : 'rgba(98,160,247,0.18)';
      for (const z of zones) ctx.fillRect(z.x0 * k, z.z0 * k, (z.x1 - z.x0) * k, (z.z1 - z.z0) * k);
    }
  }
  for (const s of Object.values(map.sites)) {
    ctx.fillStyle = 'rgba(220,50,40,0.22)';
    ctx.fillRect(s.x0 * k, s.z0 * k, (s.x1 - s.x0) * k, (s.z1 - s.z0) * k);
    ctx.fillStyle = 'rgba(255,90,70,0.9)';
    ctx.font = `900 ${Math.round(ppc * 3.2)}px "Arial Black", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s.name, s.cx * k, s.cz * k);
  }
  return c;
}
