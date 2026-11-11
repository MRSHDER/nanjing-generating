// 144 BPM 方向草稿（约 21 秒）：只做“蓄力 → 爆发 → 变奏 → 再爆发”，用来让用户判断速度和力度。
// 不是整首；v2（128 BPM）保持不变。用法：node music/drafts/draft144.mjs
// 输出：out/music/drafts/draft144.wav、music/drafts/draft144.events.json
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSynth } from '../synth.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const S = createSynth({ bpm: 144, bars: 12, tail: 1.2, seed: 144 });
const { tb, BEAT } = S;

const CH = {
  D: { pad: [50, 57, 62, 66], hi: [62, 66, 69, 74], bass: 38 },
  Bm: { pad: [47, 54, 59, 62], hi: [59, 62, 66, 71], bass: 35 },
  G: { pad: [43, 50, 55, 59], hi: [62, 67, 71, 74], bass: 31 },
  A: { pad: [45, 52, 57, 61], hi: [61, 64, 69, 73], bass: 33 },
};
const chordOf = (bar) => (bar >= 12 ? 'D' : ['D', 'Bm', 'G', 'A'][bar % 4]);
for (let b = 0; b <= 12; b++) S.chord(tb(b), chordOf(b));

// 快速五声旋律（十六分音符为主）
const FAST_A = [[0, 74, .5], [.5, 78, .25], [.75, 81, .25], [1, 83, .5], [1.5, 81, .25], [1.75, 78, .25], [2, 76, .5], [2.5, 74, .25], [2.75, 71, .25], [3, 74, .75], [3.75, 76, .25]];
const FAST_B = [[0, 78, .5], [.5, 81, .25], [.75, 83, .25], [1, 86, .5], [1.5, 83, .5], [2, 81, .25], [2.25, 78, .25], [2.5, 76, .5], [3, 74, .5], [3.5, 71, .5]];
const phrase = (bar, motif, shift, amp, harm = 0) => {
  for (const [b, m, len] of motif) {
    S.lead(tb(bar, b), len * BEAT, m + shift, amp, -0.05);
    S.pluck(tb(bar, b), m + shift, amp * 0.7, 0.2, { dur: 0.8, bright: 0.75, dly: 0.18 });
    if (harm) S.lead(tb(bar, b), len * BEAT, m + shift + harm, amp * 0.45, 0.35);
  }
};
const STAB = [[0.5, 0.25], [1.25, 0.25], [2, 0.25], [2.75, 0.25], [3.5, 0.4]];
const hats16 = (bar, amp, drop = 0) => {
  for (let q = 0; q < 16; q++) { if (drop && S.rand() < drop) continue; S.hat(tb(bar, q / 4), q % 2 ? amp * 0.6 : amp, false, q % 4 === 2 ? -0.25 : 0.25); }
};
// 切分低音：根音与高八度交替，最后一个音滑向下一个和弦
const sync = [0, 0.5, 0.75, 1.5, 2, 2.5, 2.75, 3.5];
const syncBass = (bar, amp) => {
  const m = CH[chordOf(bar)].bass, next = CH[chordOf(bar + 1)].bass;
  sync.forEach((b, i) => {
    const last = i === sync.length - 1;
    const note = m + (i % 2 ? 12 : 0);
    S.bass(tb(bar, b), BEAT * (last ? 0.48 : 0.22), note, amp * (b % 1 === 0 ? 1 : 0.85), last ? next + 12 : note, { drive: 2.4, glide: BEAT * 0.4 });
  });
};

// ── 蓄力（0–3）──
S.supersaw(tb(0), tb(3, 3.5), CH.D.pad, 0.06, (t) => 500 + 6500 * Math.pow(Math.min(1, t / tb(3, 3.5)), 2), { att: 0.2, dec: 9, sus: 1, rel: 0.02 });
S.riser(tb(0), tb(3, 3.5), 0.075);
S.sweep(tb(0), tb(3, 3.5), 110, 1760, 0.03, 0.02);
[1, 0.5, 0.5, 0.25].forEach((step, bar) => {
  for (let b = 0; b < (bar === 3 ? 3.5 : 4); b += step) S.kick(tb(bar, b), [0.4, 0.3, 0.25, 0.22][bar], { punch: 0.7 }); // 加速但不抢 Drop 的响度
  if (bar === 2) for (let e = 0; e < 8; e++) S.snare(tb(2, e / 2), 0.05 + 0.05 * (e / 7));
  if (bar === 3) for (let q = 0; q < 14; q++) S.snare(tb(3, q / 4), 0.05 + 0.06 * (q / 13), q % 2 ? 0.2 : -0.2);
  if (bar < 2) { S.clap(tb(bar, 1), 0.18); S.clap(tb(bar, 3), 0.18); }
  for (let e = 0; e < (bar === 3 ? 7 : 8); e++) S.bass(tb(bar, e / 2), BEAT * 0.4, CH[chordOf(bar)].bass + 12, 0.15);
  hats16(bar, 0.025 + 0.008 * bar);
});
S.gap(tb(3, 3.5), tb(4));

