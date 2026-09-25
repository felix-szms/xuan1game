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

export function hitSound(kill = false) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'square';
  o.frequency.value = kill ? 880 : 1400;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.15, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  if (kill) o.frequency.setValueAtTime(440, t + 0.05);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + 0.1);
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
