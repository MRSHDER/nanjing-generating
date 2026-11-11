// 《南京，正在生成》配乐 v3：144 BPM、54 小节、90 秒。全部由代码合成，不使用外部采样或音乐素材。
// 用法：node music/compose.mjs → out/music/score.wav + music/events.json（画面的节拍与鼓点来源）
// 乐器与混音在 music/synth.mjs；本文件只负责编曲。v2（128 BPM）存档在 music/v2/。
//
// 与 Codex 已编排画面对齐的重音（段内拍）：
//   锁定  第 12 拍“南”、第 14 拍“京”         城墙  第 0 拍“南京”、第 16 拍“正在生成”
//   青年  第 0 拍“青年”、第 16 拍“来”、第 32 拍“南京”
//   双向奔赴 第 0 拍“双向奔赴”、第 24 拍“你选择南京”、第 32 拍“南京也选择你”
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSynth } from './synth.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ST = JSON.parse(readFileSync(resolve(here, 'structure.json'), 'utf8'));
const S = createSynth({ bpm: ST.bpm, bars: ST.bars, beatsPerBar: ST.beatsPerBar, seed: 20261012 });
const { tb, BEAT } = S;
const SEC = Object.fromEntries(ST.sections.map((s) => [s.id, s]));
const bars = (id) => Array.from({ length: SEC[id].bars }, (_, k) => SEC[id].startBar + k);
const sb = (id, beat) => tb(SEC[id].startBar, beat); // 段内拍 → 秒

// ───────── 和声 ─────────
const CH = {
  D: { pad: [50, 57, 62, 66], hi: [62, 66, 69, 74], bass: 38 },
  Bm: { pad: [47, 54, 59, 62], hi: [59, 62, 66, 71], bass: 35 },
  G: { pad: [43, 50, 55, 59], hi: [62, 67, 71, 74], bass: 31 },
  A: { pad: [45, 52, 57, 61], hi: [61, 64, 69, 73], bass: 33 },
};
// 2026-10-18 Claude（用户 00:59–01:00：音乐太喜庆像过年，不大改节拍、只改音色）：
// 和声从 D–Bm–G–A（大调、明亮）换成 Bm–G–D–A（从小和弦起，羽调色彩，更像城市夜景的抒情）；节奏、鼓点、事件时间全部不变。
const CYCLE = ['Bm', 'G', 'D', 'A'];
function chordOf(bar) {
  const s = ST.sections.find((x) => bar >= x.startBar && bar < x.startBar + x.bars) ?? ST.sections[ST.sections.length - 1];
  const k = bar - s.startBar;
  if (s.id === 'boot') return 'D';
  if (s.id === 'outro') return ['G', 'A', 'D', 'D'][k];
  if (s.id === 'drop2') return k < 4 ? CYCLE[k] : k < 6 ? ['G', 'A'][k - 4] : CYCLE[k - 6];
  return CYCLE[k % 4];
}
for (let b = 0; b < ST.bars; b++) S.chord(tb(b), chordOf(b));

// ───────── 旋律 ─────────
const FAST_A = [[0, 74, .5], [.5, 78, .25], [.75, 81, .25], [1, 83, .5], [1.5, 81, .25], [1.75, 78, .25], [2, 76, .5], [2.5, 74, .25], [2.75, 71, .25], [3, 74, .75], [3.75, 76, .25]];
const FAST_B = [[0, 78, .5], [.5, 81, .25], [.75, 83, .25], [1, 86, .5], [1.5, 83, .5], [2, 81, .25], [2.25, 78, .25], [2.5, 76, .5], [3, 74, .5], [3.5, 71, .5]];
const SLOW_A = [[0, 66, 1], [1, 69, .5], [1.5, 71, .5], [2, 74, 1], [3, 71, .5], [3.5, 69, .5], [4, 66, 1], [5, 64, 1], [6, 62, 2]];
const SLOW_B = [[0, 71, 1], [1, 74, .5], [1.5, 76, .5], [2, 78, 1], [3, 76, .5], [3.5, 74, .5], [4, 71, 1], [5, 69, 1], [6, 69, 2]];
const OUTRO = [[0, 71, 1], [1, 69, 1], [2, 66, 2], [4, 64, 1], [5, 66, 1], [6, 64, 2], [8, 62, 6]];

