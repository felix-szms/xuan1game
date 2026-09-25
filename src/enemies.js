import * as THREE from 'three';
import { moveWithCollisions, groundHeight, hasLineOfSight } from './world.js';

// 武装看守 AI：巡逻 → 察觉 → 交战；铰接动画（髋/肩枢轴摆动、举枪、起伏、踉跄、倒地）
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
    this.deathRoll = (Math.random() - 0.5) * 0.7;
    this.walkPhase = Math.random() * 10;
    this.stepTimer = 0;
    this.radius = 0.4;
    this.flinch = 0;      // 受击踉跄计时
    this.aimBlend = 0;    // 举枪姿态混合

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

    // 髋部枢轴（腿部绕髋摆动）
    const legGeo = new THREE.CapsuleGeometry(0.11, 0.55, 4, 8);
    this.hipL = new THREE.Group();
    this.hipL.position.set(-0.15, 0.78, 0);
    const legL = new THREE.Mesh(legGeo, cloth);
    legL.position.y = -0.39;
    this.hipL.add(legL);
    this.hipR = new THREE.Group();
    this.hipR.position.set(0.15, 0.78, 0);
    const legR = new THREE.Mesh(legGeo, cloth);
    legR.position.y = -0.39;
    this.hipR.add(legR);

    // 肩部枢轴（手臂绕肩摆动 / 举枪）
    const armGeo = new THREE.CapsuleGeometry(0.09, 0.45, 4, 8);
    this.shL = new THREE.Group();
    this.shL.position.set(-0.36, 1.42, 0);
    const armL = new THREE.Mesh(armGeo, cloth);
    armL.position.y = -0.31;
    this.shL.add(armL);
    this.shR = new THREE.Group();
    this.shR.position.set(0.36, 1.42, 0);
    const armR = new THREE.Mesh(armGeo, cloth);
    armR.position.y = -0.31;
    this.shR.add(armR);

    this.gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.7), gunM);
    this.gun.position.set(0.22, 1.28, 0.42);
    this.gunHip = { pos: new THREE.Vector3(0.22, 1.28, 0.42), rotX: 0 };
    this.gunAim = { pos: new THREE.Vector3(0.14, 1.42, 0.52), rotX: -0.06 };

    // 红色识别灯（远处可见，便于玩家辨识）
    this.tag = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xff3020 })
    );
    this.tag.position.set(0, 2.05, 0);

    for (const m of [this.body, this.vest, this.head, this.helmet]) {
      m.castShadow = true;
      g.add(m);
    }
    for (const p of [this.hipL, this.hipR, this.shL, this.shR]) {
      p.traverse(m => { m.castShadow = true; });
      g.add(p);
    }
    g.add(this.gun);
    g.add(this.tag);
    g.position.copy(this.pos);
    this.scene.add(g);
    this.mesh = g;
  }

  eye() { return new THREE.Vector3(this.pos.x, this.pos.y + 1.6, this.pos.z); }

  hitBy(dmg, isHead) {
    if (this.state === DEAD) return false;
    this.hp -= isHead ? dmg * 2.2 : dmg;
    this.flinch = 0.2; // 受击踉跄
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
      const p = Math.min(1, this.deadTime / 0.45);
      // 倒地：绕脚部前倾倒下 + 随机侧倾
      this.mesh.rotation.x = -1.5 * p * p;
      this.mesh.rotation.z = this.deathRoll * p;
      this.mesh.position.y = this.pos.y + 0.28 * Math.sin(Math.PI * Math.min(1, p * 1.15));
      this.tag.visible = false;
      return;
    }

    const eye = this.eye();
    const playerEye = new THREE.Vector3(player.pos.x, player.pos.y + player.eyeHeight, player.pos.z);
    const toPlayer = new THREE.Vector3().subVectors(playerEye, eye);
    const dist = toPlayer.length();

    // 感知：视距 + 视野角（交战时全向），蹲伏/移动影响察觉距离
    const facing = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const flatDot = facing.dot(new THREE.Vector3(toPlayer.x, 0, toPlayer.z).normalize());
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

    // ---- 铰接动画 ----
    this.aimBlend += ((this.state === COMBAT ? 1 : 0) - this.aimBlend) * Math.min(1, dt * 6);
    const moving = !!moveDir;
    const swing = moving ? Math.sin(this.walkPhase) * 0.55 : 0;
    this.hipL.rotation.x = swing;
    this.hipR.rotation.x = -swing;
    // 手臂：巡逻摆臂；交战举枪指向目标
    this.shL.rotation.x = -swing * 0.6 - this.aimBlend * 1.25;
    this.shR.rotation.x = swing * 0.6 - this.aimBlend * 1.25;
    // 枪：髋部持握 ↔ 举枪瞄准
    this.gun.position.lerpVectors(this.gunHip.pos, this.gunAim.pos, this.aimBlend);
    this.gun.rotation.x = this.gunHip.rotX + (this.gunAim.rotX - this.gunHip.rotX) * this.aimBlend;
    // 起伏与跑动前倾
    const bob = moving ? Math.abs(Math.sin(this.walkPhase)) * 0.05 : 0;
    this.mesh.position.set(this.pos.x, this.pos.y + bob, this.pos.z);
    this.mesh.rotation.x = moving && speed > 2.6 ? 0.08 : 0;
    // 受击踉跄
    if (this.flinch > 0) {
      this.flinch -= dt;
      this.mesh.rotation.z = Math.sin(this.flinch * 45) * 0.14 * (this.flinch / 0.2);
    } else {
      this.mesh.rotation.z = 0;
    }
    this.mesh.rotation.y = this.yaw;
  }
}

export class EnemyManager {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.enemies = [];
  }

  spawnAll(count = 10) {
    // 从地图巡逻点派生出生位置（间隔至少 14 米，自动适配任意地图）
    const pts = [...this.world.patrolPoints].sort(() => Math.random() - 0.5);
    const chosen = [];
    for (const p of pts) {
      if (chosen.length >= count) break;
      if (chosen.every(q => q.distanceTo(p) > 14)) chosen.push(p);
    }
    for (const p of pts) {
      if (chosen.length >= count) break;
      if (!chosen.includes(p)) chosen.push(p);
    }
    for (const p of chosen) {
      this.enemies.push(new Enemy(this.scene, this.world, p.clone()));
    }
  }

  // 运行时增援/事件投放
  spawnAt(x, z, opts = {}) {
    const e = new Enemy(this.scene, this.world, new THREE.Vector3(x, 0, z));
    if (opts.hunt && opts.target) {
      e.state = 2; // COMBAT：径直向玩家最后位置移动
      e.lastSeen.copy(opts.target);
      e.lastSeenTime = opts.t || 0;
    }
    this.enemies.push(e);
    return e;
  }

  alive() { return this.enemies.filter(e => e.state !== 3).length; }
}
