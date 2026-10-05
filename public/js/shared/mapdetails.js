// 地图环境细节：全部程序生成；尺寸用米，实体掩体交给同一套碰撞 / 寻路。
// 点位与路线参考见「地图优化记录.md」，没有打包任何原游戏素材。
export const MAP_VIEWS = {
  dust2: {
    spawn: ['T 家 / 后花园', 40, null, 100, Math.PI / 2, 0],
    tunnels: ['上层地道', 20, null, 59, 0, 0],
    mid: ['中门 / Xbox', 51, null, 42, 0, 0],
    short: ['A 小 / 猫道', 71, null, 42, 0, 0],
    long: ['A 大街景', 98, null, 55, 0, 0],
    a: ['A 点', 85, null, 20, -0.6, 0],
    b: ['B 点 / 脚手架', 20, null, 29, 0, 0],
    ct: ['警家 / A 大出口', 64.5, null, 27.5, -Math.PI / 2, 0],
  },
  mirage: {
    mid: ['中路 / VIP', 76, null, 59, Math.PI / 2, 0],
    window: ['VIP 狙击窗', 47, null, 58.5, -Math.PI / 2, 0],
    a: ['A 点 / Palace', 65, null, 103, -0.75, 0],
    palace: ['宫殿内部', 101.35, null, 101.35, Math.PI / 2, 0],
    b: ['B 点 / 公寓', 36, null, 36, 1.4, 0],
    market: ['超市内部 / 收银台', 35.8, null, 46.5, 1.8, 0],
    apps: ['B 公寓', 67.8, null, 28.2, Math.PI / 2, 0],
    underpass: ['地下通道', 55.8, 2.03, 47, Math.PI, 0],
  },
  inferno: {
    spawn: ['匪口', 34, null, 75, -Math.PI / 2, 0],
    banana: ['香蕉道 / 石板', 47, null, 54, 0, 0],
    upper: ['香蕉道上半段', 59, null, 39, 0, 0],
    sandbags: ['香蕉道 / 沙袋凹槽', 59.5, null, 32.5, -Math.PI / 2, 0],
    b: ['B 点 / 喷泉 / 棺材', 59, null, 25, 0.4, 0],
    second: ['侧道 / 匪二楼', 45, null, 82, -Math.PI / 2, 0],
    apps: ['匪二楼', 55, null, 70, -Math.PI / 2, 0],
    kitchen: ['匪二楼 / 厨房', 55, null, 73, 0, 0],
    t: ['T 家 / 拱廊', 14, null, 74, Math.PI / 2, 0],
    a: ['A 点 / 墓地 / 大坑', 83, null, 56, Math.PI, 0],
    arch: ['拱门 / 书房', 79, null, 39, Math.PI, 0],
  },
  sandstorm: { a: ['A 大', 69, null, 44, 0, 0], b: ['B 点', 13, null, 21, 0, 0], mid: ['中路', 38, null, 50, 0, 0] },
  depot: { hall: ['中央仓库', 32, null, 43, 0, 0], a: ['A 装卸区', 55, null, 30, 0, 0], b: ['B 装卸平台', 15, null, 29, 0, 0] },
  arena: { center: ['中央掩体', 31, null, 37, 0, 0], spawn: ['出生区', 5, null, 11, -Math.PI / 2, 0] },
  range: { lanes: ['靶道 / 距离标牌', 29, null, 83, 0, 0] },
};