const phraseLead = (bar, motif, shift, amp, harm = 0) => {
  for (const [b, m, len] of motif) {
    S.lead(tb(bar, b), len * BEAT, m + shift, amp, -0.05);
    S.pluck(tb(bar, b), m + shift, amp * 0.45, 0.2, { dur: 0.8, bright: 0.38, dly: 0.18 }); // 拨弦更暗更轻，少点古筝 / 过年味
    if (harm) S.lead(tb(bar, b), len * BEAT, m + shift + harm, amp * 0.45, 0.35);
  }
};
const phrasePluck = (bar, motif, shift, amp) => {
  for (const [b, m, len] of motif) S.pluck(tb(bar, b), m + shift, amp, -0.1, { dur: Math.max(1, len * BEAT + 0.9), bright: 0.4, rev: 0.4, dly: 0.25 });
};

// ───────── 常用节奏型 ─────────
const STAB = [[0.5, 0.25], [1.25, 0.25], [2, 0.25], [2.75, 0.25], [3.5, 0.4]];
const hats16 = (bar, amp, drop = 0) => {
  for (let q = 0; q < 16; q++) { if (drop && S.rand() < drop) continue; S.hat(tb(bar, q / 4), q % 2 ? amp * 0.6 : amp, false, q % 4 === 2 ? -0.25 : 0.25); }
};
const hats8 = (bar, amp) => { for (let e = 0; e < 8; e++) S.hat(tb(bar, e / 2), e % 2 ? amp : amp * 0.6); };
const openHats = (bar, amp) => { for (const b of [0.5, 1.5, 2.5, 3.5]) S.hat(tb(bar, b), amp, true, 0); };
const fourFloor = (bar, amp, upto = 4, punch = 1) => { for (let b = 0; b < upto; b++) S.kick(tb(bar, b), amp, { punch }); };
const SYNC = [0, 0.5, 0.75, 1.5, 2, 2.5, 2.75, 3.5];
const syncBass = (bar, amp) => {
  const m = CH[chordOf(bar)].bass, next = CH[chordOf(bar + 1)].bass;
  SYNC.forEach((b, i) => {
    const last = i === SYNC.length - 1;
    const note = m + (i % 2 ? 12 : 0);
    S.bass(tb(bar, b), BEAT * (last ? 0.48 : 0.22), note, amp * (b % 1 === 0 ? 1 : 0.85), last ? next + 12 : note, { drive: 2.4, glide: BEAT * 0.4 });
  });
};
const offbeatBass = (bar, amp) => {
  const m = CH[chordOf(bar)].bass;
  S.bass(tb(bar), BEAT * 0.4, m, amp);
  for (const b of [0.5, 1.5, 2.5, 3.5]) S.bass(tb(bar, b), BEAT * 0.42, m + 12, amp * 0.85);
};
const arp = (bar, amp, every = 0.5) => {
  const tones = CH[chordOf(bar)].hi.map((m) => m + 12);
  const order = [0, 2, 1, 3, 2, 1, 3, 2];
  for (let k = 0; k < 4 / every; k++) S.pluck(tb(bar, k * every), tones[order[k % 8]], amp * (k % 2 ? 0.8 : 1), k % 2 ? 0.4 : -0.4, { dur: 0.7, bright: 0.32, loss: 0.994, dly: 0.12 });
};
const stabs = (bar, amp, cutoff = 4500) => { for (const [b, len] of STAB) S.stab(tb(bar, b), len * BEAT, CH[chordOf(bar)].hi, amp, cutoff); };
const hit = (t, notes, amp = 0.15) => { S.stab(t, BEAT * 0.4, notes, amp, 5200); S.kick(t, 0.6, { punch: 1 }); S.impact(t, 0.18); };
/** 爆发段的一小节：四拍底鼓、拍手、十六分镲、开镲、切分低音、反拍和弦。 */
const dropBar = (bar, lvl = 1) => {
  fourFloor(bar, 0.64 * lvl);
  S.clap(tb(bar, 1), 0.32 * lvl); S.clap(tb(bar, 3), 0.32 * lvl);
  S.snare(tb(bar, 3.75), 0.08 * lvl, 0.3);
  hats16(bar, 0.045 * lvl);
  openHats(bar, 0.04 * lvl);
  syncBass(bar, 0.32 * lvl);
  stabs(bar, 0.12 * lvl, 4200 + 1200 * (lvl - 1) * 5);
};
/** 碎拍小节：用于故障段和双向奔赴的变奏。 */
const breakBar = (bar, lvl = 1) => {
  for (const b of [0, 0.75, 2.5]) S.kick(tb(bar, b), 0.62 * lvl, { punch: 1 });
  S.snare(tb(bar, 1), 0.3 * lvl); S.snare(tb(bar, 3), 0.3 * lvl);
  for (const b of [1.75, 3.25]) S.snare(tb(bar, b), 0.1 * lvl, -0.3);
  hats16(bar, 0.045 * lvl, 0.35);
  const m = CH[chordOf(bar)].bass;
  S.bass(tb(bar), BEAT * 1.9, m, 0.3 * lvl, m - 12, { drive: 2.6 });
  S.bass(tb(bar, 2), BEAT * 1.9, m + 12, 0.27 * lvl, m, { drive: 2.6 });
  for (const b of [0, 0.75, 1.5]) S.stab(tb(bar, b), 0.2 * BEAT, CH[chordOf(bar)].hi, 0.1 * lvl, 3200);
  for (let q = 0; q < 16; q++) if (S.rand() < 0.4) S.tick(tb(bar, q / 4), [2637, 3520, 4186][(S.rand() * 3) | 0], 0.028, S.rand() * 1.4 - 0.7);
};

