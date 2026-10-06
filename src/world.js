import * as THREE from 'three';
import { concreteTexture, groundTexture, containerTexture, metalTexture, woodTexture, plasterTexture, contactShadowTexture, grassTexture } from './textures.js';

// ============================================================
// 潮汐监狱 地图：几何、碰撞体、巡逻点、小地图数据
// 坐标：1 单位 = 1 米，地图核心区约 130 x 130
// ============================================================

// ============================================================
// 地图注册表与通用工具（碰撞/射线）
// 坐标：1 单位 = 1 米
// ============================================================

export const MAP_HALF = 78;

// 地图注册表：名称与描述（开局地图选择界面用）
export const MAPS = {
  prison: { id: 'prison', name: '潮汐监狱', desc: '夜战 · 监区牢房 / 放风场 / 码头' },
  dam:    { id: 'dam',    name: '零号大坝', desc: '黄昏 · 坝顶机房 / 泄洪道 / 行政辖区 / 村庄' },
  jungle: { id: 'jungle', name: '丛林冒险', desc: '雨雾清晨 · 研究站 / 树屋 / 古庙遗迹 / 直升机索降' }
};

export class World {
  constructor(scene, mapId = 'prison') {
    this.scene = scene;
    this.mapId = MAPS[mapId] ? mapId : 'prison';
    this.mapHalf = this.mapId === 'jungle' ? 110 : MAP_HALF;
    this.enemyCount = this.mapId === 'jungle' ? 14 : 10;
    this.colliders = [];        // { min:{x,y,z}, max:{x,y,z} }
    this.solidMeshes = [];
    this.minimapRects = [];     // { x, z, w, d } 俯视图
    this.patrolPoints = [];
    this.spawnPoints = [];
    this.extractPoints = [];
    this.spawnPoint = new THREE.Vector3(-52, 0, 40);
    this.extractPoint = new THREE.Vector3(0, 0, 84);
    this.extractRadius = 7;
    this.waters = [];
    this.lampLights = [];
    this.stream = null;         // 涉水减速带 { x1, x2 }
    this.rain = null;
    if (this.mapId === 'dam') this._buildZeroDam();
    else if (this.mapId === 'jungle') this._buildJungle();
    else this._buildTidePrison();
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

  // 天空穹顶：渐变天幕（不受雾影响），替换死板纯色背景
  _addSky(top, horizon, sunDir) {
    const S = this.scene;
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(340, 20, 12),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: { uTop: { value: new THREE.Color(top) }, uHorizon: { value: new THREE.Color(horizon) } },
        vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 uTop; uniform vec3 uHorizon; varying vec3 vP;
          void main(){ float h = normalize(vP).y; gl_FragColor = vec4(mix(uHorizon, uTop, smoothstep(-0.05, 0.45, h)), 1.0); }`
      })
    );
    S.add(dome);
    // 太阳/月亮光盘
    if (sunDir) {
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(14, 24),
        new THREE.MeshBasicMaterial({ color: sunDir.color, transparent: true, opacity: 0.9, fog: false, depthWrite: false })
      );
      disc.position.copy(sunDir.dir).normalize().multiplyScalar(320);
      disc.lookAt(0, 0, 0);
      S.add(disc);
      const halo = new THREE.Mesh(
        new THREE.CircleGeometry(34, 24),
        new THREE.MeshBasicMaterial({ color: sunDir.color, transparent: true, opacity: 0.16, fog: false, depthWrite: false })
      );
      halo.position.copy(disc.position);
      halo.lookAt(0, 0, 0);
      S.add(halo);
    }
  }

  // ============================================================
  // 地图一：潮汐监狱（夜战）
  // ============================================================
  _buildTidePrison() {
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
    this._addSky(0x05080f, 0x14273a, { dir: new THREE.Vector3(-60, 90, -40), color: 0xbfd2e8 });

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

    // ---------- 水面（通用方法，监狱环绕海水 / 大坝上游水库） ----------
    this._addWater(0, 0, 600, 600, -0.7);

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

    // ============ 东南仓库区（扩建 POI） ============
    const whX = 46, whZ = 58;
    // 仓库主体 14×10，门朝西
    this.box(14, 4.5, 0.5, wallPaint, whX, 0, whZ - 5);
    this.box(14, 4.5, 0.5, wallPaint, whX, 0, whZ + 5);
    this.box(0.5, 4.5, 10, wallPaint, whX + 7, 0, whZ);
    this.box(0.5, 4.5, 3.4, wallPaint, whX - 7, 0, whZ - 3.3);
    this.box(0.5, 4.5, 3.4, wallPaint, whX - 7, 0, whZ + 3.3);
    this.box(0.5, 1.6, 3.2, wallPaint, whX - 7, 2.9, whZ, { noMinimap: true });
    this.box(15, 0.4, 11, concrete, whX, 4.5, whZ, { solid: false });
    // 内部货架与办公桌
    this.box(4.5, 1.2, 1.2, steel, whX + 3, 0, whZ - 3);
    this.box(4.5, 1.2, 1.2, steel, whX + 3, 0, whZ + 2);
    this.box(2.4, 0.9, 1.1, wood, whX - 4, 0, whZ + 3.6, { noMinimap: true });
    this._lamp(whX, 4.2, whZ, 0xd8e8ff, 26, 16);
    // 外围：废弃叉车掩体与围栏
    this.box(3.2, 1.8, 1.8, rust, whX - 12, 0, whZ - 2, { ry: 0.3 });
    this.addContactShadow(whX - 12, whZ - 2, 5, 3.5, 0.4);
    this.box(0.3, 1.2, 8, steel, whX - 3, 0, whZ + 9, { noMinimap: true });
    this.addContactShadow(whX, whZ, 17, 13, 0.45);

    // ---------- 巡逻点 ----------
    this.patrolPoints = [
      new THREE.Vector3(-30, 0, -40), new THREE.Vector3(-48, 0, -28),
      new THREE.Vector3(-12, 0, -40), new THREE.Vector3(-20, 0, -55),
      new THREE.Vector3(34, 0, -46), new THREE.Vector3(20, 0, -34),
      new THREE.Vector3(-24, 0, 14), new THREE.Vector3(0, 0, 20),
      new THREE.Vector3(24, 0, 6), new THREE.Vector3(40, 0, 24),
      new THREE.Vector3(-40, 0, 40), new THREE.Vector3(-6, 0, 44),
      new THREE.Vector3(14, 0, 36), new THREE.Vector3(44, 0, 28),
      new THREE.Vector3(0, 0, 60), new THREE.Vector3(-50, 0, 8),
      new THREE.Vector3(40, 0, -18), new THREE.Vector3(-26, 0, 48),
      // 仓库区
      new THREE.Vector3(38, 0, 58), new THREE.Vector3(50, 0, 64), new THREE.Vector3(44, 0, 50)
    ];

    // ---------- 出生点 / 撤离点候选（每局随机） ----------
    this.spawnPoints = [
      new THREE.Vector3(-52, 0, 40), new THREE.Vector3(52, 0, 40),
      new THREE.Vector3(-52, 0, -6), new THREE.Vector3(52, 0, -6),
      new THREE.Vector3(-40, 0, 52), new THREE.Vector3(34, 0, 48)
    ];
    this.extractPoints = [
      new THREE.Vector3(0, 0, 84),    // 南侧码头（直升机）
      new THREE.Vector3(-52, 0, 52),  // 西北角绳梯点
      new THREE.Vector3(52, 0, 52)    // 东北角绳梯点
    ];
  }

  // 伪环境光遮蔽接触阴影（贴在物件脚下的径向暗斑）
  addContactShadow(x, z, w, d, opacity = 0.4, y = 0.02) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, opacity, depthWrite: false })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    this.scene.add(m);
  }

  // ============================================================
  // 地图二：零号大坝（黄昏，沙漠峡谷中的水坝工事群）
  // 参考《三角洲行动》烽火地带零号大坝：坝顶机房、泄洪道、
  // 行政辖区、村庄、电站、集装箱区、直升机坪
  // ============================================================
  _buildZeroDam() {
    const S = this.scene;

    // ---------- 材质（暖沙色调） ----------
    const sand = new THREE.MeshStandardMaterial({ map: groundTexture(512, 24, '#8a744f'), roughness: 0.96 });
    const cliff = new THREE.MeshStandardMaterial({ map: concreteTexture(512, 6, '#6e5c40'), roughness: 0.95 });
    const damCon = new THREE.MeshStandardMaterial({ map: concreteTexture(512, 4, '#9a948a'), roughness: 0.9 });
    const adobe = new THREE.MeshStandardMaterial({ map: plasterTexture(512, 3, '#a8926c'), roughness: 0.9 });
    const steel = new THREE.MeshStandardMaterial({ map: metalTexture(256, 2, '#48545e'), roughness: 0.5, metalness: 0.75 });
    const wood = new THREE.MeshStandardMaterial({ map: woodTexture(512, 2, '#6b5638'), roughness: 0.9 });
    const rust = new THREE.MeshStandardMaterial({ map: containerTexture('#6e4a33'), roughness: 0.85, metalness: 0.35 });
    const blue = new THREE.MeshStandardMaterial({ map: containerTexture('#33566b'), roughness: 0.8, metalness: 0.2 });
    const red = new THREE.MeshStandardMaterial({ map: containerTexture('#7a3b30'), roughness: 0.8, metalness: 0.2 });
    const green = new THREE.MeshStandardMaterial({ map: containerTexture('#4c6244'), roughness: 0.8, metalness: 0.2 });
    this.mats = { concrete: damCon, concreteDark: sand, wallPaint: adobe, rust, steel, wood, red, blue, green };
    this.shadowTex = contactShadowTexture();

    // ---------- 黄昏光照 ----------
    S.background = new THREE.Color(0x40311f);
    S.fog = new THREE.Fog(0x40311f, 55, 190);
    this._addSky(0x241f38, 0xb35c2e, { dir: new THREE.Vector3(-50, 38, 35), color: 0xffb066 });
    S.environmentIntensity = 0.32;
    S.add(new THREE.HemisphereLight(0xa08a64, 0x30261a, 1.0));
    const sun = new THREE.DirectionalLight(0xffc98a, 2.2);
    sun.position.set(-50, 60, 35);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -95; sun.shadow.camera.right = 95;
    sun.shadow.camera.top = 95; sun.shadow.camera.bottom = -95;
    sun.shadow.camera.far = 260;
    sun.shadow.bias = -0.0006;
    S.add(sun);

    // ---------- 地面（沙漠台地）与峡谷岩壁 ----------
    const ground = new THREE.Mesh(new THREE.BoxGeometry(MAP_HALF * 2, 3, MAP_HALF * 2), sand);
    ground.position.y = -1.5;
    ground.receiveShadow = true;
    S.add(ground);
    this.addCollider(0, -1.5, 0, MAP_HALF * 2, 3, MAP_HALF * 2);
    // 岩壁（围合边界，比监狱围墙更有野外感）
    this.box(MAP_HALF * 2, 14, 3, cliff, 0, 0, -MAP_HALF);
    this.box(MAP_HALF * 2, 14, 3, cliff, 0, 0, MAP_HALF);
    this.box(3, 14, MAP_HALF * 2, cliff, -MAP_HALF, 0, 0);
    this.box(3, 14, MAP_HALF * 2, cliff, MAP_HALF, 0, 0);

    // ---------- 大坝主体（北侧，横贯东西） ----------
    // 坝体分两段，中间是泄洪道闸房
    this.box(62, 12, 10, damCon, -39, 0, -50);   // 西段 x -70..-8
    this.box(62, 12, 10, damCon, 39, 0, -50);    // 东段 x 8..70
    // 坝顶路面（可行走）
    this.box(62, 0.6, 10, damCon, -39, 12, -50, { noMinimap: true });
    this.box(62, 0.6, 10, damCon, 39, 12, -50, { noMinimap: true });
    // 坝顶机房 ×4（可进入的高价值区，门朝南）
    for (const mx of [-55, -25, 25, 55]) {
      this.box(12, 4.2, 0.4, adobe, mx, 12.6, -53.6);          // 背墙
      this.box(0.4, 4.2, 8, adobe, mx - 5.8, 12.6, -50);       // 西墙
      this.box(0.4, 4.2, 8, adobe, mx + 5.8, 12.6, -50);       // 东墙
      this.box(4.6, 4.2, 0.4, adobe, mx - 3.7, 12.6, -46.4);   // 前脸左
      this.box(4.6, 4.2, 0.4, adobe, mx + 3.7, 12.6, -46.4);   // 前脸右
      this.box(2.8, 1.6, 0.4, adobe, mx, 15.2, -46.4, { noMinimap: true }); // 门楣
      this.box(12.6, 0.4, 8.6, damCon, mx, 16.8, -50, { solid: false });    // 顶
      this._lamp(mx, 12.4, -48.5, 0xffe6c0, 24, 14);
    }
    // 上下坝阶梯：沿坝体南立面东西向爬升（0.525m 一级），顶端可北行上坝顶
    for (let i = 0; i < 24; i++) {
      this.box(1.2, (i + 1) * 0.525, 5, damCon, 69.4 - i * 1.2, 0, -42, { noMinimap: true });
      this.box(1.2, (i + 1) * 0.525, 5, damCon, -69.4 + i * 1.2, 0, -42, { noMinimap: true });
    }
    // 泄洪道闸房（大坝中央通道）
    this.box(2, 10, 10, damCon, -7, 0, -50);
    this.box(2, 10, 10, damCon, 7, 0, -50);
    this.box(16, 1, 10, damCon, 0, 9, -50); // 顶板
    this.box(14, 9, 0.4, steel, 0, 0, -54.6, { noMinimap: true }); // 北端拦污栅（挡住水库侧）
    this._lamp(0, 6, -49, 0xffc060, 30, 14); // 通道内警示灯
    // 上游水库水面（坝后）
    this._addWater(0, -88, 240, 60, 9.8);

    // ---------- 行政辖区（中东部主楼，室内高价值区） ----------
    const ax = 35, az = -7; // 中心
    this.box(26, 5, 0.6, adobe, ax, 0, az - 9);            // 北墙
    this.box(26, 5, 0.6, adobe, ax, 0, az + 9);            // 南墙
    this.box(0.6, 5, 18.6, adobe, ax - 13, 0, az);         // 西墙
    this.box(0.6, 5, 7, adobe, ax + 13, 0, az - 5.8);      // 东墙（留南段门洞）
    this.box(0.6, 5, 6, adobe, ax + 13, 0, az + 6.3);
    this.box(0.6, 2, 5.6, adobe, ax + 13, 3, az + 0.2, { noMinimap: true }); // 东门楣
    // 南门（主入口）
    this.box(9.5, 5, 0.6, adobe, ax - 8.2, 0, az + 9);
    this.box(9.5, 5, 0.6, adobe, ax + 8.2, 0, az + 9);
    this.box(5, 1.6, 0.6, adobe, ax, 3.4, az + 9, { noMinimap: true });
    // 内部隔断（两个房间）
    this.box(0.5, 5, 10, adobe, ax - 5, 0, az - 4);
    this.box(8, 5, 0.5, adobe, ax + 8, 0, az - 2);
    // 局部顶
    this.box(26, 0.4, 8, damCon, ax, 5, az - 5, { solid: false });
    this.box(26, 0.4, 8, damCon, ax, 5, az + 5, { solid: false });
    this._lamp(ax, 4.6, az, 0xd8e8ff, 28, 18);
    this._lamp(ax + 8, 4.6, az - 6, 0xd8e8ff, 22, 14);

    // ---------- 村庄（西侧，土坯房群 + 水塔） ----------
    for (const [hx, hz] of [[-52, -6], [-36, 6], [-52, 20], [-38, 34], [-24, -4]]) {
      this._house(hx, hz, adobe, damCon);
    }
    // 水塔
    for (const [lx, lz] of [[-20, 16], [-18, 20], [-24, 20], [-22, 24]]) {
      this.box(0.5, 6, 0.5, steel, lx, 0, lz, { noMinimap: true });
    }
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 3, 14), steel);
    tank.position.set(-21, 7.5, 20);
    tank.castShadow = true;
    S.add(tank);
    this.addCollider(-21, 7.5, 20, 4.4, 3, 4.4);

    // ---------- 电站（东北，坝底东侧） ----------
    this.box(14, 5, 9, adobe, 46, 0, -30);
    this.box(3.4, 5, 0.5, adobe, 42.2, 0, -25.5);   // 门两侧
    this.box(3.4, 5, 0.5, adobe, 49.8, 0, -25.5);
    this.box(3, 1.4, 0.5, adobe, 46, 3.6, -25.5, { noMinimap: true });
    this.box(14, 0.4, 9, damCon, 46, 5, -30, { solid: false });
    for (const [tx, tz] of [[40, -20], [43, -18.4], [40.4, -17]]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.6, 1.5), steel);
      t.position.set(tx, 0.8, tz);
      t.castShadow = true;
      S.add(t);
      this.addCollider(tx, 0.8, tz, 1.5, 1.6, 1.5);
    }
    this._lamp(44, 5.4, -22, 0xffe6c0, 26, 16);

    // ---------- 集装箱装卸区（中南） ----------
    const cont = (x, z, ry, mat, stacked) => {
      this.box(6.1, 2.6, 2.5, mat, x, 0, z, { ry });
      this.addContactShadow(x, z, 7.6, 3.8, 0.45);
      if (stacked) this.box(6.1, 2.6, 2.5, red, x, 2.6, z, { ry });
    };
    cont(18, 28, 0.1, blue, true);
    cont(30, 20, -0.25, green, false);
    cont(42, 34, 1.6, red, false);
    cont(6, 40, 0.05, rust, true);
    cont(-8, 34, 1.55, blue, false);

    // ---------- 南检查站（公路撤离点旁） ----------
    this.box(3, 2.6, 3, adobe, -6, 0, 58);
    this.box(0.4, 1, 6, steel, 2, 0, 56, { noMinimap: true });
    this.box(0.4, 1, 6, steel, 8, 0, 56, { noMinimap: true });
    this._lamp(0, 4, 58, 0xffe6c0, 28, 18);

    // ---------- 直升机坪（西北撤离点） ----------
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 0.24, 28), damCon);
    pad.position.set(-46, 0.12, -16);
    pad.receiveShadow = true;
    S.add(pad);
    const hRing = new THREE.Mesh(new THREE.TorusGeometry(4, 0.25, 8, 32),
      new THREE.MeshStandardMaterial({ color: 0xd8d2c0, roughness: 0.8 }));
    hRing.rotation.x = -Math.PI / 2;
    hRing.position.set(-46, 0.28, -16);
    S.add(hRing);

    // ---------- 燃料库（西侧扩建 POI） ----------
    const fdX = -58, fdZ = 10;
    const tankGeo = new THREE.CylinderGeometry(2.4, 2.4, 4.2, 16);
    for (const [tx, tz] of [[fdX - 3, fdZ - 3], [fdX + 3, fdZ - 2], [fdX, fdZ + 4]]) {
      const tank = new THREE.Mesh(tankGeo, rust);
      tank.position.set(tx, 2.1, tz);
      tank.castShadow = true; tank.receiveShadow = true;
      S.add(tank);
      this.addCollider(tx, 2.1, tz, 4.8, 4.2, 4.8);
      this.addContactShadow(tx, tz, 6, 6, 0.45);
    }
    // 输油管与阀门
    this.box(0.5, 0.5, 10, steel, fdX, 0.6, fdZ, { noMinimap: true });
    // 值班房
    this.box(6, 3, 4.5, adobe, fdX + 7, 0, fdZ + 5);
    this.box(1.6, 1, 0.4, adobe, fdX + 7, 1.5, fdZ + 2.8, { noMinimap: true });
    this.addContactShadow(fdX + 7, fdZ + 5, 9, 7, 0.4);
    // 围墙矮栏
    this.box(0.3, 1.1, 14, steel, fdX - 9, 0, fdZ, { noMinimap: true });
    this.box(6, 1.1, 0.3, steel, fdX - 6, 0, fdZ - 8, { noMinimap: true });
    this._lamp(fdX, 5, fdZ - 6, 0xffe0b0, 28, 18);

    // ---------- 场景填充：岩石 / 废车 / 掩体 ----------
    for (const [rx, rz, s] of [[10, 8, 2.2], [-14, 44, 1.8], [24, 46, 2.6], [-30, -18, 2], [16, -18, 1.6], [-6, 26, 1.5], [36, 8, 2.4]]) {
      this.box(s, s * 0.8, s, cliff, rx, 0, rz, { ry: Math.random() * 1.5, noMinimap: true });
    }
    this.box(5.5, 2.2, 2.4, rust, 14, 0, 14, { ry: 0.5 });
    this.box(2.2, 1.6, 2.2, steel, 17.4, 0, 15.6, { ry: 0.5 });
    this.addContactShadow(15, 14.5, 8.5, 4.5, 0.45);
    this.box(4, 1.4, 1, damCon, -4, 0, -20, { noMinimap: true });
    this.box(4, 1.4, 1, damCon, 22, 0, -24, { noMinimap: true });
    // 场地灯柱
    for (const [x, z] of [[-30, 40], [20, 44], [48, 10], [-12, -34], [36, -38]]) {
      this.box(0.35, 7, 0.35, steel, x, 0, z, { noMinimap: true });
      this._lamp(x, 7.4, z, 0xffe0b0, 30, 22);
    }

    // ---------- 巡逻 / 出生 / 撤离 ----------
    this.patrolPoints = [
      new THREE.Vector3(-20, 0, -30), new THREE.Vector3(10, 0, -36),
      new THREE.Vector3(34, 0, -38), new THREE.Vector3(46, 0, -12),
      new THREE.Vector3(28, 0, 4), new THREE.Vector3(44, 0, 20),
      new THREE.Vector3(24, 0, 34), new THREE.Vector3(0, 0, 44),
      new THREE.Vector3(-16, 0, 28), new THREE.Vector3(-30, 0, 12),
      new THREE.Vector3(-46, 0, -24), new THREE.Vector3(-40, 0, -28),
      new THREE.Vector3(0, 0, -48), new THREE.Vector3(-26, 0, 46),
      new THREE.Vector3(50, 0, 44), new THREE.Vector3(-56, 0, -38),
      // 燃料库
      new THREE.Vector3(-46, 0, 4), new THREE.Vector3(-62, 0, 18), new THREE.Vector3(-50, 0, 20)
    ];
    this.spawnPoints = [
      new THREE.Vector3(52, 0, 28), new THREE.Vector3(30, 0, 58),
      new THREE.Vector3(-24, 0, 58), new THREE.Vector3(-52, 0, 24),
      new THREE.Vector3(56, 0, -6), new THREE.Vector3(-68, 0, -34)
    ];
    this.extractPoints = [
      new THREE.Vector3(0, 0, 62),     // 南检查站公路
      new THREE.Vector3(-52, 0, 44),   // 村庄果园
      new THREE.Vector3(-46, 0, -16)   // 直升机坪
    ];
  }

  // ============================================================
  // 地图三：丛林冒险（雨雾清晨，220×220 大图，直升机索降）
  // ============================================================
  _buildJungle() {
    const S = this.scene;
    const H = this.mapHalf; // 110

    // ---------- 材质 ----------
    const groundM = new THREE.MeshStandardMaterial({ map: groundTexture(512, 40, '#4c5a3c'), roughness: 0.97, color: 0xb8c8a8 });
    const stoneM = new THREE.MeshStandardMaterial({ map: concreteTexture(512, 5, '#7a8074'), roughness: 0.92, color: 0xb0c0a8 });
    const mossStone = new THREE.MeshStandardMaterial({ map: concreteTexture(512, 4, '#64705c'), roughness: 0.95, color: 0xa8c0a0 });
    const wallM = new THREE.MeshStandardMaterial({ map: plasterTexture(512, 4, '#8a9484'), roughness: 0.9, color: 0xc0ccb8 });
    const woodM = new THREE.MeshStandardMaterial({ map: woodTexture(512, 2, '#5f4a30'), roughness: 0.92 });
    const steelM = new THREE.MeshStandardMaterial({ map: metalTexture(256, 2, '#4a5650'), roughness: 0.55, metalness: 0.7 });
    const rustM = new THREE.MeshStandardMaterial({ map: containerTexture('#5f4a33'), roughness: 0.85, metalness: 0.3 });
    this.mats = { concrete: stoneM, concreteDark: groundM, wallPaint: wallM, rust: rustM, steel: steelM, wood: woodM, red: rustM, blue: steelM, green: mossStone, yellow: woodM };
    this.shadowTex = contactShadowTexture();

    // ---------- 雨雾清晨光照 ----------
    S.background = new THREE.Color(0x2a3d33);
    S.fog = new THREE.Fog(0x2a3d33, 26, 135);
    S.environmentIntensity = 0.34;
    this._addSky(0x51705e, 0xa8bfa0, { dir: new THREE.Vector3(70, 55, 20), color: 0xf2ecd0 });
    S.add(new THREE.HemisphereLight(0x9db8a0, 0x1c281e, 1.05));
    const sun = new THREE.DirectionalLight(0xfff2cc, 1.45);
    sun.position.set(70, 80, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -120; sun.shadow.camera.right = 120;
    sun.shadow.camera.top = 120; sun.shadow.camera.bottom = -120;
    sun.shadow.camera.far = 300;
    sun.shadow.bias = -0.0007;
    S.add(sun);

    // ---------- 地面与岩壁围合 ----------
    const ground = new THREE.Mesh(new THREE.BoxGeometry(H * 2, 3, H * 2), groundM);
    ground.position.y = -1.5;
    ground.receiveShadow = true;
    S.add(ground);
    this.addCollider(0, -1.5, 0, H * 2, 3, H * 2);
    const cliff = new THREE.MeshStandardMaterial({ map: concreteTexture(512, 6, '#5c665a'), roughness: 0.95, color: 0xa8b8a0 });
    this.box(H * 2, 16, 4, cliff, 0, 0, -H);
    this.box(H * 2, 16, 4, cliff, 0, 0, H);
    this.box(4, 16, H * 2, cliff, -H, 0, 0);
    this.box(4, 16, H * 2, cliff, H, 0, 0);

    // ---------- 中央河谷溪流（x∈[25,35]，贯穿全图） ----------
    const bed = new THREE.Mesh(new THREE.BoxGeometry(11, 0.12, H * 2),
      new THREE.MeshStandardMaterial({ color: 0x39443a, roughness: 0.98 }));
    bed.position.set(30, 0.02, 0);
    bed.receiveShadow = true;
    S.add(bed);
    this._addWater(30, 0, 9.5, H * 2 + 8, 0.06, 0.04, 0x12303a, 0x2e5c58);
    this.stream = { x1: 25, x2: 35 };
    for (const bz of [-20, 40]) {
      this.box(13, 0.3, 3.4, woodM, 30, 0.7, bz);
      this.box(13, 0.9, 0.24, woodM, 30, 1.0, bz - 1.7, { noMinimap: true });
      this.box(13, 0.9, 0.24, woodM, 30, 1.0, bz + 1.7, { noMinimap: true });
      for (const ex of [24, 36]) {
        this.box(3, 0.35, 3.4, woodM, ex, 0, bz, { noMinimap: true });
        this.box(3, 0.35, 3.4, woodM, ex + (ex < 30 ? -1 : 1) * 2, 0.35, bz, { noMinimap: true });
      }
    }

    // ---------- 山脊直升机坪（西北高地，撤离点） ----------
    this.box(36, 6, 36, mossStone, -72, 0, -72);
    // 台阶从山脚向南展开：最高一级与山顶(y=6)齐平并贴合崖面
    for (let i = 0; i < 12; i++) {
      this.box(6, (i + 1) * 0.5, 0.66, mossStone, -72, 0, -53.67 + (11 - i) * 0.66, { noMinimap: true });
    }
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 5.5, 0.26, 26), stoneM);
    pad.position.set(-72, 6.13, -72);
    pad.receiveShadow = true;
    S.add(pad);
    this.addCollider(-72, 6.13, -72, 11, 0.26, 11);
    const hRing = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.28, 8, 30),
      new THREE.MeshStandardMaterial({ color: 0xd8d2c0, roughness: 0.8 }));
    hRing.rotation.x = -Math.PI / 2;
    hRing.position.set(-72, 6.3, -72);
    S.add(hRing);
    this._lamp(-72, 8, -72, 0xfff0c8, 30, 20);

    // ---------- 废弃研究站（东北核心建筑群） ----------
    const rx = 52, rz = -42;
    this.box(24, 3.6, 0.5, wallM, rx, 0, rz - 8);
    this.box(0.5, 3.6, 16, wallM, rx - 12, 0, rz);
    this.box(9, 3.6, 0.5, wallM, rx - 7.5, 0, rz + 8);
    this.box(9, 3.6, 0.5, wallM, rx + 7.5, 0, rz + 8);
    this.box(0.5, 1.6, 6, wallM, rx, 2, rz + 8, { noMinimap: true });
    this.box(0.5, 3.6, 5.5, wallM, rx + 12, 0, rz - 5.2);
    this.box(0.5, 3.6, 5.5, wallM, rx + 12, 0, rz + 5.2);
    this.box(0.5, 1.8, 5.5, wallM, rx + 12, 1.8, rz, { noMinimap: true });
    this.box(24.6, 0.4, 9, stoneM, rx, 3.6, rz - 4, { solid: false });
    this.box(24.6, 0.4, 9, stoneM, rx, 3.6, rz + 4, { solid: false });
    this.box(0.5, 3.6, 9, wallM, rx - 4, 0, rz);
    this.box(6, 1.1, 1.4, steelM, rx + 6, 0, rz - 5, { noMinimap: true });
    this.box(2, 2.6, 2, steelM, rx - 9, 0, rz - 5);
    this._lamp(rx, 3.3, rz, 0xd8f0e0, 30, 18);
    this._lamp(rx - 6, 3.3, rz - 5, 0xd8f0e0, 24, 14);
    this.addContactShadow(rx, rz, 28, 20, 0.4);
    const ax = 52, az = -62;
    this.box(10, 3.2, 0.5, wallM, ax, 0, az - 4);
    this.box(0.5, 3.2, 8, wallM, ax - 5, 0, az);
    this.box(0.5, 3.2, 8, wallM, ax + 5, 0, az);
    this.box(3.4, 3.2, 0.5, wallM, ax - 3.3, 0, az + 4);
    this.box(3.4, 3.2, 0.5, wallM, ax + 3.3, 0, az + 4);
    this.box(10.6, 0.4, 8.6, stoneM, ax, 3.2, az, { solid: false });
    this._lamp(ax, 3, az, 0xd8f0e0, 22, 14);
    this.addContactShadow(ax, az, 13, 11, 0.4);

    // ---------- 树屋群落（西部，平台 y=5 + 绳桥） ----------
    const treehouse = (x, z) => {
      for (const [lx, lz] of [[x - 1.8, z - 1.8], [x + 1.8, z - 1.8], [x - 1.8, z + 1.8], [x + 1.8, z + 1.8]]) {
        this.box(0.4, 5, 0.4, woodM, lx, 0, lz, { noMinimap: true });
      }
      this.box(4.6, 0.32, 4.6, woodM, x, 5, z);
      this.box(4.6, 0.8, 0.16, woodM, x, 5.3, z - 2.3, { noMinimap: true });
      // 南侧围栏中间留 1.6m 入口（与爬梯对齐）
      this.box(1.5, 0.8, 0.16, woodM, x - 1.55, 5.3, z + 2.3, { noMinimap: true });
      this.box(1.5, 0.8, 0.16, woodM, x + 1.55, 5.3, z + 2.3, { noMinimap: true });
      this.box(0.16, 0.8, 4.6, woodM, x - 2.3, 5.3, z, { noMinimap: true });
      this.box(0.16, 0.8, 4.6, woodM, x + 2.3, 5.3, z, { noMinimap: true });
      // 爬梯（南侧台阶：由外向内升高，顶步紧贴平台边；0.62m 深防止探测点碰到上一级立面）
      for (let i = 0; i < 10; i++) {
        this.box(1.4, 0.5, 0.62, woodM, x, i * 0.5, z + 2.7 + (9 - i) * 0.62, { noMinimap: true });
      }
      this.addContactShadow(x, z, 7, 7, 0.35);
      this._lamp(x, 4.9, z, 0xffe8c0, 16, 10);
    };
    [[-52, 22], [-38, 30], [-46, 42], [-26, 18]].forEach(([x, z]) => treehouse(x, z));
    const ropeBridge = (x1, z1, x2, z2) => {
      const n = Math.floor(Math.hypot(x2 - x1, z2 - z1) / 1.3);
      for (let i = 1; i < n; i++) {
        const tt = i / n;
        this.box(1.1, 0.14, 0.9, woodM, x1 + (x2 - x1) * tt, 5.02, z1 + (z2 - z1) * tt, { ry: -Math.atan2(z2 - z1, x2 - x1), noMinimap: true });
      }
    };
    ropeBridge(-52, 22, -38, 30);
    ropeBridge(-38, 30, -46, 42);

    // ---------- 古庙遗迹（南部） ----------
    const tx = 10, tz = 62;
    this.box(18, 1, 18, mossStone, tx, 0, tz);
    // 台基前两级台阶（1m 台基需踏步）
    this.box(4, 0.5, 0.7, mossStone, tx, 0, tz + 9.35, { noMinimap: true });
    this.box(7, 3, 0.6, mossStone, tx - 4, 1, tz - 8.6);
    this.box(5, 2.2, 0.6, mossStone, tx + 5, 1, tz - 8.6);
    this.box(0.6, 3, 7, mossStone, tx - 8.6, 1, tz + 4);
    this.box(0.6, 2.6, 5, mossStone, tx + 8.6, 1, tz - 4);
    for (const [cx2, cz2, fallen] of [[tx - 6, tz - 6, 0], [tx, tz - 6, 0], [tx + 6, tz - 6, 1], [tx - 6, tz + 6, 1], [tx + 6, tz + 6, 0]]) {
      if (fallen) {
        this.box(0.9, 0.9, 4.2, mossStone, cx2, 1, cz2, { ry: Math.random() * 1.5, noMinimap: true });
      } else {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.52, 4.4, 10), mossStone);
        col.position.set(cx2, 3.2, cz2);
        col.castShadow = true;
        S.add(col);
        this.addCollider(cx2, 3.2, cz2, 1, 4.4, 1);
      }
    }
    this.box(6, 2.4, 0.5, mossStone, tx, 1, tz - 3);
    this.box(0.5, 2.4, 6, mossStone, tx - 3, 1, tz);
    this.box(0.5, 2.4, 6, mossStone, tx + 3, 1, tz);
    this.box(2.2, 2.4, 0.5, mossStone, tx - 1.9, 1, tz + 3);
    this.box(2.2, 2.4, 0.5, mossStone, tx + 1.9, 1, tz + 3);
    this._lamp(tx, 1.9, tz, 0xffd9a0, 18, 12);
    this.addContactShadow(tx, tz, 22, 22, 0.4);

    // ---------- 伐木场（西部） ----------
    const lx0 = -62, lz0 = -18;
    for (const [px2, pz2] of [[lx0 - 3, lz0 - 2], [lx0 + 3, lz0 - 2], [lx0 - 3, lz0 + 2], [lx0 + 3, lz0 + 2]]) {
      this.box(0.35, 3.2, 0.35, woodM, px2, 0, pz2, { noMinimap: true });
    }
    this.box(9, 0.3, 6.6, rustM, lx0, 3.2, lz0, { solid: false });
    const logGeo = new THREE.CylinderGeometry(0.5, 0.5, 6, 9);
    const logM = new THREE.MeshStandardMaterial({ map: woodTexture(512, 1, '#7a6444'), roughness: 0.95 });
    for (const [ox, oy] of [[-0.9, 0.5], [0, 0.5], [0.9, 0.5], [-0.45, 1.5], [0.45, 1.5]]) {
      const log = new THREE.Mesh(logGeo, logM);
      log.rotation.z = Math.PI / 2;
      log.position.set(lx0 + 8 + ox, oy, lz0 + 4);
      log.castShadow = true;
      S.add(log);
      this.addCollider(lx0 + 8 + ox, oy, lz0 + 4, 6, 1, 1.1);
    }
    this.box(3, 1, 1.6, woodM, lx0 - 2, 0, lz0 + 5, { noMinimap: true });
    this.box(0.4, 7, 0.4, steelM, lx0 + 4, 0, lz0 - 5, { noMinimap: true });
    this.box(5, 0.35, 0.35, steelM, lx0 + 6, 6.6, lz0 - 5, { noMinimap: true });
    this.addContactShadow(lx0 + 8, lz0 + 4, 8, 4, 0.4);

    // ---------- 河畔码头（南缘，撤离点） ----------
    this.box(5, 0.3, 14, woodM, 30, 0.7, 96);
    for (const [px2, pz2] of [[28, 90], [32, 90], [28, 100], [32, 100]]) {
      this.box(0.3, 1, 0.3, woodM, px2, 0, pz2, { noMinimap: true });
    }
    this.box(2.4, 1.1, 5.4, rustM, 37, 0.2, 96, { ry: 0.4 });
    this.box(3, 0.35, 3.4, woodM, 30, 0, 88, { noMinimap: true });
    this._lamp(30, 3, 96, 0xffe8c0, 26, 18);

    // ---------- 公路检查站（东缘，撤离点） ----------
    this.box(3.4, 2.6, 3.2, wallM, 100, 0, 20);
    this.box(0.35, 1, 7, steelM, 96, 0, 24, { noMinimap: true });
    this.box(0.35, 1, 7, steelM, 96, 0, 16, { noMinimap: true });
    this._lamp(100, 4, 20, 0xffe8c0, 26, 16);

    // ---------- 岩石点缀 ----------
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockM = new THREE.MeshStandardMaterial({ color: 0x6d756a, roughness: 0.95, flatShading: true });
    for (const [px2, pz2, s] of [[8, -30, 1.6], [-18, -60, 2.2], [66, 10, 1.4], [-88, 40, 1.9], [42, 66, 1.3], [-14, 96, 1.7], [76, -66, 2.1], [-92, -34, 1.5]]) {
      const r = new THREE.Mesh(rockGeo, rockM);
      r.position.set(px2, s * 0.4, pz2);
      r.scale.set(s, s * 0.8, s);
      r.rotation.y = Math.random() * 3;
      r.castShadow = true; r.receiveShadow = true;
      S.add(r);
      this.addCollider(px2, s * 0.4, pz2, s * 1.6, s * 0.8, s * 1.6);
      this.addContactShadow(px2, pz2, s * 3, s * 3, 0.35);
    }

    // ---------- 巡逻 / 出生 / 撤离（须在植被种植前定义，树要避让） ----------
    this.patrolPoints = [
      new THREE.Vector3(52, 0, -42), new THREE.Vector3(40, 0, -52), new THREE.Vector3(67, 0, -34),
      new THREE.Vector3(10, 0, 76), new THREE.Vector3(-2, 0, 50), new THREE.Vector3(22, 0, 76),
      new THREE.Vector3(-46, 0, 34), new THREE.Vector3(-56, 0, 22), new THREE.Vector3(-34, 0, 26),
      new THREE.Vector3(-62, 0, -18), new THREE.Vector3(-50, 0, -24), new THREE.Vector3(-72, 0, -6),
      new THREE.Vector3(30, 0, 84), new THREE.Vector3(18, 0, 78), new THREE.Vector3(42, 0, 80),
      new THREE.Vector3(-50, 0, -62), new THREE.Vector3(-52, 0, -78), new THREE.Vector3(-76, 0, -44),
      new THREE.Vector3(78, 0, 30), new THREE.Vector3(88, 0, 16), new THREE.Vector3(66, 0, 44),
      new THREE.Vector3(6, 0, -68), new THREE.Vector3(-12, 0, -44), new THREE.Vector3(48, 0, 6)
    ];
    this.spawnPoints = [
      new THREE.Vector3(90, 0, 0), new THREE.Vector3(0, 0, -92),
      new THREE.Vector3(-90, 0, 0), new THREE.Vector3(20, 0, 92),
      new THREE.Vector3(-76, 0, 76), new THREE.Vector3(76, 0, -80)
    ];
    this.extractPoints = [
      new THREE.Vector3(30, 0, 97),     // 河畔码头（乘船）
      new THREE.Vector3(-72, 0, -72),   // 山脊直升机坪
      new THREE.Vector3(104, 0, 20)     // 公路检查站
    ];

    // ---------- 植被（实例化渲染） ----------
    this._plantJungle(S);

    // ---------- 雨粒子 ----------
    const rainGeo = new THREE.BufferGeometry();
    const rainN = 520;
    const rainPos = new Float32Array(rainN * 3);
    for (let i = 0; i < rainN; i++) {
      rainPos[i * 3] = (Math.random() - 0.5) * 70;
      rainPos[i * 3 + 1] = Math.random() * 30;
      rainPos[i * 3 + 2] = (Math.random() - 0.5) * 70;
    }
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
    const rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({
      color: 0xb8d0da, size: 0.14, transparent: true, opacity: 0.5, sizeAttenuation: true
    }));
    rain.frustumCulled = false;
    S.add(rain);
    this.rain = rain;
  }

  // 丛林植被：乔木/灌木/草丛全部 InstancedMesh（几次 draw call）
  _plantJungle(S) {
    const placed = [];
    // 事件与关键点位留空（坠机/空投需要开阔地，巡逻/出生/撤离点不能被树压住）
    const keepClear = [
      [-10, -22, 8], [62, 68, 8], [-78, 8, 8],
      [2, 22, 6], [-52, -54, 6], [72, -12, 6], [28, 78, 6]
    ];
    for (const p of this.patrolPoints) keepClear.push([p.x, p.z, 3.2]);
    for (const p of this.spawnPoints) keepClear.push([p.x, p.z, 4]);
    for (const p of this.extractPoints) keepClear.push([p.x, p.z, 5]);
    const okSpot = (x, z, minDist, pad = 2.4) => {
      if (Math.abs(x) > 104 || Math.abs(z) > 104) return false;
      if (x > 20 && x < 40) return false;               // 河谷留空
      for (const p of placed) if (Math.hypot(p[0] - x, p[1] - z) < minDist) return false;
      for (const k of keepClear) if (Math.hypot(k[0] - x, k[1] - z) < k[2]) return false;
      for (const c of this.colliders) {
        if (c.max.y < 0.3) continue;
        if (x + pad > c.min.x && x - pad < c.max.x && z + pad > c.min.z && z - pad < c.max.z) return false;
      }
      return true;
    };
    const N = 170;
    const trunkGeo = new THREE.CylinderGeometry(0.24, 0.4, 6, 6);
    const trunkM = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.95 });
    const trunkIM = new THREE.InstancedMesh(trunkGeo, trunkM, N);
    const canopyGeo = new THREE.SphereGeometry(1, 7, 6);
    const canopyM = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    const c1IM = new THREE.InstancedMesh(canopyGeo, canopyM, N);
    const c2IM = new THREE.InstancedMesh(canopyGeo, canopyM.clone(), N);
    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();
    let ti = 0, tries = 0;
    while (ti < N && tries < 3200) {
      tries++;
      const x = (Math.random() - 0.5) * 206;
      const z = (Math.random() - 0.5) * 206;
      if (!okSpot(x, z, 4.2)) continue;
      const s = 0.8 + Math.random() * 0.7;
      m4.compose(new THREE.Vector3(x, 3 * s, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s));
      trunkIM.setMatrixAt(ti, m4);
      m4.compose(new THREE.Vector3(x, (6.2 + Math.random() * 0.5) * s, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 3), new THREE.Vector3(2.7 * s, 2.2 * s, 2.7 * s));
      c1IM.setMatrixAt(ti, m4);
      c1IM.setColorAt(ti, col.setHSL(0.3 + Math.random() * 0.05, 0.42, 0.24 + Math.random() * 0.1));
      m4.compose(new THREE.Vector3(x + (Math.random() - 0.5), (8 + Math.random() * 0.6) * s, z + (Math.random() - 0.5)), new THREE.Quaternion(), new THREE.Vector3(2 * s, 1.7 * s, 2 * s));
      c2IM.setMatrixAt(ti, m4);
      c2IM.setColorAt(ti, col.setHSL(0.31 + Math.random() * 0.05, 0.46, 0.3 + Math.random() * 0.1));
      this.addCollider(x, 3 * s, z, 0.9 * s, 6 * s, 0.9 * s);
      placed.push([x, z]);
      ti++;
    }
    trunkIM.castShadow = true; c1IM.castShadow = true; c2IM.castShadow = true;
    S.add(trunkIM, c1IM, c2IM);

    const BN = 240;
    const bushGeo = new THREE.IcosahedronGeometry(1, 0);
    const bushM = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true });
    const bushIM = new THREE.InstancedMesh(bushGeo, bushM, BN);
    let bi = 0; tries = 0;
    while (bi < BN && tries < 2600) {
      tries++;
      const x = (Math.random() - 0.5) * 206, z = (Math.random() - 0.5) * 206;
      if (!okSpot(x, z, 1.6, 1.2)) continue;
      const s = 0.6 + Math.random() * 0.9;
      m4.compose(new THREE.Vector3(x, 0.45 * s, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 3), new THREE.Vector3(1.3 * s, 0.85 * s, 1.3 * s));
      bushIM.setMatrixAt(bi, m4);
      bushIM.setColorAt(bi, col.setHSL(0.3 + Math.random() * 0.06, 0.4, 0.2 + Math.random() * 0.1));
      bi++;
    }
    S.add(bushIM);

    const GN = 420;
    const grassGeo = new THREE.PlaneGeometry(1.4, 1.0);
    const grassM = new THREE.MeshStandardMaterial({
      map: grassTexture(), alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.9
    });
    const grassIM = new THREE.InstancedMesh(grassGeo, grassM, GN);
    let gi = 0; tries = 0;
    while (gi < GN && tries < 3000) {
      tries++;
      const x = (Math.random() - 0.5) * 206, z = (Math.random() - 0.5) * 206;
      if (!okSpot(x, z, 1.1, 0.4)) continue;
      const s = 0.7 + Math.random() * 0.8;
      m4.compose(new THREE.Vector3(x, 0.48 * s, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 3.14), new THREE.Vector3(s, s, s));
      grassIM.setMatrixAt(gi, m4);
      gi++;
    }
    S.add(grassIM);
    this.vegetation = { trees: ti, bushes: bi, grass: gi };
  }

  // 土坯房：8×6，门朝南，平顶
  _house(x, z, wallM, roofM) {
    this.box(8, 3.2, 0.4, wallM, x, 0, z + 3);              // 后墙
    this.box(0.4, 3.2, 6, wallM, x - 4, 0, z);              // 西墙
    this.box(0.4, 3.2, 6, wallM, x + 4, 0, z);              // 东墙
    this.box(2.8, 3.2, 0.4, wallM, x - 2.6, 0, z - 3);      // 前墙左
    this.box(2.8, 3.2, 0.4, wallM, x + 2.6, 0, z - 3);      // 前墙右
    this.box(2.4, 0.9, 0.4, wallM, x, 2.3, z - 3, { noMinimap: true }); // 门楣
    this.box(8.6, 0.4, 6.6, roofM, x, 3.2, z, { solid: false });        // 平顶
    this.addContactShadow(x, z, 11, 9, 0.45);
  }

  _addWater(cx, cz, w, d, y, bobAmp = 0.25, deep = 0x07222e, shallow = 0x14506a) {
    const S = this.scene;
    const waterGeo = new THREE.PlaneGeometry(w, d, 48, 64);
    const waterMat = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uDeep: { value: new THREE.Color(deep) },
        uShallow: { value: new THREE.Color(shallow) }
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
    water.position.set(cx, y, cz);
    S.add(water);
    this.waters.push({ mesh: water, y, bob: bobAmp });
    return water;
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

  update(t, dt = 0, playerPos = null) {
    for (const w of this.waters) {
      w.mesh.material.uniforms.uTime.value = t;
      // 潮汐/水流缓慢波动（视觉）
      w.mesh.position.y = w.y + Math.sin(t * 0.02) * w.bob;
    }
    // 丛林雨：粒子跟随玩家下落循环
    if (this.rain && playerPos && dt > 0) {
      const pos = this.rain.geometry.attributes.position;
      const p = playerPos;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) - 30 * dt;
        let x = pos.getX(i) + 4 * dt;
        if (y < p.y - 2) {
          y = p.y + 26 + Math.random() * 4;
          pos.setX(i, p.x + (Math.random() - 0.5) * 70);
          pos.setZ(i, p.z + (Math.random() - 0.5) * 70);
        }
        if (Math.abs(x - p.x) > 38) pos.setX(i, p.x + (Math.random() - 0.5) * 60);
        else pos.setX(i, x);
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
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
