import * as THREE from 'three';
import { rollSafeItem } from './loot.js';
import { planeFlyby, alarmSound } from './audio.js';

// ============================================================
// 随机事件系统：每局从事件池抽取
//  - 坠机残骸：开局刷新直升机残骸 + 高价值物资 + 2 名看守
//  - 空投补给：中局在随机点投放金色信标物资箱（小地图标记）
//  - 看守增援：中局一支小队从地图边缘向玩家移动
// ============================================================

const EVENT_CFG = {
  prison: {
    name: '潮汐监狱',
    crashPoints: [[0, 60], [-44, -10], [30, 44]],
    dropPoints: [[-10, 30], [22, 40], [-36, 50], [12, 14]],
    reinforcePoints: [[-70, 0], [70, 60], [0, 70], [-70, -60]]
  },
  dam: {
    name: '零号大坝',
    crashPoints: [[0, 26], [-58, -26], [36, 48]],
    dropPoints: [[8, 46], [-30, 36], [50, 16], [-14, -34]],
    reinforcePoints: [[-70, 40], [70, -40], [70, 40], [-70, -40]]
  }
};

export class RandomEvents {
  constructor(scene, world, enemyMgr, lootMgr, hud) {
    this.scene = scene;
    this.world = world;
    this.enemyMgr = enemyMgr;
    this.lootMgr = lootMgr;
    this.hud = hud;
    this.eventObjects = [];
    this.smokes = [];
    this.markers = [];
    this.airdrop = null;
    this.reinforce = null;
    this.t = 0;
  }

  _clear() {
    for (const o of this.eventObjects) {
      this.scene.remove(o);
      o.traverse?.((m) => m.geometry?.dispose?.());
    }
    for (const s of this.smokes) this.scene.remove(s.mesh);
    this.eventObjects = [];
    this.smokes = [];
    this.markers = [];
    this.airdrop = null;
    this.reinforce = null;
  }

