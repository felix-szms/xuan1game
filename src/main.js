import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { World, MAPS, moveWithCollisions, groundHeight, raycastWorld, hasLineOfSight } from './world.js';
import { Controls } from './controls.js';
import { Weapon } from './weapons.js';
import { EnemyManager } from './enemies.js';
import { LootManager } from './loot.js';
import { HUD } from './hud.js';
import { initAudio, shotSound, sniperShotSound, enemyShotSound, hitSound, reloadSound, hurtSound, beep, footstep } from './audio.js';
import { RandomEvents } from './events.js';

// ================= 渲染器 / 场景 =================
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// 环境光照：PMREM 预滤波的程序化环境（金属/潮湿表面产生真实反射）
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.3;
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 400);
// 枪模补光（挂在相机上，只照亮近距离第一人称视角物体）
const fillLight = new THREE.PointLight(0xcfe0ff, 2.2, 4, 1.5);
camera.add(fillLight);
fillLight.position.set(0.2, 0.1, -0.3);

const composer = new EffectComposer(renderer);
// SSAO 在部分环境会渲染黑屏，默认关闭；加 ?ssao 参数可实验性开启
const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;
const useSSAO = !isTouchDevice && location.search.includes('ssao');
if (useSSAO) {
  const ssao = new SSAOPass(scene, camera, window.innerWidth, window.innerHeight);
  ssao.kernelRadius = 0.55;
  ssao.minDistance = 0.0008;
  ssao.maxDistance = 0.09;
  composer.addPass(ssao);
} else {
  composer.addPass(new RenderPass(scene, camera));
}
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.32, 0.6, 0.85);
composer.addPass(bloom);

// 动态分辨率：帧率不足时自动降低渲染精度，空闲时恢复
const maxPR = Math.min(window.devicePixelRatio, 2);
let curPR = maxPR;
let fpsAcc = 0, fpsCount = 0;

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ================= 游戏对象 =================
let world = null;
let lootMgr = null;
let enemyMgr = null;
let currentMapId = null;
const hud = new HUD();
const controls = new Controls(renderer.domElement, document.getElementById('touchui'));
const rifle = new Weapon(camera, scene);
const sniper = new Weapon(camera, scene, {
  kind: 'sniper', name: 'M700 · 狙击枪',
  magSize: 10, reserve: 0, rpm: 45, damage: 130,   // 一击必杀
  shotKick: 0.05, recoilPerShot: 0.05, recoilCap: 0.12,
  spreadBase: 0.03, reloadTime: 2.8
});
sniper.viewmodel.visible = false;
sniper.owned = true; // 狙击枪为初始标配武器
let weapon = rifle;   // 当前手持武器
scene.add(camera);

// 按地图构建世界（切换地图或首次进入时调用）
let events = null;
function buildMap(mapId) {
  // 清空场景（保留相机及其子物体：枪模/补光），并释放几何体内存
  for (let i = scene.children.length - 1; i >= 0; i--) {
    const obj = scene.children[i];
    if (obj === camera) continue;
    scene.remove(obj);
    obj.traverse?.((o) => {
      o.geometry?.dispose?.();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose?.());
    });
  }
  world = new World(scene, mapId);
  lootMgr = new LootManager(scene, world);
  enemyMgr = new EnemyManager(scene, world);
  events = new RandomEvents(scene, world, enemyMgr, lootMgr, hud);
  world.lootCrates = lootMgr.crates;
  weapon.resetScene(scene); // 曳光弹池重新挂到新场景
  sniper.resetScene(scene);
  currentMapId = mapId;
  Object.assign(window.__game, { world, lootMgr, enemyMgr, events });
}

// 玩家状态
const player = {
  pos: new THREE.Vector3(-52, 0, 40), // 每局开始时由随机出生点覆盖
  velY: 0,
  yaw: 0, pitch: 0,
  eyeHeight: 1.62,
  crouchLerp: 0,
  hp: 100, armor: 60,
  moving: false, crouching: false, airborne: false,
  loot: [],
  kills: 0,
  startTime: 0,
  alive: true
};

