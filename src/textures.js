import * as THREE from 'three';

// ============================================================
// 程序化照片风纹理：Canvas 生成（污渍/颗粒/划痕/锈迹/条纹），
// 无需外部素材文件，替代纯色材质大幅提升真实感
// ============================================================

function canvasTex(size, draw, repeatX = 1, repeatY = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// 纹理缓存：同一参数只生成一次（切换地图重建场景时避免卡顿）
const _texCache = new Map();
function cached(key, gen) {
  if (!_texCache.has(key)) _texCache.set(key, gen());
  return _texCache.get(key);
}

// 全图颗粒噪声（模拟表面细部）
function grain(ctx, size, amount = 16) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

// 随机污渍斑
function stains(ctx, size, count, rgba, maxR, elongate = 1) {
  for (let i = 0; i < count; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = maxR * (0.3 + Math.random() * 0.7);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, elongate);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, rgba);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
    ctx.restore();
  }
}

// 垂直水渍流痕（墙面积水留下的真实细节）
function drips(ctx, size, count, rgba) {
  for (let i = 0; i < count; i++) {
    const x = Math.random() * size;
    const len = size * (0.15 + Math.random() * 0.5);
    const y = Math.random() * size * 0.4;
    const g = ctx.createLinearGradient(x, y, x, y + len);
    g.addColorStop(0, rgba);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.strokeStyle = g;
    ctx.lineWidth = 1 + Math.random() * 3;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + len); ctx.stroke();
  }
}