// ── 第一次爆发（4–7）──
S.impact(tb(4), 0.55);
S.crash(tb(4), 0.07);
for (let bar = 4; bar < 8; bar++) {
  for (let b = 0; b < 4; b++) S.kick(tb(bar, b), 0.64, { punch: 1 });
  S.clap(tb(bar, 1), 0.32); S.clap(tb(bar, 3), 0.32);
  S.snare(tb(bar, 3.75), 0.09, 0.3);
  hats16(bar, 0.045);
  for (const b of [0.5, 1.5, 2.5, 3.5]) S.hat(tb(bar, b), 0.04, true, 0);
  syncBass(bar, 0.33);
  for (const [b, len] of STAB) S.stab(tb(bar, b), len * BEAT, CH[chordOf(bar)].hi, 0.13);
}
phrase(4, FAST_A, 0, 0.1);
phrase(5, FAST_B, 0, 0.1);
phrase(6, FAST_A, 0, 0.1);
phrase(7, FAST_B, -5, 0.1);

// ── 变奏（8–9）：碎拍、滑音、故障音色、切片、半拍静音 ──
for (let bar = 8; bar < 10; bar++) {
  for (const b of [0, 0.75, 2.5]) S.kick(tb(bar, b), 0.62, { punch: 1 });
  S.snare(tb(bar, 1), 0.3); S.snare(tb(bar, 3), 0.3);
  for (const b of [1.75, 3.25]) S.snare(tb(bar, b), 0.1, -0.3);
  hats16(bar, 0.045, 0.35);
  const m = CH[chordOf(bar)].bass;
  S.bass(tb(bar), BEAT * 1.9, m, 0.3, m - 12, { drive: 2.6 });
  S.bass(tb(bar, 2), BEAT * 1.9, m + 12, 0.27, m, { drive: 2.6 });
  for (const b of [0, 0.75, 1.5]) S.stab(tb(bar, b), 0.2 * BEAT, CH[chordOf(bar)].hi, 0.1, 3200);
  for (let q = 0; q < 16; q++) if (S.rand() < 0.45) S.tick(tb(bar, q / 4), [2637, 3520, 4186][(S.rand() * 3) | 0], 0.03, S.rand() * 1.4 - 0.7);
}
S.crush('keys', tb(8), tb(10));
S.riser(tb(9), tb(9, 3.5), 0.08);
S.stutter(tb(9, 2), tb(9, 3.5));
S.gap(tb(9, 3.5), tb(10));

// ── 再次爆发（10–11）＋ 结尾重击 ──
S.impact(tb(10), 0.62);
S.crash(tb(10), 0.08);
for (let bar = 10; bar < 12; bar++) {
  for (let b = 0; b < 4; b++) S.kick(tb(bar, b), 0.66, { punch: 1 });
  S.clap(tb(bar, 1), 0.34); S.clap(tb(bar, 3), 0.34);
  S.snare(tb(bar, 1), 0.12); S.snare(tb(bar, 3), 0.12);
  hats16(bar, 0.05);
  for (const b of [0.5, 1.5, 2.5, 3.5]) S.hat(tb(bar, b), 0.045, true, 0);
  syncBass(bar, 0.31);
  for (const [b, len] of STAB) S.stab(tb(bar, b), len * BEAT, CH[chordOf(bar)].hi, 0.12, 5600);
}
phrase(10, FAST_A, 12, 0.09, -5);
phrase(11, FAST_B, 12, 0.09, -5);
for (let q = 0; q < 4; q++) S.snare(tb(11, 3 + q / 4), 0.12 + 0.04 * q);
S.impact(tb(12), 0.5);
S.kick(tb(12), 0.66, { punch: 1 });
S.stab(tb(12), 0.9, CH.D.hi, 0.14, 5000);
S.bass(tb(12), 0.9, CH.D.bass, 0.3);

const r = S.render({
  wav: resolve(here, '../../out/music/drafts/draft144.wav'),
  events: resolve(here, 'draft144.events.json'),
  sections: [{ id: 'build', start: tb(0), end: tb(4) }, { id: 'drop', start: tb(4), end: tb(12) }],
  duckDepth: 0.7,
  duckRelease: 0.08,
  fadeOut: 0.9,
  meta: { version: 'draft144', note: '144 BPM 方向草稿，不是整首' },
});
console.log(`草稿已生成：${r.duration.toFixed(2)} 秒（144 BPM，12 小节 + 尾音）；底鼓 ${r.kicks}、军鼓/拍手 ${r.snares}、撞击 ${r.impacts}`);