// 撤离状态
let extractProgress = 0;
let gameState = 'menu'; // menu | playing | win | lose
let elapsed = 0;

// ================= 命中反馈特效 =================
const hitVfx = [];   // 短暂停留的命中标记
const puffPool = []; // 血雾/尘埃粒子池

function spawnPuff(point, dir, color, count, speedScale = 1) {
  for (let i = 0; i < count; i++) {
    let p = puffPool.find(p0 => p0.life <= 0);
    if (!p) {
      p = {
        mesh: new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6), new THREE.MeshBasicMaterial({ transparent: true })),
        vel: new THREE.Vector3(), life: 0
      };
      scene.add(p.mesh);
      puffPool.push(p);
    }
    p.mesh.visible = true;
    p.mesh.material.color.setHex(color);
    p.mesh.material.opacity = 0.95;
    p.mesh.position.copy(point);
    p.vel.set(
      (Math.random() - 0.5) * 2.4 + (dir ? dir.x : 0) * 1.6,
      Math.random() * 2.4 + 0.4,
      (Math.random() - 0.5) * 2.4 + (dir ? dir.z : 0) * 1.6
    ).multiplyScalar(speedScale);
    p.life = 0.3 + Math.random() * 0.18;
    p.mesh.scale.setScalar(0.6 + Math.random() * 0.9);
  }
}

function spawnBlood(point, dir) { spawnPuff(point, dir, 0x8a1a12, 7, 1); }
function spawnDust(point, dir) {
  spawnImpact(point, false);
  spawnPuff(point, dir, 0x9a9484, 4, 0.7);
}

function spawnImpact(point, onEnemy) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(onEnemy ? 0.06 : 0.045, 6, 6),
    new THREE.MeshBasicMaterial({ color: onEnemy ? 0xff5040 : 0xccccaa, transparent: true, opacity: 0.9 })
  );
  m.position.copy(point);
  scene.add(m);
  hitVfx.push({ mesh: m, life: 0.15 });
}

// 命中弹孔标记（墙面留痕）
function spawnImpactMark(point, normal) {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(0.05, 8),
    new THREE.MeshBasicMaterial({ color: 0x1a1c1e, transparent: true, opacity: 0.85 })
  );
  m.position.copy(point).addScaledVector(normal, 0.01);
  m.lookAt(point.clone().sub(normal));
  scene.add(m);
  hitVfx.push({ mesh: m, life: 6, fade: true });
}