// ════════ 1. 开场（16 拍）════════
S.supersaw(sb('boot', 0), sb('boot', 15.5), CH.D.pad, 0.08, (t) => 300 + 1600 * Math.min(1, t / sb('boot', 15.5)), { att: 1.2, dec: 9, sus: 1, rel: 0.03 });
S.bell(sb('boot', 0), 81, 0.06, 0, { decay: 2.2, dur: 3.5 });
S.sweep(sb('boot', 0.5), sb('boot', 3), 220, 1760, 0.05);
for (let q = 4; q < 62; q++) {
  if (S.rand() < 0.15 + 0.55 * ((q - 4) / 58)) S.tick(sb('boot', q / 4), [2349, 2637, 2960, 3520, 3951][(S.rand() * 5) | 0], 0.028, S.rand() * 1.2 - 0.6);
}
for (let b = 0; b < 15; b++) S.hat(sb('boot', b), 0.012 + 0.018 * (b / 15), false, 0); // 底部拍点条逐拍亮起
S.kick(sb('boot', 8), 0.35, { punch: 0.5 }); // NANJING 红条
S.impact(sb('boot', 8), 0.15);
S.kick(sb('boot', 12), 0.42, { punch: 0.6 }); // 经纬度大字
S.impact(sb('boot', 12), 0.2);
S.riser(sb('boot', 8), sb('boot', 15.5), 0.07);
S.gap(sb('boot', 15.5), sb('boot', 16));

// ════════ 2. 锁定（16 拍）════════
S.supersaw(sb('lock', 0), sb('lock', 15.5), CH.D.pad, 0.05, (t) => 700 + 3000 * Math.min(1, (t - sb('lock', 0)) / (15.5 * BEAT)), { att: 0.2, dec: 9, sus: 1, rel: 0.03 });
for (const bar of bars('lock')) {
  const k = bar - SEC.lock.startBar;
  if (k < 3) {
    fourFloor(bar, 0.5, 4, 0.8);
    S.clap(tb(bar, 1), 0.26); S.clap(tb(bar, 3), 0.26);
    hats16(bar, 0.035);
    offbeatBass(bar, 0.22);
    arp(bar, 0.055);
  }
}
hit(sb('lock', 12), CH.A.hi, 0.17); // “南”
hit(sb('lock', 14), CH.A.hi, 0.17); // “京”
S.bass(sb('lock', 12), BEAT * 1.8, CH.A.bass, 0.28);
S.bass(sb('lock', 14), BEAT * 0.45, CH.A.bass + 12, 0.24);
for (let q = 0; q < 4; q++) S.snare(sb('lock', 14.5 + q / 4), 0.07 + 0.05 * q, q % 2 ? 0.2 : -0.2);
S.riser(sb('lock', 8), sb('lock', 15.5), 0.08);
S.gap(sb('lock', 15.5), sb('lock', 16));

