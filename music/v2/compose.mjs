// 【已归档】《南京，正在生成》配乐 v2：128 BPM 电子乐（v3 起改为 144 BPM，见 music/compose.mjs），全部由代码合成，不使用外部采样或音乐素材。
// 用法：node music/compose.mjs            → out/music/score.wav + music/events.json
//       node music/compose.mjs <wav路径>  → 指定音频输出位置
// 只用 Node 自带模块；固定随机种子，每次生成的音频完全相同。
//
// 结构见 music/structure.json：128 BPM，4/4，48 小节 = 90 秒，9 个段落。
// 调式：D 宫调五声（D E F# A B）；和声每小节一个：D – Bm – G – A 循环（片尾 G – A – D）。
// events.json：所有鼓点、撞击、上升音、切片重复、静音停顿和旋律音符的精确时间，供画面做节拍驱动。

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const S = JSON.parse(readFileSync(resolve(here, 'structure.json'), 'utf8'));
const OUT = resolve(process.argv[2] ?? resolve(here, '../../out/music/v2/score.wav'));
const EVENTS_OUT = resolve(here, 'events.json');

const SR = 48000;
const BEAT = 60 / S.bpm;
const BAR = BEAT * S.beatsPerBar;
const DUR = S.bars * BAR;
const N = Math.ceil(DUR * SR);

// ───────────────────────── 工具 ─────────────────────────

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261012);
const noise = () => rand() * 2 - 1;

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const tb = (bar, beat = 0) => bar * BAR + beat * BEAT;
const idx = (t) => Math.round(t * SR);
const panG = (p) => [Math.cos(((p + 1) * Math.PI) / 4), Math.sin(((p + 1) * Math.PI) / 4)];
const lerp = (a, b, k) => a + (b - a) * k;

const SEC = Object.fromEntries(S.sections.map((s) => [s.id, s]));
const secOf = (bar) => S.sections.find((s) => bar >= s.startBar && bar < s.startBar + s.bars);
const barsOf = (id) => {
  const s = SEC[id];
  return Array.from({ length: s.bars }, (_, k) => s.startBar + k);
};

const stereo = () => [new Float32Array(N), new Float32Array(N)];
const BUS = {
  pad: stereo(), // 铺底与超锯齿和弦（受侧链）
  bass: stereo(), // 低音（受侧链）
  drums: stereo(),
  keys: stereo(), // 拨弦、主音、钟声、音效
  rev: stereo(),
  dly: new Float32Array(N),
};

// 画面用的事件表
const EV = { tick: [], kick: [], snare: [], hat: [], openhat: [], impact: [], stab: [], riser: [], stutter: [], gap: [], lead: [], chord: [] };
const r4 = (x) => Math.round(x * 1e4) / 1e4;

function put(bus, i, s, pan, rev = 0, dly = 0) {
  if (i < 0 || i >= N) return;
  const [gl, gr] = panG(pan);
  bus[0][i] += s * gl;
  bus[1][i] += s * gr;
  if (rev) {
    BUS.rev[0][i] += s * rev * gl;
    BUS.rev[1][i] += s * rev * gr;
  }
  if (dly) BUS.dly[i] += s * dly;
}

function bandpass(fc, q) {
  const w = (2 * Math.PI * Math.min(fc, SR * 0.45)) / SR;
  const al = Math.sin(w) / (2 * q);
  const a0 = 1 + al;
  return { b0: al / a0, b2: -al / a0, a1: (-2 * Math.cos(w)) / a0, a2: (1 - al) / a0 };
}

// 带限波表
const TAB = 4096;
const SAW = new Float32Array(TAB);
const SQR = new Float32Array(TAB);
for (let k = 0; k < TAB; k++) {
  let s = 0, q = 0;
  for (let h = 1; h <= 24; h++) {
    const v = Math.sin((2 * Math.PI * h * k) / TAB) / h;
    s += v;
    if (h % 2) q += v;
  }
  SAW[k] = s * 0.55;
  SQR[k] = q * 0.8;
}

// ───────────────────────── 音色 ─────────────────────────

/** 拨弦（Karplus–Strong + 分数延迟全通，音准准确）。 */
function pluck(t, m, amp, pan = 0, o = {}) {
  const P = SR / mtof(m);
  const L = Math.max(2, Math.floor(P - 0.6));
  const d = P - 0.5 - L;
  const C = (1 - d) / (1 + d);
  const buf = new Float32Array(L);
  const bright = o.bright ?? 0.6;
  let lp = 0;
  for (let k = 0; k < L; k++) {
    lp += bright * (noise() - lp);
    buf[k] = lp;
  }
  const loss = o.loss ?? 0.996;
  const n = Math.floor((o.dur ?? 1.6) * SR);
  const i0 = idx(t);
  let p = 0, apx = 0, apy = 0;
  for (let k = 0; k < n; k++) {
    const a = buf[p];
    const avg = 0.5 * (a + buf[(p + 1) % L]) * loss;
    const y = C * avg + apx - C * apy;
    apx = avg;
    apy = y;
    buf[p] = y;
    p = (p + 1) % L;
    const env = (k < 48 ? k / 48 : 1) * (k > n - 2400 ? (n - k) / 2400 : 1);
    put(BUS.keys, i0 + k, a * amp * env, pan, o.rev ?? 0.22, o.dly ?? 0);
  }
}

