// 唯一的时间与节拍来源（负责人：Claude）。
// 读取 music/structure.json（结构）和 music/events.json（由 music/compose.mjs 生成的鼓点事件）。
// 画面必须是时间 t 的纯函数：这里的所有函数只依赖 t，不依赖播放历史。
import structure from '../../music/structure.json';
import events from '../../music/events.json';

export const BPM = structure.bpm;
export const BEAT = 60 / BPM; // 144 BPM 时约 0.4167 秒
export const BAR = BEAT * structure.beatsPerBar; // 约 1.667 秒
export const TOTAL = structure.bars * BAR; // 90 秒
export const FPS = 60;

export type SectionId = 'boot' | 'lock' | 'drop1' | 'glitch' | 'youth' | 'gen' | 'build' | 'drop2' | 'outro';
export type EventKind = 'tick' | 'kick' | 'snare' | 'hat' | 'openhat' | 'impact' | 'stab';
export type WindowKind = 'riser' | 'stutter' | 'gap';

export interface Envelopes {
  /** 最近一次底鼓后的衰减包络 0..1 */
  kick: number;
  /** 军鼓 / 拍手 */
  snare: number;
  /** 闭镲 + 开镲 */
  hat: number;
  /** 撞击（段落重音） */
  impact: number;
  /** 数据滴答声 */
  tick: number;
  /** 超锯齿和弦重击 */
  stab: number;
  /** 上升音进度 0..1（窗口外为 0） */
  riser: number;
  /** 处于切片重复窗口内为 1 */
  stutter: number;
  /** 处于静音停顿窗口内为 1 */
  gap: number;
}

export interface Frame {
  t: number;
  frame: number;
  beat: number;
  bar: number;
  beatPhase: number;
  barPhase: number;
  section: SectionId;
  sectionStart: number;
  sectionEnd: number;
  /** 段内时间（秒） */
  lt: number;
  /** 段内进度 0..1 */
  sp: number;
  env: Envelopes;
  /** 本段是否米白底 */
  paper: boolean;
}

interface Section {
  id: SectionId;
  title: string;
  startBar: number;
  bars: number;
  energy: number;
  paper: boolean;
  start: number;
  end: number;
}

export const SECTIONS: Section[] = structure.sections.map((s) => ({
  ...(s as Omit<Section, 'start' | 'end'>),
  start: s.startBar * BAR,
  end: (s.startBar + s.bars) * BAR,
}));

const EV = events as unknown as Record<string, unknown>;
const times = (k: string) => ((EV[k] as number[] | undefined) ?? []).slice().sort((a, b) => a - b);
const windows = (k: string) => (EV[k] as [number, number][] | undefined) ?? [];

const LISTS: Record<EventKind, number[]> = {
  tick: times('tick'),
  kick: times('kick'),
  snare: times('snare'),
  hat: [...times('hat'), ...times('openhat')].sort((a, b) => a - b),
  openhat: times('openhat'),
  impact: times('impact'),
  stab: times('stab'),
};
const WINDOWS: Record<WindowKind, [number, number][]> = {
  riser: windows('riser'),
  stutter: windows('stutter'),
  gap: windows('gap'),
};

/** 时间 ≤ t 的最后一个事件；没有则返回 -Infinity。 */
export function lastEvent(kind: EventKind, t: number): number {
  const a = LISTS[kind];
  let lo = 0, hi = a.length - 1, ans = -Infinity;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (a[m]! <= t + 1e-6) {
      ans = a[m]!;
      lo = m + 1;
    } else hi = m - 1;
  }
  return ans;
}

/** [t0, t1) 内的事件时间。 */
export function eventsIn(kind: EventKind, t0: number, t1: number): number[] {
  return LISTS[kind].filter((x) => x >= t0 && x < t1);
}

/** 指数衰减包络：事件发生瞬间为 1，按 halfLife（秒）减半。 */
export function envOf(kind: EventKind, t: number, halfLife: number): number {
  const e = lastEvent(kind, t);
  if (!Number.isFinite(e)) return 0;
  return Math.pow(0.5, (t - e) / halfLife);
}

function windowEnv(kind: WindowKind, t: number, progress: boolean): number {
  for (const [a, b] of WINDOWS[kind]) if (t >= a && t < b) return progress ? (t - a) / (b - a) : 1;
  return 0;
}

export function sectionAt(t: number): Section {
  const tt = Math.min(Math.max(t, 0), TOTAL - 1e-6);
  return SECTIONS.find((s) => tt >= s.start && tt < s.end) ?? SECTIONS[SECTIONS.length - 1]!;
}

export function sectionRange(id: SectionId) {
  const s = SECTIONS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown section ${id}`);
  return { start: s.start, end: s.end, startBar: s.startBar, bars: s.bars };
}

export function frameAt(t: number): Frame {
  const s = sectionAt(t);
  const beat = t / BEAT;
  const bar = t / BAR;
  return {
    t,
    frame: Math.floor(t * FPS + 1e-6),
    beat,
    bar,
    beatPhase: beat - Math.floor(beat),
    barPhase: bar - Math.floor(bar),
    section: s.id,
    sectionStart: s.start,
    sectionEnd: s.end,
    lt: t - s.start,
    sp: (t - s.start) / (s.end - s.start),
    paper: s.paper,
    env: {
      kick: envOf('kick', t, 0.07),
      snare: envOf('snare', t, 0.08),
      hat: envOf('hat', t, 0.03),
      impact: envOf('impact', t, 0.25),
      tick: envOf('tick', t, 0.04),
      stab: envOf('stab', t, 0.06),
      riser: windowEnv('riser', t, true),
      stutter: windowEnv('stutter', t, false),
      gap: windowEnv('gap', t, false),
    },
  };
}


/**
 * 与音乐切片重复、静音停顿同步的“卡顿时间”：
 * - 切片窗口 [a, b) 内：时间按 1/4 → 1/8 → 1/16 拍循环（与 compose 的切片长度一致），画面跟着声音“卡”；
 * - 静音窗口 [a, b) 内：时间停在 a，画面冻结；
 * - 其余时间原样返回。仍是 t 的纯函数，可乱序取帧。
 */
export function glitchTime(t: number): number {
  for (const [a, b] of WINDOWS.gap) if (t >= a && t < b) return a;
  for (const [a, b] of WINDOWS.stutter) {
    if (t >= a && t < b) {
      const u = (t - a) / (b - a);
      const len = BEAT * (u < 0.5 ? 0.25 : u < 0.75 ? 0.125 : 0.0625);
      return a + ((t - a) % len);
    }
  }
  return t;
}
