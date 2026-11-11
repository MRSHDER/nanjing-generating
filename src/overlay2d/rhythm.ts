import { BEAT } from '../engine/beat';

export function steppedBeat(beat: number) {
  const whole = Math.floor(beat);
  const progress = Math.min(1, Math.max(0, (beat - whole) / 0.18));
  const eased = progress * progress * (3 - 2 * progress);
  return whole + eased * 0.999;
}

export function flowBeat(beat: number) {
  return beat - 0.7 * Math.sin(Math.PI * beat) / Math.PI;
}

export function openingFlow(beat: number) {
  const start = 6 / BEAT;
  const progress = Math.min(1, Math.max(0, (beat - start) / (16 - start)));
  return flowBeat(progress * 2) / 2;
}

export function openingBeat(beat: number) {
  const start = 6 / BEAT;
  if (beat < start) return steppedBeat(beat);
  const anchor = steppedBeat(start);
  return Math.min(15.999, anchor + (16 - anchor) * openingFlow(beat));
}