function playerFire() {
  const scopedNow = weapon === sniper && controls.scopeHeld;
  const spread = weapon.currentSpread(player.moving, player.crouching, player.airborne, scopedNow);
  const shot = weapon.tryFire(spread);
  if (!shot) {
    if (weapon.mag === 0 && !weapon.reloading && weapon.reserve > 0) {
      if (weapon.startReload()) reloadSound();
    }
    return;
  }
  if (weapon.kind === 'sniper') sniperShotSound(); else shotSound(1);

  const { origin, dir } = shot;
  // 后坐力：视口逐渐上跳（越连射越明显）+ 轻微水平散移，仅作用于实际射出的子弹
  controls.pitch = Math.min(1.45, controls.pitch + weapon.shotKick + weapon.recoil * 0.30);
  controls.yaw += (Math.random() - 0.5) * 0.0016 * (1 + weapon.recoil * 9);

  const wallDist = raycastWorld(origin, dir, 200, world.colliders);

  // 与敌人做射线-球体判定（头部/躯干）
  let bestEnemy = null, bestDist = wallDist, bestHead = false, hitPoint = null;
  for (const e of enemyMgr.enemies) {
    if (e.state === 3) continue;
    const headC = new THREE.Vector3(e.pos.x, e.pos.y + 1.72, e.pos.z);
    const bodyC = new THREE.Vector3(e.pos.x, e.pos.y + 1.1, e.pos.z);
    for (const [c, r, isHead] of [[headC, 0.24, true], [bodyC, 0.45, false]]) {
      const oc = new THREE.Vector3().subVectors(c, origin);
      const tca = oc.dot(dir);
      if (tca < 0) continue;
      const d2 = oc.lengthSq() - tca * tca;
      if (d2 > r * r) continue;
      const t = tca - Math.sqrt(r * r - d2);
      if (t < bestDist) {
        bestDist = t; bestEnemy = e; bestHead = isHead;
        hitPoint = origin.clone().addScaledVector(dir, t);
      }
    }
  }

  const muzzle = origin.clone().addScaledVector(dir, 0.8).add(new THREE.Vector3(0, -0.1, 0));
  const end = origin.clone().addScaledVector(dir, bestDist);
  weapon.spawnTracer(muzzle, end);

  if (bestEnemy) {
    const killed = bestEnemy.hitBy(weapon.damage, bestHead);
    spawnBlood(hitPoint, dir);
    hud.hitmarker(killed, bestHead);
    hitSound(bestHead ? 'head' : 'body', killed);
    if (killed) {
      player.kills++;
      hud.killfeed(`你击倒了武装看守 ${bestHead ? '（爆头）' : ''}`);
    }
  } else if (bestDist < 200) {
    spawnDust(end, dir);
    // 弹孔留痕（用命中点反推法线近似：取射入反方向）
    spawnImpactMark(end.clone().addScaledVector(dir, -0.02), dir.clone().negate());
  }
}

// ================= 敌人回调 =================
const enemyCallbacks = {
  onSpot(enemy) {
    hud.killfeed('⚠ 有看守发现了你');
    beep(620, 0.12);
  },
  onEnemyFire(enemy, playerEye, dist) {
    enemyShotSound(dist);
    // 曳光
    const from = enemy.eye().add(new THREE.Vector3(Math.sin(enemy.yaw) * 0.4, -0.25, Math.cos(enemy.yaw) * 0.4));
    const hitChance = Math.max(0.08, 0.42 - dist / 80 - (player.moving ? 0.12 : 0) - (player.crouching ? 0.1 : 0));
    if (Math.random() < hitChance) {
      weapon.spawnTracer(from, playerEye.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2)));
      const dmg = Math.random() < 0.3 ? 0 : 5 + Math.random() * 6;
      if (dmg > 0) damagePlayer(dmg, enemy.pos);
    } else {
      const miss = playerEye.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3));
      weapon.spawnTracer(from, miss);
    }
  },
  onEnemyStep(enemy, p) {
    const d = Math.hypot(enemy.pos.x - p.pos.x, enemy.pos.z - p.pos.z);
    if (d < 18) beep(160 + Math.random() * 60, 0.03);
  }
};

function damagePlayer(dmg, fromPos) {
  if (!player.alive) return;
  // 破解过程被伤害打断（与三角洲行动一致：破解时被击中会中断）
  if (crack.active) cancelCrack(true);
  // 受击方向指示：弧线指向射手方位
  if (fromPos) {
    const bearing = Math.atan2(fromPos.x - player.pos.x, fromPos.z - player.pos.z);
    const facingBearing = controls.yaw + Math.PI;
    let rel = bearing - facingBearing;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    hud.showDamageDir(-rel * 57.3);
  }
  if (player.armor > 0) {
    const absorbed = Math.min(player.armor, dmg * 0.6);
    player.armor -= absorbed;
    dmg -= absorbed;
  }
  player.hp -= dmg;
  hurtSound();
  if (player.hp <= 0) {
    player.hp = 0;
    player.alive = false;
    endGame(false);
  }
}

