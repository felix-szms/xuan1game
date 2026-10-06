import * as THREE from 'three';
import { startRotor, stopRotor, setRotorVolume, windRush, landThud } from './audio.js';

// ============================================================
// 直升机索降过场（仅丛林图）：
// 黑屏→俯瞰→抛绳→加速下滑（高度表）→落地尘土→直升机离场
// ============================================================

const T_HOVER = 0.9;    // 黑屏淡出结束
const T_ROPE = 1.8;     // 开始抛绳
const T_DROP = 2.3;     // 开始下滑
const T_LAND = 4.8;     // 落地
const T_DEPART = 6.4;   // 结束
const TOP_Y = 58;

export class Insertion {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.active = false;
    this.t = 0;
    this.spawn = new THREE.Vector3();
    this._dust = [];
    this._el = {
      root: document.getElementById('insertion'),
      black: document.getElementById('ins-black'),
      alt: document.getElementById('ins-alt'),
      hint: document.querySelector('#insertion .ins-skip-hint')
    };
  }

  start(spawnPos) {
    this.spawn.copy(spawnPos);
    this.t = 0;
    this.active = true;
    this._buildHeli();
    this._el.root.style.display = 'block';
    this._el.black.style.transition = 'none';
    this._el.black.style.opacity = 1;
    this._el.alt.textContent = '高度 -- m';
    startRotor();
    windRush(0.16);
  }

  _buildHeli() {
    const g = new THREE.Group();
    const bodyM = new THREE.MeshStandardMaterial({ color: 0x3a4a3c, roughness: 0.6, metalness: 0.3 });
    const darkM = new THREE.MeshStandardMaterial({ color: 0x1e2620, roughness: 0.7 });
    const fus = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 2.4, 4, 10), bodyM);
    fus.rotation.z = Math.PI / 2;
    const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.72, 10, 8), darkM);
    cockpit.position.set(1.7, 0.1, 0);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.42, 0.42), bodyM);
    tail.position.set(-2.6, 0.32, 0);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.16), bodyM);
    fin.position.set(-4, 0.9, 0);
    const skidL = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 0.14), darkM);
    skidL.position.set(0, -1.12, 0.55);
    const skidR = skidL.clone(); skidR.position.z = -0.55;
    const skidBar1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 1.2), darkM);
    skidBar1.position.set(0.7, -0.85, 0);
    const skidBar2 = skidBar1.clone(); skidBar2.position.x = -0.7;
    // 主旋翼：十字桨叶 + 模糊圆盘
    const blade = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.07, 0.34), darkM);
    const blade2 = blade.clone(); blade2.rotation.y = Math.PI / 2;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(3.9, 24),
      new THREE.MeshBasicMaterial({ color: 0x9ab0a0, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2;
    const rotorHub = new THREE.Group();
    rotorHub.position.set(0, 1.15, 0);
    rotorHub.add(blade, blade2, disc);
    // 尾桨
    const tblade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.5, 0.16), darkM);
    const tdisc = new THREE.Mesh(new THREE.CircleGeometry(0.78, 16),
      new THREE.MeshBasicMaterial({ color: 0x9ab0a0, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false }));
    tdisc.rotation.z = Math.PI / 2;
    const tailRotor = new THREE.Group();
    tailRotor.position.set(-4, 0.85, 0.3);
    tailRotor.add(tblade, tdisc);
    g.add(fus, cockpit, tail, fin, skidL, skidR, skidBar1, skidBar2, rotorHub, tailRotor);
    g.traverse(m => { m.castShadow = false; });
    this.heli = g;
    this.rotorHub = rotorHub;
    this.tailRotor = tailRotor;
    // 绳索
    const rope = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 1, 6),
      new THREE.MeshStandardMaterial({ color: 0xc8b89a, roughness: 0.9 })
    );
    this.rope = rope;
    this.scene.add(g, rope);
  }

  _spawnDust() {
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.22 + Math.random() * 0.2, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0x8a947e, transparent: true, opacity: 0.7 })
      );
      m.position.set(this.spawn.x + (Math.random() - 0.5) * 0.8, this.spawn.y + 0.25, this.spawn.z + (Math.random() - 0.5) * 0.8);
      const a = Math.random() * Math.PI * 2;
      this._dust.push({
        mesh: m,
        vel: new THREE.Vector3(Math.cos(a) * (1.5 + Math.random()), 0.8 + Math.random(), Math.sin(a) * (1.5 + Math.random())),
        life: 0.55
      });
      this.scene.add(m);
    }
  }

  skip() {
    if (!this.active || this.t >= T_LAND) return;
    this.t = T_LAND - 0.01; // 直接送至落地瞬间
  }

  // 返回 true 表示过场结束
  update(dt, yaw) {
    if (!this.active) return true;
    this.t += dt;
    const t = this.t;
    const sp = this.spawn;
    const eye = 1.62;

    // 直升机：悬停浮动 → 落地后爬升离场
    let heliY = TOP_Y + 6 + Math.sin(t * 1.1) * 0.5;
    let heliX = sp.x, heliZ = sp.z;
    if (t > T_LAND) {
      const k = (t - T_LAND) / (T_DEPART - T_LAND);
      heliY += k * 26;
      heliX += k * 34 * Math.sin(yaw + 0.8);
      heliZ += k * 34 * Math.cos(yaw + 0.8);
      setRotorVolume(Math.max(0.02, 0.4 * (1 - k)));
    }
    this.heli.position.set(heliX, heliY, heliZ);
    this.heli.rotation.z = t > T_LAND ? Math.sin((t - T_LAND) * 2) * 0.06 - 0.1 * ((t - T_LAND) / (T_DEPART - T_LAND)) : Math.sin(t * 0.8) * 0.03;
    this.rotorHub.rotation.y += dt * 28;
    this.tailRotor.rotation.x += dt * 34;

    // 绳索：抛绳后从直升机垂到相机下方；离场时收起
    const ropeVisible = t > T_ROPE && t < T_LAND + 0.3;
    this.rope.visible = ropeVisible;
    if (ropeVisible) {
      const extend = Math.min(1, (t - T_ROPE) / 0.5);
      const ropeTop = heliY - 1.3;
      const ropeBottom = Math.max(sp.y, Math.min(ropeTop, this.camera.position.y - 0.4)) - extend * 0 + sp.y;
      const len = Math.max(0.1, ropeTop - sp.y) * extend;
      this.rope.scale.y = len;
      this.rope.position.set(sp.x, ropeTop - len / 2, sp.z);
    }

    // 相机时间线
    if (t < T_HOVER) {
      // 黑屏淡出 + 缓慢下降
      this._el.black.style.transition = `opacity ${T_HOVER}s ease-out`;
      this._el.black.style.opacity = Math.max(0, 1 - t / T_HOVER);
      this.camera.position.set(sp.x, TOP_Y + 1.5 - t * 1.2, sp.z);
      this.camera.rotation.set(-0.62, yaw, 0, 'YXZ');
    } else if (t < T_DROP) {
      // 悬停俯瞰
      this._el.black.style.opacity = 0;
      this.camera.position.set(sp.x + Math.sin(t * 0.7) * 0.8, TOP_Y + 0.6 - (t - T_HOVER) * 0.8, sp.z + Math.cos(t * 0.7) * 0.8);
      this.camera.rotation.set(-0.58, yaw, 0, 'YXZ');
      this._el.alt.textContent = `高度 ${Math.round(this.camera.position.y - eye)} m`;
    } else if (t < T_LAND) {
      // 索降：加速下滑 + 摆动（smoothstep）
      const k = Math.min(1, (t - T_DROP) / (T_LAND - T_DROP));
      const e = k * k * (3 - 2 * k);
      const y = (TOP_Y + 0.6) - ((TOP_Y + 0.6) - eye) * e;
      const sway = (1 - k) * Math.sin(t * 3.2) * 0.35;
      this.camera.position.set(sp.x + sway, y, sp.z + sway * 0.6);
      this.camera.rotation.set(-0.12 - (1 - k) * 0.1, yaw + sway * 0.05, sway * 0.1, 'YXZ');
      if (k > 0.1 && !this._windPlayed) { windRush(0.34); this._windPlayed = true; }
      this._el.alt.textContent = `高度 ${Math.max(0, Math.round(this.camera.position.y - eye))} m`;
    } else if (t < T_LAND + 0.35) {
      // 落地：下沉回弹
      if (!this._landed) {
        this._landed = true;
        this._spawnDust();
        landThud();
        setRotorVolume(0.32);
        this._el.alt.textContent = '已着陆';
      }
      const k = (t - T_LAND) / 0.35;
      const dip = -0.22 * Math.sin(Math.PI * k);
      this.camera.position.set(sp.x, eye + dip, sp.z);
      this.camera.rotation.set(0, yaw, 0, 'YXZ');
    } else {
      // 站定目送直升机
      this.camera.position.set(sp.x, eye, sp.z);
      this.camera.rotation.set(0.18, yaw, 0, 'YXZ');
      this._el.alt.textContent = '';
    }

    // 尘土
    for (let i = this._dust.length - 1; i >= 0; i--) {
      const d = this._dust[i];
      d.life -= dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.material.opacity = Math.max(0, d.life * 1.2);
      if (d.life <= 0) { this.scene.remove(d.mesh); this._dust.splice(i, 1); }
    }

    if (t >= T_DEPART) {
      this.dispose();
      return true;
    }
    return false;
  }

  dispose() {
    if (this.heli) { this.scene.remove(this.heli, this.rope); this.heli = null; }
    for (const d of this._dust) this.scene.remove(d.mesh);
    this._dust = [];
    this._el.root.style.display = 'none';
    this._el.black.style.opacity = 0;
    this._landed = false;
    this._windPlayed = false;
    this.active = false;
    stopRotor();
  }
}
