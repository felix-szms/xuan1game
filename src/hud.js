// HUD 更新与小地图绘制
export class HUD {
  constructor() {
    this.el = {
      hud: document.getElementById('hud'),
      hp: document.getElementById('hp-fill'),
      armor: document.getElementById('armor-fill'),
      lootVal: document.getElementById('loot-val'),
      lootList: document.getElementById('loot-list'),
      zoneTimer: document.getElementById('zone-timer'),
      ammoCur: document.getElementById('ammo-cur'),
      ammoRes: document.getElementById('ammo-res'),
      hitmarker: document.getElementById('hitmarker'),
      vignette: document.getElementById('vignette'),
      killfeed: document.getElementById('killfeed'),
      interactTip: document.getElementById('interact-tip'),
      extractBanner: document.getElementById('extract-banner'),
      extractProgress: document.getElementById('extract-progress'),
      toast: document.getElementById('toast'),
      minimap: document.getElementById('minimap')
    };
    this.mmCtx = this.el.minimap.getContext('2d');
    this._toastTimer = null;
    this._hmTimer = null;
  }

  show() { this.el.hud.style.display = 'block'; }

  setHealth(hp, armor) {
    const f = this.el.hp;
    f.style.width = Math.max(0, hp) + '%';
    f.classList.toggle('low', hp < 35);
    this.el.armor.style.width = Math.max(0, armor) + '%';
    this.el.vignette.style.opacity = hp < 70 ? (70 - hp) / 70 * 0.9 : 0;
  }

  setAmmo(cur, res) {
    this.el.ammoCur.textContent = cur;
    this.el.ammoRes.textContent = res;
    this.el.ammoCur.parentElement.classList.toggle('empty', cur === 0);
  }

  setLoot(items) {
    const total = items.reduce((s, i) => s + i.value, 0);
    this.el.lootVal.textContent = total.toLocaleString();
    this.el.lootList.innerHTML = items.slice(-5).map(i => `${i.name} <span style="color:#ffd76a">¥${i.value}</span>`).join('<br>');
  }

  setZoneTimer(text) { this.el.zoneTimer.textContent = text; }

  hitmarker(kill) {
    const h = this.el.hitmarker;
    h.classList.toggle('kill', kill);
    h.style.opacity = 1;
    clearTimeout(this._hmTimer);
    this._hmTimer = setTimeout(() => { h.style.opacity = 0; }, 120);
  }

  killfeed(text) {
    const d = document.createElement('div');
    d.textContent = text;
    this.el.killfeed.appendChild(d);
    setTimeout(() => d.remove(), 5000);
    while (this.el.killfeed.children.length > 5) this.el.killfeed.firstChild.remove();
  }

  interactTip(text) {
    if (text) {
      this.el.interactTip.innerHTML = text;
      this.el.interactTip.style.display = 'block';
    } else {
      this.el.interactTip.style.display = 'none';
    }
  }

  extractBanner(show, progressText) {
    this.el.extractBanner.style.display = show ? 'block' : 'none';
    if (progressText) this.el.extractProgress.textContent = progressText;
  }

  toast(text, dur = 2200) {
    const t = this.el.toast;
    t.textContent = text;
    t.style.opacity = 1;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { t.style.opacity = 0; }, dur);
  }

  // 小地图：以玩家为中心旋转
  drawMinimap(player, enemies, world, extractDist, safes = []) {
    const ctx = this.mmCtx;
    const W = 340, R = W / 2, view = 46; // 显示半径（米）
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.beginPath(); ctx.arc(R, R, R - 4, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = 'rgba(8,16,24,0.85)'; ctx.fillRect(0, 0, W, W);

    const s = R / view;
    const px = player.pos.x, pz = player.pos.z, pyaw = player.yaw;
    // 旋转 +yaw 使玩家面朝方向显示为小地图正上方
    const tx = (x, z) => {
      const dx = x - px, dz = z - pz;
      const c = Math.cos(pyaw), sn = Math.sin(pyaw);
      return [R + (dx * c - dz * sn) * s, R + (dx * sn + dz * c) * s];
    };

    // 墙体
    ctx.fillStyle = 'rgba(120,160,190,0.5)';
    for (const r of world.minimapRects) {
      const p1 = tx(r.x - r.w / 2, r.z - r.d / 2);
      const p2 = tx(r.x + r.w / 2, r.z + r.d / 2);
      const x0 = Math.min(p1[0], p2[0]), x1 = Math.max(p1[0], p2[0]);
      const y0 = Math.min(p1[1], p2[1]), y1 = Math.max(p1[1], p2[1]);
      ctx.fillRect(x0, y0, Math.max(2, x1 - x0), Math.max(2, y1 - y0));
    }

    // 撤离点
    const e = tx(world.extractPoint.x, world.extractPoint.z);
    ctx.fillStyle = '#30ff90';
    ctx.beginPath(); ctx.arc(e[0], e[1], 7, 0, Math.PI * 2); ctx.fill();
    ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('撤离', e[0], e[1] - 10);

    // 未开启的物资箱
    ctx.fillStyle = 'rgba(255,215,110,0.75)';
    for (const c of world.lootCrates || []) {
      if (c.opened) continue;
      if (Math.hypot(c.pos.x - px, c.pos.z - pz) > view) continue;
      const p = tx(c.pos.x, c.pos.z);
      ctx.fillRect(p[0] - 2.5, p[1] - 2.5, 5, 5);
    }

    // 加密保险箱（青色方块，价值高优先找）
    ctx.fillStyle = '#40e0ff';
    for (const s of safes) {
      if (s.opened) continue;
      if (Math.hypot(s.pos.x - px, s.pos.z - pz) > view) continue;
      const p = tx(s.pos.x, s.pos.z);
      ctx.fillRect(p[0] - 3.5, p[1] - 3.5, 7, 7);
    }

    // 敌人
    for (const en of enemies) {
      if (en.state === 3) continue;
      const d = Math.hypot(en.pos.x - px, en.pos.z - pz);
      if (d > view) continue;
      const p = tx(en.pos.x, en.pos.z);
      ctx.fillStyle = en.state === 2 ? '#ff4030' : '#e08060';
      ctx.beginPath(); ctx.arc(p[0], p[1], 4, 0, Math.PI * 2); ctx.fill();
    }

    // 玩家箭头
    ctx.fillStyle = '#8fe0ff';
    ctx.beginPath();
    ctx.moveTo(R, R - 9); ctx.lineTo(R - 6, R + 7); ctx.lineTo(R + 6, R + 7);
    ctx.closePath(); ctx.fill();

    // 撤离方向指示（超出小地图范围时显示在边缘，方向与小地图旋转一致）
    if (extractDist > view) {
      const dx = world.extractPoint.x - px, dz = world.extractPoint.z - pz;
      const c = Math.cos(pyaw), sn = Math.sin(pyaw);
      const rx = dx * c - dz * sn, ry = dx * sn + dz * c;
      const ang = Math.atan2(rx, -ry); // 相对“正上方=面朝方向”的角度
      const ex = R + Math.sin(ang) * (R - 16);
      const ey = R - Math.cos(ang) * (R - 16);
      ctx.fillStyle = '#30ff90';
      ctx.beginPath(); ctx.arc(ex, ey, 5, 0, Math.PI * 2); ctx.fill();
    }

    ctx.restore();
    // 边框
    ctx.strokeStyle = 'rgba(140,190,220,0.4)';
    ctx.beginPath(); ctx.arc(R, R, R - 4, 0, Math.PI * 2); ctx.stroke();
  }
}