// 简单曲面也合并到贴图桶里，一张地图不会给每个花盆 / 灯柱单开 draw call。
function round(b, x, y, z, radius, height, mat, top = radius) {
  b.deco.push({ shape: 'round', x, y, z, radius, top, height, mat });
}
function ball(b, x, y, z, radius, mat) {
  b.deco.push({ shape: 'ball', x, y, z, radius, mat });
}
// 碰撞引擎使用 AABB；细条贴合渲染用的十边形，去掉方形盆的空角。
function diskCollider(b, x, y, z, radius, height) {
  const polygon = Array.from({ length: 10 }, (_, k) => [Math.cos(k * Math.PI / 5) * radius, Math.sin(k * Math.PI / 5) * radius]);
  const edges = [...new Set(polygon.map((p) => p[0]))].sort((a, c) => a - c);
  const extent = (u) => {
    const zs = [];
    for (let k = 0; k < polygon.length; k++) {
      const a = polygon[k], c = polygon[(k + 1) % polygon.length];
      if (Math.abs(c[0] - a[0]) < 1e-8) { if (Math.abs(u - a[0]) < 1e-8) zs.push(a[1], c[1]); }
      else if (u >= Math.min(a[0], c[0]) - 1e-8 && u <= Math.max(a[0], c[0]) + 1e-8) zs.push(a[1] + (c[1] - a[1]) * (u - a[0]) / (c[0] - a[0]));
    }
    return [Math.min(...zs), Math.max(...zs)];
  };
  for (let k = 0; k < edges.length - 1; k++) {
    const start = edges[k], end = edges[k + 1];
    if (end - start < 1e-8) continue;
    const count = Math.ceil((end - start) / 0.12);
    for (let j = 0; j < count; j++) {
      const a = start + (end - start) * j / count, c = start + (end - start) * (j + 1) / count;
      const za = extent(a), zc = extent(c);
      b.box(x + a, y, z + Math.min(za[0], zc[0]), x + c, y + height, z + Math.max(za[1], zc[1]), 'stone', 'collision');
    }
  }
}
function face(b, x, y, z, width, height, normal, mat) {
  const east = normal === 'e' || normal === 'w', d = 0.055;
  // 手工核对的门窗优先，避免通用外墙的随机百叶窗叠到卷帘网门上。
  const min = [east ? x - 0.16 : x - width / 2, y - 0.15, east ? z - width / 2 : z - 0.16];
  const max = [east ? x + 0.16 : x + width / 2, y + height, east ? z + width / 2 : z + 0.16];
  b.deco = b.deco.filter(o => !o.facade || !min.every((v, k) => v < o.max[k] && max[k] > o.min[k]));
  b.decor(east ? x - d : x - width / 2, y, east ? z - width / 2 : z - d,
    east ? x + d : x + width / 2, y + height, east ? z + width / 2 : z + d, mat, 'box');
}
function window(b, x, y, z, normal, mat = 'shutter_w') {
  face(b, x, y, z, 1.15, 1.5, normal, mat);
  face(b, x, y - 0.13, z, 1.4, 0.13, normal, 'stone');
}
function lamp(b, x, y, z, normal = 'e') {
  const dx = normal === 'e' ? 1 : normal === 'w' ? -1 : 0;
  const dz = normal === 's' ? 1 : normal === 'n' ? -1 : 0;
  b.decor(x - 0.045, y, z - 0.045, x + 0.045, y + 0.55, z + 0.045, 'iron');
  const lx = x + dx * 0.4, lz = z + dz * 0.4;
  b.decor(Math.min(x, lx) - 0.035, y + 0.47, Math.min(z, lz) - 0.035, Math.max(x, lx) + 0.035, y + 0.54, Math.max(z, lz) + 0.035, 'iron');
  b.decor(lx - 0.16, y + 0.12, lz - 0.16, lx + 0.16, y + 0.44, lz + 0.16, 'lampglass');
  b.decor(lx - 0.2, y + 0.44, lz - 0.2, lx + 0.2, y + 0.5, lz + 0.2, 'iron');
}
function palm(b, x, y, z, height = 6) {
  round(b, x, y, z, 0.17, height, 'bark', 0.1);
  ball(b, x, y + height, z, 0.3, 'foliage');
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4;
    b.deco.push({ shape: 'frond', x, y: y + height, z, angle: a, length: 2.6, mat: 'foliage' });
  }
}
function planter(b, x, y, z, width = 1.2) {
  b.decor(x, y, z, x + width, y + 0.38, z + 0.35, 'terracotta');
  for (let k = 0; k < 4; k++) ball(b, x + width * (k + 0.5) / 4, y + 0.54, z + 0.17, 0.19, 'foliage');
}
function trim(b, x0, z0, x1, z1, y, mat = 'stone') {
  b.decor(x0, y, z0, x1, y + 0.16, z1, mat);
}
function arch(b, x, y, z, width, height, normal, mat = 'stone') {
  const east = normal === 'e' || normal === 'w', half = width / 2;
  const put = (a0, a1, h0, h1) => b.decor(east ? x - 0.12 : x + a0, y + h0, east ? z + a0 : z - 0.12,
    east ? x + 0.12 : x + a1, y + h1, east ? z + a1 : z + 0.12, mat);
  put(-half - 0.2, -half, 0, height); put(half, half + 0.2, 0, height);
  for (let k = 0; k < 12; k++) {
    const a0 = k / 12 * width - half, a1 = (k + 1) / 12 * width - half;
    const h = height - 0.35 + Math.sqrt(Math.max(0, 1 - ((a0 + a1) / width) ** 2)) * 0.35;
    put(a0, a1, h, h + 0.23);
  }
}
function railing(b, x0, z0, x1, z1, y) {
  const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.55);
  for (let k = 0; k <= steps; k++) {
    const x = x0 + (x1 - x0) * k / steps, z = z0 + (z1 - z0) * k / steps;
    b.decor(x - 0.027, y, z - 0.027, x + 0.027, y + 1.0, z + 0.027, 'iron');
  }
  trim(b, Math.min(x0, x1) - 0.04, Math.min(z0, z1) - 0.04, Math.max(x0, x1) + 0.04, Math.max(z0, z1) + 0.04, y + 0.95, 'iron');
}

