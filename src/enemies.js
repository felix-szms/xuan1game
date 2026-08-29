import * as THREE from 'three';
import { moveWithCollisions, groundHeight, hasLineOfSight } from './world.js';

// 武装看守 AI：巡逻 → 察觉 → 交战；血量/掩体/走位简化处理
const IDLE = 0, PATROL = 1, COMBAT = 2, DEAD = 3;

export class Enemy {
  constructor(scene, world, pos) {
    this.scene = scene;
    this.world = world;
    this.pos = pos.clone();
    this.yaw = Math.random() * Math.PI * 2;
    this.hp = 100;
    this.state = PATROL;
    this.speed = 2.2;
    this.combatSpeed = 3.2;
    this.seePlayer = false;
    this.lastSeen = new THREE.Vector3();
    this.lastSeenTime = -99;
    this.fireTimer = Math.random() * 2;
    this.burst = 0;
    this.deadTime = 0;
    this.walkPhase = Math.random() * 10;
    this.stepTimer = 0;
    this.radius = 0.4;

    // 巡逻路线
    const pts = world.patrolPoints;
    const start = Math.floor(Math.random() * pts.length);
    this.route = [];
    for (let i = 0; i < 4; i++) this.route.push(pts[(start + i * 3 + Math.floor(Math.random() * 3)) % pts.length]);
    this.routeIdx = 0;

    this._buildMesh();
  }

