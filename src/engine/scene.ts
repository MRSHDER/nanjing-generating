export const W = 1920;
export const H = 1080;

export interface Scene {
  id: string;
  /** 全片时间（秒）。 */
  start: number;
  end: number;
  /** t：全片时间；lt：镜头内时间。 */
  draw(ctx: CanvasRenderingContext2D, t: number, lt: number): void;
}
