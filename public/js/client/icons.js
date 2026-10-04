// 买枪菜单里的图标。武器：把简化模型（和别人手里拿的是同一个）从左侧面拍一张，枪口朝左，每把只拍一次；
// 防弹衣、头盔、拆弹器没有模型，直接画成小图形
import * as THREE from 'three';
import { makeWeapon } from './models.js';
import { WEAPONS } from '../shared/weapons.js';

const W = 420, H = 140;
// 画面至少这么宽（米）：短的东西别放得和长枪一样大，同一类武器之间还能看出大小
const MIN_W = { pistol: 0.36, smg: 0.62, shotgun: 0.95, rifle: 0.95, sniper: 0.95, grenade: 0.26 };
const cache = new Map();
let R = null, scene = null, cam = null;

function setup() {
  if (R) return;
  R = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  R.setPixelRatio(1);
  R.setSize(W, H, false);
  R.setClearColor(0x000000, 0);
  scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 2.1));
  const d = new THREE.DirectionalLight(0xffffff, 2.4);
  d.position.set(-1.4, 2, 0.6);
  scene.add(d);
  cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
}

// 一把武器的图标（PNG 的 data URL）
export function weaponIcon(id) {
  let url = cache.get(id);
  if (url) return url;
  setup();
  const g = makeWeapon(id, true);
  const box = new THREE.Box3().setFromObject(g), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  let w = Math.max(size.z * 1.06, MIN_W[WEAPONS[id].type] || 0.3), h = (w * H) / W;
  if (size.y * 1.1 > h) { h = size.y * 1.1; w = (h * W) / H; }
  cam.left = -w / 2; cam.right = w / 2; cam.top = h / 2; cam.bottom = -h / 2;
  cam.updateProjectionMatrix();
  cam.position.set(c.x - 3, c.y, c.z);
  cam.lookAt(c);
  scene.add(g);
  R.render(scene, cam);
  scene.remove(g);
  url = R.domElement.toDataURL('image/png');
  cache.set(id, url);
  return url;
}

// 全拍完了：把这个临时的渲染器收掉
export function iconsDone() {
  if (!R) return;
  R.dispose();
  R.forceContextLoss();
  R = scene = cam = null;
}

export const EQUIP_ICON = {
  vest: '<svg viewBox="0 0 96 44"><path fill="currentColor" d="M38 3h6c1.5 5 6.5 5 8 0h6c0 6 3 9 7 11v27H31V14c4-2 7-5 7-11z"/><path fill="none" stroke="rgba(0,0,0,.5)" stroke-width="1.6" d="M37 21h22v15H37zM37 28.5h22"/></svg>',
  vesthelm: '<svg viewBox="0 0 96 44"><path fill="currentColor" d="M8 31c0-13 7-20 17-20s17 7 17 20v3h-5l-2-4H15l-2 4H8z"/><path fill="none" stroke="rgba(0,0,0,.5)" stroke-width="1.6" d="M12 26h26"/><g transform="translate(40 5) scale(.84)"><path fill="currentColor" d="M38 3h6c1.5 5 6.5 5 8 0h6c0 6 3 9 7 11v27H31V14c4-2 7-5 7-11z"/><path fill="none" stroke="rgba(0,0,0,.5)" stroke-width="1.8" d="M37 21h22v15H37zM37 28.5h22"/></g></svg>',
  kit: '<svg viewBox="0 0 96 44"><g fill="currentColor"><path d="M31 41 45 22l5 4-14 18z"/><path d="M65 41 51 22l-5 4 14 18z"/><path d="M45 23c-4-6-3-14 1-19l3 10v10z"/><path d="M51 23c4-6 3-14-1-19l-3 10v10z"/><circle cx="48" cy="25" r="3.6"/></g><circle cx="48" cy="25" r="1.3" fill="rgba(0,0,0,.55)"/></svg>',
};