/** 超锯齿：每个音 5 个微失谐锯齿波 + 两级低通（截止频率可随时间变化）+ ADSR。 */
function supersaw(t0, t1, notes, amp, cutoff, o = {}) {
  const att = o.att ?? 0.01, dec = o.dec ?? 0.25, sus = o.sus ?? 0.7, rel = o.rel ?? 0.12;
  const i0 = idx(t0), iEnd = idx(t1), i1 = Math.min(N, idx(t1 + rel));
  const cut = typeof cutoff === 'function' ? cutoff : () => cutoff;
  const bus = o.bus ?? BUS.pad;
  for (const m of notes) {
    [-22, -10, 0, 10, 22].forEach((cents, v) => {
      const inc = (mtof(m) * Math.pow(2, cents / 1200) * TAB) / SR;
      let ph = rand() * TAB, y = 0, y2 = 0, g = 0;
      const pan = (v - 2) * 0.32;
      for (let i = i0; i < i1; i++) {
        if ((i - i0) % 64 === 0) g = 1 - Math.exp((-2 * Math.PI * cut(i / SR)) / SR);
        const tt = (i - i0) / SR;
        let env = tt < att ? tt / att : sus + (1 - sus) * Math.exp(-(tt - att) / dec);
        if (i > iEnd) env *= Math.max(0, 1 - (i - iEnd) / (rel * SR));
        ph += inc;
        if (ph >= TAB) ph -= TAB;
        y += g * (SAW[ph | 0] - y);
        y2 += g * (y - y2);
        put(bus, i, y2 * amp * env * 0.22, pan, o.rev ?? 0.3);
      }
    });
  }
}

/** 主音合成器：锯齿 + 方波，带颤音，给 Drop 段落用。 */
function lead(t, dur, m, amp, pan = 0) {
  EV.lead.push([r4(t), m, r4(dur)]);
  const i0 = idx(t), n = Math.floor((dur + 0.15) * SR);
  const f = mtof(m);
  let p1 = 0, p2 = rand() * TAB, y = 0, y2 = 0;
  const g = 1 - Math.exp((-2 * Math.PI * 4200) / SR);
  for (let k = 0; k < n; k++) {
    const tt = k / SR;
    const vib = 1 + (tt > 0.18 ? 0.004 * Math.sin(2 * Math.PI * 5.5 * tt) : 0);
    p1 += (f * vib * TAB) / SR;
    p2 += (f * 1.004 * vib * TAB) / SR;
    if (p1 >= TAB) p1 -= TAB;
    if (p2 >= TAB) p2 -= TAB;
    y += g * (SAW[p1 | 0] * 0.6 + SQR[p2 | 0] * 0.4 - y);
    y2 += g * (y - y2);
    let env = Math.min(1, tt / 0.004) * (0.6 + 0.4 * Math.exp(-tt / 0.15));
    if (tt > dur) env *= Math.max(0, 1 - (tt - dur) / 0.15);
    put(BUS.keys, i0 + k, y2 * amp * env, pan, 0.25, 0.25);
  }
}

/** 低音：正弦 + 谐波，可滑音（m1 不同于 m0 时在最后一拍滑过去）。 */
function bass(t, dur, m0, amp, m1 = m0) {
  const i0 = idx(t), n = Math.floor((dur + 0.03) * SR);
  let ph = 0;
  for (let k = 0; k < n; k++) {
    const tt = k / SR;
    const u = Math.max(0, (tt - (dur - BEAT)) / BEAT);
    const f = mtof(lerp(m0, m1, Math.min(1, u * u)));
    ph += (2 * Math.PI * f) / SR;
    const env = Math.min(1, tt / 0.004) * (tt > dur ? Math.max(0, 1 - (tt - dur) / 0.03) : 1);
    const s = Math.tanh(1.8 * (Math.sin(ph) + 0.35 * Math.sin(2 * ph) + 0.1 * Math.sin(3 * ph))) * 0.65;
    put(BUS.bass, i0 + k, s * amp * env, 0);
  }
}

function kick(t, amp) {
  EV.kick.push(r4(t));
  const i0 = idx(t), n = Math.floor(0.45 * SR);
  let ph = 0;
  for (let k = 0; k < n; k++) {
    const tt = k / SR;
    ph += (2 * Math.PI * (48 + 110 * Math.exp(-tt / 0.028))) / SR;
    const click = k < 72 ? noise() * (1 - k / 72) * 0.4 : 0;
    const s = Math.tanh(1.4 * Math.sin(ph)) * Math.exp(-tt / 0.2) + click;
    put(BUS.drums, i0 + k, s * amp, 0);
  }
}