// ================= 结算 / 重开 =================
const menuEl = document.getElementById('menu');
const endEl = document.getElementById('end-screen');
const briefPanel = document.getElementById('brief-panel');
let chosenMode = 'pc';

// 每张地图的行动简报（环境叙事）
const MAP_BRIEF = {
  prison: {
    code: '行动代号 X-7 · 绝密',
    text: '七十二小时前，潮汐监狱与外界失去联络。卫星图显示狱方在失联前转移了一批高价值物资——它们还留在监狱某处。看守已经失控游荡，潮水正在再次上涨。潜入、搜刮、在水位淹没码头之前撤离。'
  },
  dam: {
    code: '行动代号 X-9 · 绝密',
    text: '零号大坝战后被武装看守盘踞，坝顶机房里封存着战前的机密货物。情报显示“渡鸦”已经入境，交易随时可能发生。注意：撤离点每日更换，出发前确认小地图上的绿色标记。潜入、搜刮、抢在所有人之前撤离。'
  }
};

function startGame(touchMode, mapId = 'prison', force = {}) {
  initAudio();
  if (currentMapId !== mapId) buildMap(mapId); // 直接调用时自动切换地图
  controls.enableTouch(touchMode);
  hud.el.hud.classList.toggle('touch', touchMode);
  menuEl.style.display = 'none';
  endEl.style.display = 'none';
  document.getElementById('map-menu').style.display = 'none';
  hud.show();
  gameState = 'playing';
  player.hp = 100; player.armor = 60;
  player.alive = true;
  player.loot = []; player.kills = 0;
  // 每局随机出生点（面向地图中心）与随机撤离点
  const sp = world.spawnPoints[Math.floor(Math.random() * world.spawnPoints.length)];
  player.pos.copy(sp);
  player.velY = 0;
  controls.yaw = Math.atan2(-sp.x, sp.z);
  controls.pitch = 0;
  const ep = world.extractPoints[Math.floor(Math.random() * world.extractPoints.length)];
  world.extractPoint.copy(ep);
  lootMgr.setExtractPoint(ep);
  // 武器重置：初始标配 AS VAL + M700（弹匣内 5 发狙击弹，补充靠宝箱）
  rifle.mag = rifle.magSize; rifle.reserve = 120; rifle.recoil = 0; rifle.reloading = false;
  sniper.owned = true; sniper.mag = 5; sniper.reserve = 0; sniper.recoil = 0; sniper.reloading = false;
  sniper.viewmodel.visible = false;
  weapon = rifle;
  controls.scopeHeld = false;
  hud.setGun(rifle.name);
  hud.setScope(false);
  extractProgress = 0;
  elapsed = 0;
  cancelCrack(false);
  lootMgr.reset(); // 每局重新随机布置所有物资箱与加密保险箱（全部关闭）
  player.loreFound = 0;
  hud.setLore(0, lootMgr.loreTotal);
  const bf = MAP_BRIEF[mapId] || MAP_BRIEF.prison;
  hud.showBriefing(bf.code, MAPS[mapId].name, bf.text);
  hud.setLoot([]);
  hud.extractBanner(false);
  hud.toast(`行动开始 — 目标地图：${MAPS[mapId].name}`, 2600);

  // 重置敌人
  for (const e of enemyMgr.enemies) scene.remove(e.mesh);
  enemyMgr.enemies = [];
  enemyMgr.spawnAll(10);
  events.reset(player.pos, force); // 随机事件抽签（须在敌人重置之后，事件守卫才不会被清掉）
}

// 站位探测：某点在给定脚部高度下是否可站（供台阶攀登判定）
function pointFree(x, z, feetY, colliders, r = 0.3) {
  const head = feetY + 1.2;
  for (const c of colliders) {
    if (head < c.min.y || feetY > c.max.y - 0.02) continue;
    if (x + r > c.min.x && x - r < c.max.x && z + r > c.min.z && z - r < c.max.z) return false;
  }
  return true;
}