// ════════ 3. 城墙爆发（32 拍）════════
S.impact(sb('drop1', 0), 0.55); S.crash(sb('drop1', 0), 0.07); // “南京”
S.impact(sb('drop1', 16), 0.3); S.crash(sb('drop1', 16), 0.06); // “正在生成”
for (const bar of bars('drop1')) dropBar(bar, 0.93); // 给“双向奔赴”留出更响的余量
const d1 = SEC.drop1.startBar;
phraseLead(d1 + 0, FAST_A, 0, 0.1); phraseLead(d1 + 1, FAST_B, 0, 0.1);
phraseLead(d1 + 2, FAST_A, 0, 0.1); phraseLead(d1 + 3, FAST_B, -5, 0.1);
phraseLead(d1 + 4, FAST_A, 0, 0.1); phraseLead(d1 + 5, FAST_B, 0, 0.1);
phraseLead(d1 + 6, FAST_A, 7, 0.09); // 最后两小节砖块松动：旋律升高、加紧张
S.riser(sb('drop1', 24), sb('drop1', 32), 0.06);
for (let q = 0; q < 8; q++) S.snare(sb('drop1', 30 + q / 4), 0.06 + 0.08 * (q / 7), q % 2 ? 0.2 : -0.2);

// ════════ 4. 数据故障（24 拍，米白底）════════
for (const bar of bars('glitch')) breakBar(bar);
S.crush('keys', sb('glitch', 0), sb('glitch', 24));
S.gap(sb('glitch', 3.5), sb('glitch', 4)); // 砖阵“冻结一瞬”
S.stutter(sb('glitch', 10), sb('glitch', 11.5));
S.gap(sb('glitch', 11.5), sb('glitch', 12));
S.stutter(sb('glitch', 18), sb('glitch', 19.5));
S.gap(sb('glitch', 19.5), sb('glitch', 20));
S.riser(sb('glitch', 20), sb('glitch', 24), 0.06);

// ════════ 5. 青年（40 拍：前 16 拍半速，后 24 拍全速）════════
S.impact(sb('youth', 0), 0.32); // “青年”
S.supersaw(sb('youth', 0), sb('youth', 40), CH.D.pad, 0.04, 1600, { att: 0.5, dec: 9, sus: 1, rel: 0.3 });
for (const bar of bars('youth')) {
  const k = bar - SEC.youth.startBar;
  const m = CH[chordOf(bar)].bass;
  if (k < 4) {
    S.kick(tb(bar), 0.58, { punch: 0.8 }); S.kick(tb(bar, 2.5), 0.48, { punch: 0.8 });
    S.snare(tb(bar, 2), 0.3);
    hats8(bar, 0.04);
    S.bass(tb(bar), BAR_BEATS(1.9), m, 0.27);
    S.bass(tb(bar, 2.5), BEAT * 1.4, m + 12, 0.22);
    arp(bar, 0.065);
  } else {
    dropBar(bar, 0.88);
  }
}
function BAR_BEATS(n) { return n * BEAT; }
const y0 = SEC.youth.startBar;
phrasePluck(y0 + 0, SLOW_A, 0, 0.14);
phrasePluck(y0 + 2, SLOW_B, 0, 0.14);
S.impact(sb('youth', 16), 0.36); S.crash(sb('youth', 16), 0.06); // “来”
phraseLead(y0 + 4, FAST_A, 0, 0.09); phraseLead(y0 + 5, FAST_B, 0, 0.09);
phraseLead(y0 + 6, FAST_A, 0, 0.09); phraseLead(y0 + 7, FAST_B, -5, 0.09);
S.impact(sb('youth', 32), 0.3); // “南京”
phraseLead(y0 + 8, FAST_A, 0, 0.09); phraseLead(y0 + 9, FAST_B, 0, 0.09);
S.riser(sb('youth', 36), sb('youth', 40), 0.06);