/** 拍手：三次快速噪声 + 尾巴。 */
function clap(t, amp, pan = 0) {
  EV.snare.push(r4(t));
  const i0 = idx(t), n = Math.floor(0.35 * SR);
  const bp = bandpass(1400, 0.9);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let k = 0; k < n; k++) {
    const tt = k / SR;
    const x = noise();
    const y = bp.b0 * x + bp.b2 * x2 - bp.a1 * y1 - bp.a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    const burst = [0, 0.011, 0.022].reduce((a, o) => a + (tt >= o ? Math.exp(-(tt - o) / 0.006) : 0), 0);
    const env = Math.max(burst * 0.7, Math.exp(-tt / 0.11) * (tt > 0.022 ? 1 : 0));
    put(BUS.drums, i0 + k, y * 2.2 * env * amp, pan, 0.25);
  }
}

function snare(t, amp, pan = 0) {
  EV.snare.push(r4(t));
  const i0 = idx(t), n = Math.floor(0.25 * SR);
  const bp = bandpass(2000, 0.7);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let k = 0; k < n; k++) {
    const tt = k / SR;
    const x = noise();
    const y = bp.b0 * x + bp.b2 * x2 - bp.a1 * y1 - bp.a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    const body = Math.sin(2 * Math.PI * 200 * tt) * Math.exp(-tt / 0.04) * 0.5;
    put(BUS.drums, i0 + k, (y * 1.6 * Math.exp(-tt / 0.08) + body) * amp, pan, 0.15);
  }
}

function hat(t, amp, open = false, pan = 0.2) {
  (open ? EV.openhat : EV.hat).push(r4(t));
  const i0 = idx(t), dec = open ? 0.16 : 0.028;
  const n = Math.floor(dec * 6 * SR);
  let xp = 0, y = 0;
  for (let k = 0; k < n; k++) {
    const x = noise();
    y = 0.88 * (y + x - xp);
    xp = x;
    put(BUS.drums, i0 + k, y * amp * Math.exp(-k / SR / dec), pan, open ? 0.12 : 0.03);
  }
}

/** 镲：长的开镲 + 高频噪声。 */
function crash(t, amp) {
  const i0 = idx(t), n = Math.floor(2.2 * SR);
  let xp = 0, y = 0;
  for (let k = 0; k < n; k++) {
    const x = noise();
    y = 0.93 * (y + x - xp);
    xp = x;
    const tt = k / SR;
    put(BUS.drums, i0 + k, y * amp * Math.exp(-tt / 0.7), Math.sin(tt * 3) * 0.3, 0.3);
  }
}

function bell(t, m, amp, pan = 0, o = {}) {
  const f = mtof(m), i0 = idx(t), n = Math.floor((o.dur ?? 3) * SR);
  for (let k = 0; k < n; k++) {
    const tt = k / SR;
    const I = 2.2 * Math.exp(-tt / 0.4);
    const s = Math.sin(2 * Math.PI * f * tt + I * Math.sin(2 * Math.PI * f * 3.5 * tt));
    put(BUS.keys, i0 + k, s * amp * Math.min(1, tt / 0.002) * Math.exp(-tt / (o.decay ?? 1.2)), pan, o.rev ?? 0.45, o.dly ?? 0.2);
  }
}

function tick(t, freq, amp, pan) {
  EV.tick.push(r4(t));
  const i0 = idx(t), n = Math.floor(0.01 * SR);
  for (let k = 0; k < n; k++) {
    const w = Math.sin((Math.PI * k) / n);
    put(BUS.keys, i0 + k, Math.sin((2 * Math.PI * freq * k) / SR) * w * w * amp, pan, 0.15, 0.25);
  }
}

function sweep(t0, t1, f0, f1, amp, tail = 0.4) {
  const i0 = idx(t0), n = idx(t1) - i0;
  let ph = 0;
  for (let k = 0; k < n + SR * tail; k++) {
    const u = Math.min(1, k / n);
    ph += (2 * Math.PI * f0 * Math.pow(f1 / f0, 1 - Math.pow(1 - u, 2))) / SR;
    const env = Math.sin(Math.PI * 0.5 * Math.min(1, u * 1.2)) * (k > n ? Math.max(0, 1 - (k - n) / (SR * tail)) : 1);
    put(BUS.keys, i0 + k, Math.sin(ph) * amp * env, 0, 0.5, 0.3);
  }
}

function riser(t0, t1, amp) {
  EV.riser.push([r4(t0), r4(t1)]);
  const i0 = idx(t0), n = idx(t1) - i0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, c = bandpass(300, 2);
  for (let k = 0; k < n; k++) {
    const u = k / n;
    if (k % 32 === 0) c = bandpass(250 * Math.pow(32, u), 2.5);
    const x = noise();
    const y = c.b0 * x + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    put(BUS.keys, i0 + k, y * amp * u * u * 2.4 * (k > n - 240 ? (n - k) / 240 : 1), Math.sin(u * 11) * 0.45, 0.3);
  }
}

