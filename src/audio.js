// 轻量 WebAudio 合成音效，无需外部素材
let ctx = null;
let master = null;

export function initAudio() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  startAmbient();
}

function noiseBuffer(dur) {
  const n = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export function shotSound(vol = 1) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(0.14);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.setValueAtTime(3200, t); f.frequency.exponentialRampToValueAtTime(300, t + 0.12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.9 * vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
  const o = ctx.createOscillator(); o.type = 'triangle';
  o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.1);
  const og = ctx.createGain(); og.gain.setValueAtTime(0.5 * vol, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  src.connect(f).connect(g).connect(master);
  o.connect(og).connect(master);
  src.start(t); o.start(t); o.stop(t + 0.12);
}

export function sniperShotSound() {
  if (!ctx) return;
  const t = ctx.currentTime;
  // 低沉长尾的狙击枪声
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(0.32);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(1500, t);
  f.frequency.exponentialRampToValueAtTime(110, t + 0.3);
  const g = ctx.createGain();
  g.gain.setValueAtTime(1.0, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(90, t);
  o.frequency.exponentialRampToValueAtTime(34, t + 0.26);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.7, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
  src.connect(f).connect(g).connect(master);
  o.connect(og).connect(master);
  src.start(t); o.start(t); o.stop(t + 0.3);
}

export function enemyShotSound(dist) {
  if (!ctx) return;
  const vol = Math.max(0.05, 0.7 - dist / 60) * 0.8;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(0.12);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 900;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

// 分层命中反馈：躯干闷响 / 爆头金属叮声 / 击杀附加低沉确认音
export function hitSound(kind = 'body', kill = false) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  if (kind === 'head') {
    o.type = 'square';
    o.frequency.setValueAtTime(1500, t);
    o.frequency.exponentialRampToValueAtTime(700, t + 0.07);
    g.gain.setValueAtTime(0.17, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  } else {
    o.type = 'triangle';
    o.frequency.setValueAtTime(340, t);
    o.frequency.exponentialRampToValueAtTime(180, t + 0.06);
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  }
  o.connect(g).connect(master);
  o.start(t); o.stop(t + 0.12);
  if (kill) {
    const k = ctx.createOscillator();
    k.type = 'sine';
    k.frequency.setValueAtTime(kind === 'head' ? 500 : 420, t + 0.05);
    k.frequency.exponentialRampToValueAtTime(160, t + 0.2);
    const kg = ctx.createGain();
    kg.gain.setValueAtTime(0.2, t + 0.05);
    kg.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    k.connect(kg).connect(master);
    k.start(t + 0.05); k.stop(t + 0.26);
  }
}

// ============ 丛林/索降音频 ============

let rotorNodes = null;
export function startRotor() {
  if (!ctx || rotorNodes) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(1.2);
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 380;
  // 桨叶 chopping 调制（约 13Hz）
  const lfo = ctx.createOscillator(); lfo.frequency.value = 13;
  const lg = ctx.createGain(); lg.gain.value = 0.24;
  const g = ctx.createGain(); g.gain.value = 0.001;
  g.gain.linearRampToValueAtTime(0.4, ctx.currentTime + 0.5);
  lfo.connect(lg).connect(g.gain);
  src.connect(f).connect(g).connect(master);
  src.start(); lfo.start();
  rotorNodes = { src, lfo, g };
}

export function setRotorVolume(v) {
  if (!rotorNodes) return;
  rotorNodes.g.gain.linearRampToValueAtTime(Math.max(0.0001, v), ctx.currentTime + 0.4);
}

export function stopRotor() {
  if (!rotorNodes) return;
  const { src, lfo, g } = rotorNodes;
  g.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 1.2);
  setTimeout(() => { try { src.stop(); lfo.stop(); } catch (_) {} }, 1400);
  rotorNodes = null;
}

// 索降风噪（强度随下滑速度）
export function windRush(vol = 0.3) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(2.4);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.setValueAtTime(500, t);
  f.frequency.linearRampToValueAtTime(1400, t + 1.6);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.001, t);
  g.gain.linearRampToValueAtTime(vol, t + 1.4);
  g.gain.linearRampToValueAtTime(0.001, t + 2.3);
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

export function landThud() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(120, t);
  o.frequency.exponentialRampToValueAtTime(40, t + 0.18);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.5, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + 0.24);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(0.25);
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 800;
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.3, t);
  g2.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
  src.connect(f).connect(g2).connect(master);
  src.start(t);
}

export function thunderSound() {
  if (!ctx) return;
  const t = ctx.currentTime + 0.3 + Math.random() * 0.8;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(2.6);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(400, t);
  f.frequency.exponentialRampToValueAtTime(60, t + 2.2);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.001, t);
  g.gain.linearRampToValueAtTime(0.35, t + 0.25);
  g.gain.exponentialRampToValueAtTime(0.001, t + 2.4);
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

// 丛林鸟鸣（随机双音短哨）
export function birdChirp() {
  if (!ctx) return;
  const base = 1800 + Math.random() * 1800;
  [0, 0.14].forEach((d, i) => {
    const t = ctx.currentTime + d;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(base + i * 250, t);
    o.frequency.exponentialRampToValueAtTime(base * 0.8, t + 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.03, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + 0.14);
  });
}
export function planeFlyby() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(2.2);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(220, t);
  f.frequency.linearRampToValueAtTime(900, t + 1.0);
  f.frequency.linearRampToValueAtTime(180, t + 2.1);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.001, t);
  g.gain.linearRampToValueAtTime(0.32, t + 0.9);
  g.gain.linearRampToValueAtTime(0.001, t + 2.1);
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

// 增援警报：双音警笛
export function alarmSound() {
  if (!ctx) return;
  for (let i = 0; i < 3; i++) {
    const t = ctx.currentTime + i * 0.28;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(620, t);
    o.frequency.setValueAtTime(430, t + 0.13);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + 0.26);
  }
}

export function reloadSound() {
  if (!ctx) return;
  [0, 0.5, 1.4].forEach((d, i) => {
    const t = ctx.currentTime + d;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(0.05);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800 + i * 600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    src.connect(f).connect(g).connect(master);
    src.start(t);
  });
}

export function lootSound() {
  if (!ctx) return;
  const t = ctx.currentTime;
  [660, 990].forEach((fr, i) => {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = fr;
    const g = ctx.createGain();
    const s = t + i * 0.09;
    g.gain.setValueAtTime(0.001, s);
    g.gain.linearRampToValueAtTime(0.2, s + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, s + 0.2);
    o.connect(g).connect(master);
    o.start(s); o.stop(s + 0.25);
  });
}

export function beep(freq = 880, dur = 0.1) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.18, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

export function footstep() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(0.06);
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.12, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

export function hurtSound() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(220, t);
  o.frequency.exponentialRampToValueAtTime(80, t + 0.15);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.25, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + 0.2);
}

function startAmbient() {
  // 海风环境声
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(3);
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 320;
  const g = ctx.createGain(); g.gain.value = 0.05;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13;
  const lg = ctx.createGain(); lg.gain.value = 0.025;
  lfo.connect(lg).connect(g.gain);
  src.connect(f).connect(g).connect(master);
  src.start(); lfo.start();
}
