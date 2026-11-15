// 効果音とBGM。音源ファイルを使わず、ブラウザの中で音を作る。
// assets/bgm.mp3 を置いた場合は、そちらをBGMとして流す。

let ctx = null;
let master = null;
let seGain = null;
let bgmGain = null;
let bgmTimer = null;
let bgmAudio = null;
let settings = { se: true, seVol: 0.7, bgm: false, bgmVol: 0.4 };

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.connect(ctx.destination);
  seGain = ctx.createGain();
  seGain.connect(master);
  bgmGain = ctx.createGain();
  bgmGain.connect(master);
  apply();
  return ctx;
}

function apply() {
  if (!ctx) return;
  seGain.gain.value = settings.se ? settings.seVol : 0;
  bgmGain.gain.value = settings.bgmVol * 0.5;
  if (bgmAudio) bgmAudio.volume = settings.bgmVol;
}

export function setSoundSettings(s) {
  settings = { ...settings, ...s };
  apply();
  if (settings.bgm) startBgm();
  else stopBgm();
}

// スマホは最初のタップまで音を出せないので、タップのたびに起こす
export function unlock() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume();
  if (settings.bgm) startBgm();
}

// 札を置く「パチッ」
export function pachi(strength = 1) {
  const c = ensure();
  if (!c || !settings.se) return;
  const t = c.currentTime;
  const len = 0.06;
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * len), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i += 1) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 6);
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2400 + Math.random() * 600;
  bp.Q.value = 1.2;
  const g = c.createGain();
  g.gain.setValueAtTime(0.9 * strength, t);
  src.connect(bp);
  bp.connect(g);
  g.connect(seGain);
  src.start(t);
  // 低い「トン」を少し混ぜる
  const o = c.createOscillator();
  const og = c.createGain();
  o.frequency.setValueAtTime(180, t);
  o.frequency.exponentialRampToValueAtTime(70, t + 0.08);
  og.gain.setValueAtTime(0.35 * strength, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  o.connect(og);
  og.connect(seGain);
  o.start(t);
  o.stop(t + 0.12);
}

function pluck(freq, when, vol = 0.25, dest = seGain) {
  const c = ctx;
  const o = c.createOscillator();
  const g = c.createGain();
  const f = c.createBiquadFilter();
  o.type = 'triangle';
  o.frequency.value = freq;
  f.type = 'lowpass';
  f.frequency.setValueAtTime(freq * 6, when);
  f.frequency.exponentialRampToValueAtTime(freq * 1.5, when + 0.6);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(vol, when + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 1.6);
  o.connect(f);
  f.connect(g);
  g.connect(dest);
  o.start(when);
  o.stop(when + 1.7);
}

// 役ができたときの短いフレーズ(都節音階)
export function fanfare() {
  const c = ensure();
  if (!c || !settings.se) return;
  const t = c.currentTime;
  [440, 466.16, 587.33, 659.25, 880].forEach((f, i) => pluck(f, t + i * 0.09, 0.3));
}

export function koikoiSound() {
  const c = ensure();
  if (!c || !settings.se) return;
  const t = c.currentTime;
  [659.25, 587.33, 659.25, 880].forEach((f, i) => pluck(f, t + i * 0.12, 0.3));
}

// BGM: 都節音階の箏っぽい音をゆっくり流す
const SCALE = [146.83, 155.56, 196.0, 220.0, 233.08, 293.66, 311.13, 392.0, 440.0, 466.16];
function scheduleBgm() {
  if (!ctx || !settings.bgm) return;
  const t = ctx.currentTime + 0.05;
  const step = 0.55;
  let idx = 4 + Math.floor(Math.random() * 3);
  for (let i = 0; i < 16; i += 1) {
    if (Math.random() < 0.72) {
      idx = Math.max(0, Math.min(SCALE.length - 1, idx + [-2, -1, -1, 1, 1, 2, 0][Math.floor(Math.random() * 7)]));
      pluck(SCALE[idx] * 2, t + i * step, 0.18, bgmGain);
      if (i % 8 === 0) pluck(SCALE[0], t + i * step, 0.16, bgmGain);
    }
  }
  bgmTimer = setTimeout(scheduleBgm, 16 * step * 1000);
}

function startBgm() {
  if (bgmTimer || (bgmAudio && !bgmAudio.paused)) return;
  if (!ensure() || ctx.state === 'suspended') return;
  // 自分で用意したBGMファイルがあれば優先
  if (bgmAudio === null) {
    bgmAudio = new Audio('assets/bgm.mp3');
    bgmAudio.loop = true;
    bgmAudio.volume = settings.bgmVol;
    bgmAudio.addEventListener('error', () => {
      bgmAudio = false;
      if (settings.bgm) scheduleBgm();
    });
    bgmAudio.play().catch(() => {});
    return;
  }
  if (bgmAudio) {
    bgmAudio.play().catch(() => {});
    return;
  }
  scheduleBgm();
}

function stopBgm() {
  if (bgmTimer) clearTimeout(bgmTimer);
  bgmTimer = null;
  if (bgmAudio) bgmAudio.pause();
}
