import * as THREE from 'three';
import { lootSound, beep } from './audio.js';
import { woodTexture, metalTexture } from './textures.js';

// 物资系统：普通物资箱 + 加密保险箱（每局重置、重新随机位置）
const ITEM_TABLE = [
  { name: '机械零件', value: 1200, w: 24 },
  { name: '军用绷带', value: 800, w: 18 },
  { name: '弹药盒', value: 600, w: 16, ammo: 60 },
  { name: '加密门卡', value: 3000, w: 12 },
  { name: '军用硬盘', value: 5000, w: 8 },
  { name: '金条', value: 8000, w: 4 },
  { name: '红酒收藏款', value: 2400, w: 11 },
  // 狙击枪：只能通过宝箱获取（含 10 发弹），后续拾取转化为狙击弹
  { name: 'M700 狙击枪', value: 9000, w: 9, sniper: true }
];

// 加密保险箱专属高价值物资
const SAFE_TABLE = [
  { name: '机密文件', value: 6500 },
  { name: '军用硬盘', value: 5000 },
  { name: '金条', value: 8000 },
  { name: '翡翠原石', value: 10000 },
  { name: '金鹰雕像', value: 12000 }
];

// 每张地图的物资候选点：[x, z] 或 [x, z, y]（y 用于坝顶等高位）
const MAP_LOOT = {
  prison: {
    spawns: [
      [-48, -54], [-26, -50], [-12, -42], [-40, -40], [-24, -28],
      [24, -54], [40, -46], [46, -32], [30, -34],
      [-34, 22], [-18, 36], [10, 28], [30, 14], [44, 32],
      [-40, 44], [-6, 50], [20, 50], [54, 6], [-54, 30], [8, 8],
      [-48.5, -52], [-41.5, -52], [-34.5, -52], [-27.5, -52], [-20.5, -52], [-13.5, -52],
      [-48.5, -29], [-41.5, -29], [-34.5, -29], [-27.5, -29], [-20.5, -29], [-13.5, -29],
      [-44, -41], [-36, -41], [-20, -41], [-8, -41],
      [24, -52], [38, -52], [30, -32], [44, -50],
      // 东南仓库区
      [46, 58], [42, 60], [50, 62], [44, 55]
    ],
    safeSpawns: [[-48, -41], [-30, -41], [-12, -41], [28, -44], [44, -36], [-36, 33], [46, 60]]
  },
  dam: {
    spawns: [
      // 坝顶机房（高位，三倍权重保证每局都有坝顶物资）
      [-55, -50, 12.6], [-25, -50, 12.6], [25, -50, 12.6], [55, -50, 12.6],
      [-55, -50, 12.6], [-25, -50, 12.6], [25, -50, 12.6], [55, -50, 12.6],
      [-45, -50, 12.6], [45, -50, 12.6], [-35, -52, 12.6], [35, -52, 12.6],
      // 泄洪道
      [-3, -50], [3, -50],
      // 行政辖区
      [28, -8], [42, -8], [28, -13], [42, -2],
      // 村庄
      [-52, -6], [-36, 6], [-52, 20], [-38, 34], [-24, -4],
      // 电站
      [46, -30], [50, -21],
      // 集装箱区与公路
      [18, 28], [30, 20], [42, 34], [6, 40], [-8, 34],
      [0, 20], [-12, 30], [12, 52], [-30, 48], [14, 10], [24, 54],
      // 燃料库
      [-58, 12], [-54, 8], [-62, 16], [-51, 15]
    ],
    safeSpawns: [[34, -12], [42, -8], [0, -52], [20, -50, 12.6], [-56, 8]]
  }
};

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
export { rollSafeItem };

