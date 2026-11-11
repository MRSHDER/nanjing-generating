// 代码合成器模块（负责人：Claude）。所有乐器、混音和导出都在这里，乐曲脚本只负责“编曲”。
// 用法：
//   import { createSynth } from './synth.mjs';
//   const S = createSynth({ bpm: 144, bars: 12, seed: 1 });
//   S.kick(S.tb(0), 0.6); ... ; S.render({ wav: 'out.wav', events: 'events.json', sections: [...] });
// 只用 Node 自带模块；固定随机种子，同样的编曲每次生成完全相同的音频。

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function createSynth({ bpm, bars, beatsPerBar = 4, seed = 20261012, sr = 48000, tail = 0 }) {
  const SR = sr;
  const BEAT = 60 / bpm;
  const BAR = BEAT * beatsPerBar;
  const DUR = bars * BAR + tail;
  const N = Math.ceil(DUR * SR);

  // ───────── 工具 ─────────
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const noise = () => rand() * 2 - 1;
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const tb = (bar, beat = 0) => bar * BAR + beat * BEAT;
  const idx = (t) => Math.round(t * SR);
  const panG = (p) => [Math.cos(((p + 1) * Math.PI) / 4), Math.sin(((p + 1) * Math.PI) / 4)];
  const lerp = (x, y, k) => x + (y - x) * k;
  const r4 = (x) => Math.round(x * 1e4) / 1e4;

  const stereo = () => [new Float32Array(N), new Float32Array(N)];
  const BUS = { pad: stereo(), bass: stereo(), drums: stereo(), keys: stereo(), rev: stereo(), dly: new Float32Array(N) };
  const EV = { tick: [], kick: [], snare: [], hat: [], openhat: [], impact: [], stab: [], riser: [], stutter: [], gap: [], lead: [], chord: [] };

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

  // ───────── 音色 ─────────
  function pluck(t, m, amp, pan = 0, o = {}) {
    const P = SR / mtof(m);
    const L = Math.max(2, Math.floor(P - 0.6));
    const d = P - 0.5 - L;
    const C = (1 - d) / (1 + d);
    const buf = new Float32Array(L);
    const bright = o.bright ?? 0.6;
    let lp = 0;
    for (let k = 0; k < L; k++) { lp += bright * (noise() - lp); buf[k] = lp; }
    const loss = o.loss ?? 0.996;
    const n = Math.floor((o.dur ?? 1.4) * SR);
    const i0 = idx(t);
    let p = 0, apx = 0, apy = 0;
    for (let k = 0; k < n; k++) {
      const x = buf[p];
      const avg = 0.5 * (x + buf[(p + 1) % L]) * loss;
      const y = C * avg + apx - C * apy;
      apx = avg; apy = y; buf[p] = y; p = (p + 1) % L;
      const env = (k < 48 ? k / 48 : 1) * (k > n - 2400 ? (n - k) / 2400 : 1);
      put(BUS.keys, i0 + k, x * amp * env, pan, o.rev ?? 0.22, o.dly ?? 0);
    }
  }

  function supersaw(t0, t1, notes, amp, cutoff, o = {}) {
    const att = o.att ?? 0.01, dec = o.dec ?? 0.25, sus = o.sus ?? 0.7, rel = o.rel ?? 0.12;
    const i0 = idx(t0), iEnd = idx(t1), i1 = Math.min(N, idx(t1 + rel));
    const cut = typeof cutoff === 'function' ? cutoff : () => cutoff;
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
          ph += inc; if (ph >= TAB) ph -= TAB;
          y += g * (SAW[ph | 0] - y);
          y2 += g * (y - y2);
          put(BUS.pad, i, y2 * amp * env * 0.22, pan, o.rev ?? 0.3);
        }
      });
    }
  }

  function lead(t, dur, m, amp, pan = 0) {
    EV.lead.push([r4(t), m, r4(dur)]);
    const i0 = idx(t), n = Math.floor((dur + 0.12) * SR);
    const f = mtof(m);
    let p1 = 0, p2 = rand() * TAB, y = 0, y2 = 0;
    const g = 1 - Math.exp((-2 * Math.PI * 2400) / SR); // 2026-10-18 Claude：主旋律滤波 4500 → 2400 Hz，去掉唢呐似的亮，变成柔和的合成器
    for (let k = 0; k < n; k++) {
      const tt = k / SR;
      const vib = 1 + (tt > 0.15 ? 0.004 * Math.sin(2 * Math.PI * 6 * tt) : 0);
      p1 += (f * vib * TAB) / SR; p2 += (f * 1.004 * vib * TAB) / SR;
      if (p1 >= TAB) p1 -= TAB; if (p2 >= TAB) p2 -= TAB;
      y += g * (SAW[p1 | 0] * 0.6 + SQR[p2 | 0] * 0.4 - y);
      y2 += g * (y - y2);
      let env = Math.min(1, tt / 0.003) * (0.6 + 0.4 * Math.exp(-tt / 0.12));
      if (tt > dur) env *= Math.max(0, 1 - (tt - dur) / 0.12);
      put(BUS.keys, i0 + k, y2 * amp * env, pan, 0.22, 0.22);
    }
  }

  /** 低音；m1 ≠ m0 时在最后一拍滑音。o.drive 越大越“脏”。 */
  function bass(t, dur, m0, amp, m1 = m0, o = {}) {
    const i0 = idx(t), n = Math.floor((dur + 0.02) * SR);
    const drive = o.drive ?? 1.8;
    const glideLen = o.glide ?? BEAT;
    let ph = 0;
    for (let k = 0; k < n; k++) {
      const tt = k / SR;
      const u = Math.max(0, (tt - (dur - glideLen)) / glideLen);
      ph += (2 * Math.PI * mtof(lerp(m0, m1, Math.min(1, u * u)))) / SR;
      const env = Math.min(1, tt / 0.003) * (tt > dur ? Math.max(0, 1 - (tt - dur) / 0.02) : 1);
      const s = Math.tanh(drive * (Math.sin(ph) + 0.35 * Math.sin(2 * ph) + 0.12 * Math.sin(3 * ph))) * 0.65;
      put(BUS.bass, i0 + k, s * amp * env, 0);
    }
  }

  /** 底鼓；o.punch 越大越短促（更快的音高下滑、更短的尾巴、更多“咔”）。 */
  function kick(t, amp, o = {}) {
    EV.kick.push(r4(t));
    const punch = o.punch ?? 0;
    const i0 = idx(t), n = Math.floor((0.45 - 0.2 * punch) * SR);
    const pd = 0.028 - 0.01 * punch, ad = 0.2 - 0.08 * punch;
    let ph = 0;
    for (let k = 0; k < n; k++) {
      const tt = k / SR;
      ph += (2 * Math.PI * (48 + (110 + 60 * punch) * Math.exp(-tt / pd))) / SR;
      const clickN = 72 + 60 * punch;
      const click = k < clickN ? noise() * (1 - k / clickN) * (0.4 + 0.3 * punch) : 0;
      const s = Math.tanh((1.4 + punch) * Math.sin(ph)) * Math.exp(-tt / ad) + click;
      put(BUS.drums, i0 + k, s * amp, 0);
    }
  }

  function clap(t, amp, pan = 0) {
    EV.snare.push(r4(t));
    const i0 = idx(t), n = Math.floor(0.3 * SR);
    const bp = bandpass(1400, 0.9);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let k = 0; k < n; k++) {
      const tt = k / SR;
      const x = noise();
      const y = bp.b0 * x + bp.b2 * x2 - bp.a1 * y1 - bp.a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      const burst = [0, 0.01, 0.02].reduce((acc, off) => acc + (tt >= off ? Math.exp(-(tt - off) / 0.006) : 0), 0);
      const env = Math.max(burst * 0.7, Math.exp(-tt / 0.1) * (tt > 0.02 ? 1 : 0));
      put(BUS.drums, i0 + k, y * 2.2 * env * amp, pan, 0.22);
    }
  }

  function snare(t, amp, pan = 0) {
    EV.snare.push(r4(t));
    const i0 = idx(t), n = Math.floor(0.22 * SR);
    const bp = bandpass(2000, 0.7);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let k = 0; k < n; k++) {
      const tt = k / SR;
      const x = noise();
      const y = bp.b0 * x + bp.b2 * x2 - bp.a1 * y1 - bp.a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      const body = Math.sin(2 * Math.PI * 200 * tt) * Math.exp(-tt / 0.035) * 0.5;
      put(BUS.drums, i0 + k, (y * 1.6 * Math.exp(-tt / 0.07) + body) * amp, pan, 0.15);
    }
  }

  function hat(t, amp, open = false, pan = 0.2) {
    (open ? EV.openhat : EV.hat).push(r4(t));
    const i0 = idx(t), dec = open ? 0.14 : 0.025;
    const n = Math.floor(dec * 6 * SR);
    let xp = 0, y = 0;
    for (let k = 0; k < n; k++) {
      const x = noise();
      y = 0.88 * (y + x - xp);
      xp = x;
      put(BUS.drums, i0 + k, y * amp * Math.exp(-k / SR / dec), pan, open ? 0.12 : 0.03);
    }
  }

  function crash(t, amp) {
    const i0 = idx(t), n = Math.floor(2 * SR);
    let xp = 0, y = 0;
    for (let k = 0; k < n; k++) {
      const x = noise();
      y = 0.93 * (y + x - xp);
      xp = x;
      const tt = k / SR;
      put(BUS.drums, i0 + k, y * amp * Math.exp(-tt / 0.6), Math.sin(tt * 3) * 0.3, 0.3);
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

  function sweep(t0, t1, f0, f1, amp, tailSec = 0.4) {
    const i0 = idx(t0), n = idx(t1) - i0;
    let ph = 0;
    for (let k = 0; k < n + SR * tailSec; k++) {
      const u = Math.min(1, k / n);
      ph += (2 * Math.PI * f0 * Math.pow(f1 / f0, 1 - Math.pow(1 - u, 2))) / SR;
      const env = Math.sin(Math.PI * 0.5 * Math.min(1, u * 1.2)) * (k > n ? Math.max(0, 1 - (k - n) / (SR * tailSec)) : 1);
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
    const i0 = idx(t), n = Math.floor(2 * SR);
    let ph = 0, lp = 0;
    for (let k = 0; k < n; k++) {
      const tt = k / SR;
      ph += (2 * Math.PI * (34 + 40 * Math.exp(-tt / 0.12))) / SR;
      lp += 0.1 * (noise() - lp);
      const s = Math.sin(ph) * Math.exp(-tt / 0.6) + lp * 2.4 * Math.exp(-tt / 0.28);
      put(BUS.drums, i0 + k, s * amp, 0, 0.45);
    }
  }

  const stab = (t, len, notes, amp, cutoff = 4500) => {
    EV.stab.push(r4(t));
    supersaw(t, t + len, notes, amp, cutoff, { att: 0.003, dec: 0.09, sus: 0.5, rel: 0.06, rev: 0.25 });
  };
  const gap = (t0, t1) => EV.gap.push([r4(t0), r4(t1)]);
  const stutter = (t0, t1) => EV.stutter.push([r4(t0), r4(t1)]);
  const chord = (t, name) => EV.chord.push([r4(t), name]);

  /** 对某个总线的一段做降采样（故障音色）。 */
  function crush(busName, t0, t1, hold = 6, levels = 24) {
    const x0 = idx(t0), x1 = Math.min(N, idx(t1));
    for (const ch of BUS[busName]) {
      let h = 0;
      for (let i = x0; i < x1; i++) {
        if ((i - x0) % hold === 0) h = Math.round(ch[i] * levels) / levels;
        ch[i] = h;
      }
    }
  }

  // ───────── 混音与导出 ─────────
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
        for (const ap of ab) {
          const o = ap.b[ap.p];
          ap.b[ap.p] = y + o * 0.5;
          ap.p = (ap.p + 1) % ap.b.length;
          y = o - y;
        }
        out[i] = y;
      }
      return out;
    };
    return [run(0), run(23)];
  }

  function pingpong(input) {
    const D = Math.round(BEAT * 0.75 * SR), fb = 0.33;
    const L = new Float32Array(N), R = new Float32Array(N);
    let lp = 0;
    for (let i = 0; i < N; i++) {
      lp += 0.35 * ((i >= D ? input[i - D] + fb * R[i - D] : 0) - lp);
      L[i] = lp;
      R[i] = i >= D ? fb * L[i - D] : 0;
    }
    return [L, R];
  }

  /**
   * 混音并写出 WAV 与事件表。
   * duckDepth：侧链深度（底鼓响时铺底/低音让开的程度）；fadeOut：结尾淡出秒数。
   */
  function render({ wav, events, sections = [], duckDepth = 0.62, duckRelease = 0.09, fadeOut = 0.4, meta = {} }) {
    const duck = new Float32Array(N).fill(1);
    for (const t of EV.kick) {
      const i0 = idx(t), n = Math.floor(0.3 * SR);
      for (let k = 0; k < n && i0 + k < N; k++) {
        const g = 1 - duckDepth * Math.exp(-k / SR / duckRelease);
        if (g < duck[i0 + k]) duck[i0 + k] = g;
      }
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
    for (const [t0, t1] of EV.stutter) {
      const s0 = idx(t0), s1 = idx(t1), seg = s1 - s0;
      for (let c = 0; c < 2; c++) {
        const src = mix[c].slice(s0, s0 + idx(BEAT * 0.5));
        for (let i = s0; i < s1; i++) {
          const u = (i - s0) / seg;
          const len = idx(BEAT * (u < 0.5 ? 0.25 : u < 0.75 ? 0.125 : 0.0625));
          const k = (i - s0) % len;
          mix[c][i] = src[k] * Math.min(1, k / 48, (len - k) / 48);
        }
      }
    }
    for (const [t0, t1] of EV.gap) {
      const g0 = idx(t0), g1 = idx(t1), f = 96;
      for (let c = 0; c < 2; c++) for (let i = g0; i < g1 && i < N; i++) {
        mix[c][i] *= Math.min(1, Math.max(0, (g0 + f - i) / f) + Math.max(0, (i - (g1 - f)) / f));
      }
    }
    if (fadeOut > 0) {
      const fs = idx(DUR - fadeOut);
      for (let i = fs; i < N; i++) {
        const g = 0.5 * (1 + Math.cos((Math.PI * (i - fs)) / (N - fs)));
        mix[0][i] *= g; mix[1][i] *= g;
      }
    }
    let peak = 0;
    for (let c = 0; c < 2; c++) for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(mix[c][i]));
    const drive = 1.6, norm = drive / peak, ceil = 0.891 / Math.tanh(drive);
    const data = Buffer.alloc(N * 4);
    for (let i = 0; i < N; i++) for (let c = 0; c < 2; c++) {
      const v = Math.tanh(mix[c][i] * norm) * ceil;
      data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 4 + c * 2);
    }
    const head = Buffer.alloc(44);
    head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8); head.write('fmt ', 12);
    head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(2, 22); head.writeUInt32LE(SR, 24);
    head.writeUInt32LE(SR * 4, 28); head.writeUInt16LE(4, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(data.length, 40);
    mkdirSync(dirname(wav), { recursive: true });
    writeFileSync(wav, Buffer.concat([head, data]));
    if (events) {
      for (const k of Object.keys(EV)) if (typeof EV[k][0] === 'number') EV[k].sort((x, y) => x - y);
      mkdirSync(dirname(events), { recursive: true });
      writeFileSync(events, JSON.stringify({ ...meta, bpm, beat: BEAT, bar: BAR, duration: DUR, sections, ...EV }));
    }
    return { duration: DUR, kicks: EV.kick.length, snares: EV.snare.length, impacts: EV.impact.length };
  }

  return {
    SR, BEAT, BAR, DUR, N, rand, noise, mtof, tb, idx,
    pluck, supersaw, lead, bass, kick, clap, snare, hat, crash, bell, tick, sweep, riser, downlifter, impact,
    stab, gap, stutter, chord, crush, render, EV,
  };
}
