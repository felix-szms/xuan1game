import * as THREE from 'three';
import { concreteTexture, groundTexture, containerTexture, metalTexture, woodTexture, plasterTexture, contactShadowTexture } from './textures.js';

// ============================================================
// 潮汐监狱 地图：几何、碰撞体、巡逻点、小地图数据
// 坐标：1 单位 = 1 米，地图核心区约 130 x 130
// ============================================================

export const MAP_HALF = 78;

export class World {
  constructor(scene) {
    this.scene = scene;
    this.colliders = [];        // { min:{x,y,z}, max:{x,y,z} }
    this.solidMeshes = [];
    this.minimapRects = [];     // { x, z, w, d } 俯视图
    this.patrolPoints = [];
    this.spawnPoint = new THREE.Vector3(-52, 0, 40);
    this.extractPoint = new THREE.Vector3(0, 0, 84);
    this.extractRadius = 7;
    // 每局随机的出生点 / 撤离点候选
    this.spawnPoints = [
      new THREE.Vector3(-52, 0, 40), new THREE.Vector3(52, 0, 40),
      new THREE.Vector3(-52, 0, -6), new THREE.Vector3(52, 0, -6),
      new THREE.Vector3(-40, 0, 52), new THREE.Vector3(40, 0, 52)
    ];
    this.extractPoints = [
      new THREE.Vector3(0, 0, 84),    // 南侧码头（直升机）
      new THREE.Vector3(-52, 0, 52),  // 西北角绳梯点
      new THREE.Vector3(52, 0, 52)    // 东北角绳梯点
    ];
    this.water = null;
    this.lampLights = [];
    this._build();
  }

  addCollider(cx, cy, cz, sx, sy, sz) {
    this.colliders.push({
      min: { x: cx - sx / 2, y: cy - sy / 2, z: cz - sz / 2 },
      max: { x: cx + sx / 2, y: cy + sy / 2, z: cz + sz / 2 }
    });
  }

