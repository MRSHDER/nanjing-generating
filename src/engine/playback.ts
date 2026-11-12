/** Playback only: original 60 fps timeline and export renderAt stay unchanged. */
export type PlaybackQuality = 'auto' | 'smooth' | 'original';
export function playbackProfile(input: { quality: PlaybackQuality; mobile: boolean; viewportWidth: number; explicitScale: number | null }) {
  const manual = input.explicitScale !== null && Number.isFinite(input.explicitScale) && input.explicitScale > 0;
  const light = !manual && (input.quality === 'smooth' || (input.quality === 'auto' && input.mobile));
  const scale = manual ? Math.min(2, input.explicitScale!) : light ? (input.quality === 'smooth' || input.viewportWidth <= 700 ? 0.5 : 2 / 3) : 1;
  return { scale, fps: light ? 30 : 60, preserveDrawingBuffer: !light };
}
export class AudioFramePacer {
  private lastFrame = -1;
  shouldRender(audioTime: number, fps: number) {
    const frame = Math.floor(audioTime * fps + 1e-7);
    if (frame === this.lastFrame) return false;
    this.lastFrame = frame;
    return true;
  }
  reset() { this.lastFrame = -1; }
}