/** 下降音效：段落从高能量回落时用。 */
function downlifter(t0, t1, amp) {
  const i0 = idx(t0), n = idx(t1) - i0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, c = bandpass(6000, 2);
  for (let k = 0; k < n; k++) {
    const u = k / n;
    if (k % 32 === 0) c = bandpass(6000 * Math.pow(1 / 30, u), 2.2);
    const x = noise();
    const y = c.b0 * x + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    put(BUS.keys, i0 + k, y * amp * (1 - u) * 2.2, 0, 0.4);
  }
}

function impact(t, amp) {
  EV.impact.push(r4(t));
  const i0 = idx(t), n = Math.floor(2.2 * SR);
  let ph = 0, lp = 0;
  for (let k = 0; k < n; k++) {
    const tt = k / SR;
    ph += (2 * Math.PI * (34 + 40 * Math.exp(-tt / 0.12))) / SR;
    lp += 0.1 * (noise() - lp);
    const s = Math.sin(ph) * Math.exp(-tt / 0.7) + lp * 2.4 * Math.exp(-tt / 0.3);
    put(BUS.drums, i0 + k, s * amp, 0, 0.45);
  }
}

// ───────────────────────── 和声与旋律 ─────────────────────────

const CH = {
  D:  { pad: [50, 57, 62, 66], hi: [62, 66, 69, 74], bass: 38 },
  Bm: { pad: [47, 54, 59, 62], hi: [59, 62, 66, 71], bass: 35 },
  G:  { pad: [43, 50, 55, 59], hi: [62, 67, 71, 74], bass: 31 },
  A:  { pad: [45, 52, 57, 61], hi: [61, 64, 69, 73], bass: 33 },
};
const chordOf = (bar) => {
  if (bar >= 44) return ['G', 'A', 'D', 'D'][bar - 44];
  return ['D', 'Bm', 'G', 'A'][bar % 4];
};
for (let bar = 0; bar < S.bars; bar++) EV.chord.push([r4(tb(bar)), chordOf(bar)]);

// 旋律动机（拍, MIDI, 时值拍），2 小节一句
const MOTIF_A = [[0, 66, 0.75], [0.75, 69, 0.75], [1.5, 71, 0.5], [2, 74, 1], [3, 71, 0.5], [3.5, 69, 0.5], [4, 66, 0.75], [4.75, 64, 0.75], [5.5, 62, 0.5], [6, 64, 1], [7, 66, 1]];
const MOTIF_B = [[0, 71, 0.75], [0.75, 74, 0.75], [1.5, 76, 0.5], [2, 78, 1], [3, 76, 0.5], [3.5, 74, 0.5], [4, 71, 0.75], [4.75, 69, 0.75], [5.5, 66, 0.5], [6, 69, 1.5], [7.5, 71, 0.5]];
const MOTIF_END = [[0, 74, 0.75], [0.75, 71, 0.75], [1.5, 69, 0.5], [2, 66, 1], [3, 64, 1], [4, 66, 0.75], [4.75, 69, 0.75], [5.5, 71, 0.5], [6, 74, 2]];
const OUTRO = [[0, 71, 1], [1, 69, 1], [2, 66, 2], [4, 64, 1], [5, 66, 1], [6, 64, 2], [8, 62, 6]];

function phraseLead(bar, motif, shift, amp, harmony = 0) {
  for (const [b, m, len] of motif) {
    lead(tb(bar, b), len * BEAT, m + shift, amp, -0.05);
    pluck(tb(bar, b), m + shift, amp * 0.8, 0.15, { dur: 1.2, bright: 0.7, dly: 0.2 });
    if (harmony) lead(tb(bar, b), len * BEAT, m + shift + harmony, amp * 0.45, 0.35);
  }
}
function phrasePluck(bar, motif, shift, amp) {
  for (const [b, m, len] of motif) pluck(tb(bar, b), m + shift, amp, -0.1, { dur: Math.max(1.2, len * BEAT + 1), bright: 0.6, rev: 0.3, dly: 0.25 });
}