function stringLights(b, x0, z0, x1, z1, y) {
  const n = 12;
  for (let k = 0; k < n; k++) {
    const t0 = k / n, t1 = (k + 1) / n;
    const xa = x0 + (x1 - x0) * t0, za = z0 + (z1 - z0) * t0;
    const xb = x0 + (x1 - x0) * t1, zb = z0 + (z1 - z0) * t1;
    const yy = y - Math.sin((t0 + t1) * Math.PI / 2) * 0.28;
    b.decor(Math.min(xa, xb) - 0.015, yy, Math.min(za, zb) - 0.015, Math.max(xa, xb) + 0.015, yy + 0.025, Math.max(za, zb) + 0.015, 'iron');
    ball(b, (xa + xb) / 2, yy - 0.09, (za + zb) / 2, 0.065, 'lampglass');
  }
}
// 跑图中可辨认的近景道具；造型与贴图均为本项目程序生成。
function bench(b, x, y, z, width = 1.7) {
  b.decor(x, y + 0.48, z, x + width, y + 0.57, z + 0.4, 'darkwood');
  b.decor(x, y + 0.57, z + 0.36, x + width, y + 1.0, z + 0.43, 'darkwood');
  for (const dx of [0.12, width - 0.2]) b.decor(x + dx, y, z + 0.03, x + dx + 0.08, y + 0.48, z + 0.35, 'iron');
}
function pipe(b, x, y, z, height) { round(b, x, y, z, 0.045, height, 'iron'); }
function shelf(b, x, y, z, width, normal) {
  face(b, x, y, z, width, 2.1, normal, 'shop_shelves');
  for (const dy of [0.45, 1.0, 1.55, 2.1]) face(b, x, y + dy, z, width, 0.07, normal, 'metal');
}
function videoDetails(b, id) {
  if (id === 'inferno') {
    // 38–65 秒：香蕉道灰石墙裙、红色酒馆、网门和沙袋凹槽。
    b.wallMat(55, 27, 56, 41, 'stucco_r'); b.wallMat(63, 28, 66, 41, 'stucco_r');
    b.wallMat(43, 41, 54, 42, 'stucco_p');
    face(b, 62.96, 2.65, 39.5, 2.5, 2.5, 'w', 'shop_grille');
    face(b, 62.91, 5.3, 39.5, 2.9, 0.5, 'w', 'wine_sign');
    face(b, 65.98, 3.2, 35.8, 2.5, 2.4, 'w', 'shop_grille');
    for (let row = 0; row < 4; row++) for (let col = 0; col < 3; col++) {
      b.deco.push({ shape: 'ball', x: 64.3 + col * 0.6, y: 3.16 + row * 0.31, z: 33.53,
        radius: 1, scale: [0.32, 0.19, 0.52], mat: 'jute' });
    }
    face(b, 56.03, 3.3, 35, 1.25, 2.45, 'e', 'housedoor');
    for (const z of [30, 37, 40]) { window(b, 56.03, 6.2, z, 'e', 'shutter'); pipe(b, 62.94, 3.1, z, 4.2); }
    trim(b, 56, 27.92, 63, 28.05, 4.15, 'stone');
    for (const z of [42.5, 57.5]) planter(b, 43.05, 2.8, z, 0.8);
    // 71–118 秒：匪口的黄墙、台阶旁花槽、T 家红砖拱廊和侧道药店。
    b.wallMat(30, 56, 42, 58, 'stucco_y'); b.wallMat(29, 79, 42, 86, 'stucco_y');
    b.floorMat(5, 60, 10, 80, 'redtiles');
    for (const z of [63, 67, 71, 75, 79]) arch(b, 10.7, 0, z, 2.7, 3.0, 'e');
    bench(b, 5.2, 0, 69); planter(b, 29.8, 1.65, 78.5, 1.7);
    face(b, 49, 1.2, 78.97, 2.8, 2.4, 's', 'shop_grille');
    face(b, 49, 3.75, 78.94, 3.1, 0.5, 's', 'pharmacy_sign');
    face(b, 59, 1.2, 85.98, 2.7, 2.35, 'n', 'garage');
    // 110–151 秒：厨房的木梁、红色高凳、走廊暖灯与锅炉房框画。
    for (const x of [53, 57, 60]) trim(b, x, 68, x + 0.16, 77, 7.5, 'darkwood');
    face(b, 54.5, 4.9, 68.05, 3.3, 1.5, 's', 'cupboard');
    for (const x of [58.0, 59.3]) {
      round(b, x, 4.8, 70.8, 0.035, 0.68, 'iron'); round(b, x, 5.48, 70.8, 0.24, 0.08, 'paint_o');
    }
    lamp(b, 60.02, 6.3, 72, 'e'); face(b, 75.96, 4.4, 63.4, 1.2, 0.75, 'w', 'framed_print');
    face(b, 75.96, 4.4, 65.1, 1.2, 0.75, 'w', 'framed_print');
    // 12、25、199 秒：教堂/包点有红砖地带，喷泉外圈和 A 区墙裙。
    b.floorMat(44, 8, 62, 27, 'redtiles'); b.floorMat(80, 58, 92, 69, 'redtiles');
    for (const z of [12, 17, 23]) arch(b, 46.7, 4, z, 3.9, 3.05, 'e');
    bench(b, 64.3, 3, 22.8, 2.0);
    for (const z of [59, 68, 74]) face(b, 97.96, 3.2, z, 1.3, 2.1, 'w', 'housedoor');
    for (const z of [61, 65]) round(b, 81.0, 5.15, z, 0.38, 0.7, 'cask');
  } else if (id === 'dust2') {
    // 6–18 秒：T 家浅色街面、灰色垃圾桶与后花园坡道，树在场外。
    b.floorMat(28, 94, 56, 108, 'sand');
    face(b, 39, 6.0, 97.04, 3.0, 2.6, 's', 'garage');
    for (const x of [29, 35, 40]) window(b, x, 9.3, 97.03, 's', 'shutter_w');
    palm(b, 27, 5.6, 85.5, 7.2);
    // 30–42 秒：洞内暖色粗石、分段梁柱和铺石地面。
    b.floorMat(8, 37, 48, 67, 'pavers'); b.wallMat(7, 35, 36, 67, 'tunnelstone');
    for (const z of [40, 46, 52, 60]) arch(b, 20.5, 4, z, 4.5, 2.9, 's', 'tunnelstone');
    // 82 秒：B 后台棚架，横梁/木板平台贴着后台的墙。
    for (const x of [9.15, 14.8]) trim(b, x - 0.05, 9.2, x + 0.05, 12.6, 7.15, 'darkwood');
    trim(b, 9, 11.7, 15, 12.6, 6.8, 'plywood');
    // 164、206、226 秒：门楼石框、小道转角墙裙与忍者位的木箱。
    arch(b, 75.05, 2.4, 72, 3.5, 3.2, 'e', 'tunnelstone');
    arch(b, 79, 2.4, 62.03, 3.5, 3.2, 's', 'tunnelstone');
    b.wallMat(68, 31, 78, 42, 'stucco_o');
    for (const z of [32, 40]) face(b, 75.96, 2.4, z, 2.0, 1.1, 'w', 'stone');
    face(b, 96.0, 4.0, 4.05, 3.0, 2.3, 's', 'housedoor_b');
    trim(b, 84.05, 4, 84.18, 20, 5.2, 'stone');
  } else if (id === 'mirage') {
    const S = b.S;
    // 5、85、115 秒：警家和 VIP 外墙蓝/粉两色，窗内是暖白墙而非木屋。
    b.wallMat(60, 151, 92, 204, 'paint_b'); b.wallMat(82, 103, 98, 124, 'stucco_p');
    b.floorMat(89, 111, 96, 119, 'tiles');
    for (const c of [90, 94]) window(b, c * S, 5.6, 120 * S, 'n', 'shutter_w');
    // 75–95 秒：宫殿走廊柱框和暖色墙裙；出口下面有连续支架。
    for (const c of [184, 198, 214]) arch(b, c * S, 6.4, 195 * S, 3.1, 2.65, 'e');
    for (const c of [176, 223]) trim(b, c * S, 182 * S, c * S + 0.1, 206 * S, 6.7, 'stone');
    // 65 秒：A 点三箱上的圆形罐/黄色弹药筒，附着既有掩体、不新堵通路。
    for (const r of [187, 190, 193]) for (const y of [5.5, 6.2, 6.9]) {
      round(b, 132.8 * S, y, r * S, 0.28, 0.65, 'metal');
      ball(b, 133.4 * S, y + 0.28, r * S, 0.22, 'paint_y');
      b.box(132.8 * S - 0.28, y, r * S - 0.28, 132.8 * S + 0.28, y + 0.65, r * S + 0.28, 'metal', 'collision');
      b.box(133.4 * S - 0.22, y + 0.06, r * S - 0.22, 133.4 * S + 0.22, y + 0.5, r * S + 0.22, 'metal', 'collision');
    }
    // 145–180 秒：超市的绿色室内、货架、灯管和收银台，位置沿现有墙边。
    for (const c of [51.5, 65.5]) arch(b, c * S, 3.2, 72 * S, 6.1, 2.9, 'e');
    for (const r of [64.5, 79.5]) arch(b, 58.5 * S, 3.2, r * S, 5.6, 2.9, 's');
    b.wallMat(55, 90, 83, 110, 'marketwall');
    shelf(b, 69 * S, 3.2, 87 * S + 0.06, 3.2, 's'); shelf(b, 83 * S - 0.06, 3.2, 93 * S, 3.0, 'w');
    trim(b, 67 * S, 93 * S, 73 * S, 93 * S + 0.3, 6.1, 'lampglass');
    face(b, 59 * S + 0.02, 4.45, 95 * S, 0.6, 0.3, 'e', 'metalbox');
    // 125–135 秒：中路沙袋上方的棕榈，与桥头/连接的石拱。
    palm(b, 147 * S, 3.2, 100 * S, 6.5);
    arch(b, 116 * S, 3.2, 137 * S, 3.2, 2.8, 's');
  }
}
export function dressMap(b, id) {
  switch (id) {
    case 'dust2': {
      // T 家的街区、足球与垃圾桶；场外棕榈不占玩家通路。
      b.wallMat(12, 83, 69, 112, 'stucco_w');
      b.floorMat(28, 94, 56, 108, 'pavers');
      b.facade({ every: 7, rows: 1, doors: 0.12, mats: ['shutter_w', 'shutter_b'] });
      ball(b, 33.4, 5.84, 99.4, 0.23, 'football');
      round(b, 28.8, 5.6, 96.8, 0.34, 0.95, 'metalbox');
      round(b, 28.8, 6.55, 96.8, 0.37, 0.06, 'iron');
      palm(b, 26.2, 5.6, 93, 7); palm(b, 110.3, 2.4, 39, 6.5);
      for (const z of [34, 45, 56]) lamp(b, 94.08, 5.4, z, 'e');
      // 洞内石材、门口的拱券、梁柱和灯，保留转角楼梯与两层通道。
      b.wallMat(5, 34, 36, 67, 'stone'); b.wallMat(30, 40, 47, 49, 'stone');
      arch(b, 20.5, 2.4, 67.04, 4.5, 2.95, 'n');
      arch(b, 12.5, 2.4, 36.05, 2.7, 2.8, 'n');
      for (const z of [47, 52, 57, 62]) { trim(b, 18, z - 0.12, 23, z + 0.12, 7.5, 'darkwood'); lamp(b, 18.05, 5.7, z, 'e'); }
      // B 后台脚手架与沙地；架子放在既有墙 / 箱子外沿。
      b.floorMat(9, 8, 28, 26, 'sand');
      for (const x of [9.15, 14.8]) for (const z of [9.2, 12.6]) round(b, x, 4, z, 0.045, 3.4, 'iron');
      trim(b, 9, 9, 15, 12.8, 6.8, 'plywood');
      for (const y of [4.8, 5.8, 6.8]) trim(b, 9, 9.1, 15, 9.2, y, 'iron');
      arch(b, 30.02, 3.6, 14, 1.7, 2.35, 'e');
      // A 小的墙根、窗台、拐角石面；A 点平台用浅石面，箱顶压上帆布。
      b.floorMat(55, 43, 75, 58, 'tiles'); b.wallMat(66, 31, 78, 43, 'stucco_w');
      window(b, 76.02, 4.9, 40.5, 'w'); lamp(b, 68.95, 5.2, 40, 'e');
      b.floorMat(84, 4, 102, 20, 'pavers');
      trim(b, 88, 17, 90, 19, 6.3, 'tarp');
      window(b, 95, 6.7, 4.04, 's'); window(b, 99, 6.7, 4.04, 's');
      arch(b, 50.9, 0.8, 32.5, 5.9, 3.4, 's');
      break;
    }
    case 'mirage': {
      const S = b.S, rect = (c0, r0, c1, r1, y, mat) => b.decor(c0 * S, y, r0 * S, c1 * S, y + 0.12, r1 * S, mat);
      // 区域材质：中路蓝墙、宫殿暖色、B 公寓米白墙，避免全图同一片黄。
      b.wallMat(95, 90, 166, 131, 'stucco_w'); b.wallMat(82, 103, 98, 124, 'paint_b');
      b.wallMat(163, 176, 229, 210, 'stucco_o'); b.wallMat(25, 38, 160, 98, 'stucco_w');
      b.facade({ every: 14, rows: 1, doors: 0.08, mats: ['shutter_w', 'shutter_b'] });
      // 狙击窗的窗台和石边框，窗口本身留空；室内木地板、屋梁。
      const wx = 98 * S, wz = 115.5 * S;
      arch(b, wx, 5.6, wz, 1.55, 2.1, 'e');
      for (const c of [90, 94]) rect(c, 111, c + 0.25, 120, 8.15, 'darkwood');
      // A 点宫殿出口、遮棚、售票亭位置的墙面细节。
      arch(b, 159 * S, 6.4, 187.5 * S, 1.5, 2.5, 'w');
      rect(157, 183, 174, 193, 8.0, 'plywood');
      for (const c of [157.5, 172.5]) for (const r of [184, 192]) round(b, c * S, 4.8, r * S, 0.045, 3.2, 'iron');
      face(b, 99 * S, 5.7, 192 * S, 2.0, 1.4, 'e', 'ticket');
      for (const c of [183, 194, 205, 216]) window(b, c * S, 8.1, 207 * S, 'n');
      // 公寓窗沿与百叶窗、B 后方超市招牌与遮阳棚。
      for (const c of [114, 127, 141]) { window(b, c * S, 6.2, 41.95 * S, 's'); lamp(b, c * S, 6.5, 42.1 * S, 's'); }
      face(b, 74 * S, 4.9, 94 * S, 3, 0.6, 'n', 'market');
      rect(70, 92, 80, 94, 5.55, 'awning');
      palm(b, 19 * S, 3.2, 53 * S, 6.4); palm(b, 88 * S, 3.2, 148 * S, 6.0);
      // 下水道的入口石框、墙脚和顶梁；不再给暗道加梯子。
      arch(b, 110 * S, 0.4, 63 * S, 3.0, 2.4, 's');
      for (const r of [76, 87, 96]) rect(106, r, 114, r + 0.22, 2.78, 'darkwood');
      break;
    }
    case 'inferno': {
      // 匪口和侧道：墙裙、窗台、雨棚、花箱，近景优先。
      b.wallMat(30, 55, 42, 57, 'stucco_w'); b.wallMat(43, 66, 60, 78, 'stucco_y');
      for (const z of [60.5, 68, 81]) { window(b, 29.96, 4.8, z, 'e', 'shutter'); lamp(b, 30.05, 3.7, z, 'e'); }
      trim(b, 43, 78.82, 60, 79.0, 1.65, 'stone');
      for (const x of [47, 54, 59]) { window(b, x, 4.6, 78.96, 's', 'shutter'); planter(b, x - 0.5, 4.35, 79.01); }
      arch(b, 62, 1.2, 82.5, 4.6, 3.3, 'e');
      // 香蕉道的粉刷墙 / 砖墙和大门，沙袋用沙袋材质，木板掩体仍保留。
      b.wallMat(42, 41, 55, 58, 'stucco_w'); b.wallMat(55, 28, 63, 41, 'stucco_y');
      face(b, 42.97, 2.4, 48.8, 2.3, 2.8, 'e', 'housedoor');
      window(b, 42.96, 5.4, 51, 'e', 'shutter'); lamp(b, 43.08, 5.1, 46, 'e');
      face(b, 55.96, 3.0, 35, 1.25, 2.45, 'e', 'housedoor');
      trim(b, 56, 27.87, 63, 28, 4.15, 'stone');
      for (const z of [49, 54]) stringLights(b, 43, z, 50, z + 0.6, 6.0);
      for (const z of [32, 38]) stringLights(b, 56, z, 63, z + 0.4, 6.6);
      // 教堂后面的钟楼轮廓，位于不可走墙区，保持玩家上空的投掷空间。
      b.decor(66, 8.5, 17, 72, 13, 20, 'stone');
      for (const x of [67.5, 70.5]) face(b, x, 10.2, 20.02, 1, 1.6, 's', 'churchwindow');
      trim(b, 65.7, 16.7, 72.3, 20.3, 13, 'rooftile');
      // B 点的教堂拱门、墙上砖石、蓝布箱；喷泉的圆形盆和金属出水头。
      arch(b, 63, 3.0, 21, 1.7, 2.7, 'e');
      face(b, 62.96, 5.5, 16, 1.4, 2.1, 'w', 'churchwindow');
      round(b, 53, 4.0, 17, 2.6, 0.55, 'stone');
      round(b, 53, 4.55, 17, 2.38, 0.025, 'water');
      round(b, 53, 4.56, 17, 0.42, 1.25, 'stone', 0.3);
      round(b, 53, 5.8, 17, 0.55, 0.15, 'stone'); round(b, 53, 5.95, 17, 0.2, 0.45, 'iron', 0.08);
      diskCollider(b, 53, 4, 17, 2.6, 0.55);
      diskCollider(b, 53, 4.56, 17, 0.42, 1.25);
      diskCollider(b, 53, 5.8, 17, 0.55, 0.15);
      diskCollider(b, 53, 5.95, 17, 0.2, 0.45);
      face(b, 44.02, 5.4, 21, 1.15, 1.2, 'e', 'sign_b');
      // 铁艺阳台、锅炉房门框、厨房柜门，站在侧道就能认出二楼。
      railing(b, 79, 79, 89, 79, 5.6);
      face(b, 56.5, 4.8, 74.98, 2.8, 0.85, 'n', 'cupboard');
      face(b, 60.02, 6.1, 89.5, 1.6, 1.0, 'e', 'cupboard');
      arch(b, 73.8, 2.96, 55.07, 1.75, 2.4, 's');
      // A 拱门、书房和墓地的外观；大坑墙面与顶棚下的壁灯。
      arch(b, 79, 2.7, 44.5, 3.8, 3.45, 's');
      face(b, 82.97, 2.56, 41.5, 1.3, 2.2, 'e', 'books');
      for (const z of [60, 64]) face(b, 102.96, 3.2, z, 1.2, 1.8, 'w', 'memorial');
      b.wallMat(89, 77, 103, 81, 'stone');
      for (const z of [57, 67]) lamp(b, 97.95, 5.8, z, 'w');
      face(b, 97.95, 4.8, 55.5, 1.2, 1.2, 'w', 'sign_a');
      break;
    }
    case 'sandstorm': {
      b.facade({ every: 4, rows: 1, doors: 0.15, mats: ['shutter_w', 'shutter_b'] });
      b.wallMat(31, 14, 39, 30, 'stucco_w'); b.floorMat(32, 14, 37, 23, 'asphalt');
      arch(b, 37, 0, 48, 3.8, 3.1, 's');
      arch(b, 27, 0, 11, 5.5, 3.15, 'e');
      face(b, 64, 2.0, 34, 1.1, 1.1, 'e', 'sign_a');
      face(b, 26.02, 1.8, 15, 1.1, 1.1, 'e', 'sign_b');
      for (const z of [44, 54, 64]) { trim(b, 8, z, 16, z + 0.16, 3.2, 'darkwood'); lamp(b, 8.07, 2.4, z, 'e'); }
      palm(b, 77, 0, 37, 6); palm(b, 3, 0, 65, 5.5);
      break;
    }
    case 'depot': {
      // 工业环境：高处工字梁、装卸区编号、卷帘门、地面导流线。
      for (const z of [22, 30, 38, 44]) trim(b, 26, z, 42, z + 0.25, 4.6, 'metal');
      for (const x of [26.2, 41.5]) b.decor(x, 3.5, 20, x + 0.12, 4.7, 46, 'metal');
      face(b, 43.95, 1.3, 16, 3.0, 2.8, 'e', 'garage');
      face(b, 22.05, 2.1, 16, 3.0, 2.8, 'w', 'garage_b');
      face(b, 43.98, 3.4, 24, 1.4, 1.0, 'e', 'sign_a');
      face(b, 22.02, 3.4, 26, 1.4, 1.0, 'w', 'sign_b');
      for (const z of [18, 24, 30]) trim(b, 54, z, 62, z + 0.1, 0.012, 'paint_y');
      for (const z of [18, 24, 30]) trim(b, 6, z, 20, z + 0.1, 0.81, 'paint_y');
      for (const x of [28, 38]) { b.decor(x, 4.4, 27, x + 2.0, 4.48, 27.3, 'lampglass'); b.decor(x, 4.4, 41, x + 2.0, 4.48, 41.3, 'lampglass'); }
      break;
    }
    case 'arena': {
      // 用颜色区分阵营和两条包点路线；不增加影响公平性的掩体。
      b.wallMat(0, 0, 4, 25, 'paint_b'); b.wallMat(21, 0, 25, 25, 'paint_o');
      face(b, 24.0, 1.5, 15, 1.3, 1.3, 'w', 'sign_a');
      face(b, 24.0, 1.5, 39, 1.3, 1.3, 'w', 'sign_b');
      for (const z of [5, 47]) trim(b, 3, z, 49, z + 0.12, 0.012, 'paint_y');
      break;
    }
    case 'range': {
      // 靶场的距离线原来只有颜色，现在能读到数值。
      for (const [r, distance] of [[34, 10], [29, 20], [24, 30], [19, 40], [14, 50], [4, 70]]) {
        face(b, 2.06, 1.1, r * 2 + 1, 1.7, 0.7, 'e', 'distance_' + distance);
        face(b, 57.94, 1.1, r * 2 + 1, 1.7, 0.7, 'w', 'distance_' + distance);
      }
      for (let c = 3; c <= 25; c += 2) face(b, c * 2, 0.3, 75.02, 1.3, 0.55, 's', 'lane_' + ((c - 3) / 2 + 1));
      break;
    }
  }
  videoDetails(b, id);
}