  box(w, h, d, mat, x, y, z, opts = {}) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y + h / 2, z);
    if (opts.ry) m.rotation.y = opts.ry;
    m.castShadow = opts.cast !== false;
    m.receiveShadow = true;
    this.scene.add(m);
    if (opts.solid !== false) {
      this.solidMeshes.push(m);
      if (opts.ry) {
        // 旋转过的包围盒按 AABB 近似（容器等小角度影响可忽略则用外接盒）
        const c = Math.abs(Math.cos(opts.ry)), s = Math.abs(Math.sin(opts.ry));
        const ew = w * c + d * s, ed = w * s + d * c;
        this.addCollider(x, y + h / 2, z, ew, h, ed);
      } else {
        this.addCollider(x, y + h / 2, z, w, h, d);
      }
      if (!opts.noMinimap && h > 1.2) this.minimapRects.push({ x, z, w: w, d: d });
    }
    return m;
  }

  _build() {
    const S = this.scene;

    // ---------- 材质（程序化照片风纹理） ----------
    const concrete = new THREE.MeshStandardMaterial({ map: concreteTexture(512, 4, '#82898f'), roughness: 0.95, metalness: 0.02 });
    const concreteDark = new THREE.MeshStandardMaterial({ map: groundTexture(512, 24), roughness: 0.97, color: 0xb8bcc0 });
    const wallPaint = new THREE.MeshStandardMaterial({ map: plasterTexture(512, 4, '#6e7a72'), roughness: 0.9 });
    const rust = new THREE.MeshStandardMaterial({ map: containerTexture('#6e4a33'), roughness: 0.85, metalness: 0.35 });
    const steel = new THREE.MeshStandardMaterial({ map: metalTexture(256, 2, '#48545e'), roughness: 0.5, metalness: 0.75 });
    const wood = new THREE.MeshStandardMaterial({ map: woodTexture(512, 2, '#6b5638'), roughness: 0.9 });
    const barMat = new THREE.MeshStandardMaterial({ color: 0x2c343a, roughness: 0.45, metalness: 0.85 });
    const red = new THREE.MeshStandardMaterial({ map: containerTexture('#7a3b30'), roughness: 0.8, metalness: 0.2 });
    const blue = new THREE.MeshStandardMaterial({ map: containerTexture('#33566b'), roughness: 0.8, metalness: 0.2 });
    const green = new THREE.MeshStandardMaterial({ map: containerTexture('#4c6244'), roughness: 0.8, metalness: 0.2 });
    const yellow = new THREE.MeshStandardMaterial({ map: containerTexture('#8a7a35'), roughness: 0.85, metalness: 0.15 });
    this.mats = { concrete, concreteDark, wallPaint, rust, steel, wood, barMat, red, blue, green, yellow };
    this.shadowTex = contactShadowTexture();

    // ---------- 天空 / 雾 / 灯光 ----------
    S.background = new THREE.Color(0x0d1722);
    S.fog = new THREE.Fog(0x0d1722, 50, 170);

    const hemi = new THREE.HemisphereLight(0x4a6280, 0x1c242c, 0.85);
    S.add(hemi);

    const moon = new THREE.DirectionalLight(0xaec6e6, 1.7);
    moon.position.set(-60, 90, -40);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    moon.shadow.camera.left = -90; moon.shadow.camera.right = 90;
    moon.shadow.camera.top = 90; moon.shadow.camera.bottom = -90;
    moon.shadow.camera.far = 250;
    moon.shadow.bias = -0.0006;
    S.add(moon);

    // 星空（不受雾影响）
    const starCount = 700;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const el = Math.random() * Math.PI * 0.46 + 0.08;
      const r = 330;
      starPos[i * 3] = Math.cos(el) * Math.cos(a) * r;
      starPos[i * 3 + 1] = Math.sin(el) * r;
      starPos[i * 3 + 2] = Math.cos(el) * Math.sin(a) * r;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    S.add(new THREE.Points(starGeo, new THREE.PointsMaterial({
      color: 0xcfe0ff, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.8, fog: false
    })));

    // ---------- 地面（监狱岛台） ----------
    const ground = new THREE.Mesh(new THREE.BoxGeometry(MAP_HALF * 2, 3, MAP_HALF * 2), concreteDark);
    ground.position.y = -1.5;
    ground.receiveShadow = true;
    S.add(ground);
    this.addCollider(0, -1.5, 0, MAP_HALF * 2, 3, MAP_HALF * 2);

    // 码头栈桥（南侧伸出）
    const pier = new THREE.Mesh(new THREE.BoxGeometry(10, 1, 34), wood);
    pier.position.set(0, -0.5, MAP_HALF + 16);
    pier.receiveShadow = true; pier.castShadow = true;
    S.add(pier);
    this.addCollider(0, -0.5, MAP_HALF + 16, 10, 1, 34);

    // ---------- 环形海水 ----------
    const waterGeo = new THREE.PlaneGeometry(600, 600, 64, 64);
    const waterMat = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uDeep: { value: new THREE.Color(0x07222e) },
        uShallow: { value: new THREE.Color(0x14506a) }
      },
      vertexShader: `
        uniform float uTime;
        varying vec2 vUv; varying float vWave;
        void main() {
          vUv = uv;
          vec3 p = position;
          float w = sin(p.x * 0.12 + uTime * 1.2) * 0.35 + sin(p.y * 0.09 - uTime * 0.8) * 0.3
                  + sin((p.x + p.y) * 0.05 + uTime * 0.5) * 0.25;
          p.z += w;
          vWave = w;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uDeep; uniform vec3 uShallow;
        varying vec2 vUv; varying float vWave;
        void main() {
          float t = smoothstep(-0.6, 0.7, vWave);
          vec3 col = mix(uDeep, uShallow, t);
          float spec = pow(max(vWave, 0.0), 6.0) * 0.6;
          col += spec;
          gl_FragColor = vec4(col, 0.92);
        }`
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = -0.7;
    S.add(water);
    this.water = water;

    // ---------- 外围墙（南侧开门通码头） ----------
    const H = 8;
    // 北
    this.box(MAP_HALF * 2, H, 1.2, concrete, 0, 0, -MAP_HALF);
    // 南：留 10m 门洞
    this.box(MAP_HALF - 5, H, 1.2, concrete, -(MAP_HALF / 2 + 2.5), 0, MAP_HALF);
    this.box(MAP_HALF - 5, H, 1.2, concrete, (MAP_HALF / 2 + 2.5), 0, MAP_HALF);
    this.box(1.2, H, 1.2, concrete, -5, 0, MAP_HALF);
    this.box(1.2, H, 1.2, concrete, 5, 0, MAP_HALF);
    // 门楣
    this.box(10, 2, 1.2, concrete, 0, 6, MAP_HALF, { solid: true });
    // 东西
    this.box(1.2, H, MAP_HALF * 2, concrete, -MAP_HALF, 0, 0);
    this.box(1.2, H, MAP_HALF * 2, concrete, MAP_HALF, 0, 0);

    // 四角哨塔
    for (const [tx, tz] of [[-MAP_HALF + 4, -MAP_HALF + 4], [MAP_HALF - 4, -MAP_HALF + 4],
                            [-MAP_HALF + 4, MAP_HALF - 4], [MAP_HALF - 4, MAP_HALF - 4]]) {
      this.box(5, 11, 5, concreteDark, tx, 0, tz);
      this.box(6.4, 0.6, 6.4, steel, tx, 11, tz);
      this.addContactShadow(tx, tz, 7.5, 7.5, 0.5);
      // 塔灯
      this._lamp(tx, 12.5, tz, 0xffd9a0, 30);
    }

    // ============ 监区主楼（西北，两层通高中庭 + 两侧牢房） ============
    const bx1 = -52, bx2 = -6, bz1 = -60, bz2 = -22; // 楼体范围
    const bh = 6.5;
    const cxm = (bx1 + bx2) / 2, czm = (bz1 + bz2) / 2;
    // 外墙（东墙留门洞 4m）
    this.box(bx2 - bx1, bh, 0.6, wallPaint, cxm, 0, bz1 + 0.3);
    this.box(bx2 - bx1, bh, 0.6, wallPaint, cxm, 0, bz2 - 0.3);
    this.box(0.6, bh, bz2 - bz1, wallPaint, bx1 + 0.3, 0, czm);
    this.box(0.6, bh, (bz2 - bz1) / 2 - 2, wallPaint, bx2 - 0.3, 0, bz1 + (bz2 - bz1) / 4 - 1);
    this.box(0.6, bh, (bz2 - bz1) / 2 - 2, wallPaint, bx2 - 0.3, 0, bz2 - (bz2 - bz1) / 4 + 1);
    this.box(0.6, 2.5, 4, wallPaint, bx2 - 0.3, 4, czm); // 门楣
    // 局部屋顶
    this.box(bx2 - bx1, 0.4, 6, concrete, cxm, bh, bz1 + 3, { solid: false, noMinimap: true });
    this.box(bx2 - bx1, 0.4, 6, concrete, cxm, bh, bz2 - 3, { solid: false, noMinimap: true });

    // 中央走廊（沿 x），南北两排牢房
    const corrZ1 = -46, corrZ2 = -36; // 走廊 z 范围
    // 牢房隔墙 + 铁栅栏（北排：z -60..-46；南排：z -36..-22）
    const cellW = 7;
    const nCells = Math.floor((bx2 - bx1) / cellW); // 6
    for (let i = 0; i <= nCells; i++) {
      const wx = bx1 + i * cellW;
      this.box(0.5, bh, 13, wallPaint, wx, 0, (bz1 + corrZ1) / 2 + 0.5); // 北排隔断（z -60..-46）
      this.box(0.5, bh, 13, wallPaint, wx, 0, (corrZ2 + bz2) / 2 - 0.5); // 南排
    }
    // 铁栅栏（每间牢房朝走廊面，留 1.6m 门洞）
    for (let i = 0; i < nCells; i++) {
      const mx = bx1 + i * cellW + cellW / 2;
      this._bars(mx - cellW / 2 + 1.8, mx + cellW / 2 - 1.8, corrZ1, true);   // 北排栅栏在 z=corrZ1
      this._bars(mx - cellW / 2 + 1.8, mx + cellW / 2 - 1.8, corrZ2, false);  // 南排栅栏在 z=corrZ2
    }
    // 走廊顶部灯
    for (let i = 0; i < 3; i++) this._lamp(bx1 + 8 + i * 14, 4.5, (corrZ1 + corrZ2) / 2, 0xffe2b0, 22, 14);
    // 走廊内物件
    this.box(3, 1, 1.2, steel, bx1 + 8, 0, corrZ2 + 2, { noMinimap: true });  // 长凳
    this.box(3, 1, 1.2, steel, bx2 - 12, 0, corrZ1 - 2, { noMinimap: true });

    // ============ 工坊（东北） ============
    const wx1 = 18, wx2 = 50, wz1 = -58, wz2 = -28;
    const wcx = (wx1 + wx2) / 2, wcz = (wz1 + wz2) / 2;
    const wh = 5.5;
    this.box(wx2 - wx1, wh, 0.6, wallPaint, wcx, 0, wz1 + 0.3);
    this.box(wx2 - wx1, wh, 0.6, wallPaint, wcx, 0, wz2 - 0.3);
    this.box(0.6, wh, wz2 - wz1, wallPaint, wx2 - 0.3, 0, wcz);
    // 西墙留门
    this.box(0.6, wh, 8, wallPaint, wx1 + 0.3, 0, wz1 + 4);
    this.box(0.6, wh, 8, wallPaint, wx1 + 0.3, 0, wz2 - 4);
    this.box(0.6, 2.5, (wz2 - wz1) - 16, wallPaint, wx1 + 0.3, 3, wcz);
    this.box(wx2 - wx1, 0.4, 8, concrete, wcx, wh, wz1 + 4, { solid: false, noMinimap: true });
    this.box(wx2 - wx1, 0.4, 8, concrete, wcx, wh, wz2 - 4, { solid: false, noMinimap: true });
    // 工作台 / 货架
    this.box(6, 1.1, 1.6, steel, 34, 0, -54, { noMinimap: true });
    this.box(1.6, 3, 6, steel, 46, 0, -44);
    this.box(4, 0.9, 4, rust, 24, 0, -32, { noMinimap: true });
    this._lamp(34, 5, -43, 0xd8e8ff, 26, 18);

    // ============ 放风场（南部大院子） ============
    // 集装箱群
    const cont = (x, z, ry, mat, stacked) => {
      this.box(6.1, 2.6, 2.5, mat, x, 0, z, { ry });
      this.addContactShadow(x, z, 7.6, 3.8, 0.45);
      if (stacked) this.box(6.1, 2.6, 2.5, red, x, 2.6, z, { ry });
    };
    cont(-30, 20, 0.12, blue, true);
    cont(-16, 34, -0.3, green, false);
    cont(8, 26, 1.65, red, false);
    cont(26, 12, 0.05, green, true);
    cont(40, 30, -0.2, blue, false);
    cont(-44, 6, 1.5, rust, false);
    // 水泥掩体
    this.box(4, 1.4, 1, concrete, 0, 0, 8, { noMinimap: true });
    this.box(1, 1.4, 4, concrete, -12, 0, 2, { noMinimap: true });
    this.box(4, 1.4, 1, concrete, 20, 0, -6, { noMinimap: true });
    this.box(1, 1.4, 4, concrete, 34, 0, 2, { noMinimap: true });
    // 废弃卡车
    this.box(5.5, 2.2, 2.4, rust, -8, 0, 48, { ry: 0.4 });
    this.box(2.2, 1.6, 2.2, steel, -4.6, 0, 49.8, { ry: 0.4 });
    this.addContactShadow(-7, 48.5, 8.5, 4.5, 0.45);
    // 木箱堆
    for (const [x, z] of [[-38, 34], [-36.4, 34.6], [-37.4, 32.5], [14, 40], [15.4, 39.2], [-2, 18]]) {
      this.box(1.6, 1.6, 1.6, wood, x, 0, z, { ry: Math.random() * 0.6, noMinimap: true });
    }
    // 油桶
    const barrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.1, 12);
    const barrelPos = [[-24, 8], [-23.2, 9], [30, 42], [31, 40.6], [44, -6], [45.4, -5], [-54, -12], [6, 34]];
    for (const [x, z] of barrelPos) {
      const b = new THREE.Mesh(barrelGeo, Math.random() > 0.5 ? red : rust);
      b.position.set(x, 0.55, z);
      b.castShadow = true; b.receiveShadow = true;
      S.add(b);
      this.addCollider(x, 0.55, z, 0.84, 1.1, 0.84);
      this.addContactShadow(x, z, 1.5, 1.5, 0.4);
    }
    // 中央高台（操场看台式）
    this.box(12, 2.2, 4, concrete, 18, 0, 52);
    this.box(12, 0.3, 1.2, steel, 18, 2.2, 50.4, { solid: false });
    // 场地灯柱
    for (const [x, z] of [[-20, 0], [20, 20], [-10, 44], [44, 16], [-48, 24]]) {
      this.box(0.35, 7, 0.35, steel, x, 0, z, { noMinimap: true });
      this._lamp(x, 7.4, z, 0xffe6c0, 34, 24);
    }

    // 走廊连通矮墙（引导动线）
    this.box(1, 2.5, 16, concrete, -6, 0, -12, { noMinimap: false });

    // ---------- 巡逻点 ----------
    this.patrolPoints = [
      new THREE.Vector3(-30, 0, -40), new THREE.Vector3(-48, 0, -28),
      new THREE.Vector3(-12, 0, -40), new THREE.Vector3(-20, 0, -55),
      new THREE.Vector3(34, 0, -46), new THREE.Vector3(24, 0, -34),
      new THREE.Vector3(-24, 0, 14), new THREE.Vector3(0, 0, 20),
      new THREE.Vector3(24, 0, 6), new THREE.Vector3(40, 0, 24),
      new THREE.Vector3(-40, 0, 40), new THREE.Vector3(-6, 0, 44),
      new THREE.Vector3(14, 0, 36), new THREE.Vector3(46, 0, 40),
      new THREE.Vector3(0, 0, 60), new THREE.Vector3(-50, 0, 8),
      new THREE.Vector3(50, 0, -12), new THREE.Vector3(-30, 0, 56)
    ];
  }

  // 伪环境光遮蔽接触阴影（贴在物件脚下的径向暗斑）
  addContactShadow(x, z, w, d, opacity = 0.4) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, opacity, depthWrite: false })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.02, z);
    this.scene.add(m);
  }

  // 一段铁栅栏：细杆阵列 + 碰撞（两端留门柱）
  _bars(x1, x2, z, northSide) {
    const S = this.scene;
    const g = new THREE.Group();
    const barMat = this.mats.barMat;
    const mid = (x1 + x2) / 2, span = x2 - x1;
    const zc = northSide ? z - 0.2 : z + 0.2;
    const n = Math.floor(span / 0.28);
    for (let i = 0; i <= n; i++) {
      const x = x1 + (span * i) / n;
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 3.4, 6), barMat);
      bar.position.set(x, 1.7, zc);
      g.add(bar);
    }
    // 横梁
    const rail = new THREE.Mesh(new THREE.BoxGeometry(span, 0.08, 0.08), barMat);
    rail.position.set(mid, 3.2, zc);
    g.add(rail);
    const rail2 = rail.clone(); rail2.position.y = 0.9;
    g.add(rail2);
    S.add(g);
    // 栅栏碰撞：矮一点便于视觉通透，但阻挡通行（2 段，中间留门洞 1.7m）
    const segL = (span - 1.7) / 2;
    this.addCollider(x1 + segL / 2, 1.7, zc, segL, 3.4, 0.3);
    this.addCollider(x2 - segL / 2, 1.7, zc, segL, 3.4, 0.3);
    this.solidMeshes.push(rail);
  }

  _lamp(x, y, z, color, intensity, dist = 30) {
    const S = this.scene;
    const fixture = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xfff2d0 })
    );
    fixture.position.set(x, y, z);
    S.add(fixture);
    if (this.lampLights.length < 10) {
      const l = new THREE.PointLight(color, intensity, dist, 1.8);
      l.position.set(x, y, z);
      S.add(l);
      this.lampLights.push(l);
    }
  }

  update(t) {
    if (this.water) {
      this.water.material.uniforms.uTime.value = t;
      // 潮汐缓慢上涨（视觉）
      this.water.position.y = -0.7 + Math.sin(t * 0.02) * 0.25;
    }
  }
}