  // 每局开始调用；force 用于测试（0-1 概率覆写）
  reset(playerPos, force = {}) {
    this._clear();
    this.t = 0;
    const cfg = EVENT_CFG[this.world.mapId] || EVENT_CFG.prison;
    const roll = (p, f) => (f !== undefined ? f >= 0.5 : Math.random() < p);

    // ---- 事件一：坠机残骸（开局即在场） ----
    if (roll(0.7, force.crash)) {
      const [cx, cz] = cfg.crashPoints[Math.floor(Math.random() * cfg.crashPoints.length)];
      const g = new THREE.Group();
      const metal = new THREE.MeshStandardMaterial({ color: 0x3a4148, roughness: 0.6, metalness: 0.7 });
      const burnt = new THREE.MeshStandardMaterial({ color: 0x181a1c, roughness: 0.9 });
      const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.9, 6.5, 12), metal);
      fuselage.rotation.z = Math.PI / 2 - 0.15;
      fuselage.position.y = 1.2;
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.2, 1.4), metal);
      tail.position.set(-3.6, 1.9, 0.4);
      tail.rotation.z = 0.5;
      const rotor = new THREE.Mesh(new THREE.BoxGeometry(7, 0.12, 0.5), burnt);
      rotor.position.set(0.6, 0.15, 1.2);
      rotor.rotation.y = 0.7;
      const rotor2 = rotor.clone();
      rotor2.rotation.y = -1.2;
      rotor2.position.z = 0.6;
      const scorch = new THREE.Mesh(
        new THREE.CircleGeometry(5.5, 20),
        new THREE.MeshBasicMaterial({ color: 0x0c0e10, transparent: true, opacity: 0.55 })
      );
      scorch.rotation.x = -Math.PI / 2;
      scorch.position.y = 0.03;
      g.add(fuselage, tail, rotor, rotor2, scorch);
      g.position.set(cx, 0, cz);
      this.scene.add(g);
      this.eventObjects.push(g);
      this.world.addCollider(cx, 1.2, cz, 6.5, 2.4, 3.4);
      // 残骸烟雾
      for (let i = 0; i < 5; i++) {
        const m = new THREE.Mesh(
          new THREE.SphereGeometry(0.8 + Math.random() * 0.7, 8, 8),
          new THREE.MeshBasicMaterial({ color: 0x2c2e30, transparent: true, opacity: 0.35, depthWrite: false })
        );
        m.position.set(cx + (Math.random() - 0.5) * 1.5, 1 + i * 1.1, cz + (Math.random() - 0.5) * 1.5);
        this.scene.add(m);
        this.smokes.push({ mesh: m, base: m.position.clone(), phase: i * 1.3 });
      }
      // 残骸高价值物资 ×2 + 看守 ×2
      this.lootMgr.spawnSpecialCrate(cx + 3.2, cz + 1.5, [rollSafeItem(), rollSafeItem()]);
      this.lootMgr.spawnSpecialCrate(cx - 2.8, cz - 2.2, [rollSafeItem()]);
      this.enemyMgr.spawnAt(cx + 5, cz - 4);
      this.enemyMgr.spawnAt(cx - 5, cz + 4);
      this.markers.push({ x: cx, z: cz, color: '#ff9040', label: '坠机' });
      this.hud.toast('⚠ 卫星侦测到坠机残骸 — 残骸附近有高价值物资', 3400);
    }

    // ---- 事件二：空投补给（中局触发） ----
    if (roll(0.6, force.airdrop)) {
      this.airdrop = {
        at: 30 + Math.random() * 30,
        point: cfg.dropPoints[Math.floor(Math.random() * cfg.dropPoints.length)],
        done: false
      };
    }

    // ---- 事件三：看守增援（中局触发） ----
    if (roll(0.55, force.reinforce)) {
      this.reinforce = { at: 60 + Math.random() * 35, done: false };
    }

    // 保底：至少一个动态事件
    if (!this.airdrop && !this.reinforce) {
      this.airdrop = { at: 40, point: cfg.dropPoints[0], done: false };
    }
  }

  update(dt, player) {
    this.t += dt;

    // 烟雾上升循环
    for (const s of this.smokes) {
      const life = (this.t * 0.25 + s.phase) % 3;
      s.mesh.position.y = s.base.y + life * 1.8;
      s.mesh.material.opacity = 0.35 * (1 - life / 3);
    }

    // 空投触发
    if (this.airdrop && !this.airdrop.done && this.t >= this.airdrop.at) {
      this.airdrop.done = true;
      const [dx, dz] = this.airdrop.point;
      const items = [rollSafeItem(), { name: '弹药盒', value: 600, ammo: 60 }];
      const crate = this.lootMgr.spawnSpecialCrate(dx, dz, items);
      // 金色信标光柱
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(1.2, 1.2, 22, 16, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xffc040, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false })
      );
      beam.position.set(dx, 11, dz);
      this.scene.add(beam);
      this.eventObjects.push(beam);
      crate.beacon = beam;
      this.markers.push({ x: dx, z: dz, color: '#ffd76a', label: '空投' });
      planeFlyby();
      this.hud.toast('⚠ 补给空投已投放 — 留意金色信标与小地图标记', 3600);
    }
    // 空投信标呼吸
    if (this.airdrop && this.airdrop.done) {
      const crate = this.airdropCrate;
      for (const o of this.eventObjects) {
        if (o.material && o.geometry && o.geometry.type === 'CylinderGeometry') {
          o.material.opacity = 0.1 + Math.abs(Math.sin(this.t * 2.4)) * 0.1;
        }
      }
      void crate;
    }

    // 增援触发
    if (this.reinforce && !this.reinforce.done && this.t >= this.reinforce.at) {
      this.reinforce.done = true;
      const cfg = EVENT_CFG[this.world.mapId] || EVENT_CFG.prison;
      // 选离玩家最远的边缘点
      let best = null, bestD = -1;
      for (const p of cfg.reinforcePoints) {
        const d = Math.hypot(p[0] - player.pos.x, p[1] - player.pos.z);
        if (d > bestD) { bestD = d; best = p; }
      }
      for (let i = 0; i < 3; i++) {
        this.enemyMgr.spawnAt(best[0] + (Math.random() - 0.5) * 6, best[1] + (Math.random() - 0.5) * 6, {
          hunt: true, target: player.pos, t: this.t
        });
      }
      alarmSound();
      this.hud.toast('⚠ 有看守增援抵达 — 他们正在向你移动', 3400);
    }
  }

  getMarkers() { return this.markers; }
}
