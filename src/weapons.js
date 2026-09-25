import * as THREE from 'three';

// 武器系统：可配置的枪械（AS VAL 突击步枪 / M700 狙击枪）
// 枪模、射击、曳光、后坐、换弹
export class Weapon {
  constructor(camera, scene, cfg = {}) {
    const c = Object.assign({
      kind: 'rifle',
      name: 'AS VAL · 突击步枪',
      magSize: 30,
      reserve: 120,
      rpm: 720,
      damage: 26,
      shotKick: 0.004,     // 每发视口上跳
      recoilPerShot: 0.012,
      recoilCap: 0.07,
      spreadBase: 0.006,
      reloadTime: 2.2
    }, cfg);

    this.kind = c.kind;
    this.name = c.name;
    this.camera = camera;
    this.scene = scene;
    this.magSize = c.magSize;
    this.mag = c.magSize;
    this.reserve = c.reserve;
    this.rpm = c.rpm;
    this.fireInterval = 60 / c.rpm;
    this.damage = c.damage;
    this.shotKick = c.shotKick;
    this.recoilPerShot = c.recoilPerShot;
    this.recoilCap = c.recoilCap;
    this.spreadBase = c.spreadBase;
    this.reloadTime = c.reloadTime;
    this.cooldown = 0;
    this.reloading = false;
    this.recoil = 0;
    this.kick = 0;
    this.owned = true; // 狙击枪需从宝箱获取，初始为 false

    this._buildViewModel();
    this._initTracers();
  }

  // 切换地图重建场景后，把曳光弹池重新挂载
  resetScene(scene) {
    this.scene = scene;
    for (const l of this.tracerPool) scene.add(l);
  }