// ════════ 6. 地形生成（16 拍）：抽掉鼓，短暂呼吸 ════════
S.downlifter(sb('gen', 0), sb('gen', 4), 0.06);
S.supersaw(sb('gen', 0), sb('gen', 14), CH.D.pad, 0.08, 1100, { att: 0.6, dec: 9, sus: 1, rel: 0.05 });
for (const bar of bars('gen')) {
  const k = bar - SEC.gen.startBar;
  S.bass(tb(bar), k === 3 ? BEAT * 1.9 : BEAT * 3.9, CH[chordOf(bar)].bass, 0.18);
  for (let b = 0; b < 4; b++) if (S.rand() < 0.55 && !(k === 3 && b >= 2)) S.bell(tb(bar, b + 0.5), [74, 76, 78, 81, 83, 86][(S.rand() * 6) | 0], 0.045, S.rand() * 1.4 - 0.7);
  for (let e = 0; e < 8; e++) if (k < 3 || e < 4) S.hat(tb(bar, e / 2), 0.012, false, e % 2 ? 0.4 : -0.4); // 轻微的时钟感，保持运动
}
phrasePluck(SEC.gen.startBar, SLOW_A, -12, 0.13);
phrasePluck(SEC.gen.startBar + 2, SLOW_B.filter(([b]) => b < 6), -12, 0.12);
S.gap(sb('gen', 14), sb('gen', 16));

// ════════ 7. 蓄力（16 拍）════════
S.supersaw(sb('build', 0), sb('build', 15.5), CH.D.pad, 0.055, (t) => 500 + 6500 * Math.pow(Math.min(1, (t - sb('build', 0)) / (15.5 * BEAT)), 2), { att: 0.2, dec: 9, sus: 1, rel: 0.02 });
S.riser(sb('build', 0), sb('build', 15.5), 0.075);
S.sweep(sb('build', 0), sb('build', 15.5), 110, 1760, 0.03, 0.02);
for (const bar of bars('build')) {
  const k = bar - SEC.build.startBar;
  const step = [1, 0.5, 0.5, 0.25][k];
  for (let b = 0; b < (k === 3 ? 3.5 : 4); b += step) S.kick(tb(bar, b), [0.4, 0.3, 0.25, 0.22][k], { punch: 0.7 });
  if (k === 2) for (let e = 0; e < 8; e++) S.snare(tb(bar, e / 2), 0.05 + 0.05 * (e / 7));
  if (k === 3) for (let q = 0; q < 14; q++) S.snare(tb(bar, q / 4), 0.05 + 0.06 * (q / 13), q % 2 ? 0.2 : -0.2);
  if (k < 2) { S.clap(tb(bar, 1), 0.18); S.clap(tb(bar, 3), 0.18); }
  for (let e = 0; e < (k === 3 ? 7 : 8); e++) S.bass(tb(bar, e / 2), BEAT * 0.4, CH[chordOf(bar)].bass + 12, 0.15);
  hats16(bar, 0.025 + 0.008 * k);
}
S.gap(sb('build', 15.5), sb('build', 16));