const STAB = [[0, 0.5], [0.75, 0.5], [1.5, 0.5], [2.5, 0.5], [3, 0.25], [3.5, 0.4]];
function stabs(bar, amp, cutoff) {
  for (const [b, len] of STAB) {
    EV.stab.push(r4(tb(bar, b)));
    supersaw(tb(bar, b), tb(bar, b + len), CH[chordOf(bar)].hi, amp, cutoff, { att: 0.004, dec: 0.12, sus: 0.55, rel: 0.08, rev: 0.25 });
  }
}
function arp(bar, amp, every = 0.5) {
  const tones = CH[chordOf(bar)].hi.map((m) => m + 12);
  const order = [0, 2, 1, 3, 2, 1, 3, 2];
  for (let k = 0; k < 4 / every; k++) {
    pluck(tb(bar, k * every), tones[order[k % 8]], amp * (k % 2 ? 0.8 : 1), k % 2 ? 0.4 : -0.4, { dur: 0.9, bright: 0.5, loss: 0.994, dly: 0.12 });
  }
}
function fourFloor(bar, amp, uptoBeat = 4) {
  for (let b = 0; b < uptoBeat; b++) kick(tb(bar, b), amp);
}
function hats16(bar, amp, pDrop = 0) {
  for (let q = 0; q < 16; q++) {
    if (pDrop && rand() < pDrop) continue;
    hat(tb(bar, q / 4), q % 2 ? amp * 0.6 : amp, false, q % 4 === 2 ? -0.25 : 0.25);
  }
}
function offbeatBass(bar, amp, root = true) {
  const m = CH[chordOf(bar)].bass;
  if (root) bass(tb(bar), BEAT * 0.4, m, amp);
  for (const b of [0.5, 1.5, 2.5, 3.5]) bass(tb(bar, b), BEAT * 0.42, m + 12, amp * 0.85);
}
function gap(bar, b0, b1) {
  EV.gap.push([r4(tb(bar, b0)), r4(tb(bar, b1))]);
}
function stutter(bar, b0, b1) {
  EV.stutter.push([r4(tb(bar, b0)), r4(tb(bar, b1))]);
}

// ───────────────────────── 编曲 ─────────────────────────

// 1) 启动（0–3）：滤波铺底、光点、扫描线、数据滴答、上升音
supersaw(tb(0), tb(4), CH.D.pad, 0.07, (t) => 250 + 1300 * Math.min(1, t / tb(4)), { att: 1.6, dec: 9, sus: 1, rel: 0.05 });
bell(tb(0), 81, 0.06, 0, { decay: 2.5, dur: 4 }); // 光点
sweep(tb(0, 2), tb(0, 4), 220, 1760, 0.05); // 扫描线展开
for (let q = 16; q < 62; q++) {
  const p = 0.15 + 0.6 * ((q - 16) / 46);
  if (rand() < p) tick(tb(0, q / 4), [2349, 2637, 2960, 3520, 3951][(rand() * 5) | 0], 0.028, rand() * 1.2 - 0.6);
}
impact(tb(2), 0.18); // 金色光柱升起
riser(tb(2), tb(3, 3.5), 0.08);
gap(3, 3.5, 4);

// 2) 锁定（4–7）：四拍底鼓、拍手、反拍低音，滤波逐渐打开；第 7 小节“南”“京”两拍重击
supersaw(tb(4), tb(8), CH.D.pad, 0.06, (t) => 700 + 2600 * Math.min(1, (t - tb(4)) / (4 * BAR)), { att: 0.3, dec: 9, sus: 1, rel: 0.05 });
for (const bar of barsOf('lock')) {
  const last = bar === 7;
  fourFloor(bar, 0.55, last ? 2 : 4);
  clap(tb(bar, 1), 0.3);
  if (!last) clap(tb(bar, 3), 0.3);
  hats16(bar, 0.04);
  offbeatBass(bar, 0.22);
  arp(bar, 0.06);
}
for (const b of [2, 3]) {
  EV.stab.push(r4(tb(7, b)));
  supersaw(tb(7, b), tb(7, b + 0.4), CH.A.hi, 0.16, 5000, { att: 0.003, dec: 0.1, sus: 0.5, rel: 0.1 });
  kick(tb(7, b), 0.6);
  impact(tb(7, b), 0.15);
}
for (let q = 0; q < 8; q++) snare(tb(7, 2 + q / 4), 0.05 + 0.2 * (q / 7), q % 2 ? 0.2 : -0.2);
riser(tb(6), tb(7, 3.5), 0.1);
gap(7, 3.5, 4);

// 3) 第一次爆发（8–15）
impact(tb(8), 0.5);
crash(tb(8), 0.07);
crash(tb(12), 0.06);
impact(tb(12), 0.25); // “正在生成”
for (const bar of barsOf('drop1')) {
  fourFloor(bar, 0.62);
  clap(tb(bar, 1), 0.32);
  clap(tb(bar, 3), 0.32);
  hats16(bar, 0.045);
  for (const b of [0.5, 1.5, 2.5, 3.5]) hat(tb(bar, b), 0.04, true, 0);
  stabs(bar, 0.11, 4200);
  bass(tb(bar), BAR * 0.97, CH[chordOf(bar)].bass, 0.3);
}
phraseLead(8, MOTIF_A, 0, 0.11);
phraseLead(10, MOTIF_B, 0, 0.11);
phraseLead(12, MOTIF_A, 0, 0.11);
phraseLead(14, MOTIF_END, 0, 0.11);
for (let q = 0; q < 4; q++) snare(tb(15, 2 + q / 2), 0.12 + 0.05 * q);
riser(tb(15, 2), tb(16), 0.05);

