import * as THREE from 'three';
import { lootSound, beep } from './audio.js';

// 物资系统：普通物资箱 + 加密保险箱（每局重置、重新随机位置）
const ITEM_TABLE = [
  { name: '机械零件', value: 1200, w: 26 },
  { name: '军用绷带', value: 800, w: 20 },
  { name: '弹药盒', value: 600, w: 18, ammo: 60 },
  { name: '加密门卡', value: 3000, w: 12 },
  { name: '军用硬盘', value: 5000, w: 8 },
  { name: '金条', value: 8000, w: 4 },
  { name: '红酒收藏款', value: 2400, w: 12 }
];

// 加密保险箱专属高价值物资
const SAFE_TABLE = [
  { name: '机密文件', value: 6500 },
  { name: '军用硬盘', value: 5000 },
  { name: '金条', value: 8000 },
  { name: '翡翠原石', value: 10000 },
  { name: '金鹰雕像', value: 12000 }
];

function rollItem() {
  const total = ITEM_TABLE.reduce((s, i) => s + i.w, 0);
  let r = Math.random() * total;
  for (const it of ITEM_TABLE) {
    r -= it.w;
    if (r <= 0) return it;
  }
  return ITEM_TABLE[0];
}

function rollSafeItem() {
  return SAFE_TABLE[Math.floor(Math.random() * SAFE_TABLE.length)];
}