  _buildViewModel() {
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x181c20, roughness: 0.42, metalness: 0.65 });
    const grip = new THREE.MeshStandardMaterial({ color: 0x24282c, roughness: 0.8 });
    const woodM = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.7 });

    if (this.kind === 'sniper') {
      // M700：长枪管 + 瞄准镜 + 木托
      const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.66), dark);
      receiver.position.set(0, 0, -0.12);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.6, 10), dark);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.012, -0.78);
      const scopeTube = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.26, 12), dark);
      scopeTube.rotation.x = Math.PI / 2;
      scopeTube.position.set(0, 0.098, -0.04);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.046, 12),
        new THREE.MeshBasicMaterial({ color: 0x0a2028 }));
      lens.position.set(0, 0.098, -0.171);
      lens.rotation.y = Math.PI;
      const mount1 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.03), dark);
      mount1.position.set(0, 0.06, 0.02);
      const mount2 = mount1.clone();
      mount2.position.z = -0.1;
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.3), woodM);
      stock.position.set(0, -0.02, 0.32);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.13, 0.06), grip);
      handle.position.set(0, -0.1, 0.1);
      handle.rotation.x = 0.3;
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.09, 8), dark);
      bolt.rotation.z = Math.PI / 2;
      bolt.position.set(0.06, 0.02, 0.04);
      g.add(receiver, barrel, scopeTube, lens, mount1, mount2, stock, handle, bolt);
      g.position.set(0.22, -0.2, -0.45);
      this.muzzleZ = -1.1;
    } else {
      // AS VAL：集成消音器 + 折托
      const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.5), dark);
      receiver.position.set(0, 0, -0.1);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.42, 10), dark);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.012, -0.52);
      const suppressor = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.26, 10), dark);
      suppressor.rotation.x = Math.PI / 2;
      suppressor.position.set(0, 0.012, -0.78);
      const magBox = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.2, 0.09), dark);
      magBox.position.set(0, -0.13, -0.08);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.24), woodM);
      stock.position.set(0, -0.015, 0.3);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.06), grip);
      handle.position.set(0, -0.11, 0.12);
      handle.rotation.x = 0.3;
      const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.1), dark);
      sight.position.set(0, 0.08, -0.05);
      g.add(receiver, barrel, suppressor, magBox, stock, handle, sight);
      g.position.set(0.22, -0.2, -0.42);
      this.muzzleZ = -0.92;
    }

    g.traverse(m => { m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false; });

    // 枪口火光
    this.flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd080, transparent: true, opacity: 0 })
    );
    this.flash.position.set(0, 0.012, this.muzzleZ);
    this.flash.frustumCulled = false;
    g.add(this.flash);

    this.flashLight = new THREE.PointLight(0xffc070, 0, 12, 2);
    this.flashLight.position.set(0, 0, this.muzzleZ + 0.1);
    g.add(this.flashLight);

    // 挂在相机上（第一人称枪模）
    g.rotation.y = 0.03;
    this.viewmodel = g;
    this.camera.add(g);
  }

  _initTracers() {
    this.tracers = [];
    this.tracerPool = [];
    for (let i = 0; i < 24; i++) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: 0xffd070, transparent: true, opacity: 0
      }));
      line.frustumCulled = false;
      this.scene.add(line);
      this.tracerPool.push(line);
    }
  }

  spawnTracer(from, to) {
    const line = this.tracerPool.find(l => l.material.opacity <= 0.02) || this.tracerPool[0];
    const pos = line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    line.material.opacity = 0.85;
    line.userData.life = 0.09;
    this.tracers.push(line);
  }

  startReload() {
    if (this.reloading || this.mag >= this.magSize || this.reserve <= 0) return false;
    this.reloading = true;
    this.reloadTimer = this.reloadTime;
    return true;
  }

  tryFire(spread) {
    if (this.reloading || this.cooldown > 0) return null;
    if (this.mag <= 0) return null;
    this.mag--;
    this.cooldown = this.fireInterval;
    // 瞬时后坐：连射累积（封顶），驱动准星上跳与枪口抬起动画
    this.recoil = Math.min(this.recoilCap, this.recoil + this.recoilPerShot);
    this.kick = 1;
    // 方向：相机前方 + 扩散
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    dir.x += (Math.random() - 0.5) * spread * 2;
    dir.y += (Math.random() - 0.5) * spread * 2;
    dir.z += (Math.random() - 0.5) * spread * 2;
    dir.normalize();
    const origin = new THREE.Vector3();
    this.camera.getWorldPosition(origin);
    this.flash.material.opacity = 0.9;
    this.flashLight.intensity = 30;
    return { origin, dir };
  }

  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.recoil = Math.max(0, this.recoil - dt * 0.06);
    this.kick = Math.max(0, this.kick - dt * 10);
    this.flash.material.opacity = Math.max(0, this.flash.material.opacity - dt * 14);
    this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 400);

    if (this.reloading) {
      this.reloadTimer -= dt;
      const t = 1 - Math.max(0, this.reloadTimer) / this.reloadTime;
      // 换弹动画：枪下沉翻转
      this.viewmodel.position.y = (this.kind === 'sniper' ? -0.2 : -0.2) - Math.sin(t * Math.PI) * 0.18;
      this.viewmodel.rotation.z = Math.sin(t * Math.PI) * 0.6;
      if (this.reloadTimer <= 0) {
        const need = this.magSize - this.mag;
        const take = Math.min(need, this.reserve);
        this.mag += take;
        this.reserve -= take;
        this.reloading = false;
        this.viewmodel.position.y = -0.2;
        this.viewmodel.rotation.z = 0;
      }
    } else {
      // 射击晃动 + 枪口上抬（kick 衰减产生回弹感）
      this.viewmodel.rotation.x = -this.kick * 0.14;
      this.viewmodel.position.z = (this.kind === 'sniper' ? -0.45 : -0.42) + this.kick * 0.05;
      this.viewmodel.position.y = -0.2 + Math.sin(performance.now() * 0.004) * 0.004;
    }

    for (const l of this.tracerPool) {
      if (l.material.opacity > 0) {
        l.material.opacity -= dt * 11;
      }
    }
  }

  currentSpread(moving, crouching, airborne, scoped = false) {
    if (this.kind === 'sniper') {
      // 开镜近乎指哪打哪；腰射扩散很大
      if (scoped) return 0.0006;
      return this.spreadBase + (moving ? 0.02 : 0) + (airborne ? 0.04 : 0) + this.recoil * 0.5;
    }
    let s = this.spreadBase;
    if (moving) s += 0.012;
    if (crouching) s *= 0.55;
    if (airborne) s += 0.03;
    s += this.recoil * 1.6;
    return s;
  }
}
