import * as THREE from 'three';
import { lootSound } from './audio.js';

// 物资系统：物资箱 + 撤离点
const ITEM_TABLE = [
  { name: '机械零件', value: 1200, w: 26 },
  { name: '军用绷带', value: 800, w: 20 },
  { name: '弹药盒', value: 600, w: 18, ammo: 60 },
  { name: '加密门卡', value: 3000, w: 12 },
  { name: '军用硬盘', value: 5000, w: 8 },
  { name: '金条', value: 8000, w: 4 },
  { name: '红酒收藏款', value: 2400, w: 12 }
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

export class LootManager {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.crates = [];
    this.spawns = [
      [-48, -54], [-26, -50], [-12, -42], [-40, -40], [-24, -28],
      [24, -54], [40, -46], [46, -32], [30, -34],
      [-34, 22], [-18, 36], [10, 28], [30, 14], [44, 32],
      [-40, 44], [-6, 50], [20, 50], [54, 6], [-54, 30], [8, 8]
    ];
    this._spawnCrates(14);
    this._buildExtractMarker();
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
      this.world.addCollider(x, 0.4, z, 1.1, 0.8, 0.9);
      this.crates.push({
        group: g, pos: new THREE.Vector3(x, 0, z), opened: false,
        items: [rollItem(), ...(Math.random() < 0.4 ? [rollItem()] : [])]
      });
    }
  }

  _buildExtractMarker() {
    const p = this.world.extractPoint;
    // 地面光圈
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(this.world.extractRadius - 0.6, this.world.extractRadius, 48),
      new THREE.MeshBasicMaterial({ color: 0x30ff90, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(p.x, 0.06, p.z);
    this.scene.add(ring);
    this.extractRing = ring;
    // 光柱
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(this.world.extractRadius * 0.55, this.world.extractRadius * 0.55, 26, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x30ff90, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false })
    );
    beam.position.set(p.x, 13, p.z);
    this.scene.add(beam);
    this.extractBeam = beam;
    // 撤离区集装箱小屋
    const hut = new THREE.Mesh(
      new THREE.BoxGeometry(4, 2.6, 3),
      new THREE.MeshStandardMaterial({ color: 0x2e4a3a, roughness: 0.8 })
    );
    hut.position.set(p.x + 6, 1.3, p.z - 3);
    hut.castShadow = true;
    this.scene.add(hut);
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
    // 打开动画：盖子张开
    crate.group.children[0].scale.y = 0.4;
    crate.group.children[1].position.y = 0.9;
    crate.group.children[1].rotation.z = 0.5;
    lootSound();
    return msgs;
  }

  update(t) {
    if (this.extractRing) {
      this.extractRing.material.opacity = 0.35 + Math.sin(t * 3) * 0.2;
      this.extractBeam.material.opacity = 0.05 + Math.sin(t * 2) * 0.03;
    }
  }
}