  _buildMesh() {
    const g = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0x8a6f58, roughness: 0.9 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x3d4a3a, roughness: 0.95 });
    const vest = new THREE.MeshStandardMaterial({ color: 0x23282c, roughness: 0.8, metalness: 0.3 });
    const gunM = new THREE.MeshStandardMaterial({ color: 0x1c2126, roughness: 0.5, metalness: 0.6 });

    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.65, 4, 10), cloth);
    this.body.position.y = 1.05;
    this.vest = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.55, 0.4), vest);
    this.vest.position.y = 1.2;
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10), skin);
    this.head.position.y = 1.72;
    this.helmet = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8, 0, Math.PI * 2, 0, Math.PI / 1.8), vest);
    this.helmet.position.y = 1.74;

    this.legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.55, 4, 8), cloth);
    this.legR = this.legL.clone();
    this.legL.position.set(-0.15, 0.42, 0);
    this.legR.position.set(0.15, 0.42, 0);

    this.armR = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.45, 4, 8), cloth);
    this.armR.position.set(0.36, 1.25, 0.12);
    this.armL = this.armR.clone();
    this.armL.position.set(-0.36, 1.25, 0.12);

    this.gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.7), gunM);
    this.gun.position.set(0.22, 1.28, 0.42);

    // 红色识别灯（远处可见，便于玩家辨识）
    this.tag = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xff3020 })
    );
    this.tag.position.set(0, 2.05, 0);

    for (const m of [this.body, this.vest, this.head, this.helmet, this.legL, this.legR, this.armR, this.armL, this.gun]) {
      m.castShadow = true;
      g.add(m);
    }
    g.add(this.tag);
    g.position.copy(this.pos);
    this.scene.add(g);
    this.mesh = g;
  }

  eye() { return new THREE.Vector3(this.pos.x, this.pos.y + 1.6, this.pos.z); }

  hitBy(dmg, isHead) {
    if (this.state === DEAD) return false;
    this.hp -= isHead ? dmg * 2.2 : dmg;
    // 受击进入交战
    if (this.state !== COMBAT) { this.state = COMBAT; this.alertTo(this.playerPos || this.pos); }
    if (this.hp <= 0) {
      this.state = DEAD;
      this.deadTime = 0;
      return true;
    }
    return false;
  }

  alertTo(pos) {
    this.lastSeen.copy(pos);
    this.lastSeenTime = this.time || 0;
    if (this.state === PATROL || this.state === IDLE) this.state = COMBAT;
  }

  update(dt, t, player, callbacks) {
    this.time = t;
    this.playerPos = player.pos;

    if (this.state === DEAD) {
      this.deadTime += dt;
      if (this.deadTime < 0.5) {
        this.mesh.rotation.x = -this.deadTime * 2.6; // 倒地
      }
      this.tag.visible = false;
      return;
    }

    const eye = this.eye();
    const playerEye = new THREE.Vector3(player.pos.x, player.pos.y + player.eyeHeight, player.pos.z);
    const toPlayer = new THREE.Vector3().subVectors(playerEye, eye);
    const dist = toPlayer.length();
    const facing = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const flatDot = facing.dot(new THREE.Vector3(toPlayer.x, 0, toPlayer.z).normalize());

    // 感知：视距 + 视野角（交战时全向），蹲伏/移动影响察觉距离
    const seeRange = player.crouching ? 26 : (player.moving ? 40 : 32);
    this.seePlayer = dist < seeRange &&
      (this.state === COMBAT || flatDot > 0.15 || dist < 6) &&
      hasLineOfSight(eye, playerEye, this.world.colliders);
    if (this.seePlayer) {
      this.lastSeen.copy(player.pos);
      this.lastSeenTime = t;
      if (this.state !== COMBAT) {
        this.state = COMBAT;
        callbacks.onSpot(this);
      }
    } else if (this.state === COMBAT && t - this.lastSeenTime > 6) {
      this.state = PATROL; // 失去目标，恢复巡逻
    }

    let moveDir = null;
    let speed = this.speed;

    if (this.state === PATROL) {
      const target = this.route[this.routeIdx];
      const d = new THREE.Vector3().subVectors(target, this.pos);
      d.y = 0;
      if (d.length() < 1.5) this.routeIdx = (this.routeIdx + 1) % this.route.length;
      else { moveDir = d.normalize(); speed = this.speed; }
    } else if (this.state === COMBAT) {
      const d = new THREE.Vector3().subVectors(this.lastSeen, this.pos); d.y = 0;
      const flatDist = d.length();
      if (this.seePlayer && flatDist > 9) {
        moveDir = d.clone().normalize(); speed = this.combatSpeed;
      } else if (!this.seePlayer && flatDist > 1.5) {
        moveDir = d.clone().normalize(); speed = this.combatSpeed;
      } else if (this.seePlayer) {
        // 近距离侧向走位
        const side = new THREE.Vector3(-d.z, 0, d.x).normalize()
          .multiplyScalar(Math.sin(t * 0.9 + this.walkPhase) > 0 ? 1 : -1);
        moveDir = side; speed = 1.6;
      }
    }

    // 移动 + 碰撞
    if (moveDir) {
      const nd = moveDir.clone().multiplyScalar(speed * dt);
      const res = moveWithCollisions(this.pos, nd, this.world.colliders, this.radius, 1.7);
      this.pos.x = res.x; this.pos.z = res.z;
      this.walkPhase += dt * speed * 3;
      this.stepTimer += dt;
      if (this.stepTimer > 0.42 / (speed / 2.2)) {
        this.stepTimer = 0;
        callbacks.onEnemyStep(this, player);
      }
    }
    // 面向
    const faceTarget = this.state === COMBAT ? this.lastSeen : (moveDir ? this.pos.clone().add(moveDir) : null);
    if (faceTarget) {
      const want = Math.atan2(faceTarget.x - this.pos.x, faceTarget.z - this.pos.z);
      let diff = want - this.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.yaw += diff * Math.min(1, dt * 8);
    }

    // 开火
    if (this.state === COMBAT && this.seePlayer) {
      this.fireTimer -= dt;
      if (this.burst > 0 && this.fireTimer <= 0) {
        this.burst--;
        this.fireTimer = 0.13;
        callbacks.onEnemyFire(this, playerEye, dist);
      } else if (this.burst === 0 && this.fireTimer <= 0) {
        this.burst = 3 + Math.floor(Math.random() * 3);
        this.fireTimer = 0.9 + Math.random() * 1.2;
      }
    }

    // 动画
    const swing = moveDir ? Math.sin(this.walkPhase) * 0.55 : 0;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.mesh.rotation.y = this.yaw;
  }
}

export class EnemyManager {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.enemies = [];
    this.spawns = [
      [-30, -44], [-44, -30], [30, -48], [40, -36], [-20, -30],
      [-24, 16], [4, 22], [28, 10], [42, 28], [-40, 38],
      [-8, 46], [18, 40], [0, 58], [48, -14], [-52, 12], [34, 2]
    ];
  }

  spawnAll(count = 10) {
    const shuffled = [...this.spawns].sort(() => Math.random() - 0.5);
    for (let i = 0; i < Math.min(count, shuffled.length); i++) {
      const [x, z] = shuffled[i];
      this.enemies.push(new Enemy(this.scene, this.world, new THREE.Vector3(x, 0, z)));
    }
  }

  alive() { return this.enemies.filter(e => e.state !== 3).length; }
}