// ════════ 8. 双向奔赴（40 拍：爆发 16 → 变奏 8 → 再爆发 16）════════
const d2 = SEC.drop2.startBar;
S.impact(sb('drop2', 0), 0.6); S.crash(sb('drop2', 0), 0.08); // “双向奔赴”
S.supersaw(sb('drop2', 0), sb('drop2', 16), CH.D.hi.map((m) => m + 12), 0.03, 3000, { att: 0.05, dec: 9, sus: 1, rel: 0.3 });
for (let k = 0; k < 4; k++) dropBar(d2 + k, 1.04);
phraseLead(d2 + 0, FAST_A, 0, 0.1); phraseLead(d2 + 1, FAST_B, 0, 0.1);
phraseLead(d2 + 2, FAST_A, 0, 0.1); phraseLead(d2 + 3, FAST_B, -5, 0.1);
// 变奏：碎拍、切片、半拍静音
for (let k = 4; k < 6; k++) breakBar(d2 + k, 1.02);
S.crush('keys', sb('drop2', 16), sb('drop2', 24));
S.riser(sb('drop2', 20), sb('drop2', 23.5), 0.08);
S.stutter(sb('drop2', 22), sb('drop2', 23.5));
S.gap(sb('drop2', 23.5), sb('drop2', 24));
// 再爆发：“你选择南京”（24）“南京也选择你”（32）
S.impact(sb('drop2', 24), 0.65); S.crash(sb('drop2', 24), 0.09);
S.impact(sb('drop2', 32), 0.45); S.crash(sb('drop2', 32), 0.08);
S.supersaw(sb('drop2', 24), sb('drop2', 40), CH.D.hi.map((m) => m + 12), 0.035, 3400, { att: 0.05, dec: 9, sus: 1, rel: 0.4 });
for (let k = 6; k < 10; k++) {
  dropBar(d2 + k, 1.08);
  S.snare(tb(d2 + k, 1), 0.12); S.snare(tb(d2 + k, 3), 0.12);
  S.bell(tb(d2 + k), [86, 81, 83, 78][k % 4], 0.018, 0.3);
}
phraseLead(d2 + 6, FAST_A, 12, 0.09, -5); phraseLead(d2 + 7, FAST_B, 12, 0.09, -5);
phraseLead(d2 + 8, FAST_A, 12, 0.09, -5); phraseLead(d2 + 9, FAST_B, 7, 0.09, -5);
for (let q = 0; q < 4; q++) S.snare(sb('drop2', 39 + q / 4), 0.12 + 0.04 * q);
S.downlifter(sb('drop2', 38), sb('outro', 2), 0.05);

// ════════ 9. 片尾（16 拍，米白底）════════
S.impact(sb('outro', 0), 0.3);
S.supersaw(sb('outro', 0), sb('outro', 16) - 0.4, [43, 50, 55, 59], 0.07, (t) => 3000 - 2400 * Math.min(1, (t - sb('outro', 0)) / (16 * BEAT)), { att: 0.05, dec: 9, sus: 1, rel: 0.4 });
const o0 = SEC.outro.startBar;
S.kick(tb(o0), 0.5, { punch: 1 }); S.kick(tb(o0, 2), 0.42, { punch: 1 }); S.clap(tb(o0, 1), 0.2); S.clap(tb(o0, 3), 0.18);
hats8(o0, 0.03);
S.kick(tb(o0 + 1), 0.36, { punch: 1 });
for (const bar of bars('outro')) S.bass(tb(bar), bar >= o0 + 2 ? BEAT * 6 : BEAT * 3.9, CH[chordOf(bar)].bass, bar >= o0 + 2 ? 0.2 : 0.25);
phrasePluck(o0, OUTRO, 0, 0.15);
S.bell(sb('outro', 8), 74, 0.08, -0.2, { decay: 2.2, dur: 4 });
S.bell(sb('outro', 8.02), 81, 0.05, 0.3, { decay: 2.2, dur: 4 });

// ───────── 输出 ─────────
const sections = ST.sections.map((s) => ({ ...s, start: Math.round(tb(s.startBar) * 1e4) / 1e4, end: Math.round(tb(s.startBar + s.bars) * 1e4) / 1e4 }));
const r = S.render({
  wav: resolve(here, '../out/music/score.wav'),
  events: resolve(here, 'events.json'),
  sections,
  duckDepth: 0.68,
  duckRelease: 0.085,
  fadeOut: 1.6,
  meta: { version: 3 },
});
console.log(`配乐 v3 已生成：${r.duration.toFixed(2)} 秒（${ST.bpm} BPM，${ST.bars} 小节）；底鼓 ${r.kicks}、军鼓/拍手 ${r.snares}、撞击 ${r.impacts}`);