// ============================================================
// 碰撞与射线工具
// ============================================================

// 玩家/敌人移动：分轴 AABB 解析
export function moveWithCollisions(pos, delta, colliders, radius = 0.38, height = 1.7) {
  const res = { x: pos.x + delta.x, z: pos.z + delta.z, hit: false };
  const feet = pos.y, head = pos.y + height;
  const tryAxis = (nx, nz) => {
    for (const c of colliders) {
      if (head < c.min.y || feet > c.max.y - 0.02) continue; // 垂直不相交
      if (nx + radius > c.min.x && nx - radius < c.max.x &&
          nz + radius > c.min.z && nz - radius < c.max.z) return true;
    }
    return false;
  };
  if (tryAxis(res.x, pos.z)) { res.x = pos.x; res.hit = true; }
  if (tryAxis(res.x, res.z)) { res.z = pos.z; res.hit = true; }
  return res;
}

// 站立支撑面高度（取脚下最高碰撞体顶面）
export function groundHeight(x, z, fromY, colliders) {
  let h = 0;
  for (const c of colliders) {
    if (x + 0.3 > c.min.x && x - 0.3 < c.max.x && z + 0.3 > c.min.z && z - 0.3 < c.max.z) {
      if (c.max.y <= fromY + 0.55 && c.max.y > h) h = c.max.y;
    }
  }
  return h;
}

// 射线 vs AABB 列表，返回最近命中距离（无命中返回 maxDist）
export function raycastWorld(origin, dir, maxDist, colliders) {
  let best = maxDist;
  for (const c of colliders) {
    let tmin = 0, tmax = best;
    let ok = true;
    for (const axis of ['x', 'y', 'z']) {
      const o = origin[axis], d = dir[axis];
      const mn = c.min[axis], mx = c.max[axis];
      if (Math.abs(d) < 1e-8) {
        if (o < mn || o > mx) { ok = false; break; }
      } else {
        let t1 = (mn - o) / d, t2 = (mx - o) / d;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) { ok = false; break; }
      }
    }
    if (ok && tmin < best && tmin > 0) best = tmin;
  }
  return best;
}

// 两点间视线是否通畅
export function hasLineOfSight(a, b, colliders) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const dist = dir.length();
  if (dist < 0.01) return true;
  dir.divideScalar(dist);
  return raycastWorld(a, dir, dist, colliders) >= dist - 0.05;
}