// 裂缝（随机折线）
function cracks(ctx, size, count, rgba) {
  for (let i = 0; i < count; i++) {
    let x = Math.random() * size, y = Math.random() * size;
    ctx.strokeStyle = rgba;
    ctx.lineWidth = 0.8 + Math.random();
    ctx.beginPath(); ctx.moveTo(x, y);
    const segs = 4 + Math.floor(Math.random() * 6);
    for (let s = 0; s < segs; s++) {
      x += (Math.random() - 0.5) * size * 0.14;
      y += (Math.random() - 0.5) * size * 0.14;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

// ---------- 各表面生成器 ----------

// 混凝土（围墙/建筑）
export function concreteTexture(size = 512, repeat = 4, tint = '#82898f') {
  return cached(`concrete_${tint}`, () =>
    canvasTex(size, (ctx, s) => {
      ctx.fillStyle = tint; ctx.fillRect(0, 0, s, s);
      stains(ctx, s, 26, 'rgba(40,44,48,0.16)', s * 0.16);
      stains(ctx, s, 14, 'rgba(255,255,255,0.07)', s * 0.12);
      drips(ctx, s, 10, 'rgba(30,32,34,0.12)');
      cracks(ctx, s, 5, 'rgba(30,32,34,0.22)');
      grain(ctx, s, 20);
    }, repeat, repeat));
}

// 监狱场地地面（深色水泥 + 油污 + 磨损）/ 沙漠地面（暖色调）
export function groundTexture(size = 512, repeat = 36, tint = '#4c5257') {
  return cached(`ground_${tint}`, () =>
    canvasTex(size, (ctx, s) => {
      ctx.fillStyle = tint; ctx.fillRect(0, 0, s, s);
      stains(ctx, s, 34, 'rgba(20,22,24,0.25)', s * 0.2);
      stains(ctx, s, 16, 'rgba(120,126,130,0.08)', s * 0.14);
      // 轮胎擦痕
      ctx.strokeStyle = 'rgba(18,20,22,0.14)';
      for (let i = 0; i < 8; i++) {
        ctx.lineWidth = 6 + Math.random() * 10;
        ctx.beginPath();
        ctx.moveTo(Math.random() * s, Math.random() * s);
        ctx.quadraticCurveTo(Math.random() * s, Math.random() * s, Math.random() * s, Math.random() * s);
        ctx.stroke();
      }
      cracks(ctx, s, 8, 'rgba(16,18,20,0.3)');
      grain(ctx, s, 22);
    }, repeat, repeat));
}

// 集装箱瓦楞面（底色 + 竖条纹 + 锈迹流痕）
export function containerTexture(base, size = 512) {
  return cached(`container_${base}`, () =>
    canvasTex(size, (ctx, s) => {
      ctx.fillStyle = base; ctx.fillRect(0, 0, s, s);
      // 瓦楞竖条
      const band = s / 24;
      for (let x = 0; x < s; x += band) {
        ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.fillRect(x, 0, band * 0.28, s);
        ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(x + band * 0.28, 0, band * 0.14, s);
      }
      // 锈斑与流痕
      stains(ctx, s, 18, 'rgba(72,42,22,0.32)', s * 0.09, 2.2);
      drips(ctx, s, 14, 'rgba(60,34,18,0.28)');
      // 边缘磨损
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(0, 0, s, 6); ctx.fillRect(0, s - 6, s, 6);
      grain(ctx, s, 18);
    }, 1, 1));
}

// 做旧金属（钢架/门/工作台）
export function metalTexture(size = 256, repeat = 1, tint = '#48545e') {
  return cached(`metal_${tint}`, () =>
    canvasTex(size, (ctx, s) => {
      ctx.fillStyle = tint; ctx.fillRect(0, 0, s, s);
      // 拉丝横纹
      for (let i = 0; i < 60; i++) {
        ctx.strokeStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
        ctx.lineWidth = 1;
        const y = Math.random() * s;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y + (Math.random() - 0.5) * 8); ctx.stroke();
      }
      stains(ctx, s, 8, 'rgba(70,40,20,0.25)', s * 0.1);
      grain(ctx, s, 12);
    }, repeat, repeat));
}

// 旧木板（木箱/栈桥）
export function woodTexture(size = 512, repeat = 2, tint = '#6b5638') {
  return cached(`wood_${tint}`, () =>
    canvasTex(size, (ctx, s) => {
      ctx.fillStyle = tint; ctx.fillRect(0, 0, s, s);
      // 板条
      const planks = 6;
      for (let i = 0; i < planks; i++) {
        const y = (i * s) / planks;
        ctx.fillStyle = `rgba(0,0,0,${0.1 + Math.random() * 0.12})`;
        ctx.fillRect(0, y, s, 3);
        ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
        ctx.fillRect(0, y + 3, s, 2);
        // 木纹
        for (let k = 0; k < 14; k++) {
          ctx.strokeStyle = `rgba(30,20,10,${0.06 + Math.random() * 0.1})`;
          ctx.lineWidth = 1;
          const wy = y + 6 + Math.random() * (s / planks - 8);
          ctx.beginPath(); ctx.moveTo(0, wy);
          ctx.bezierCurveTo(s * 0.3, wy + (Math.random() - 0.5) * 8, s * 0.6, wy + (Math.random() - 0.5) * 8, s, wy);
          ctx.stroke();
        }
      }
      stains(ctx, s, 10, 'rgba(20,14,8,0.2)', s * 0.1);
      grain(ctx, s, 14);
    }, repeat, repeat));
}

// 灰浆墙面（监区/工坊内墙）
export function plasterTexture(size = 512, repeat = 4, tint = '#6e7a72') {
  return cached(`plaster_${tint}`, () =>
    canvasTex(size, (ctx, s) => {
      ctx.fillStyle = tint; ctx.fillRect(0, 0, s, s);
      stains(ctx, s, 20, 'rgba(24,28,26,0.14)', s * 0.15);
      drips(ctx, s, 12, 'rgba(20,24,22,0.12)');
      // 墙皮剥落
      stains(ctx, s, 8, 'rgba(150,150,140,0.12)', s * 0.05);
      grain(ctx, s, 18);
    }, repeat, repeat));
}

// 径向接触阴影贴图（放在物件脚下，伪造环境光遮蔽）
export function contactShadowTexture(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.65, 'rgba(0,0,0,0.28)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