// ================= 加密保险箱密码破解 =================
const crackUI = document.getElementById('crack-ui');
const crack = {
  active: false, safe: null,
  locked: 0, pos: 0, dir: 1, speed: 1.5
};
const ZONE_W = [0.20, 0.16, 0.13]; // 第 1/2/3 位的绿色区域宽度

function startCrack(safe) {
  crack.active = true;
  crack.safe = safe;
  crack.locked = 0;
  crack.pos = Math.random();
  crack.dir = 1;
  crack.speed = 1.05;
  crackUI.style.display = 'flex';
  for (let i = 0; i < 3; i++) document.getElementById('d' + i).classList.remove('ok');
  updateCrackUI();
  beep(500, 0.08);
}

function cancelCrack(byDamage) {
  crack.active = false;
  crack.safe = null;
  crackUI.style.display = 'none';
  controls.jumpQueued = false; controls.useQueued = false;
  if (byDamage) hud.toast('破解被射击打断！');
}

function updateCrackUI() {
  const zone = ZONE_W[crack.locked] || 0.11;
  document.getElementById('crack-zone').style.left = (50 - zone / 2 * 100) + '%';
  document.getElementById('crack-zone').style.width = (zone * 100) + '%';
  document.getElementById('crack-needle').style.left = 'calc(' + (crack.pos * 100) + '% - 1px)';
}

function tryLock() {
  if (!crack.active) return;
  controls.jumpQueued = false; controls.useQueued = false;
  const zone = ZONE_W[crack.locked] || 0.11;
  if (Math.abs(crack.pos - 0.5) <= zone / 2) {
    // 锁对一位
    document.getElementById('d' + crack.locked).classList.add('ok');
    crack.locked++;
    crack.speed *= 1.3;
    beep(700 + crack.locked * 200, 0.1);
    if (crack.locked >= 3) {
      const msgs = lootMgr.openSafe(crack.safe, player);
      hud.toast('保险箱开启！获得：' + msgs.join('、'), 3000);
      hud.setLoot(player.loot);
      cancelCrack(false);
    }
  } else {
    // 失误：红闪，当前位重新转
    beep(200, 0.12);
    crackUI.classList.add('flash');
    setTimeout(() => crackUI.classList.remove('flash'), 180);
  }
}

document.getElementById('crack-lock').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); tryLock(); });
document.getElementById('crack-cancel').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); cancelCrack(false); });
window.addEventListener('keydown', (e) => {
  if (crack.active) {
    if (e.code === 'Space' || e.code === 'KeyE') { tryLock(); e.preventDefault(); }
    if (e.code === 'Escape' || e.code === 'KeyQ') cancelCrack(false);
  }
});

function endGame(win) {
  gameState = win ? 'win' : 'lose';
  cancelCrack(false);
  hud.extractBanner(false);
  hud.interactTip(null);
  if (document.pointerLockElement) document.exitPointerLock();
  const total = player.loot.reduce((s, i) => s + i.value, 0);
  const mins = Math.floor(elapsed / 60), secs = Math.floor(elapsed % 60);
  document.getElementById('end-result').textContent = win ? '撤离成功' : '行动失败';
  document.getElementById('end-result').className = 'result ' + (win ? 'win' : 'lose');
  document.getElementById('end-stats').innerHTML =
    `带走物资价值 <b>¥${total.toLocaleString()}</b>　·　击倒看守 <b>${player.kills}</b> 人<br>` +
    `情报档案 <b>${player.loreFound || 0}/${lootMgr.loreTotal}</b>　·　存活时间 <b>${mins}分${secs.toString().padStart(2, '0')}秒</b>` +
    (win ? '<br><span style="color:#6affb0">直升机已接应，干得漂亮。</span>'
         : '<br><span style="color:#ff8a7a">搜刮到的物资全部遗落在监狱中…</span>');
  hud.el.hud.style.display = 'none';
  endEl.style.display = 'flex';
}