// 4) 故障（16–19）：碎拍、低音滑音、切片重复、降采样
for (const bar of barsOf('glitch')) {
  for (const b of [0, 0.75, 2.5]) kick(tb(bar, b), 0.6);
  clap(tb(bar, 2), 0.3);
  hats16(bar, 0.045, 0.3);
  const m = CH[chordOf(bar)].bass;
  bass(tb(bar), BAR * 0.95, m, 0.28, m - 12);
  for (const b of [0, 1.5]) {
    EV.stab.push(r4(tb(bar, b)));
    supersaw(tb(bar, b), tb(bar, b + 0.3), CH[chordOf(bar)].hi, 0.1, 3000, { att: 0.003, dec: 0.08, sus: 0.4, rel: 0.06 });
  }
  for (let q = 0; q < 16; q++) if (rand() < 0.5) tick(tb(bar, q / 4), [2637, 3520, 4186][(rand() * 3) | 0], 0.03, rand() * 1.4 - 0.7);
  arp(bar, 0.05, 0.25);
}
stutter(17, 2, 4);
stutter(19, 2, 4);

// 5) 青年（20–27）：前 4 小节半速，后 4 小节全速
impact(tb(20), 0.3); // “青年”
supersaw(tb(20), tb(28), CH.D.pad, 0.045, 1600, { att: 0.5, dec: 9, sus: 1, rel: 0.3 });
for (const bar of barsOf('youth')) {
  const half = bar < 24;
  const m = CH[chordOf(bar)].bass;
  if (half) {
    kick(tb(bar), 0.6);
    kick(tb(bar, 2.5), 0.5);
    snare(tb(bar, 2), 0.3);
    for (let e = 0; e < 8; e++) hat(tb(bar, e / 2), e % 2 ? 0.04 : 0.025);
    bass(tb(bar), BAR * 0.95, m, 0.27);
    arp(bar, 0.07);
  } else {
    fourFloor(bar, 0.6);
    clap(tb(bar, 1), 0.3);
    clap(tb(bar, 3), 0.3);
    hats16(bar, 0.042);
    offbeatBass(bar, 0.24);
    stabs(bar, 0.08, 3600);
  }
}
phrasePluck(20, MOTIF_A, 0, 0.14);
phrasePluck(22, MOTIF_B, 0, 0.14);
phraseLead(24, MOTIF_A, 0, 0.1);
phraseLead(26, MOTIF_B, 0, 0.1);
impact(tb(24), 0.32); // “来”
crash(tb(24), 0.06);
impact(tb(26), 0.22); // “南京”
riser(tb(27), tb(28), 0.06);

// 6) 正在生成（28–31）：抽掉鼓，只留铺底、钟声和低八度旋律；最后半小节静音
downlifter(tb(28), tb(29), 0.06);
supersaw(tb(28), tb(31, 2), CH.D.pad, 0.08, 1100, { att: 0.8, dec: 9, sus: 1, rel: 0.05 });
for (const bar of barsOf('gen')) {
  bass(tb(bar), bar === 31 ? BEAT * 1.9 : BAR * 0.98, CH[chordOf(bar)].bass, 0.18);
  for (let b = 0; b < 4; b++) if (rand() < 0.55 && !(bar === 31 && b >= 2)) bell(tb(bar, b + 0.5), [74, 76, 78, 81, 83, 86][(rand() * 6) | 0], 0.045, rand() * 1.4 - 0.7);
}
phrasePluck(28, MOTIF_A, -12, 0.13);
phrasePluck(30, MOTIF_END.filter(([b]) => b < 6), -12, 0.12);
gap(31, 2, 4);

// 7) 蓄力（32–35）：底鼓由四分加速到十六分，军鼓滚奏，滤波全开
supersaw(tb(32), tb(35, 3.5), CH.D.pad, 0.055, (t) => 500 + 6500 * Math.pow(Math.min(1, (t - tb(32)) / (4 * BAR)), 2), { att: 0.2, dec: 9, sus: 1, rel: 0.02 });
riser(tb(32), tb(35, 3.5), 0.1);
sweep(tb(32), tb(35, 3.5), 110, 880, 0.035, 0.02);
for (const bar of barsOf('build')) {
  const k = bar - 32;
  const step = [1, 0.5, 0.25, 0.25][k];
  for (let b = 0; b < (bar === 35 ? 3.5 : 4); b += step) kick(tb(bar, b), k < 2 ? 0.5 : 0.34 + 0.03 * (b / 4)); // 加速但不超过 Drop 的响度
  if (k >= 2) for (let q = 0; q < (bar === 35 ? 14 : 16); q++) snare(tb(bar, q / 4), 0.03 + 0.08 * ((k - 2) * 16 + q) / 32, q % 2 ? 0.2 : -0.2);
  else { clap(tb(bar, 1), 0.25); clap(tb(bar, 3), 0.25); }
  for (let e = 0; e < 8; e++) hat(tb(bar, e / 2), 0.03 + 0.01 * k);
  for (let e = 0; e < (bar === 35 ? 7 : 8); e++) bass(tb(bar, e / 2), BEAT * 0.4, CH[chordOf(bar)].bass + 12, 0.16);
}
gap(35, 3.5, 4);