export class LootManager {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.crates = [];
    this.safes = [];
    this.spawns = [
      [-48, -54], [-26, -50], [-12, -42], [-40, -40], [-24, -28],
      [24, -54], [40, -46], [46, -32], [30, -34],
      [-34, 22], [-18, 36], [10, 28], [30, 14], [44, 32],
      [-40, 44], [-6, 50], [20, 50], [54, 6], [-54, 30], [8, 8]
    ];
    // 加密保险箱候选点位（屋内/掩体旁）
    this.safeSpawns = [
      [-48, -41], [-30, -41], [-12, -41], [28, -44], [44, -36], [-36, 33]
    ];
    this._spawnAll();
  }

  // 每局开始时调用：清空上一局所有容器（含已开启的），全部重新随机布置
  reset() {
    for (const c of this.crates) {
      this.scene.remove(c.group);
      const i = this.world.colliders.indexOf(c.collider);
      if (i >= 0) this.world.colliders.splice(i, 1);
    }
    for (const s of this.safes) {
      this.scene.remove(s.group);
      const i = this.world.colliders.indexOf(s.collider);
      if (i >= 0) this.world.colliders.splice(i, 1);
    }
    this.crates = [];
    this.safes = [];
    this._spawnAll();
  }

  _spawnAll() {
    this._spawnCrates(14);
    this._spawnSafes(2);
  }

  _trackCollider(x, y, z, sx, sy, sz) {
    this.world.addCollider(x, y, z, sx, sy, sz);
    return this.world.colliders[this.world.colliders.length - 1];
  }

  _spawnCrates(count) {
    const shuffled = [...this.spawns].sort(() => Math.random() - 0.5);
    const crateM = new THREE.MeshStandardMaterial({ color: 0x4a5238, roughness: 0.85, metalness: 0.2 });
    const stripM = new THREE.MeshStandardMaterial({ color: 0xc9a53a, roughness: 0.4, metalness: 0.7, emissive: 0x332200 });
    for (let i = 0; i < count; i++) {
      const [x, z] = shuffled[i];
      const g = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.8, 0.8), crateM);
      box.position.y = 0.4;
      box.castShadow = true; box.receiveShadow = true;
      const strip = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.12, 0.82), stripM);
      strip.position.y = 0.55;
      g.add(box, strip);
      g.position.set(x, 0, z);
      g.rotation.y = Math.random() * Math.PI;
      this.scene.add(g);
      this.crates.push({
        group: g, pos: new THREE.Vector3(x, 0, z), opened: false,
        collider: this._trackCollider(x, 0.4, z, 1.1, 0.8, 0.9),
        items: [rollItem(), ...(Math.random() < 0.4 ? [rollItem()] : [])]
      });
    }
  }

  _spawnSafes(count) {
    const shuffled = [...this.safeSpawns].sort(() => Math.random() - 0.5);
    const bodyM = new THREE.MeshStandardMaterial({ color: 0x1d2b36, roughness: 0.35, metalness: 0.8 });
    const glowM = new THREE.MeshStandardMaterial({
      color: 0x0a3a44, roughness: 0.3, metalness: 0.6,
      emissive: 0x00c8ff, emissiveIntensity: 0.9
    });
    for (let i = 0; i < count; i++) {
      const [x, z] = shuffled[i];
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.3, 0.75), bodyM);
      body.position.y = 0.65;
      body.castShadow = true; body.receiveShadow = true;
      // 四条青色发光边条 + 密码面板
      const stripL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.2, 0.06), glowM);
      stripL.position.set(-0.47, 0.65, 0.36);
      const stripR = stripL.clone(); stripR.position.x = 0.47;
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.04), glowM);
      panel.position.set(0, 0.95, 0.39);
      const dial = new THREE.Mesh(
        new THREE.TorusGeometry(0.16, 0.035, 8, 20),
        new THREE.MeshStandardMaterial({ color: 0x2c3a44, roughness: 0.4, metalness: 0.85, emissive: 0x003340 })
      );
      dial.position.set(0, 0.5, 0.39);
      g.add(body, stripL, stripR, panel, dial);
      g.position.set(x, 0, z);
      g.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(g);
      this.safes.push({
        group: g, pos: new THREE.Vector3(x, 0, z), opened: false, cracked: 0,
        collider: this._trackCollider(x, 0.65, z, 1.0, 1.3, 0.75)
      });
    }
  }

  // 找玩家附近可搜刮的箱子
  nearestOpenable(playerPos) {
    let best = null, bestD = 2.4;
    for (const c of this.crates) {
      if (c.opened) continue;
      const d = Math.hypot(c.pos.x - playerPos.x, c.pos.z - playerPos.z);
      if (d < bestD && Math.abs(c.pos.y - playerPos.y) < 2) { best = c; bestD = d; }
    }
    return best;
  }

  // 找玩家附近未破解的加密保险箱
  nearestSafe(playerPos) {
    let best = null, bestD = 2.6;
    for (const s of this.safes) {
      if (s.opened) continue;
      const d = Math.hypot(s.pos.x - playerPos.x, s.pos.z - playerPos.z);
      if (d < bestD && Math.abs(s.pos.y - playerPos.y) < 2) { best = s; bestD = d; }
    }
    return best;
  }

  open(crate, player) {
    crate.opened = true;
    const msgs = [];
    for (const it of crate.items) {
      if (it.ammo) {
        player.weapon.reserve += it.ammo;
        msgs.push(`弹药盒 ×1（+${it.ammo} 发）`);
      } else {
        player.loot.push({ name: it.name, value: it.value });
        msgs.push(`${it.name} ¥${it.value}`);
      }
    }
    crate.group.children[0].scale.y = 0.4;
    crate.group.children[1].position.y = 0.9;
    crate.group.children[1].rotation.z = 0.5;
    lootSound();
    return msgs;
  }

  // 破解成功：保险箱内随机 2-3 件高价值物资
  openSafe(safe, player) {
    safe.opened = true;
    const n = 2 + (Math.random() < 0.5 ? 1 : 0);
    const msgs = [];
    for (let i = 0; i < n; i++) {
      const it = rollSafeItem();
      player.loot.push({ name: it.name, value: it.value });
      msgs.push(`${it.name} ¥${it.value}`);
    }
    // 开启动画：柜门弹开 + 青光转金色
    safe.group.rotation.x = -0.9;
    safe.group.children[3].material = safe.group.children[3].material.clone();
    safe.group.children[3].material.emissive = new THREE.Color(0xffc040);
    safe.group.children[1].material.emissive = new THREE.Color(0xffc040);
    safe.group.children[2].material.emissive = new THREE.Color(0xffc040);
    lootSound();
    setTimeout(() => beep(1320, 0.15), 150);
    return msgs;
  }

  update(t) {
    if (this.extractRing) {
      this.extractRing.material.opacity = 0.35 + Math.sin(t * 3) * 0.2;
      this.extractBeam.material.opacity = 0.05 + Math.sin(t * 2) * 0.03;
    }
    // 未破解保险箱面板呼吸灯
    for (const s of this.safes) {
      if (s.opened) continue;
      const p = s.group.children[1].material;
      if (p.emissiveIntensity !== undefined) p.emissiveIntensity = 0.6 + Math.sin(t * 3 + s.pos.x) * 0.35;
    }
  }
}