document.getElementById('btn-pc').addEventListener('click', () => {
  chosenMode = 'pc';
  menuEl.style.display = 'none';
  document.getElementById('map-menu').style.display = 'flex';
});
document.getElementById('btn-pad').addEventListener('click', () => {
  chosenMode = 'pad';
  menuEl.style.display = 'none';
  document.getElementById('map-menu').style.display = 'flex';
});
document.getElementById('btn-back').addEventListener('click', () => {
  document.getElementById('map-menu').style.display = 'none';
  menuEl.style.display = 'flex';
});
for (const id of ['map-prison', 'map-dam']) {
  document.getElementById(id).addEventListener('click', () => {
    const mapId = id === 'map-dam' ? 'dam' : 'prison';
    if (currentMapId !== mapId) buildMap(mapId);
    startGame(chosenMode === 'pad', mapId);
  });
}
document.getElementById('btn-restart').addEventListener('click', () => {
  endEl.style.display = 'none';
  document.getElementById('map-menu').style.display = 'flex';
  gameState = 'menu';
});

// ================= 主循环 =================
let lastStepTime = 0;
function updateFrame(dt, t) {
    world.update(t);
    lootMgr.update(t);
    weapon.update(dt);
    if (weapon !== rifle) rifle.update(dt); else sniper.update(dt);

  // 特效衰减
  for (let i = hitVfx.length - 1; i >= 0; i--) {
    hitVfx[i].life -= dt;
    if (hitVfx[i].fade) hitVfx[i].mesh.material.opacity = Math.min(0.85, hitVfx[i].life / 6 * 0.85);
    if (hitVfx[i].life <= 0) { scene.remove(hitVfx[i].mesh); hitVfx.splice(i, 1); }
  }
  // 血雾/尘埃粒子
  for (const p of puffPool) {
    if (p.life <= 0) continue;
    p.life -= dt;
    p.vel.y -= 9 * dt;
    p.mesh.position.addScaledVector(p.vel, dt);
    p.mesh.material.opacity = Math.max(0, p.life * 2.6);
    if (p.life <= 0) p.mesh.visible = false;
  }
  hud.tickDamageDir(dt);

  // 动态分辨率：每 2 秒按实测帧率调整渲染精度
  fpsAcc += dt; fpsCount++;
  if (fpsAcc >= 2) {
    const fps = fpsCount / fpsAcc;
    if (fps < 42 && curPR > 0.8) {
      curPR = Math.max(0.8, curPR - 0.25);
      renderer.setPixelRatio(curPR); composer.setPixelRatio(curPR);
    } else if (fps > 57 && curPR < maxPR) {
      curPR = Math.min(maxPR, curPR + 0.25);
      renderer.setPixelRatio(curPR); composer.setPixelRatio(curPR);
    }
    fpsAcc = 0; fpsCount = 0;
  }

  if (gameState === 'playing') {
    elapsed += dt;
    const inp = controls.sample(dt);

    // ---- 密码破解进行中：推进转盘指针，冻结移动/射击/交互 ----
    if (crack.active) {
      crack.pos += crack.dir * crack.speed * dt;
      if (crack.pos > 1) { crack.pos = 1; crack.dir = -1; }
      if (crack.pos < 0) { crack.pos = 0; crack.dir = 1; }
      updateCrackUI();
      inp.mx = 0; inp.mz = 0; inp.sprint = false;
      inp.jump = false; inp.fire = false; inp.reload = false; inp.use = false;
    }

    // ---- 切枪（Q / 触屏切枪按钮）----
    if (!crack.active && inp.swap) {
      const next = weapon === rifle ? (sniper.owned ? sniper : null) : rifle;
      if (next) {
        weapon.reloading = false;
        weapon = next;
        if (weapon === rifle) controls.scopeHeld = false;
        hud.setGun(weapon.name);
        hud.toast(weapon === sniper ? '已切换 M700 狙击枪 — 右键/开镜键瞄准' : '已切换 AS VAL 突击步枪', 1500);
        beep(520, 0.06);
      } else {
        hud.toast('尚未获得狙击枪 — 搜刮物资箱获取', 1600);
      }
    }

    // ---- 开镜状态（仅狙击枪）----
    const scopedNow = weapon === sniper && weapon.owned && controls.scopeHeld && !weapon.reloading;
    controls.sensScale = scopedNow ? 0.32 : 1;
    rifle.viewmodel.visible = weapon === rifle;
    sniper.viewmodel.visible = weapon === sniper && !scopedNow;
    hud.setScope(scopedNow);

    // ---- 玩家移动 ----
    player.crouching = inp.crouch;
    const targetEye = player.crouching ? 1.05 : 1.62;
    player.eyeHeight += (targetEye - player.eyeHeight) * Math.min(1, dt * 10);

    const speed = player.crouching ? 2.1 : (inp.sprint ? 7.0 : 4.2);
    const sin = Math.sin(controls.yaw), cos = Math.cos(controls.yaw);
    // 相机前方向 = (-sin yaw, -cos yaw)，右方向 = (cos yaw, -sin yaw)
    // W 为 mz=-1：v = mx*右 + (-mz)*前
    const vx = (inp.mx * cos + inp.mz * sin) * speed;
    const vz = (-inp.mx * sin + inp.mz * cos) * speed;
    player.moving = Math.hypot(vx, vz) > 0.5;

    const ground = groundHeight(player.pos.x, player.pos.z, player.pos.y, world.colliders);
    if (inp.jump && !player.airborne && !player.crouching) {
      player.velY = 6.4;
      player.airborne = true;
    }
    if (player.airborne) {
      player.velY -= 18 * dt;
      player.pos.y += player.velY * dt;
      if (player.pos.y <= ground) { player.pos.y = ground; player.velY = 0; player.airborne = false; }
    } else if (player.pos.y > ground + 0.05) {
      // 走下台阶
      player.airborne = true;
      player.velY = 0;
    } else {
      player.pos.y = ground;
    }

    // 疾跑/开镜视野变化（开镜大幅变焦）
    const targetFov = scopedNow ? 20 : ((inp.sprint && player.moving && !player.crouching) ? 82 : 75);
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 7);
      camera.updateProjectionMatrix();
    }

    const res = moveWithCollisions(player.pos, { x: vx * dt, z: vz * dt }, world.colliders, 0.38, player.crouching ? 1.2 : 1.7);
    player.pos.x = res.x; player.pos.z = res.z;
    // 台阶自动踏上：低处被挡、抬高 0.55m 后通畅，且前方地面高差 ≤0.55 则登上
    if (res.hit && !player.airborne && !player.crouching) {
      const len = Math.hypot(vx, vz) || 1;
      const aheadX = player.pos.x + (vx / len) * 0.55;
      const aheadZ = player.pos.z + (vz / len) * 0.55;
      const lowBlocked = !pointFree(aheadX, aheadZ, player.pos.y, world.colliders);
      const highFree = pointFree(aheadX, aheadZ, player.pos.y + 0.55, world.colliders);
      if (lowBlocked && highFree) {
        const gh = groundHeight(aheadX, aheadZ, player.pos.y, world.colliders);
        if (gh > player.pos.y && gh <= player.pos.y + 0.56 && pointFree(aheadX, aheadZ, gh, world.colliders)) {
          player.pos.x = aheadX; player.pos.z = aheadZ; player.pos.y = gh;
        }
      }
    }

    // 脚步声
    if (player.moving && !player.airborne && t - lastStepTime > (inp.sprint ? 0.3 : 0.45)) {
      lastStepTime = t;
      footstep();
    }

    // ---- 相机 ----
    player.yaw = controls.yaw;
    player.pitch = controls.pitch;
    camera.position.set(player.pos.x, player.pos.y + player.eyeHeight, player.pos.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = controls.yaw;
    camera.rotation.x = controls.pitch + weapon.recoil * 2.2;
    camera.rotation.z = 0;

    // ---- 射击 / 换弹 ----
    if (inp.reload) { if (weapon.startReload()) reloadSound(); }
    if (inp.fire) playerFire();

    // ---- 敌人 ----
    for (const e of enemyMgr.enemies) e.update(dt, t, player, enemyCallbacks);
    events.update(dt, player);

    // ---- 搜刮 / 破解 / 档案交互 ----
    const crate = lootMgr.nearestOpenable(player.pos);
    const safe = crack.active ? null : lootMgr.nearestSafe(player.pos);
    const lore = lootMgr.nearestLore(player.pos);
    if (crate) {
      hud.interactTip((controls.touchMode ? '点击【互动】' : '按 <b>E</b>') + ` 搜刮${crate.special ? '空投' : ''}物资箱`);
      if (inp.use) {
        const msgs = lootMgr.open(crate, player, weapon, sniper);
        hud.toast('获得：' + msgs.join('、'));
        hud.setLoot(player.loot);
      }
    } else if (safe) {
      hud.interactTip((controls.touchMode ? '点击【互动】' : '按 <b>E</b>') + ` 破解加密保险箱（高价值）`);
      if (inp.use) startCrack(safe);
    } else if (lore) {
      hud.interactTip((controls.touchMode ? '点击【互动】' : '按 <b>E</b>') + ` 拾取情报档案`);
      if (inp.use) {
        const text = lootMgr.pickLore(lore);
        player.loreFound++;
        hud.setLore(player.loreFound, lootMgr.loreTotal);
        hud.toast(text, 5200);
        beep(880, 0.12);
      }
    } else {
      hud.interactTip(null);
    }

    // ---- 撤离判定 ----
    const dEx = Math.hypot(player.pos.x - world.extractPoint.x, player.pos.z - world.extractPoint.z);
    if (dEx < world.extractRadius && !crack.active) {
      extractProgress += dt;
      hud.extractBanner(true, `保持位于撤离区 ${Math.ceil(5 - extractProgress)} 秒`);
      if (Math.floor(extractProgress * 2) !== Math.floor((extractProgress - dt) * 2)) beep(980, 0.08);
      if (extractProgress >= 5) endGame(true);
    } else {
      extractProgress = Math.max(0, extractProgress - dt * 2);
      hud.extractBanner(false);
    }
    const mins = Math.floor(elapsed / 60), secs = Math.floor(elapsed % 60);
    hud.setZoneTimer(`行动时间 ${mins}:${secs.toString().padStart(2, '0')} · 场上剩余看守 ${enemyMgr.alive()}`);

    hud.setHealth(player.hp, player.armor);
    hud.setAmmo(weapon.mag, weapon.reserve);
    hud.drawMinimap(player, enemyMgr.enemies, world, dEx, lootMgr.safes, events.getMarkers());
  }

  composer.render();
}

// 可见时由 rAF 驱动；隐藏/自动化测试时可通过 updateFrame 手动驱动
function tick() {
  requestAnimationFrame(tick);
  updateFrame(Math.min(0.05, clock.getDelta()), clock.elapsedTime);
}

const clock = new THREE.Clock();

// 调试 / 自动化测试句柄
window.__game = { player, controls, weapon: null, rifle, sniper, getWeapon: () => weapon, enemyMgr, lootMgr, world, scene, camera, startGame, endGame, gameState: () => gameState, crack, tryLock, cancelCrack, buildMap, updateFrame };
buildMap('prison'); // 启动即构建监狱地图（作为菜单背景与默认地图）

// 隐藏 loading
document.getElementById('loading').style.display = 'none';
tick();