// 8) 双向奔赴（36–43）：最高潮
for (const bar of [36, 38, 40, 42]) crash(tb(bar), 0.07);
impact(tb(36), 0.6); // “双向奔赴”
impact(tb(40), 0.4); // “你选择南京”
impact(tb(42), 0.3); // “南京也选择你”
supersaw(tb(36), tb(44), CH.D.hi.map((m) => m + 12), 0.035, 3000, { att: 0.05, dec: 9, sus: 1, rel: 0.4 });
for (const bar of barsOf('drop2')) {
  fourFloor(bar, 0.66);
  clap(tb(bar, 1), 0.34);
  clap(tb(bar, 3), 0.34);
  hats16(bar, 0.05);
  for (const b of [0.5, 1.5, 2.5, 3.5]) hat(tb(bar, b), 0.045, true, 0);
  stabs(bar, 0.12, 5200);
  bass(tb(bar), BAR * 0.97, CH[chordOf(bar)].bass, 0.31);
  bell(tb(bar), [86, 81, 83, 78][bar % 4], 0.04, 0.3);
}
phraseLead(36, MOTIF_A, 12, 0.1, -5);
phraseLead(38, MOTIF_B, 12, 0.1, -5);
phraseLead(40, MOTIF_A, 12, 0.1, -5);
phraseLead(42, MOTIF_END, 12, 0.1, -5);
for (let q = 0; q < 4; q++) snare(tb(43, 2 + q / 2), 0.12 + 0.05 * q);
downlifter(tb(43, 2), tb(44, 2), 0.05);

// 9) 收尾（44–47）：鼓逐步撤掉，回到主和弦
impact(tb(44), 0.28);
supersaw(tb(44), tb(48) - 0.6, [43, 50, 55, 59], 0.07, (t) => 3000 - 2400 * Math.min(1, (t - tb(44)) / (4 * BAR)), { att: 0.05, dec: 9, sus: 1, rel: 0.6 });
kick(tb(44), 0.5); kick(tb(44, 2), 0.42); clap(tb(44, 1), 0.2); clap(tb(44, 3), 0.18);
kick(tb(45), 0.38);
for (let e = 0; e < 8; e++) hat(tb(44, e / 2), 0.03);
for (const bar of barsOf('outro')) bass(tb(bar), bar >= 46 ? BAR * 1.6 : BAR * 0.97, CH[chordOf(bar)].bass, bar >= 46 ? 0.2 : 0.25);
phrasePluck(44, OUTRO, 0, 0.15);
bell(tb(46), 74, 0.08, -0.2, { decay: 2.2, dur: 4 });
bell(tb(46, 0.02), 81, 0.05, 0.3, { decay: 2.2, dur: 4 });

// ───────────────────────── 混音 ─────────────────────────

// 降采样故障：故障段落的拨弦与音效
{
  const s = SEC.glitch;
  const a = idx(tb(s.startBar)), b = idx(tb(s.startBar + s.bars));
  for (const ch of BUS.keys) {
    let hold = 0;
    for (let i = a; i < b; i++) {
      if ((i - a) % 6 === 0) hold = Math.round(ch[i] * 24) / 24;
      ch[i] = hold;
    }
  }
}

// 侧链：底鼓响时铺底和低音让开，产生“呼吸”感
const duck = new Float32Array(N).fill(1);
for (const t of EV.kick) {
  const i0 = idx(t), n = Math.floor(0.3 * SR);
  for (let k = 0; k < n && i0 + k < N; k++) {
    const g = 1 - 0.62 * Math.exp(-k / SR / 0.09);
    if (g < duck[i0 + k]) duck[i0 + k] = g;
  }
}

function reverb(inL, inR, room = 0.82, damp = 0.3) {
  const sc = SR / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const aps = [556, 441, 341, 225];
  const run = (spread) => {
    const out = new Float32Array(N);
    const cb = combs.map((c) => ({ b: new Float32Array(Math.round((c + spread) * sc)), p: 0, f: 0 }));
    const ab = aps.map((c) => ({ b: new Float32Array(Math.round((c + spread) * sc)), p: 0 }));
    for (let i = 0; i < N; i++) {
      const x = (inL[i] + inR[i]) * 0.015;
      let y = 0;
      for (const c of cb) {
        const o = c.b[c.p];
        c.f = o * (1 - damp) + c.f * damp;
        c.b[c.p] = x + c.f * room;
        c.p = (c.p + 1) % c.b.length;
        y += o;
      }
      for (const a of ab) {
        const o = a.b[a.p];
        a.b[a.p] = y + o * 0.5;
        a.p = (a.p + 1) % a.b.length;
        y = o - y;
      }
      out[i] = y;
    }
    return out;
  };
  return [run(0), run(23)];
}

