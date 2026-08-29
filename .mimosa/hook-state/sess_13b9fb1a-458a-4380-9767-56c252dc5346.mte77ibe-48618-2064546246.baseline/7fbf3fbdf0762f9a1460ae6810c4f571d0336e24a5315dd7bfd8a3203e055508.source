// 玩家输入：PC 键鼠（指针锁定）+ 平板触屏（左摇杆移动 / 右半屏滑动视角）
export class Controls {
  constructor(canvas, touchUI) {
    this.canvas = canvas;
    this.touchUI = touchUI;
    this.keys = {};
    this.yaw = 0; this.pitch = 0;
    this.sensitivity = 0.0023;
    this.move = { x: 0, z: 0 };        // 归一化移动输入
    this.sprint = false;
    this.jumpQueued = false;
    this.crouch = false;
    this.fireHeld = false;
    this.reloadQueued = false;
    this.useQueued = false;
    this.touchMode = false;
    this.pointerLocked = false;
    this.lookDelta = { x: 0, y: 0 };
    this.enabled = true;

    this._bindKeyboard();
    this._bindMouse();
    this._bindTouch();
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys[e.code] = true;
      if (e.code === 'KeyR') this.reloadQueued = true;
      if (e.code === 'KeyE' || e.code === 'KeyF') this.useQueued = true;
      if (e.code === 'Space') { this.jumpQueued = true; e.preventDefault(); }
      if (e.code === 'KeyC') this.crouch = !this.crouch;
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
  }

  _bindMouse() {
    this.canvas.addEventListener('click', () => {
      if (!this.touchMode && this.enabled && !this.pointerLocked) {
        this.canvas.requestPointerLock();
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.lookDelta.x += e.movementX;
      this.lookDelta.y += e.movementY;
    });
    document.addEventListener('mousedown', (e) => {
      if (this.pointerLocked && e.button === 0) this.fireHeld = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fireHeld = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _bindTouch() {
    // 统一使用 Pointer Events：鼠标点击与真机触屏都能驱动摇杆和按钮
    const joy = document.getElementById('joy');
    const knob = document.getElementById('joy-knob');
    let joyId = null, lookId = null;
    let joyCenter = { x: 0, y: 0 };
    let lastLook = { x: 0, y: 0 };
    const JOY_MAX = 52;

    const joyUpdate = (e) => {
      let dx = e.clientX - joyCenter.x, dy = e.clientY - joyCenter.y;
      const len = Math.hypot(dx, dy);
      if (len > JOY_MAX) { dx = dx / len * JOY_MAX; dy = dy / len * JOY_MAX; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.move.x = dx / JOY_MAX;
      this.move.z = dy / JOY_MAX;
      this.sprint = len > JOY_MAX * 0.85; // 推满摇杆疾跑
    };
    joy.addEventListener('pointerdown', (e) => {
      if (joyId !== null) return;
      joyId = e.pointerId;
      const r = joy.getBoundingClientRect();
      joyCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      try { joy.setPointerCapture(e.pointerId); } catch (_) {}
      joyUpdate(e);
      e.preventDefault();
    });
    joy.addEventListener('pointermove', (e) => {
      if (e.pointerId !== joyId) return;
      joyUpdate(e);
      e.preventDefault();
    });
    const joyEnd = (e) => {
      if (e.pointerId !== joyId) return;
      joyId = null;
      knob.style.transform = '';
      this.move.x = 0; this.move.z = 0; this.sprint = false;
    };
    joy.addEventListener('pointerup', joyEnd);
    joy.addEventListener('pointercancel', joyEnd);

    // 右半屏滑动转视角（摇杆与按钮区域由其自身处理并 stopPropagation）
    window.addEventListener('pointerdown', (e) => {
      if (!this.touchMode || this.pointerLocked) return;
      if (e.clientX < window.innerWidth * 0.38) return;
      if (lookId !== null) return;
      lookId = e.pointerId;
      lastLook = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('pointermove', (e) => {
      if (e.pointerId !== lookId) return;
      this.lookDelta.x += (e.clientX - lastLook.x) * 2.2;
      this.lookDelta.y += (e.clientY - lastLook.y) * 2.2;
      lastLook = { x: e.clientX, y: e.clientY };
    });
    const lookEnd = (e) => {
      if (e.pointerId === lookId) lookId = null;
    };
    window.addEventListener('pointerup', lookEnd);
    window.addEventListener('pointercancel', lookEnd);

    // 按钮：按下触发（射击持续到松开）
    const bindHold = (id, on, off) => {
      const el = document.getElementById(id);
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation(); on();
      });
      el.addEventListener('pointerup', (e) => {
        e.preventDefault(); e.stopPropagation(); off && off();
      });
      el.addEventListener('pointercancel', () => off && off());
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    bindHold('t-fire', () => { this.fireHeld = true; }, () => { this.fireHeld = false; });
    bindHold('t-jump', () => { this.jumpQueued = true; });
    bindHold('t-crouch', () => { this.crouch = !this.crouch; });
    bindHold('t-reload', () => { this.reloadQueued = true; });
    bindHold('t-use', () => { this.useQueued = true; });
  }

  enableTouch(on) {
    this.touchMode = on;
    this.touchUI.style.display = on ? 'block' : 'none';
  }

  // 每帧调用：汇总键盘移动，消化视角增量
  sample(dt) {
    let mx = this.move.x, mz = this.move.z;
    if (!this.touchMode) {
      if (this.keys['KeyW'] || this.keys['ArrowUp']) mz -= 1;
      if (this.keys['KeyS'] || this.keys['ArrowDown']) mz += 1;
      if (this.keys['KeyA'] || this.keys['ArrowLeft']) mx -= 1;
      if (this.keys['KeyD'] || this.keys['ArrowRight']) mx += 1;
      this.sprint = !!(this.keys['ShiftLeft'] || this.keys['ShiftRight']);
    }
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    const out = { mx, mz, sprint: this.sprint };

    this.yaw -= this.lookDelta.x * this.sensitivity;
    this.pitch -= this.lookDelta.y * this.sensitivity;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    this.lookDelta.x = 0; this.lookDelta.y = 0;

    const j = this.jumpQueued; this.jumpQueued = false;
    const r = this.reloadQueued; this.reloadQueued = false;
    const u = this.useQueued; this.useQueued = false;
    return { ...out, jump: j, reload: r, use: u, fire: this.fireHeld, crouch: this.crouch };
  }
}