// 每张地图的情报档案（环境叙事收集品，固定点位）
const MAP_LORE = {
  prison: {
    points: [[-30, -24], [-52, 20], [0, 11], [10, 52]],
    texts: [
      '【监狱长日志·一】潮位上涨的第七天，柴油发电机停了。我们决定把重犯转移到坝区——如果直升机还能来的话。',
      '【守卫录音带】……东墙外的水已经淹到哨塔二层。指挥部没有回电。重复，指挥部没有回电。',
      '【墙上的刻字】放风场的水泥墙上，有人反复刻下同一句话：“潮水会带走一切，除了罪。”',
      '【监狱长日志·末】保险箱的密码是撤离那天的日期。如果有人读到这本日志——别开箱，那是我留给死人的。'
    ]
  },
  dam: {
    points: [[31, -4], [0, -47], [-60, -2], [46, -23.5]],
    texts: [
      '【工程师笔记】大坝的承重远超设计值。战争开始之后，他们往坝顶机房里塞满了不该放的东西。',
      '【巡逻队记录】03:00，北岸探照灯又灭了。对岸有灯语闪烁——不是我们的频率。',
      '【值班室交接簿】燃料库今晚起只留两人。其余人向行政辖区集结，带不走的设备就地封存。',
      '【加密电报残页】“渡鸦”已入境，货在坝顶。撤离点每日更换——盯死绿色信号烟。'
    ]
  }
};

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
      [-40, 44], [-6, 50], [20, 50], [54, 6], [-54, 30], [8, 8],
      // 牢房内部与走廊、工坊补充点位（过滤后保证 14 个可用）
      [-48.5, -52], [-41.5, -52], [-34.5, -52], [-27.5, -52], [-20.5, -52], [-13.5, -52],
      [-48.5, -29], [-41.5, -29], [-34.5, -29], [-27.5, -29], [-20.5, -29], [-13.5, -29],
      [-44, -41], [-36, -41], [-20, -41], [-8, -41],
      [24, -52], [38, -52], [30, -32], [44, -50]
    ];
    // 加密保险箱候选点位（屋内/掩体旁）
    this.safeSpawns = [
      [-48, -41], [-30, -41], [-12, -41], [28, -44], [44, -36], [-36, 33]
    ];
    this._spawnAll();
    this._spawnLore();
    this._buildExtractMarker();
  }

  // 撤离点视觉标记：地面光圈 + 光柱 + 小屋
  _buildExtractMarker() {
    const p = this.world.extractPoint;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(this.world.extractRadius - 0.6, this.world.extractRadius, 48),
      new THREE.MeshBasicMaterial({ color: 0x30ff90, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(p.x, 0.06, p.z);
    this.scene.add(ring);
    this.extractRing = ring;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(this.world.extractRadius * 0.55, this.world.extractRadius * 0.55, 26, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x30ff90, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false })
    );
    beam.position.set(p.x, 13, p.z);
    this.scene.add(beam);
    this.extractBeam = beam;
    const hut = new THREE.Mesh(
      new THREE.BoxGeometry(4, 2.6, 3),
      new THREE.MeshStandardMaterial({ color: 0x2e4a3a, roughness: 0.8 })
    );
    hut.position.set(p.x + 6, 1.3, p.z - 3);
    hut.castShadow = true;
    this.scene.add(hut);
    this.hut = hut;
  }

  // 每局撤离点随机化：把光圈/光柱/小屋迁移到新点位
  setExtractPoint(p) {
    this.extractRing.position.set(p.x, 0.06, p.z);
    this.extractBeam.position.set(p.x, 13, p.z);
    const hx = p.x + (p.x > 0 ? -6 : 6);
    const hz = p.z + (p.z > 0 ? -3 : 3);
    this.hut.position.set(hx, 1.3, hz);
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
    // 原地清空以保持外部引用（小地图）有效
    this.crates.length = 0;
    this.safes.length = 0;
    this._spawnAll();
    this._spawnLore();
  }

  // 刷新点校验：与同一高度层的碰撞体保持间距，避免箱子嵌进墙/集装箱
  _pointBlocked(x, z, y = 0, pad = 0.95) {
    const floorTop = y + 0.05; // 脚下地面/平台碰撞体不算障碍
    for (const c of this.world.colliders) {
      if (c.max.y <= floorTop || c.min.y > y + 1.3) continue;
      if (x + pad > c.min.x && x - pad < c.max.x && z + pad > c.min.z && z - pad < c.max.z) return true;
    }
    return false;
  }

  _spawnAll() {
    const cfg = MAP_LOOT[this.world.mapId] || MAP_LOOT.prison;
    this.spawns = cfg.spawns;
    this.safeSpawns = cfg.safeSpawns;
    this._spawnCrates(14);
    this._spawnSafes(2);
  }

  // ============ 情报档案（环境叙事收集品） ============
  _spawnLore() {
    const cfg = MAP_LORE[this.world.mapId] || MAP_LORE.prison;
    this.loreItems = [];
    this.loreTotal = cfg.points.length;
    const paperM = new THREE.MeshStandardMaterial({
      color: 0xd8e6ef, roughness: 0.6,
      emissive: 0x00c8ff, emissiveIntensity: 0.55
    });
    cfg.points.forEach(([x, z, y = 0], i) => {
      const g = new THREE.Group();
      const sheet = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.42, 0.05), paperM);
      sheet.position.y = 0.21;
      sheet.rotation.z = 0.1;
      const clip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.07),
        new THREE.MeshStandardMaterial({ color: 0x30373c, metalness: 0.8, roughness: 0.3 }));
      clip.position.y = 0.44;
      g.add(sheet, clip);
      g.position.set(x, y, z);
      g.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(g);
      this.loreItems.push({ group: g, pos: new THREE.Vector3(x, y, z), picked: false, text: cfg.texts[i] });
    });
  }

  nearestLore(playerPos) {
    let best = null, bestD = 2.2;
    for (const l of this.loreItems || []) {
      if (l.picked) continue;
      const d = Math.hypot(l.pos.x - playerPos.x, l.pos.z - playerPos.z);
      if (d < bestD && Math.abs(l.pos.y - playerPos.y) < 2) { best = l; bestD = d; }
    }
    return best;
  }

  pickLore(lore) {
    lore.picked = true;
    this.scene.remove(lore.group);
    return lore.text;
  }

  loreFoundCount() {
    return (this.loreItems || []).filter(l => l.picked).length;
  }

  _trackCollider(x, y, z, sx, sy, sz) {
    this.world.addCollider(x, y, z, sx, sy, sz);
    return this.world.colliders[this.world.colliders.length - 1];
  }

  _spawnCrates(count) {
    const shuffled = [...this.spawns].sort(() => Math.random() - 0.5);
    const free = shuffled.filter(([x, z, y = 0]) => !this._pointBlocked(x, z, y));
    for (let i = 0; i < Math.min(count, free.length); i++) {
      const [x, z, y = 0] = free[i];
      this._makeCrate(x, y, z, [rollItem(), ...(Math.random() < 0.4 ? [rollItem()] : [])]);
    }
  }

  // 运行时投放特殊物资箱（空投/坠机高价值箱，小地图金色标记）
  spawnSpecialCrate(x, z, items) {
    return this._makeCrate(x, 0, z, items, true);
  }

  _makeCrate(x, y, z, items, special = false) {
    const crateM = new THREE.MeshStandardMaterial({ map: woodTexture(512, 1, special ? '#4a4234' : '#56603f'), roughness: 0.88, metalness: 0.15 });
    const stripM = new THREE.MeshStandardMaterial({
      color: special ? 0xffb040 : 0xc9a53a, roughness: 0.4, metalness: 0.7,
      emissive: special ? 0x442200 : 0x332200
    });
    const g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.8, 0.8), crateM);
    box.position.y = 0.4;
    box.castShadow = true; box.receiveShadow = true;
    const strip = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.12, 0.82), stripM);
    strip.position.y = 0.55;
    g.add(box, strip);
    g.position.set(x, y, z);
    g.rotation.y = Math.random() * Math.PI;
    this.scene.add(g);
    this.world.addContactShadow(x, z, 2.0, 1.7, 0.4, y + 0.02);
    const crate = {
      group: g, pos: new THREE.Vector3(x, y, z), opened: false, special,
      collider: this._trackCollider(x, y + 0.4, z, 1.1, 0.8, 0.9),
      items
    };
    this.crates.push(crate);
    return crate;
  }

  _spawnSafes(count) {
    const shuffled = [...this.safeSpawns].sort(() => Math.random() - 0.5);
    const free = shuffled.filter(([x, z, y = 0]) => !this._pointBlocked(x, z, y, 1.15));
    const bodyM = new THREE.MeshStandardMaterial({ map: metalTexture(256, 1, '#22323e'), roughness: 0.35, metalness: 0.8 });
    const glowM = new THREE.MeshStandardMaterial({
      color: 0x0a3a44, roughness: 0.3, metalness: 0.6,
      emissive: 0x00c8ff, emissiveIntensity: 0.9
    });
    for (let i = 0; i < Math.min(count, free.length); i++) {
      const [x, z, y = 0] = free[i];
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
      g.position.set(x, y, z);
      g.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(g);
      this.world.addContactShadow(x, z, 2.2, 1.8, 0.45, y + 0.02);
      this.safes.push({
        group: g, pos: new THREE.Vector3(x, y, z), opened: false, cracked: 0,
        collider: this._trackCollider(x, y + 0.65, z, 1.0, 1.3, 0.75)
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

  open(crate, player, weapon, sniper) {
    crate.opened = true;
    const msgs = [];
    for (const it of crate.items) {
      if (it.sniper) {
        if (sniper && !sniper.owned) {
          sniper.owned = true;
          sniper.mag = sniper.magSize; // 含 10 发弹（弹匣全满）
          sniper.reserve = 0;
          sniper.reloading = false;
          msgs.push('M700 狙击枪 ×1（含 10 发狙击弹，按 Q 切换）');
        } else if (sniper) {
          sniper.reserve += 5;
          msgs.push('狙击弹 ×5');
        }
      } else if (it.ammo) {
        // 弹药盒补给当前手持武器（狙击枪按 10 发/盒折算）
        const add = weapon && weapon.kind === 'sniper' ? 10 : it.ammo;
        weapon.reserve += add;
        msgs.push(`弹药盒 ×1（+${add} 发）`);
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
    // 情报档案悬浮旋转
    for (const l of this.loreItems || []) {
      if (l.picked) continue;
      l.group.rotation.y = t * 0.8;
      l.group.position.y = l.pos.y + 0.08 + Math.sin(t * 2 + l.pos.x) * 0.04;
    }
  }
}