function pingpong(input) {
  const D = Math.round(BEAT * 0.75 * SR), fb = 0.35;
  const L = new Float32Array(N), R = new Float32Array(N);
  let lp = 0;
  for (let i = 0; i < N; i++) {
    lp += 0.35 * ((i >= D ? input[i - D] + fb * R[i - D] : 0) - lp);
    L[i] = lp;
    R[i] = i >= D ? fb * L[i - D] : 0;
  }
  return [L, R];
}

const [rvL, rvR] = reverb(BUS.rev[0], BUS.rev[1]);
const [dlL, dlR] = pingpong(BUS.dly);

const mix = [new Float32Array(N), new Float32Array(N)];
for (let c = 0; c < 2; c++) {
  const rv = c ? rvR : rvL, dl = c ? dlR : dlL;
  let hp = 0, xp = 0;
  for (let i = 0; i < N; i++) {
    const d = duck[i];
    const x = BUS.pad[c][i] * d + BUS.bass[c][i] * Math.sqrt(d) + BUS.drums[c][i] + BUS.keys[c][i] + (rv[i] * 0.8 + dl[i] * 0.3) * (0.4 + 0.6 * d);
    hp = 0.9967 * (hp + x - xp);
    xp = x;
    mix[c][i] = hp;
  }
}

// 切片重复（stutter）：在窗口内重复一小段，越来越短（1/4 → 1/8 → 1/16 拍）
for (const [t0, t1] of EV.stutter) {
  const a = idx(t0), b = idx(t1);
  const seg = b - a;
  for (let c = 0; c < 2; c++) {
    const src = mix[c].slice(a, a + idx(BEAT * 0.5));
    for (let i = a; i < b; i++) {
      const u = (i - a) / seg;
      const len = idx(BEAT * (u < 0.5 ? 0.25 : u < 0.75 ? 0.125 : 0.0625));
      const k = (i - a) % len;
      const edge = Math.min(1, k / 48, (len - k) / 48);
      mix[c][i] = src[k] * edge;
    }
  }
}

// 静音停顿（Drop 前的“吸气”）
for (const [t0, t1] of EV.gap) {
  const a = idx(t0), b = idx(t1), f = 96;
  for (let c = 0; c < 2; c++) for (let i = a; i < b && i < N; i++) {
    const g = Math.min(1, Math.max(0, (a + f - i) / f)) + Math.min(1, Math.max(0, (i - (b - f)) / f));
    mix[c][i] *= Math.min(1, g);
  }
}

// 结尾淡出
const fadeStart = idx(DUR - 1.6);
for (let i = fadeStart; i < N; i++) {
  const g = 0.5 * (1 + Math.cos((Math.PI * (i - fadeStart)) / (N - fadeStart)));
  mix[0][i] *= g;
  mix[1][i] *= g;
}

// 归一化 + 柔和限幅（峰值约 −1 dBFS）
let peak = 0;
for (let c = 0; c < 2; c++) for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(mix[c][i]));
const drive = 1.6;
const norm = drive / peak;
const ceil = 0.891 / Math.tanh(drive);
for (let c = 0; c < 2; c++) for (let i = 0; i < N; i++) mix[c][i] = Math.tanh(mix[c][i] * norm) * ceil;

// ───────────────────────── 输出 ─────────────────────────

const data = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  for (let c = 0; c < 2; c++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mix[c][i])) * 32767), i * 4 + c * 2);
}
const head = Buffer.alloc(44);
head.write('RIFF', 0);
head.writeUInt32LE(36 + data.length, 4);
head.write('WAVE', 8);
head.write('fmt ', 12);
head.writeUInt32LE(16, 16);
head.writeUInt16LE(1, 20);
head.writeUInt16LE(2, 22);
head.writeUInt32LE(SR, 24);
head.writeUInt32LE(SR * 4, 28);
head.writeUInt16LE(4, 32);
head.writeUInt16LE(16, 34);
head.write('data', 36);
head.writeUInt32LE(data.length, 40);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, Buffer.concat([head, data]));

for (const k of Object.keys(EV)) if (typeof EV[k][0] === 'number') EV[k].sort((a, b) => a - b);
const events = {
  version: 2,
  bpm: S.bpm,
  beat: BEAT,
  bar: BAR,
  duration: DUR,
  sections: S.sections.map((s) => ({ ...s, start: r4(tb(s.startBar)), end: r4(tb(s.startBar + s.bars)) })),
  ...EV,
};
writeFileSync(EVENTS_OUT, JSON.stringify(events));
console.log(`配乐已生成：${OUT}（${DUR.toFixed(1)} 秒，${S.bpm} BPM，${S.bars} 小节）`);
console.log(`事件表：${EVENTS_OUT}（底鼓 ${EV.kick.length}、军鼓/拍手 ${EV.snare.length}、撞击 ${EV.impact.length}、切片 ${EV.stutter.length}、停顿 ${EV.gap.length}）`);
